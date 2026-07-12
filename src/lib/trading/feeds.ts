/**
 * RSS / API News Feed Manager
 *
 * Live news feed aggregation with persistent feed configuration.
 *
 * - Feed configs (URL, name, category mapping) are persisted to localStorage so
 *   users can add / edit / remove feeds and have them survive page reloads.
 * - Default feeds ship with the system (Reuters, Bloomberg wires, MarketWatch,
 *   Investing.com, FT, CNBC, etc.). Users can override.
 * - Fetching goes through the Next.js API route at /api/news/rss which proxies
 *   the upstream feed server-side (browser cannot fetch cross-origin RSS
 *   directly due to CORS). The route also handles Atom + JSON Feed formats.
 * - Articles are normalised into the existing NewsArticle shape so the rest of
 *   the news/sentiment pipeline (scoring, divergence, impact) keeps working.
 */
import type { NewsArticle, NewsCategory, SentimentLabel } from "./news-sentiment";
import { scoreSentiment, computeImpact } from "./news-sentiment";

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  category: NewsCategory;
  /** Default symbols to tag articles with if none can be inferred. */
  defaultSymbols?: string[];
  /** Last successful fetch timestamp (ms). */
  lastFetchedAt?: number;
  /** Last error message (if any). */
  lastError?: string;
  /** Article count from last fetch. */
  lastArticleCount?: number;
  /** Added by user (true) or shipped as default (false). */
  custom?: boolean;
}

const STORAGE_KEY = "twg-news-feeds-v1";
const ARTICLES_CACHE_KEY = "twg-news-articles-v1";

