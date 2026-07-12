"use client";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { computeSentimentSummary, type NewsArticle, type NewsCategory } from "@/lib/trading/news-sentiment";
import {
  loadFeeds,
  addFeed,
  updateFeed,
  removeFeed,
  resetFeeds,
  fetchAllFeeds,
  loadCachedArticles,
  saveCachedArticles,
  DEFAULT_FEEDS,
  type FeedConfig,
} from "@/lib/trading/feeds";
import { generateNewsBatch } from "@/lib/trading/news-sentiment";
import { fmtTime } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { Activity, ExternalLink, Flame, Loader2, Newspaper, Plus, RefreshCw, Rss, Settings, Trash2, TrendingDown, TrendingUp, Zap } from "lucide-react";

const CAT_BADGES: Record<NewsCategory, { bg: string; text: string }> = {
  EARNINGS: { bg: "bg-blue-500/15", text: "text-blue-400" }, MACRO: { bg: "bg-amber-500/15", text: "text-amber-400" },
  "M&A": { bg: "bg-purple-500/15", text: "text-purple-400" }, GEOPOLITICAL: { bg: "bg-rose-500/15", text: "text-rose-400" },
  ANALYST: { bg: "bg-cyan-500/15", text: "text-cyan-400" }, CENTRAL_BANK: { bg: "bg-pink-500/15", text: "text-pink-400" },
  COMMODITY: { bg: "bg-emerald-500/15", text: "text-emerald-400" }, REGULATORY: { bg: "bg-red-500/15", text: "text-red-400" },
  MARKET_UPDATE: { bg: "bg-muted", text: "text-muted-foreground" },
};

const CATEGORIES: NewsCategory[] = ["MARKET_UPDATE", "MACRO", "EARNINGS", "CENTRAL_BANK", "COMMODITY", "GEOPOLITICAL", "ANALYST", "M&A", "REGULATORY"];

type View = "feed" | "manage";
const REFRESH_MS = 5 * 60 * 1000; // 5 min auto-refresh

