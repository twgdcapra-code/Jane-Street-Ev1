/** News & Sentiment Engine — based on research/news_sentiment.md */
import { CONTRACTS } from "./contracts";
import type { Quote } from "./types";

export type NewsCategory = "EARNINGS" | "MACRO" | "M&A" | "GEOPOLITICAL" | "ANALYST" | "CENTRAL_BANK" | "COMMODITY" | "REGULATORY" | "MARKET_UPDATE";
export type SentimentLabel = "POSITIVE" | "NEGATIVE" | "NEUTRAL";

export interface NewsArticle {
  id: string; timestamp: number; headline: string; summary: string;
  category: NewsCategory; source: string; symbols: string[]; sectors: string[];
  sentimentScore: number; sentimentLabel: SentimentLabel; impactScore: number;
  relevanceScore: number; expectedDirection: "BULLISH" | "BEARISH" | "NEUTRAL";
  expectedMoveBps: number; entities: { text: string; type: string }[];
  processed: boolean; priceBeforeNews?: number; priceAfterNews?: number; actualMoveBps?: number;
}

const POSITIVE_WORDS = ["beat","beats","surpass","exceed","strong","robust","growth","surge","rally","gain","positive","optimistic","bullish","upgrade","boost","profit","record","improve","outperform","buy","accumulate","overweight","expansion","opportunity","confident","momentum","recovery","rebound","favorable","encouraging","breakthrough","innovation","success"];
const NEGATIVE_WORDS = ["miss","fall","drop","decline","weak","poor","loss","bearish","sell","downgrade","cut","reduced","lower","plunge","crash","fear","risk","concern","pessimistic","underperform","warning","lawsuit","investigation","fraud","bankrupt","default","recession","crisis","collaps","slump","disappointing","pressure","headwind","challenge","uncertain","volatile"];
const UNCERTAINTY_WORDS = ["may","might","could","uncertain","pending","possible","likely","expect","estimated","preliminary"];