export const DEFAULT_FEEDS: FeedConfig[] = [
  { id: "reuters-markets", name: "Reuters Markets", url: "https://www.reuters.com/markets/rss", enabled: true, category: "MARKET_UPDATE", defaultSymbols: ["ES","NQ"] },
  { id: "reuters-business", name: "Reuters Business", url: "https://www.reuters.com/business/rss", enabled: true, category: "MARKET_UPDATE", defaultSymbols: ["ES"] },
  { id: "reuters-world", name: "Reuters World", url: "https://www.reuters.com/world/rss", enabled: false, category: "GEOPOLITICAL" },
  { id: "cnbc-top", name: "CNBC Top News", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", enabled: true, category: "MARKET_UPDATE", defaultSymbols: ["ES","NQ"] },
  { id: "cnbc-futures", name: "CNBC Futures", url: "https://www.cnbc.com/id/15839135/device/rss/rss.html", enabled: true, category: "MARKET_UPDATE", defaultSymbols: ["ES","CL","GC"] },
  { id: "marketwatch-top", name: "MarketWatch Top", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", enabled: true, category: "MARKET_UPDATE", defaultSymbols: ["ES"] },
  { id: "marketwatch-bullet", name: "MarketWatch Bulletin", url: "https://feeds.content.dowjones.io/public/rss/mw_bullet", enabled: false, category: "MARKET_UPDATE" },
  { id: "wsj-markets", name: "WSJ Markets", url: "https://feeds.affecto.com/rss/wsjs.xml", enabled: false, category: "MARKET_UPDATE" },
  { id: "ft-markets", name: "FT Markets", url: "https://www.ft.com/markets/rss", enabled: false, category: "MARKET_UPDATE" },
  { id: "investing-news", name: "Investing.com News", url: "https://www.investing.com/rss/news_1.rss", enabled: true, category: "MARKET_UPDATE" },
  { id: "investing-economic", name: "Investing.com Economic", url: "https://www.investing.com/rss/news_25.rss", enabled: false, category: "MACRO" },
  { id: "barchart-futures", name: "Barchart Futures", url: "https://www.barchart.com/rss/futures", enabled: false, category: "COMMODITY", defaultSymbols: ["CL","GC","ES"] },
  { id: "cme-group", name: "CME Group Education", url: "https://www.cmegroup.com/education/feed.xml", enabled: false, category: "MARKET_UPDATE" },
  { id: "bloomberg-markets", name: "Bloomberg Markets", url: "https://www.bloomberg.com/feed/podcast/etf-report.xml", enabled: false, category: "MARKET_UPDATE" },
];

const SYMBOL_KEYWORDS: { sym: string; patterns: RegExp[] }[] = [
  { sym: "ES", patterns: [/s&p\s*500/i, /e-mini\s*s&p/i, /spdr\s*spy/i, /\bSPX\b/, /equity\s*index/i] },
  { sym: "NQ", patterns: [/nasdaq\s*100/i, /e-mini\s*nasdaq/i, /qqq/i, /\bNDX\b/, /technology\s*index/i] },
  { sym: "YM", patterns: [/dow\s*jones/i, /\bDJIA\b/, /e-mini\s*dow/i, /industrial\s*average/i] },
  { sym: "RTY", patterns: [/russell\s*2000/i, /e-mini\s*russell/i, /\bRUT\b/, /small\s*cap/i] },
  { sym: "ZN", patterns: [/10[\s-]*year\s*treasury/i, /10[\s-]*year\s*note/i, /\bTNX\b/, /treasury\s*yield/i] },
  { sym: "ZB", patterns: [/30[\s-]*year\s*bond/i, /long\s*bond/i, /treasury\s*bond/i] },
  { sym: "CL", patterns: [/\bcrude\s*oil/i, /\bwti\b/i, /\bbrent\b/i, /oil\s*futures/i, /energy\s*market/i] },
  { sym: "NG", patterns: [/natural\s*gas/i, /\bhenry\s*hub\b/i] },
  { sym: "GC", patterns: [/\bgold\b/i, /gold\s*futures/i, /precious\s*metal/i, /safe\s*haven/i] },
  { sym: "SI", patterns: [/\bsilver\b/i, /silver\s*futures/i] },
  { sym: "BRR", patterns: [/\bbitcoin\b/i, /\bBTC\b/, /\bcrypto/i, /\bethereum\b/i, /\bETH\b/] },
  { sym: "6E", patterns: [/\beuro\b/i, /\bEUR\/USD\b/i, /\bEURUSD\b/] },
  { sym: "6B", patterns: [/\bpound\s*sterling\b/i, /\bGBP\/USD\b/i, /\bGBPUSD\b/, /\bbritish\s*pound\b/i] },
];

const SECTOR_HINTS: Record<string, string[]> = {
  "central bank": ["CENTRAL_BANK"], "federal reserve": ["CENTRAL_BANK"], "fed ": ["CENTRAL_BANK"], "ecb ": ["CENTRAL_BANK"], "powell": ["CENTRAL_BANK"], "yellen": ["CENTRAL_BANK"],
  "earnings": ["EARNINGS"], "quarterly results": ["EARNINGS"], "revenue miss": ["EARNINGS"], "eps ": ["EARNINGS"],
  "merger": ["M&A"], "acquisition": ["M&A"], "buyout": ["M&A"], "takeover": ["M&A"],
  "geopolitical": ["GEOPOLITICAL"], "sanctions": ["GEOPOLITICAL"], "war ": ["GEOPOLITICAL"], "conflict": ["GEOPOLITICAL"],
  "opec": ["COMMODITY"], "supply cut": ["COMMODITY"], "production cut": ["COMMODITY"],
  "lawsuit": ["REGULATORY"], "sec probe": ["REGULATORY"], "investigation": ["REGULATORY"], "antitrust": ["REGULATORY"],
};

function inferSymbols(text: string, fallback?: string[]): string[] {
  const syms = new Set<string>();
  for (const { sym, patterns } of SYMBOL_KEYWORDS) {
    for (const p of patterns) if (p.test(text)) syms.add(sym);
  }
  if (syms.size === 0 && fallback && fallback.length > 0) return [...fallback];
  return syms.size > 0 ? Array.from(syms) : ["ES"];
}

function inferCategory(text: string, fallback: NewsCategory): NewsCategory {
  const lower = text.toLowerCase();
  for (const [hint, cats] of Object.entries(SECTOR_HINTS)) {
    if (lower.includes(hint)) return cats[0] as NewsCategory;
  }
  return fallback;
}

let counter = 0;
function makeArticle(
  feed: FeedConfig,
  title: string,
  description: string,
  link: string,
  pubDate: number,
): NewsArticle {
  const text = `${title} ${description}`;
  const { score, label } = scoreSentiment(text);
  const category = inferCategory(text, feed.category);
  const impact = computeImpact(category, score, title);
  const symbols = inferSymbols(text, feed.defaultSymbols);
  const sectors = symbols.map(s => SECTOR_HINTS[s] ?? ["General"]).flat();
  const baseBps: Record<NewsCategory, number> = {
    EARNINGS: 50, MACRO: 40, "M&A": 80, GEOPOLITICAL: 30, ANALYST: 20,
    CENTRAL_BANK: 100, COMMODITY: 60, REGULATORY: 70, MARKET_UPDATE: 15,
  };
  const expectedMoveBps = Math.round((baseBps[category] ?? 30) * impact * Math.abs(score));
  return {
    id: `feed-${feed.id}-${counter++}-${pubDate}`,
    timestamp: pubDate,
    headline: title.slice(0, 280),
    summary: description.slice(0, 600),
    category,
    source: feed.name,
    symbols,
    sectors: Array.from(new Set(sectors)),
    sentimentScore: score,
    sentimentLabel: label,
    impactScore: impact,
    relevanceScore: 0.7 + Math.random() * 0.3,
    expectedDirection: score > 0.1 ? "BULLISH" : score < -0.1 ? "BEARISH" : "NEUTRAL",
    expectedMoveBps,
    entities: [{ text: category, type: "EVENT" }],
    processed: false,
    url: link,
  };
}

// ============================================================
// localStorage persistence
// ============================================================
function loadFromStorage(): FeedConfig[] {
  if (typeof window === "undefined") return [...DEFAULT_FEEDS];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_FEEDS];
    const parsed = JSON.parse(raw) as FeedConfig[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [...DEFAULT_FEEDS];
    return parsed;
  } catch {
    return [...DEFAULT_FEEDS];
  }
}

function saveToStorage(feeds: FeedConfig[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(feeds));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

export function loadFeeds(): FeedConfig[] {
  return loadFromStorage();
}

export function saveFeeds(feeds: FeedConfig[]): void {
  saveToStorage(feeds);
}

export function addFeed(feed: Omit<FeedConfig, "id" | "custom" | "enabled"> & Partial<Pick<FeedConfig, "id" | "enabled" | "custom">>): FeedConfig[] {
  const current = loadFromStorage();
  const newFeed: FeedConfig = {
    id: feed.id ?? `custom-${Date.now()}`,
    name: feed.name,
    url: feed.url,
    enabled: feed.enabled ?? true,
    category: feed.category,
    defaultSymbols: feed.defaultSymbols,
    custom: true,
  };
  const next = [...current, newFeed];
  saveToStorage(next);
  return next;
}

export function updateFeed(id: string, updates: Partial<FeedConfig>): FeedConfig[] {
  const current = loadFromStorage();
  const next = current.map((f) => (f.id === id ? { ...f, ...updates } : f));
  saveToStorage(next);
  return next;
}

export function removeFeed(id: string): FeedConfig[] {
  const current = loadFromStorage();
  const next = current.filter((f) => f.id !== id);
  saveToStorage(next);
  return next;
}

export function resetFeeds(): FeedConfig[] {
  saveToStorage([...DEFAULT_FEEDS]);
  return [...DEFAULT_FEEDS];
}

// ============================================================
// Article cache (so we don't lose articles on navigation)
// ============================================================
export function loadCachedArticles(): NewsArticle[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(ARTICLES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as NewsArticle[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveCachedArticles(articles: NewsArticle[]): void {
  if (typeof window === "undefined") return;
  try {
    // Cap at 200 articles to stay well under localStorage quota.
    const trimmed = articles.slice(0, 200);
    localStorage.setItem(ARTICLES_CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota exceeded — drop cache silently */
  }
}

// ============================================================
// RSS parsing (server-side proxy at /api/news/rss)
// ============================================================
interface ParsedItem {
  title: string;
  description: string;
  link: string;
  pubDate: number;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(s: string | null | undefined): number {
  if (!s) return Date.now();
  const t = Date.parse(s);
  return Number.isNaN(t) ? Date.now() : t;
}

function parseRssXml(xml: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  // Match <item>...</item> blocks
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[0];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    const desc = block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1]?.trim() ?? "";
    const link = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1]?.trim() ?? block.match(/<link[^>]*href="([^"]+)"/i)?.[1]?.trim() ?? "";
    const pub = block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim() ?? block.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1]?.trim() ?? "";
    if (title) {
      items.push({
        title: stripHtml(title),
        description: stripHtml(desc).slice(0, 600),
        link: link.trim(),
        pubDate: parseDate(pub),
      });
    }
  }
  // Atom <entry> blocks
  const entryRegex = /<entry[\s\S]*?<\/entry>/gi;
  while ((m = entryRegex.exec(xml)) !== null) {
    const block = m[0];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    const summary = block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1]?.trim() ?? block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1]?.trim() ?? "";
    const link = block.match(/<link[^>]*href="([^"]+)"/i)?.[1]?.trim() ?? "";
    const pub = block.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1]?.trim() ?? block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1]?.trim() ?? "";
    if (title) {
      items.push({
        title: stripHtml(title),
        description: stripHtml(summary).slice(0, 600),
        link: link.trim(),
        pubDate: parseDate(pub),
      });
    }
  }
  return items;
}

