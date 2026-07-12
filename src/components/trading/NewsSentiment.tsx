"use client";
import { useMemo, useState, useRef, useEffect } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { generateNewsBatch, computeSentimentSummary, type NewsArticle, type NewsCategory } from "@/lib/trading/news-sentiment";
import { fmtTime } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { Activity, Flame, Newspaper, TrendingDown, TrendingUp, Zap } from "lucide-react";

const CAT_BADGES: Record<NewsCategory, { bg: string; text: string }> = {
  EARNINGS: { bg: "bg-blue-500/15", text: "text-blue-400" }, MACRO: { bg: "bg-amber-500/15", text: "text-amber-400" },
  "M&A": { bg: "bg-purple-500/15", text: "text-purple-400" }, GEOPOLITICAL: { bg: "bg-rose-500/15", text: "text-rose-400" },
  ANALYST: { bg: "bg-cyan-500/15", text: "text-cyan-400" }, CENTRAL_BANK: { bg: "bg-pink-500/15", text: "text-pink-400" },
  COMMODITY: { bg: "bg-emerald-500/15", text: "text-emerald-400" }, REGULATORY: { bg: "bg-red-500/15", text: "text-red-400" },
  MARKET_UPDATE: { bg: "bg-muted", text: "text-muted-foreground" },
};

