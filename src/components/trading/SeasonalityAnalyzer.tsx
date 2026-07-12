"use client";
import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS } from "@/lib/trading/contracts";
import { computeMonthlySeasonality, computeAllSeasonality, getActiveSeasonalWindows, getUpcomingCalendarEvents, SEASONAL_WINDOWS, computeDayOfWeekStats, backtestAllSeasonalWindows } from "@/lib/trading/seasonality";
import { fmtPct } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { Calendar, Flame, Play, TrendingDown, TrendingUp } from "lucide-react";

type View = "monthly" | "windows" | "ranking" | "calendar" | "backtest";
const VIEWS: { id: View; name: string }[] = [
  { id: "monthly", name: "Monthly Patterns" },
  { id: "windows", name: "Seasonal Windows" },
  { id: "ranking", name: "All Symbols Ranking" },
  { id: "calendar", name: "Calendar Events" },
  { id: "backtest", name: "Trade Seasonal Windows" },
];

export function SeasonalityAnalyzer() {
  const [view, setView] = useState<View>("monthly");
  const [symbol, setSymbol] = useState("ES");
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const tickCount = useTradingStore((s) => s.tickCount);
  const seasonality = useMemo(() => computeMonthlySeasonality(symbol), [symbol, tickCount]);
  const rankings = useMemo(() => computeAllSeasonality(), [tickCount]);
  const activeWindows = useMemo(() => getActiveSeasonalWindows(symbol), [symbol]);
  const calendarEvents = useMemo(() => getUpcomingCalendarEvents(), []);
  const [backtestResults, setBacktestResults] = useState<ReturnType<typeof backtestAllSeasonalWindows> | null>(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [expandedWindowIdx, setExpandedWindowIdx] = useState<number | null>(null);

  const runBacktest = () => {
    setBacktestLoading(true);
    // Defer to next tick so the spinner can render
    setTimeout(() => {
      try {
        const results = backtestAllSeasonalWindows();
        setBacktestResults(results);
      } finally {
        setBacktestLoading(false);
      }
    }, 50);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 flex-wrap">{VIEWS.map(v => <button key={v.id} onClick={() => setView(v.id)} className={cn("px-3 py-1.5 rounded-md text-xs border transition-colors", view === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>{v.name}</button>)}</div>
      {view === "monthly" && seasonality && (
        <div className="space-y-3">
          <Card><CardContent className="p-3 flex items-center gap-3"><select value={symbol} onChange={(e) => { setSymbol(e.target.value); selectSymbol(e.target.value); }} className="bg-muted/50 border border-border rounded px-2 py-1.5 text-xs font-mono">{CONTRACTS.map(c => <option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>)}</select>
            <div className="flex items-center gap-4 text-xs"><span>Best: <span className="text-emerald-400 font-mono font-semibold">{seasonality.bestMonth.monthName} ({fmtPct(seasonality.bestMonth.avgReturn)})</span></span><span>Worst: <span className="text-rose-400 font-mono font-semibold">{seasonality.worstMonth.monthName} ({fmtPct(seasonality.worstMonth.avgReturn)})</span></span><span>Sell in May: <span className={cn("font-mono font-semibold", seasonality.sellInMay > 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(seasonality.sellInMay)}</span></span></div>
          </CardContent></Card>
          <Card><CardHeader className="py-2"><CardTitle className="text-xs">{seasonality.name} — Average Monthly Returns (%)</CardTitle></CardHeader><CardContent><div className="h-[300px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={seasonality.monthlyStats.map(m => ({ month: m.monthName, avg: m.avgReturn, sig: m.isSignificant }))}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} /><XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} /><YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} tickFormatter={v => `${v.toFixed(1)}%`} /><Tooltip formatter={(v: any) => `${Number(v).toFixed(2)}%`} /><ReferenceLine y={0} stroke="#666" /><Bar dataKey="avg" radius={[2,2,0,0]}>{seasonality.monthlyStats.map((m,i) => <Cell key={i} fill={m.avgReturn >= 0 ? (m.isSignificant ? "#10b981" : "#10b98188") : (m.isSignificant ? "#ef4444" : "#ef444488")} />)}</Bar></BarChart></ResponsiveContainer></div></CardContent></Card>
          <Card><CardHeader className="py-2"><CardTitle className="text-xs">Monthly Statistics</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-muted/40 border-y border-border"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-2 px-3">Month</th><th className="text-right py-2 px-3">Avg</th><th className="text-right py-2 px-3">Hit Rate</th><th className="text-right py-2 px-3">Std Dev</th><th className="text-right py-2 px-3">t-Stat</th><th className="text-center py-2 px-3">Sig?</th></tr></thead><tbody>{seasonality.monthlyStats.map(m => <tr key={m.month} className="border-b border-border/40"><td className="py-1.5 px-3 font-medium">{m.monthName}</td><td className={cn("py-1.5 px-3 text-right font-mono", m.avgReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(m.avgReturn)}</td><td className="py-1.5 px-3 text-right font-mono">{(m.positiveRate * 100).toFixed(0)}%</td><td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{m.stdDev.toFixed(2)}</td><td className={cn("py-1.5 px-3 text-right font-mono", Math.abs(m.tStat) > 2 ? "text-amber-400 font-semibold" : "")}>{m.tStat.toFixed(2)}</td><td className="py-1.5 px-3 text-center">{m.isSignificant ? <Badge variant="outline" className="text-[9px] bg-amber-500/15 text-amber-400">YES</Badge> : <span className="text-[10px] text-muted-foreground">—</span>}</td></tr>)}</tbody></table></div></CardContent></Card>
        </div>
      )}
      {view === "windows" && (
        <div className="space-y-3">
          {activeWindows.length > 0 && <Card className="border-amber-500/30 bg-amber-500/5"><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Flame className="w-3.5 h-3.5 text-amber-400" /> Active Windows for {symbol}</CardTitle></CardHeader><CardContent className="space-y-2">{activeWindows.map((w, i) => <div key={i} className="border border-border/40 rounded-md p-2.5"><div className="flex items-center justify-between mb-1"><span className="text-xs font-semibold">{w.name}</span><Badge variant="outline" className={cn("text-[9px]", w.direction === "LONG" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>{w.direction}</Badge></div><p className="text-[10px] text-muted-foreground">{w.description}</p><div className="flex items-center gap-3 mt-1 text-[10px] font-mono"><span>Avg: <span className={cn("font-semibold", w.avgReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(w.avgReturn)}</span></span><span>Hit Rate: <span className="font-semibold">{(w.hitRate * 100).toFixed(0)}%</span></span></div></div>)}</CardContent></Card>}
          <Card><CardHeader className="py-2"><CardTitle className="text-xs">All Seasonal Windows ({SEASONAL_WINDOWS.length})</CardTitle></CardHeader><CardContent className="space-y-2 pt-0">{SEASONAL_WINDOWS.map((w, i) => <div key={i} className={cn("border rounded-md p-2.5", w.symbol === symbol ? "border-primary/30 bg-primary/5" : "border-border/40 bg-muted/20")}><div className="flex items-center justify-between mb-1"><div className="flex items-center gap-2"><Badge variant="outline" className="text-[9px] font-mono">{w.symbol}</Badge><span className="text-xs font-semibold">{w.name}</span></div><div className="flex items-center gap-1">{w.significance === "HIGH" && <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-400">HIGH</Badge>}<Badge variant="outline" className={cn("text-[9px]", w.direction === "LONG" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>{w.direction}</Badge></div></div><p className="text-[10px] text-muted-foreground">{w.description}</p><div className="flex items-center gap-3 mt-1 text-[10px] font-mono"><span>Avg: <span className={cn("font-semibold", w.avgReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(w.avgReturn)}</span></span><span>Hit: <span className="font-semibold">{(w.hitRate * 100).toFixed(0)}%</span></span></div></div>)}</CardContent></Card>
        </div>
      )}
      {view === "ranking" && <Card><CardHeader className="py-2"><CardTitle className="text-xs">Seasonality Strength Ranking</CardTitle></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-muted/40 border-y border-border"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-2 px-3">#</th><th className="text-left py-2 px-3">Symbol</th><th className="text-right py-2 px-3">Strength</th><th className="text-right py-2 px-3">Best Month</th><th className="text-right py-2 px-3">Worst Month</th><th className="text-right py-2 px-3">Sell in May</th><th className="text-center py-2 px-3">Current Rank</th></tr></thead><tbody>{rankings.map((r, i) => <tr key={r.symbol} className="border-b border-border/40 hover:bg-muted/30 cursor-pointer" onClick={() => { setSymbol(r.symbol); selectSymbol(r.symbol); setView("monthly"); }}><td className="py-1.5 px-3 font-mono text-[10px] text-muted-foreground">{i+1}</td><td className="py-1.5 px-3 font-mono font-medium">{r.symbol}</td><td className="py-1.5 px-3 text-right"><div className="flex items-center justify-end gap-1.5"><div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden"><div className={cn("h-full", r.strength > 0.5 ? "bg-emerald-500" : r.strength > 0.25 ? "bg-amber-500" : "bg-muted-foreground")} style={{ width: `${r.strength * 100}%` }} /></div><span className="font-mono text-[10px] w-8">{(r.strength * 100).toFixed(0)}%</span></div></td><td className="py-1.5 px-3 text-right font-mono text-emerald-400">{r.bestMonth} ({fmtPct(r.bestMonthReturn)})</td><td className="py-1.5 px-3 text-right font-mono text-rose-400">{r.worstMonth} ({fmtPct(r.worstMonthReturn)})</td><td className={cn("py-1.5 px-3 text-right font-mono", r.sellInMay > 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(r.sellInMay)}</td><td className="py-1.5 px-3 text-center"><Badge variant="outline" className="text-[9px]">{r.currentMonthRank}/12</Badge></td></tr>)}</tbody></table></div></CardContent></Card>}
      {view === "calendar" && <Card><CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Calendar className="w-3.5 h-3.5" /> Upcoming Calendar Events</CardTitle></CardHeader><CardContent className="space-y-2 pt-0">{calendarEvents.map((e, i) => <div key={i} className={cn("border rounded-md p-2.5", e.daysAway <= 3 ? "border-amber-500/30 bg-amber-500/5" : "border-border/40 bg-muted/20")}><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-xs font-mono text-muted-foreground">{e.date}</span><Badge variant="outline" className={cn("text-[9px]", e.type === "FOMC" ? "bg-rose-500/15 text-rose-400" : e.type === "NFP" ? "bg-amber-500/15 text-amber-400" : "bg-blue-500/15 text-blue-400")}>{e.type}</Badge><span className="text-xs font-semibold">{e.name}</span></div><span className="text-[10px] font-mono text-muted-foreground">{e.daysAway}d away</span></div><p className="text-[10px] text-muted-foreground mt-1">{e.description}</p><div className="flex items-center gap-1 mt-1.5"><span className="text-[9px] text-muted-foreground">Affected:</span>{e.affectedSymbols.map(s => <Badge key={s} variant="outline" className="text-[9px] h-4 px-1 font-mono">{s}</Badge>)}</div></div>)}</CardContent></Card>}

      {view === "backtest" && (
        <SeasonalWindowBacktestView
          results={backtestResults}
          loading={backtestLoading}
          onRun={runBacktest}
          expandedIdx={expandedWindowIdx}
          onExpand={setExpandedWindowIdx}
          onSelectSymbol={(s) => { selectSymbol(s); }}
        />
      )}
    </div>
  );
}

// ============================================================
// Seasonal Window Backtest View
// ============================================================
function SeasonalWindowBacktestView({
  results, loading, onRun, expandedIdx, onExpand, onSelectSymbol,
}: {
  results: ReturnType<typeof backtestAllSeasonalWindows> | null;
  loading: boolean;
  onRun: () => void;
  expandedIdx: number | null;
  onExpand: (i: number | null) => void;
  onSelectSymbol: (s: string) => void;
}) {
  if (!results) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="text-sm text-muted-foreground mb-4">
            Run a backtest of all {SEASONAL_WINDOWS.length} seasonal windows across all {CONTRACTS.length} contracts.
            Each window is tested as a LONG or SHORT trade entered on its start date and exited on its end date.
            Results show hit rate, average return, t-statistic, Sharpe, and total dollar P&amp;L per (window × symbol).
          </div>
          <Button onClick={onRun} disabled={loading}>
            <Play className="w-4 h-4 mr-2" />
            {loading ? "Backtesting..." : "Run Seasonal Backtest"}
          </Button>
          {loading && <div className="text-[10px] text-muted-foreground mt-3 animate-pulse">Walking 250 days of history × 7 windows × {CONTRACTS.length} contracts...</div>}
        </CardContent>
      </Card>
    );
  }

  const totalTrades = results.reduce((s, r) => s + r.aggregateTradeCount, 0);
  const totalPnL = results.reduce((s, r) => s + r.aggregateTotalPnL, 0);
  const avgHitRate = results.length > 0 ? results.reduce((s, r) => s + r.aggregateHitRate, 0) / results.length : 0;
  const avgReturn = results.length > 0 ? results.reduce((s, r) => s + r.aggregateAvgReturn, 0) / results.length : 0;
  const sigCount = results.reduce((s, r) => s + r.significantCount, 0);
  const totalSymbols = results.reduce((s, r) => s + r.totalSymbols, 0);

  return (
    <div className="space-y-3">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Windows Tested</div>
          <div className="text-sm font-mono font-semibold">{results.length}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Total Trades</div>
          <div className="text-sm font-mono font-semibold">{totalTrades}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Avg Hit Rate</div>
          <div className={cn("text-sm font-mono font-semibold", avgHitRate >= 0.55 ? "text-emerald-400" : avgHitRate < 0.45 ? "text-rose-400" : "")}>{(avgHitRate * 100).toFixed(1)}%</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Avg Return</div>
          <div className={cn("text-sm font-mono font-semibold", avgReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(avgReturn)}</div>
        </Card>
        <Card className={cn("p-2.5 border", totalPnL >= 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5")}>
          <div className="text-[9px] uppercase text-muted-foreground">Total P&amp;L</div>
          <div className={cn("text-sm font-mono font-semibold", totalPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>${totalPnL.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Significant</div>
          <div className="text-sm font-mono font-semibold text-amber-400">{sigCount}/{totalSymbols}</div>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={onRun} disabled={loading} size="sm" className="h-7 text-xs">
          <Play className="w-3 h-3 mr-1" />
          {loading ? "Running..." : "Re-run Backtest"}
        </Button>
        <span className="text-[10px] text-muted-foreground">Click a row to expand per-symbol results</span>
      </div>

      {/* Per-window results */}
      <div className="space-y-2">
        {results.map((agg, i) => (
          <Card key={i} className={cn("border", agg.aggregateTotalPnL >= 0 ? "border-emerald-500/20" : "border-rose-500/20")}>
            <CardContent className="p-3">
              <div
                className="flex items-center gap-3 cursor-pointer"
                onClick={() => onExpand(expandedIdx === i ? null : i)}
              >
                <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center">
                  {agg.window.direction === "LONG" ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-rose-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{agg.window.name}</span>
                    <Badge variant="outline" className="text-[9px] font-mono">{agg.window.symbol}</Badge>
                    <Badge variant="outline" className={cn("text-[9px]", agg.window.direction === "LONG" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>{agg.window.direction}</Badge>
                    {agg.window.significance === "HIGH" && <Badge variant="outline" className="text-[9px] bg-amber-500/15 text-amber-400">HIGH SIG</Badge>}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{agg.window.description}</div>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono shrink-0">
                  <div className="text-right">
                    <div className="text-[9px] uppercase text-muted-foreground">Trades</div>
                    <div className="font-semibold">{agg.aggregateTradeCount}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] uppercase text-muted-foreground">Hit Rate</div>
                    <div className={cn("font-semibold", agg.aggregateHitRate >= 0.55 ? "text-emerald-400" : agg.aggregateHitRate < 0.45 ? "text-rose-400" : "")}>{(agg.aggregateHitRate * 100).toFixed(0)}%</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] uppercase text-muted-foreground">Avg Ret</div>
                    <div className={cn("font-semibold", agg.aggregateAvgReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(agg.aggregateAvgReturn)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] uppercase text-muted-foreground">Total P&amp;L</div>
                    <div className={cn("font-semibold", agg.aggregateTotalPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>${agg.aggregateTotalPnL.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] uppercase text-muted-foreground">Sig</div>
                    <div className="font-semibold text-amber-400">{agg.significantCount}/{agg.totalSymbols}</div>
                  </div>
                </div>
              </div>

              {/* Best/worst row */}
              <div className="grid grid-cols-2 gap-2 mt-2 text-[10px]">
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded p-2">
                  <span className="text-muted-foreground">Best Symbol: </span>
                  {agg.bestSymbol ? (
                    <>
                      <button onClick={() => onSelectSymbol(agg.bestSymbol!)} className="font-mono font-semibold text-emerald-400 hover:underline">{agg.bestSymbol}</button>
                      <span className="text-muted-foreground"> · Hit: {(agg.bestSymbolHitRate * 100).toFixed(0)}% · Avg: </span>
                      <span className="text-emerald-400 font-mono">{fmtPct(agg.bestSymbolReturn)}</span>
                    </>
                  ) : <span className="text-muted-foreground">—</span>}
                </div>
                <div className="bg-rose-500/5 border border-rose-500/20 rounded p-2">
                  <span className="text-muted-foreground">Worst Symbol: </span>
                  {agg.worstSymbol ? (
                    <>
                      <button onClick={() => onSelectSymbol(agg.worstSymbol!)} className="font-mono font-semibold text-rose-400 hover:underline">{agg.worstSymbol}</button>
                      <span className="text-muted-foreground"> · Avg: </span>
                      <span className="text-rose-400 font-mono">{fmtPct(agg.worstSymbolReturn)}</span>
                    </>
                  ) : <span className="text-muted-foreground">—</span>}
                </div>
              </div>

              {/* Expanded: per-symbol breakdown */}
              {expandedIdx === i && (
                <div className="mt-3 border-t border-border pt-2">
                  <div className="text-[10px] uppercase text-muted-foreground mb-1.5">Per-Symbol Breakdown ({agg.symbolResults.length} contracts)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 border-y border-border">
                        <tr className="text-muted-foreground text-[10px] uppercase">
                          <th className="text-left py-1.5 px-2">Symbol</th>
                          <th className="text-right py-1.5 px-2">Trades</th>
                          <th className="text-right py-1.5 px-2">Hit Rate</th>
                          <th className="text-right py-1.5 px-2">Avg Ret</th>
                          <th className="text-right py-1.5 px-2">Std Dev</th>
                          <th className="text-right py-1.5 px-2">t-Stat</th>
                          <th className="text-right py-1.5 px-2">Sharpe</th>
                          <th className="text-right py-1.5 px-2">Best</th>
                          <th className="text-right py-1.5 px-2">Worst</th>
                          <th className="text-right py-1.5 px-2">P&amp;L $</th>
                          <th className="text-center py-1.5 px-2">Sig?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...agg.symbolResults].sort((a,b) => b.sharpe - a.sharpe).map(r => (
                          <tr key={r.symbol} className={cn("border-b border-border/30 hover:bg-muted/30 cursor-pointer", r.isSignificant && "bg-amber-500/5")} onClick={() => onSelectSymbol(r.symbol)}>
                            <td className="py-1 px-2 font-mono font-medium">{r.symbol}</td>
                            <td className="py-1 px-2 text-right font-mono">{r.tradeCount}</td>
                            <td className={cn("py-1 px-2 text-right font-mono", r.hitRate >= 0.55 ? "text-emerald-400" : r.hitRate < 0.45 ? "text-rose-400" : "")}>{(r.hitRate * 100).toFixed(0)}%</td>
                            <td className={cn("py-1 px-2 text-right font-mono", r.avgReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(r.avgReturn)}</td>
                            <td className="py-1 px-2 text-right font-mono text-muted-foreground">{r.stdDev.toFixed(2)}</td>
                            <td className={cn("py-1 px-2 text-right font-mono", Math.abs(r.tStat) > 2 ? "text-amber-400 font-semibold" : "")}>{r.tStat.toFixed(2)}</td>
                            <td className={cn("py-1 px-2 text-right font-mono", r.sharpe > 0.5 ? "text-emerald-400" : r.sharpe < -0.5 ? "text-rose-400" : "")}>{r.sharpe.toFixed(2)}</td>
                            <td className="py-1 px-2 text-right font-mono text-emerald-400">{fmtPct(r.bestTrade)}</td>
                            <td className="py-1 px-2 text-right font-mono text-rose-400">{fmtPct(r.worstTrade)}</td>
                            <td className={cn("py-1 px-2 text-right font-mono", r.totalDollarPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>${r.totalDollarPnL.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                            <td className="py-1 px-2 text-center">{r.isSignificant ? <Badge variant="outline" className="text-[9px] bg-amber-500/15 text-amber-400">YES</Badge> : <span className="text-[10px] text-muted-foreground">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