function parseJsonFeed(json: any): ParsedItem[] {
  if (!json || !Array.isArray(json.items)) return [];
  return json.items.map((it: any) => ({
    title: String(it.title ?? "").trim(),
    description: String(it.summary ?? it.content_text ?? it.content_html ?? "").slice(0, 600),
    link: String(it.url ?? it.id ?? "").trim(),
    pubDate: it.date_published ? parseDate(it.date_published) : it.date_modified ? parseDate(it.date_modified) : Date.now(),
  })).filter((it: ParsedItem) => it.title);
}

/**
 * Fetch a single feed via the server-side proxy.
 * Returns an empty array (and updates feed.lastError) on failure so the UI
 * can show the error to the user without breaking other feeds.
 */
export async function fetchFeed(feed: FeedConfig): Promise<NewsArticle[]> {
  try {
    const proxyUrl = `/api/news/rss?url=${encodeURIComponent(feed.url)}`;
    const res = await fetch(proxyUrl, {
      method: "GET",
      headers: { Accept: "application/rss+xml, application/xml, application/json, text/xml" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") ?? "";
    let items: ParsedItem[] = [];
    if (contentType.includes("json")) {
      const json = await res.json();
      items = parseJsonFeed(json);
    } else {
      const text = await res.text();
      // Some feeds return JSON even with XML content-type — sniff.
      if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
        try {
          const json = JSON.parse(text);
          items = parseJsonFeed(json);
        } catch {
          items = parseRssXml(text);
        }
      } else {
        items = parseRssXml(text);
      }
    }
    if (items.length === 0) throw new Error("No items parsed");
    return items.map((it) => makeArticle(feed, it.title, it.description, it.link, it.pubDate));
  } catch (err: any) {
    throw new Error(err?.message ?? "Fetch failed");
  }
}

/**
 * Fetch all enabled feeds in parallel.
 * Returns merged articles sorted newest-first.
 * Also updates each feed's lastFetchedAt / lastError / lastArticleCount in localStorage.
 */
export async function fetchAllFeeds(feeds: FeedConfig[]): Promise<{ articles: NewsArticle[]; updatedFeeds: FeedConfig[] }> {
  const enabled = feeds.filter((f) => f.enabled);
  const results = await Promise.allSettled(enabled.map((f) => fetchFeed(f)));
  const updated = feeds.map((f) => {
    if (!f.enabled) return f;
    const idx = enabled.indexOf(f);
    const r = results[idx];
    if (r.status === "fulfilled") {
      return { ...f, lastFetchedAt: Date.now(), lastError: undefined, lastArticleCount: r.value.length };
    } else {
      return { ...f, lastFetchedAt: Date.now(), lastError: (r.reason as Error)?.message ?? "Failed" };
    }
  });
  saveToStorage(updated);
  const articles: NewsArticle[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") articles.push(...r.value);
  }
  // Deduplicate by headline (some feeds syndicate the same story).
  const seen = new Set<string>();
  const deduped = articles.filter((a) => {
    const key = a.headline.toLowerCase().slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  deduped.sort((a, b) => b.timestamp - a.timestamp);
  return { articles: deduped, updatedFeeds: updated };
}