export function NewsSentiment() {
  const [articles, setArticles] = useState<NewsArticle[]>(() => generateNewsBatch(["ES","NQ","CL","GC","ZN","BRR"], 15));
  const [filterSymbol, setFilterSymbol] = useState("ALL");
  const [filterSentiment, setFilterSentiment] = useState("ALL");
  const [showSummary, setShowSummary] = useState(true);
  const tickCount = useTradingStore((s) => s.tickCount);
  const quotes = useTradingStore((s) => s.quotes);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const lastGen = useRef(Date.now());
  useEffect(() => { if (Date.now() - lastGen.current > 20000) { setArticles(prev => [...generateNewsBatch(["ES","NQ","CL","GC","ZN","BRR","MNQ","MES"], 3), ...prev].slice(0, 100)); lastGen.current = Date.now(); } }, [tickCount]);
  const summary = useMemo(() => computeSentimentSummary(articles, quotes), [articles, quotes]);
  const filtered = articles.filter(a => (filterSymbol === "ALL" || a.symbols.includes(filterSymbol)) && (filterSentiment === "ALL" || a.sentimentLabel === filterSentiment));
  const allSymbols = Array.from(new Set(articles.flatMap(a => a.symbols))).sort();

  return (
    <div className="space-y-4">
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
          <Card><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Activity className="w-3.5 h-3.5" /> Sentiment by Symbol</CardTitle></CardHeader><CardContent><div className="h-[200px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={summary.symbolSentiment.map(s => ({ symbol: s.symbol, sentiment: s.avgSentiment }))} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} /><XAxis type="number" domain={[-1,1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} /><YAxis type="category" dataKey="symbol" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} /><Tooltip formatter={(v: any) => Number(v).toFixed(2)} /><ReferenceLine x={0} stroke="#666" /><Bar dataKey="sentiment" radius={[0,4,4,0]}>{summary.symbolSentiment.map((s,i) => <Cell key={i} fill={s.avgSentiment >= 0 ? "#10b981" : "#ef4444"} />)}</Bar></BarChart></ResponsiveContainer></div></CardContent></Card>
          <Card><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Zap className="w-3.5 h-3.5" /> Price-Sentiment Divergence</CardTitle></CardHeader><CardContent className="p-0"><table className="w-full text-xs"><thead className="bg-muted/40 border-y border-border"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-2 px-3">Symbol</th><th className="text-right py-2 px-3">Price%</th><th className="text-right py-2 px-3">Sentiment</th><th className="text-center py-2 px-3">Signal</th></tr></thead><tbody>{summary.priceSentimentDivergence.map((d, i) => (<tr key={i} className="border-b border-border/40 hover:bg-muted/30 cursor-pointer" onClick={() => { selectSymbol(d.symbol); setFilterSymbol(d.symbol); }}><td className="py-1.5 px-3 font-mono font-medium">{d.symbol}</td><td className={cn("py-1.5 px-3 text-right font-mono", d.priceChangePct >= 0 ? "text-emerald-400" : "text-rose-400")}>{d.priceChangePct.toFixed(2)}%</td><td className={cn("py-1.5 px-3 text-right font-mono", d.sentimentScore >= 0 ? "text-emerald-400" : "text-rose-400")}>{d.sentimentScore.toFixed(2)}</td><td className="py-1.5 px-3 text-center">{d.divergence === "BULLISH_DIVERGENCE" ? <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-400">BULL DIV</Badge> : d.divergence === "BEARISH_DIVERGENCE" ? <Badge variant="outline" className="text-[9px] bg-rose-500/15 text-rose-400">BEAR DIV</Badge> : d.divergence === "CONFIRMING" ? <Badge variant="outline" className="text-[9px] bg-blue-500/15 text-blue-400">CONFIRM</Badge> : <Badge variant="outline" className="text-[9px]">—</Badge>}</td></tr>))}</tbody></table></CardContent></Card>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select value={filterSymbol} onChange={(e) => setFilterSymbol(e.target.value)} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs"><option value="ALL">All Symbols</option>{allSymbols.map(s => <option key={s} value={s}>{s}</option>)}</select>
        <select value={filterSentiment} onChange={(e) => setFilterSentiment(e.target.value)} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs"><option value="ALL">All Sentiment</option><option value="POSITIVE">Positive</option><option value="NEGATIVE">Negative</option></select>
        <Button variant="outline" size="sm" className="h-7 text-xs ml-auto" onClick={() => setShowSummary(!showSummary)}>{showSummary ? "Hide" : "Show"} Analytics</Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setArticles(prev => [...generateNewsBatch(["ES","NQ","CL","GC","ZN","BRR","MNQ","MES"], 5), ...prev].slice(0, 100))}><Newspaper className="w-3 h-3 mr-1" /> Refresh</Button>
      </div>
      <Card><CardHeader className="py-2 flex flex-row items-center justify-between"><CardTitle className="text-xs flex items-center gap-2"><Newspaper className="w-3.5 h-3.5" /> News Feed ({filtered.length})</CardTitle><Badge variant="outline" className="text-[9px]">Updates every 20s</Badge></CardHeader>
        <CardContent className="space-y-2 pt-0 max-h-[700px] overflow-y-auto">
          {filtered.map(article => { const cb = CAT_BADGES[article.category]; const sc = article.sentimentScore > 0.15 ? "text-emerald-400" : article.sentimentScore < -0.15 ? "text-rose-400" : "text-muted-foreground"; const hi = article.impactScore > 0.6; return (
            <div key={article.id} className={cn("border rounded-md p-2.5", hi ? "border-amber-500/30 bg-amber-500/5" : "border-border bg-muted/20 hover:bg-muted/30")}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-mono text-muted-foreground">{fmtTime(article.timestamp)}</span><Badge variant="outline" className={cn("text-[9px] h-4 px-1", cb.bg, cb.text)}>{article.category}</Badge><span className="text-[10px] text-muted-foreground">{article.source}</span>{hi && <Badge variant="outline" className="text-[9px] h-4 px-1 bg-amber-500/15 text-amber-400 border-amber-500/30"><Flame className="w-2.5 h-2.5 mr-0.5" />HIGH</Badge>}</div>
                  <h3 className="text-xs font-semibold leading-tight">{article.headline}</h3>
                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{article.summary}</p>
                  <div className="flex items-center gap-1.5 mt-1.5">{article.symbols.map(s => <button key={s} onClick={() => selectSymbol(s)} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted hover:bg-primary/20 text-foreground hover:text-primary">{s}</button>)}</div>
                </div>
                <div className="shrink-0 text-right border-l border-border/40 pl-2">
                  <div className="text-[9px] uppercase text-muted-foreground">Sentiment</div><div className={cn("text-lg font-mono font-bold", sc)}>{article.sentimentScore > 0 ? "+" : ""}{article.sentimentScore.toFixed(2)}</div><div className={cn("text-[10px] font-medium", sc)}>{article.sentimentLabel}</div>
                  <div className="border-t border-border/30 mt-1 pt-1"><div className="text-[9px] uppercase text-muted-foreground">Impact</div><div className="text-xs font-mono">{(article.impactScore * 100).toFixed(0)}%</div></div>
                  <div className="border-t border-border/30 mt-1 pt-1"><div className="text-[9px] uppercase text-muted-foreground">Expected</div><div className={cn("text-xs font-mono font-medium", article.expectedDirection === "BULLISH" ? "text-emerald-400" : article.expectedDirection === "BEARISH" ? "text-rose-400" : "")}>{article.expectedDirection === "BULLISH" ? "▲" : article.expectedDirection === "BEARISH" ? "▼" : "→"} {article.expectedMoveBps}bps</div></div>
                </div>
              </div>
            </div>
          );})}
        </CardContent>
      </Card>
    </div>
  );
}