export function scoreSentiment(text: string): { score: number; label: SentimentLabel } {
  const lower = text.toLowerCase(); const words = lower.split(/\s+|[.,;!?()"']/);
  let pos = 0, neg = 0, unc = 0;
  for (const w of words) { const c = w.trim(); if (!c) continue; if (POSITIVE_WORDS.includes(c)) pos++; if (NEGATIVE_WORDS.includes(c)) neg++; if (UNCERTAINTY_WORDS.includes(c)) unc++; }
  const total = pos + neg; let score = total > 0 ? (pos - neg) / total : 0;
  if (unc > 0) score *= Math.max(0.3, 1 - unc * 0.15);
  score = Math.max(-1, Math.min(1, score));
  const label: SentimentLabel = score > 0.15 ? "POSITIVE" : score < -0.15 ? "NEGATIVE" : "NEUTRAL";
  return { score, label };
}

export function computeImpact(cat: NewsCategory, score: number, headline: string): number {
  const base: Record<NewsCategory, number> = { EARNINGS:0.6, MACRO:0.5, "M&A":0.7, GEOPOLITICAL:0.4, ANALYST:0.3, CENTRAL_BANK:0.8, COMMODITY:0.4, REGULATORY:0.5, MARKET_UPDATE:0.2 };
  let imp = (base[cat] ?? 0.3) * (0.5 + Math.abs(score) * 0.5);
  const lower = headline.toLowerCase();
  if (["crash","surge","plunge","rally","crisis","breakthrough","bankrupt","record"].some(w => lower.includes(w))) imp = Math.min(1, imp * 1.3);
  return Math.min(1, imp);
}

const SOURCES = ["Reuters","Bloomberg","WSJ","CNBC","Financial Times","MarketWatch","Barron's","AP"];
const SECTORS: Record<string, string[]> = { ES:["Equity Index"], NQ:["Technology"], CL:["Energy"], GC:["Metals"], NG:["Energy"], ZN:["Rates"], BRR:["Crypto"], MNQ:["Technology"], MES:["Equity Index"] };

const TEMPLATES: { headline: string; summary: string; category: NewsCategory; bias: number }[] = [
  { headline: "${sym} futures rally as earnings beat expectations", summary: "${sym} surged after major companies reported stronger-than-expected quarterly earnings, surpassing analyst estimates.", category: "EARNINGS", bias: 0.7 },
  { headline: "${sym} drops as earnings season disappoints", summary: "${sym} declined after companies missed revenue forecasts, raising concerns about growth momentum.", category: "EARNINGS", bias: -0.6 },
  { headline: "${sym} gains on stronger-than-expected CPI data", summary: "${sym} moved higher after inflation data came in cooler, fueling speculation of policy easing.", category: "MACRO", bias: 0.4 },
  { headline: "${sym} falls as GDP data misses forecasts", summary: "${sym} sold off after economic growth figures disappointed, raising recession concerns.", category: "MACRO", bias: -0.4 },
  { headline: "Fed hawks signal higher rates; ${sym} pressured", summary: "Federal Reserve officials signaled a more hawkish stance, suggesting rates may stay higher for longer.", category: "CENTRAL_BANK", bias: -0.5 },
  { headline: "Fed doves hint at rate cuts; ${sym} rallies", summary: "Fed officials hinted at potential rate cuts, citing progress on inflation and cooling labor market.", category: "CENTRAL_BANK", bias: 0.6 },
  { headline: "Analyst upgrades ${sym} to Overweight", summary: "A major Wall Street firm raised its rating, citing improving fundamentals and attractive valuation.", category: "ANALYST", bias: 0.5 },
  { headline: "Analyst downgrades ${sym} to Underweight", summary: "A major firm cut its outlook, citing deteriorating conditions and elevated risks.", category: "ANALYST", bias: -0.5 },
  { headline: "${sym} surges on supply concerns", summary: "${sym} jumped amid rising supply disruption fears and tightening inventories.", category: "COMMODITY", bias: 0.6 },
  { headline: "${sym} slumps on demand worries", summary: "${sym} tumbled amid growing demand-side concerns as global economic slowdown fears mount.", category: "COMMODITY", bias: -0.5 },
  { headline: "Major merger deal boosts ${sym} sentiment", summary: "Shares surged on reports of a potential blockbuster merger that would create a market leader.", category: "M&A", bias: 0.5 },
  { headline: "Rising geopolitical tensions pressure ${sym}", summary: "${sym} declined as escalating conflict raised safe-haven demand.", category: "GEOPOLITICAL", bias: -0.3 },
];

let counter = 0;
export function generateNewsBatch(symbols: string[], count: number = 15): NewsArticle[] {
  const articles: NewsArticle[] = []; const now = Date.now();
  for (let i = 0; i < count; i++) {
    const sym = symbols[Math.floor(Math.random() * symbols.length)];
    const tpl = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
    const headline = tpl.headline.replace("${sym}", sym); const summary = tpl.summary.replace("${sym}", sym);
    const textScore = scoreSentiment(`${headline} ${summary}`);
    const score = Math.max(-1, Math.min(1, textScore.score * 0.6 + tpl.bias * 0.4));
    const label: SentimentLabel = score > 0.15 ? "POSITIVE" : score < -0.15 ? "NEGATIVE" : "NEUTRAL";
    const impact = computeImpact(tpl.category, score, headline);
    const baseBps: Record<NewsCategory, number> = { EARNINGS:50, MACRO:40, "M&A":80, GEOPOLITICAL:30, ANALYST:20, CENTRAL_BANK:100, COMMODITY:60, REGULATORY:70, MARKET_UPDATE:15 };
    const expectedMoveBps = Math.round((baseBps[tpl.category] ?? 30) * impact * Math.abs(score));
    articles.push({
      id: `news-${now}-${counter++}`, timestamp: now - Math.floor(Math.random() * 3600000),
      headline, summary, category: tpl.category, source: SOURCES[Math.floor(Math.random() * SOURCES.length)],
      symbols: [sym], sectors: SECTORS[sym] ?? ["General"], sentimentScore: score, sentimentLabel: label,
      impactScore: impact, relevanceScore: 0.7 + Math.random() * 0.3,
      expectedDirection: score > 0.1 ? "BULLISH" : score < -0.1 ? "BEARISH" : "NEUTRAL",
      expectedMoveBps, entities: [{ text: tpl.category, type: "EVENT" }], processed: false,
    });
  }
  return articles.sort((a, b) => b.timestamp - a.timestamp);
}

export interface SentimentSummary {
  totalArticles: number; positiveCount: number; negativeCount: number; neutralCount: number;
  avgSentiment: number; sentimentMomentum: number; highImpactCount: number;
  symbolSentiment: { symbol: string; articleCount: number; avgSentiment: number; bullishPct: number }[];
  priceSentimentDivergence: { symbol: string; priceChangePct: number; sentimentScore: number; divergence: string }[];
}

export function computeSentimentSummary(articles: NewsArticle[], quotes: Record<string, Quote>): SentimentSummary {
  const total = articles.length;
  const positive = articles.filter(a => a.sentimentLabel === "POSITIVE");
  const negative = articles.filter(a => a.sentimentLabel === "NEGATIVE");
  const neutral = articles.filter(a => a.sentimentLabel === "NEUTRAL");
  const avg = total > 0 ? articles.reduce((s,a) => s + a.sentimentScore, 0) / total : 0;
  const sorted = [...articles].sort((a,b) => a.timestamp - b.timestamp);
  const split = Math.floor(sorted.length * 0.7);
  const olderAvg = sorted.slice(0, split).reduce((s,a) => s + a.sentimentScore, 0) / Math.max(split, 1);
  const recentAvg = sorted.slice(split).reduce((s,a) => s + a.sentimentScore, 0) / Math.max(sorted.length - split, 1);
  const highImpact = articles.filter(a => a.impactScore > 0.6);
  const symMap = new Map<string, { count: number; sum: number; bull: number }>();
  for (const a of articles) for (const s of a.symbols) { if (!symMap.has(s)) symMap.set(s, {count:0,sum:0,bull:0}); const v = symMap.get(s)!; v.count++; v.sum += a.sentimentScore; if (a.sentimentLabel === "POSITIVE") v.bull++; }
  const symbolSentiment = Array.from(symMap.entries()).map(([symbol, v]) => ({ symbol, articleCount: v.count, avgSentiment: v.sum / v.count, bullishPct: v.count > 0 ? v.bull / v.count * 100 : 0 })).sort((a,b) => b.articleCount - a.articleCount);
  const divergence = symbolSentiment.map(ss => { const q = quotes[ss.symbol]; const priceChg = q?.changePct ?? 0; let div = "NEUTRAL"; if (ss.avgSentiment > 0.2 && priceChg < -0.2) div = "BULLISH_DIVERGENCE"; else if (ss.avgSentiment < -0.2 && priceChg > 0.2) div = "BEARISH_DIVERGENCE"; else if (Math.sign(ss.avgSentiment) === Math.sign(priceChg)) div = "CONFIRMING"; return { symbol: ss.symbol, priceChangePct: priceChg, sentimentScore: ss.avgSentiment, divergence: div }; });
  return { totalArticles: total, positiveCount: positive.length, negativeCount: negative.length, neutralCount: neutral.length, avgSentiment: avg, sentimentMomentum: recentAvg - olderAvg, highImpactCount: highImpact.length, symbolSentiment, priceSentimentDivergence: divergence };
}