export function NewsSentiment() {
  const [view, setView] = useState<View>("feed");
  // Articles: live-fetched ones first; we keep simulated ones as fallback.
  const [articles, setArticles] = useState<NewsArticle[]>(() => {
    if (typeof window !== "undefined") {
      const cached = loadCachedArticles();
      if (cached.length > 0) return cached;
    }
    return generateNewsBatch(["ES","NQ","CL","GC","ZN","BRR"], 15);
  });
  const [feeds, setFeeds] = useState<FeedConfig[]>(() => loadFeeds());
  const [filterSymbol, setFilterSymbol] = useState("ALL");
  const [filterSentiment, setFilterSentiment] = useState("ALL");
  const [showSummary, setShowSummary] = useState(true);
  const [loading, setLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const tickCount = useTradingStore((s) => s.tickCount);
  const quotes = useTradingStore((s) => s.quotes);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const lastRefresh = useRef<number>(0);

  const refreshFeeds = useCallback(async (silent = false) => {
    if (loading) return;
    if (!silent) setLoading(true);
    try {
      const currentFeeds = loadFeeds();
      const { articles: fetched, updatedFeeds } = await fetchAllFeeds(currentFeeds);
      setFeeds(updatedFeeds);
      if (fetched.length > 0) {
        // Merge: keep existing articles that aren't already in the new fetch,
        // then sort newest-first, cap at 100.
        setArticles((prev) => {
          const existingById = new Map(prev.map((a) => [a.id, a]));
          const merged: NewsArticle[] = [];
          const seen = new Set<string>();
          for (const a of fetched) {
            if (!seen.has(a.id)) { merged.push(a); seen.add(a.id); }
          }
          for (const a of prev) {
            if (merged.length >= 100) break;
            if (!seen.has(a.id) && !fetched.some((f) => f.headline === a.headline)) {
              merged.push(a); seen.add(a.id);
            }
          }
          merged.sort((a, b) => b.timestamp - a.timestamp);
          saveCachedArticles(merged);
          return merged.slice(0, 100);
        });
      }
      setLastFetch(Date.now());
      lastRefresh.current = Date.now();
    } catch (err) {
      // Silently fail — the per-feed errors are surfaced in the manage view.
    } finally {
      if (!silent) setLoading(false);
    }
  }, [loading]);

  // Initial fetch on mount + auto-refresh every 5 minutes.
  useEffect(() => {
    refreshFeeds(true);
    if (!autoRefresh) return;
    const id = setInterval(() => refreshFeeds(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, refreshFeeds]);

  const summary = useMemo(() => computeSentimentSummary(articles, quotes), [articles, quotes]);
  const filtered = articles.filter(a =>
    (filterSymbol === "ALL" || a.symbols.includes(filterSymbol)) &&
    (filterSentiment === "ALL" || a.sentimentLabel === filterSentiment)
  );
  const allSymbols = Array.from(new Set(articles.flatMap(a => a.symbols))).sort();

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setView("feed")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors",
              view === "feed" ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}
          >
            <Newspaper className="w-3.5 h-3.5" /> Feed
          </button>
          <button
            onClick={() => setView("manage")}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors",
              view === "manage" ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}
          >
            <Settings className="w-3.5 h-3.5" /> Manage Feeds
          </button>
        </div>
        <div className="h-5 w-px bg-border" />
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => refreshFeeds(false)} disabled={loading}>
          {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
          {loading ? "Fetching..." : "Refresh Now"}
        </Button>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="w-3 h-3 accent-primary" />
          Auto-refresh (5 min)
        </label>
        {lastFetch && (
          <span className="text-[10px] text-muted-foreground ml-auto font-mono">
            Last: {new Date(lastFetch).toLocaleTimeString("en-US", { hour12: false })}
          </span>
        )}
      </div>

      {view === "feed" && (
        <>
          {/* Summary stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {[["Total", summary.totalArticles], ["Positive", summary.positiveCount], ["Negative", summary.negativeCount], ["Neutral", summary.neutralCount], ["Avg Sentiment", summary.avgSentiment.toFixed(2)], ["Momentum", (summary.sentimentMomentum > 0 ? "↑" : summary.sentimentMomentum < 0 ? "↓" : "→") + " " + Math.abs(summary.sentimentMomentum).toFixed(2)]].map(([label, val]: any, i) => (
              <Card key={i} className={cn("p-2.5 border", label === "Positive" && "border-emerald-500/20 bg-emerald-500/5", label === "Negative" && "border-rose-500/20 bg-rose-500/5")}>
                <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
                <div className={cn("text-sm font-mono font-semibold", label === "Positive" && "text-emerald-400", label === "Negative" && "text-rose-400")}>{val}</div>
              </Card>
            ))}
          </div>

          {showSummary && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <Card>
                <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Activity className="w-3.5 h-3.5" /> Sentiment by Symbol</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={summary.symbolSentiment.map(s => ({ symbol: s.symbol, sentiment: s.avgSentiment }))} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                        <XAxis type="number" domain={[-1,1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis type="category" dataKey="symbol" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} />
                        <Tooltip formatter={(v: any) => Number(v).toFixed(2)} />
                        <ReferenceLine x={0} stroke="#666" />
                        <Bar dataKey="sentiment" radius={[0,4,4,0]}>
                          {summary.symbolSentiment.map((s,i) => <Cell key={i} fill={s.avgSentiment >= 0 ? "#10b981" : "#ef4444"} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Zap className="w-3.5 h-3.5" /> Price-Sentiment Divergence</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-y border-border">
                      <tr className="text-muted-foreground text-[10px] uppercase">
                        <th className="text-left py-2 px-3">Symbol</th>
                        <th className="text-right py-2 px-3">Price%</th>
                        <th className="text-right py-2 px-3">Sentiment</th>
                        <th className="text-center py-2 px-3">Signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.priceSentimentDivergence.map((d, i) => (
                        <tr key={i} className="border-b border-border/40 hover:bg-muted/30 cursor-pointer" onClick={() => { selectSymbol(d.symbol); setFilterSymbol(d.symbol); }}>
                          <td className="py-1.5 px-3 font-mono font-medium">{d.symbol}</td>
                          <td className={cn("py-1.5 px-3 text-right font-mono", d.priceChangePct >= 0 ? "text-emerald-400" : "text-rose-400")}>{d.priceChangePct.toFixed(2)}%</td>
                          <td className={cn("py-1.5 px-3 text-right font-mono", d.sentimentScore >= 0 ? "text-emerald-400" : "text-rose-400")}>{d.sentimentScore.toFixed(2)}</td>
                          <td className="py-1.5 px-3 text-center">
                            {d.divergence === "BULLISH_DIVERGENCE" ? <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-400">BULL DIV</Badge>
                              : d.divergence === "BEARISH_DIVERGENCE" ? <Badge variant="outline" className="text-[9px] bg-rose-500/15 text-rose-400">BEAR DIV</Badge>
                              : d.divergence === "CONFIRMING" ? <Badge variant="outline" className="text-[9px] bg-blue-500/15 text-blue-400">CONFIRM</Badge>
                              : <Badge variant="outline" className="text-[9px]">—</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <select value={filterSymbol} onChange={(e) => setFilterSymbol(e.target.value)} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs">
              <option value="ALL">All Symbols</option>
              {allSymbols.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterSentiment} onChange={(e) => setFilterSentiment(e.target.value)} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs">
              <option value="ALL">All Sentiment</option>
              <option value="POSITIVE">Positive</option>
              <option value="NEGATIVE">Negative</option>
            </select>
            <Button variant="outline" size="sm" className="h-7 text-xs ml-auto" onClick={() => setShowSummary(!showSummary)}>{showSummary ? "Hide" : "Show"} Analytics</Button>
          </div>

          <Card>
            <CardHeader className="py-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs flex items-center gap-2">
                <Newspaper className="w-3.5 h-3.5" /> Live News Feed ({filtered.length})
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] flex items-center gap-1">
                  <Rss className="w-2.5 h-2.5" />
                  {feeds.filter(f => f.enabled).length} feeds active
                </Badge>
                {autoRefresh && <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-400">Auto · 5 min</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-0 max-h-[700px] overflow-y-auto">
              {filtered.length === 0 && (
                <div className="text-center py-8 text-muted-foreground text-xs">
                  No articles yet. Click "Refresh Now" to fetch live news, or check "Manage Feeds" to enable more sources.
                </div>
              )}
              {filtered.map(article => {
                const cb = CAT_BADGES[article.category];
                const sc = article.sentimentScore > 0.15 ? "text-emerald-400" : article.sentimentScore < -0.15 ? "text-rose-400" : "text-muted-foreground";
                const hi = article.impactScore > 0.6;
                const isLive = !!article.url;
                return (
                  <div key={article.id} className={cn("border rounded-md p-2.5", hi ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/20 hover:bg-muted/30")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-[10px] font-mono text-muted-foreground">{fmtTime(article.timestamp)}</span>
                          <Badge variant="outline" className={cn("text-[9px] h-4 px-1", cb.bg, cb.text)}>{article.category}</Badge>
                          <span className="text-[10px] text-muted-foreground">{article.source}</span>
                          {isLive && <Badge variant="outline" className="text-[9px] h-4 px-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30"><Rss className="w-2 h-2 mr-0.5" />LIVE</Badge>}
                          {hi && <Badge variant="outline" className="text-[9px] h-4 px-1 bg-amber-500/15 text-amber-400 border-amber-500/30"><Flame className="w-2.5 h-2.5 mr-0.5" />HIGH</Badge>}
                        </div>
                        <h3 className="text-xs font-semibold leading-tight">
                          {isLive && article.url ? (
                            <a href={article.url} target="_blank" rel="noopener noreferrer" className="hover:text-primary inline-flex items-start gap-1">
                              <span>{article.headline}</span>
                              <ExternalLink className="w-2.5 h-2.5 mt-0.5 shrink-0 text-muted-foreground" />
                            </a>
                          ) : article.headline}
                        </h3>
                        <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{article.summary}</p>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {article.symbols.map(s => (
                            <button key={s} onClick={() => selectSymbol(s)} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted hover:bg-primary/20 text-foreground hover:text-primary">{s}</button>
                          ))}
                        </div>
                      </div>
                      <div className="shrink-0 text-right border-l border-border/40 pl-2 min-w-[80px]">
                        <div className="text-[9px] uppercase text-muted-foreground">Sentiment</div>
                        <div className={cn("text-lg font-mono font-bold", sc)}>{article.sentimentScore > 0 ? "+" : ""}{article.sentimentScore.toFixed(2)}</div>
                        <div className={cn("text-[10px] font-medium", sc)}>{article.sentimentLabel}</div>
                        <div className="border-t border-border/30 mt-1 pt-1">
                          <div className="text-[9px] uppercase text-muted-foreground">Impact</div>
                          <div className="text-xs font-mono">{(article.impactScore * 100).toFixed(0)}%</div>
                        </div>
                        <div className="border-t border-border/30 mt-1 pt-1">
                          <div className="text-[9px] uppercase text-muted-foreground">Expected</div>
                          <div className={cn("text-xs font-mono font-medium", article.expectedDirection === "BULLISH" ? "text-emerald-400" : article.expectedDirection === "BEARISH" ? "text-rose-400" : "")}>
                            {article.expectedDirection === "BULLISH" ? "▲" : article.expectedDirection === "BEARISH" ? "▼" : "→"} {article.expectedMoveBps}bps
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}

      {view === "manage" && (
        <FeedManager
          feeds={feeds}
          onAdd={(feed) => setFeeds(addFeed(feed))}
          onUpdate={(id, updates) => setFeeds(updateFeed(id, updates))}
          onRemove={(id) => setFeeds(removeFeed(id))}
          onReset={() => { resetFeeds(); setFeeds([...DEFAULT_FEEDS]); }}
          onRefresh={refreshFeeds}
          loading={loading}
        />
      )}
    </div>
  );
}

// ============================================================
// Feed Manager Sub-Component
// ============================================================
function FeedManager({
  feeds, onAdd, onUpdate, onRemove, onReset, onRefresh, loading,
}: {
  feeds: FeedConfig[];
  onAdd: (feed: Omit<FeedConfig, "id" | "custom" | "enabled"> & Partial<Pick<FeedConfig, "id" | "enabled" | "custom">>) => void;
  onUpdate: (id: string, updates: Partial<FeedConfig>) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newCat, setNewCat] = useState<NewsCategory>("MARKET_UPDATE");
  const [newSyms, setNewSyms] = useState("");

  const handleAdd = () => {
    if (!newName.trim() || !newUrl.trim()) return;
    if (!/^https?:\/\//i.test(newUrl.trim())) {
      alert("Feed URL must start with http:// or https://");
      return;
    }
    onAdd({
      name: newName.trim(),
      url: newUrl.trim(),
      category: newCat,
      defaultSymbols: newSyms.split(",").map(s => s.trim().toUpperCase()).filter(Boolean),
    });
    setNewName(""); setNewUrl(""); setNewSyms("");
  };

  const enabledCount = feeds.filter(f => f.enabled).length;
  const errorCount = feeds.filter(f => f.lastError).length;

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Total Feeds</div>
            <div className="text-lg font-mono font-semibold">{feeds.length}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Enabled</div>
            <div className="text-lg font-mono font-semibold text-emerald-400">{enabledCount}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Custom</div>
            <div className="text-lg font-mono font-semibold text-blue-400">{feeds.filter(f => f.custom).length}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Errors</div>
            <div className={cn("text-lg font-mono font-semibold", errorCount > 0 ? "text-rose-400" : "text-emerald-400")}>{errorCount}</div>
          </div>
        </CardContent>
      </Card>

      {/* Add new feed */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Plus className="w-3.5 h-3.5" /> Add New Feed</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <div className="md:col-span-3">
              <Label className="text-[10px] text-muted-foreground">Name</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. My Custom Feed" className="h-8 text-xs mt-0.5" />
            </div>
            <div className="md:col-span-5">
              <Label className="text-[10px] text-muted-foreground">RSS / Atom / JSON Feed URL</Label>
              <Input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://example.com/feed.xml" className="h-8 text-xs mt-0.5 font-mono" />
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10px] text-muted-foreground">Category</Label>
              <select value={newCat} onChange={e => setNewCat(e.target.value as NewsCategory)} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <Label className="text-[10px] text-muted-foreground">Symbols (comma)</Label>
              <Input value={newSyms} onChange={e => setNewSyms(e.target.value)} placeholder="ES, NQ" className="h-8 text-xs mt-0.5 font-mono" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleAdd} size="sm" className="h-7 text-xs"><Plus className="w-3 h-3 mr-1" /> Add Feed</Button>
            <Button onClick={onReset} variant="outline" size="sm" className="h-7 text-xs">Reset to Defaults</Button>
            <Button onClick={onRefresh} variant="outline" size="sm" className="h-7 text-xs ml-auto" disabled={loading}>
              {loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />} Refresh All
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Feed list */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Rss className="w-3.5 h-3.5" /> Configured Feeds ({feeds.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase">
                  <th className="text-center py-2 px-2 w-10">On</th>
                  <th className="text-left py-2 px-3">Name</th>
                  <th className="text-left py-2 px-3">Category</th>
                  <th className="text-left py-2 px-3">Syms</th>
                  <th className="text-right py-2 px-3">Items</th>
                  <th className="text-left py-2 px-3">Last Fetched</th>
                  <th className="text-left py-2 px-3">Status</th>
                  <th className="text-center py-2 px-2 w-16">Action</th>
                </tr>
              </thead>
              <tbody>
                {feeds.map(f => (
                  <tr key={f.id} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="py-1.5 px-2 text-center">
                      <input type="checkbox" checked={f.enabled} onChange={e => onUpdate(f.id, { enabled: e.target.checked })} className="w-3.5 h-3.5 accent-primary cursor-pointer" />
                    </td>
                    <td className="py-1.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{f.name}</span>
                        {f.custom && <Badge variant="outline" className="text-[9px] bg-blue-500/15 text-blue-400 h-4 px-1">CUSTOM</Badge>}
                      </div>
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-muted-foreground font-mono hover:text-primary truncate block max-w-[300px]">{f.url}</a>
                    </td>
                    <td className="py-1.5 px-3">
                      <Badge variant="outline" className={cn("text-[9px] h-4 px-1", CAT_BADGES[f.category].bg, CAT_BADGES[f.category].text)}>{f.category}</Badge>
                    </td>
                    <td className="py-1.5 px-3 font-mono text-[10px] text-muted-foreground">{f.defaultSymbols?.join(",") || "—"}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{f.lastArticleCount ?? "—"}</td>
                    <td className="py-1.5 px-3 text-[10px] font-mono text-muted-foreground">{f.lastFetchedAt ? new Date(f.lastFetchedAt).toLocaleTimeString("en-US", { hour12: false }) : "—"}</td>
                    <td className="py-1.5 px-3">
                      {f.lastError ? (
                        <Badge variant="outline" className="text-[9px] bg-rose-500/15 text-rose-400 border-rose-500/30" title={f.lastError}>ERROR</Badge>
                      ) : f.lastFetchedAt ? (
                        <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-400">OK</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] text-muted-foreground">—</Badge>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <button
                        onClick={() => { if (confirm(`Remove feed "${f.name}"?`)) onRemove(f.id); }}
                        className="text-muted-foreground hover:text-rose-400 p-1"
                        title="Remove feed"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
