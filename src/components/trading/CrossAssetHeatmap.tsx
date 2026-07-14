"use client";
import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import {
  computeHeatmap, getAssetClassInfo, getTimeframeLabel,
  type Timeframe, type HeatmapResult, type PerformanceCell,
} from "@/lib/trading/cross-asset-heatmap";
import { CONTRACTS } from "@/lib/trading/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Activity, BarChart3, Grid3x3, TrendingDown, TrendingUp } from "lucide-react";

type View = "heatmap" | "ranking" | "assetclass" | "details";
const VIEWS: { id: View; name: string; icon: any }[] = [
  { id: "heatmap", name: "Heatmap Matrix", icon: Grid3x3 },
  { id: "ranking", name: "Rankings", icon: BarChart3 },
  { id: "assetclass", name: "By Asset Class", icon: Activity },
  { id: "details", name: "Detail Table", icon: TrendingUp },
];

const ALL_TIMEFRAMES: Timeframe[] = ["1D", "1W", "1M", "3M", "YTD", "1Y"];

function fmtPct(p: number): string { const sign = p >= 0 ? "+" : ""; return `${sign}${p.toFixed(2)}%`; }
function fmtPx(p: number): string { if (p === 0) return "—"; if (Math.abs(p) >= 1000) return p.toFixed(0); if (Math.abs(p) >= 10) return p.toFixed(2); return p.toFixed(4); }

export function CrossAssetHeatmap() {
  const tickCount = useTradingStore((s) => s.tickCount);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const [view, setView] = useState<View>("heatmap");
  const [selectedTimeframes] = useState<Timeframe[]>(ALL_TIMEFRAMES);
  const [sortBy, setSortBy] = useState<Timeframe>("1D");
  const [sortDesc, setSortDesc] = useState(true);
  const [filterAssetClass, setFilterAssetClass] = useState<string>("ALL");

  const tickBucket = Math.floor(tickCount / 30);
  const heatmap = useMemo(() => computeHeatmap(selectedTimeframes), [selectedTimeframes, tickBucket]);

  const sortedCells = useMemo(() => {
    const sortIdx = selectedTimeframes.indexOf(sortBy);
    if (sortIdx < 0) return heatmap.cells;
    let rows = heatmap.cells;
    if (filterAssetClass !== "ALL") rows = rows.filter((row) => row[0]?.assetClass === filterAssetClass);
    return [...rows].sort((a, b) => { const aRet = a[sortIdx]?.returnPct ?? 0; const bRet = b[sortIdx]?.returnPct ?? 0; return sortDesc ? bRet - aRet : aRet - bRet; });
  }, [heatmap, sortBy, sortDesc, filterAssetClass, selectedTimeframes]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 flex-wrap">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors", view === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>
            <v.icon className="w-3.5 h-3.5" />{v.name}
          </button>
        ))}
      </div>

      {view === "heatmap" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {heatmap.byTimeframe.map((ts) => (
              <Card key={ts.timeframe} className={cn("p-2.5 border", ts.avgReturn >= 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5")}>
                <div className="text-[9px] uppercase text-muted-foreground">{getTimeframeLabel(ts.timeframe)}</div>
                <div className={cn("text-sm font-mono font-semibold", ts.avgReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(ts.avgReturn)}</div>
                <div className="text-[9px] text-muted-foreground mt-0.5">{ts.positiveCount}↑ / {ts.negativeCount}↓</div>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Grid3x3 className="w-3.5 h-3.5" /> Cross-Asset Performance Heatmap ({sortedCells.length} contracts × {selectedTimeframes.length} timeframes)</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr><th className="text-left py-2 px-2 sticky left-0 bg-card z-10 min-w-[120px]">Symbol</th>{selectedTimeframes.map((tf) => <th key={tf} className="text-center py-2 px-1 min-w-[80px]">{tf}</th>)}</tr></thead>
                  <tbody>
                    {sortedCells.map((row, ri) => {
                      const acInfo = getAssetClassInfo(row[0]?.assetClass ?? "");
                      return (
                        <tr key={ri} className="border-t border-border/20">
                          <td className="py-1 px-2 sticky left-0 bg-card z-10">
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => selectSymbol(row[0]?.symbol ?? "")} className="font-mono font-semibold hover:text-primary">{row[0]?.symbol}</button>
                              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: acInfo.color }} title={acInfo.label} />
                            </div>
                            <div className="text-[9px] text-muted-foreground truncate max-w-[120px]">{row[0]?.name}</div>
                          </td>
                          {row.map((cell, ci) => (
                            <td key={ci} className="p-0.5 text-center">
                              <button onClick={() => selectSymbol(cell.symbol)} className="w-full h-12 rounded flex flex-col items-center justify-center hover:ring-2 hover:ring-primary/40 transition-all" style={{ backgroundColor: cell.color, color: cell.textColor }} title={`${cell.symbol} ${cell.timeframe}: ${fmtPct(cell.returnPct)} (rank ${cell.rank}/${heatmap.totalSymbols})`}>
                                <div className="font-mono font-bold text-[11px]">{fmtPct(cell.returnPct)}</div>
                                <div className="text-[8px] opacity-80">#{cell.rank}</div>
                              </button>
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-3">
              <div className="text-[10px] uppercase text-muted-foreground mb-1.5">Colour Scale</div>
              <div className="flex items-center gap-0.5 text-[9px] font-mono">
                {[{ label: "≤-3%", color: "#ef4444" }, { label: "-3%", color: "#f87171" }, { label: "-1.5%", color: "#fca5a5" }, { label: "-0.5%", color: "#fecaca" }, { label: "0%", color: "#1f2937" }, { label: "+0.5%", color: "#a7f3d0" }, { label: "+1.5%", color: "#6ee7b7" }, { label: "+3%", color: "#34d399" }, { label: "≥+3%", color: "#10b981" }].map((s, i) => (
                  <div key={i} className="flex-1 h-8 rounded flex items-center justify-center" style={{ backgroundColor: s.color, color: i === 4 ? "#fff" : "#1f2937" }}>{s.label}</div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {view === "ranking" && (
        <div className="space-y-3">
          <Card>
            <CardContent className="p-3 flex items-center gap-3 flex-wrap">
              <div className="text-xs font-semibold">Rankings by Timeframe:</div>
              {heatmap.timeframes.map((t) => (
                <button key={t} onClick={() => setSortBy(t)} className={cn("px-3 py-1 rounded-md text-xs border", sortBy === t ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>{getTimeframeLabel(t)}</button>
              ))}
            </CardContent>
          </Card>
          {(() => {
            const tfIdx = heatmap.timeframes.indexOf(sortBy);
            const tfStats = heatmap.byTimeframe[tfIdx];
            if (!tfStats) return null;
            const sorted = [...tfStats.cells].sort((a, b) => b.returnPct - a.returnPct);
            return (
              <>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Avg Return</div><div className={cn("text-sm font-mono font-semibold", tfStats.avgReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(tfStats.avgReturn)}</div></Card>
                  <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Median</div><div className={cn("text-sm font-mono font-semibold", tfStats.medianReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(tfStats.medianReturn)}</div></Card>
                  <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Breadth</div><div className="text-sm font-mono font-semibold">{(tfStats.breadth * 100).toFixed(0)}% ↑</div></Card>
                  <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Dispersion</div><div className="text-sm font-mono font-semibold">{tfStats.dispersion.toFixed(2)}%</div></Card>
                  <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Best</div><div className="text-[11px] font-mono text-emerald-400">{tfStats.bestSymbol} {fmtPct(tfStats.bestReturn)}</div></Card>
                </div>
                <Card>
                  <CardHeader className="py-2"><CardTitle className="text-xs">{getTimeframeLabel(sortBy)} Rankings ({sorted.length} contracts)</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/40 border-y border-border sticky top-0"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-center py-2 px-2 w-10">#</th><th className="text-left py-2 px-3">Symbol</th><th className="text-left py-2 px-3">Asset Class</th><th className="text-right py-2 px-3">Return</th><th className="text-right py-2 px-3">Percentile</th><th className="text-right py-2 px-3">Start Px</th><th className="text-right py-2 px-3">End Px</th></tr></thead>
                        <tbody>
                          {sorted.map((cell, i) => (
                            <tr key={cell.symbol} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => selectSymbol(cell.symbol)}>
                              <td className="py-1.5 px-2 text-center font-mono text-[10px] text-muted-foreground">{i + 1}</td>
                              <td className="py-1.5 px-3 font-mono font-medium">{cell.symbol}</td>
                              <td className="py-1.5 px-3"><Badge variant="outline" className="text-[9px] h-4 px-1" style={{ backgroundColor: getAssetClassInfo(cell.assetClass).color + "20", color: getAssetClassInfo(cell.assetClass).color }}>{getAssetClassInfo(cell.assetClass).label}</Badge></td>
                              <td className={cn("py-1.5 px-3 text-right font-mono font-semibold", cell.returnPct >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(cell.returnPct)}</td>
                              <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{cell.percentile.toFixed(0)}</td>
                              <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{fmtPx(cell.startPrice)}</td>
                              <td className="py-1.5 px-3 text-right font-mono">{fmtPx(cell.endPrice)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </div>
      )}

      {view === "assetclass" && (
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Performance by Asset Class (1-Month returns)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-2">
              {Object.keys(heatmap.byAssetClass).map((ac) => {
                const stats = heatmap.byAssetClass[ac][0];
                const info = getAssetClassInfo(ac);
                const avgPositive = stats.avgReturn >= 0;
                return (
                  <Card key={ac} className={cn("border p-3", avgPositive ? "border-emerald-500/20" : "border-rose-500/20")}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-md flex items-center justify-center text-base" style={{ backgroundColor: info.color + "20" }}>{info.icon}</div>
                      <div className="flex-1"><div className="text-sm font-semibold">{info.label}</div><div className="text-[10px] text-muted-foreground">{stats.memberCount} contracts</div></div>
                      <div className={cn("text-sm font-mono font-bold", avgPositive ? "text-emerald-400" : "text-rose-400")}>{fmtPct(stats.avgReturn)}</div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div><span className="text-muted-foreground">Median:</span> <span className={cn("font-mono", stats.medianReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(stats.medianReturn)}</span></div>
                      <div><span className="text-muted-foreground">Breadth:</span> <span className="font-mono">{(stats.breadth * 100).toFixed(0)}% ↑</span></div>
                      <div><span className="text-muted-foreground">Dispersion:</span> <span className="font-mono">{stats.dispersion.toFixed(2)}%</span></div>
                      <div><span className="text-muted-foreground">Best:</span> <span className="font-mono text-emerald-400">{stats.bestSymbol}</span></div>
                      <div><span className="text-muted-foreground">Worst:</span> <span className="font-mono text-rose-400">{stats.worstSymbol}</span></div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {view === "details" && (
        <Card>
          <CardHeader className="py-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs">Detail Table ({sortedCells.length} contracts)</CardTitle>
            <div className="flex items-center gap-2">
              <select value={filterAssetClass} onChange={(e) => setFilterAssetClass(e.target.value)} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs h-7">
                <option value="ALL">All Classes</option>
                {Array.from(new Set(CONTRACTS.map((c) => c.assetClass))).sort().map((ac) => <option key={ac} value={ac}>{getAssetClassInfo(ac).label}</option>)}
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as Timeframe)} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs h-7">
                {selectedTimeframes.map((tf) => <option key={tf} value={tf}>Sort: {tf}</option>)}
              </select>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSortDesc(!sortDesc)}>{sortDesc ? "↓ Desc" : "↑ Asc"}</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-y border-border sticky top-0"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-2 px-2 sticky left-0 bg-muted/40">Symbol</th><th className="text-left py-2 px-3">Name</th><th className="text-left py-2 px-3">Class</th>{selectedTimeframes.map((tf) => <th key={tf} className="text-right py-2 px-3">{tf} %</th>)}{selectedTimeframes.map((tf) => <th key={tf + "_rank"} className="text-center py-2 px-2">{tf} #</th>)}</tr></thead>
                <tbody>
                  {sortedCells.map((row, ri) => {
                    const acInfo = getAssetClassInfo(row[0]?.assetClass ?? "");
                    return (
                      <tr key={ri} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => selectSymbol(row[0]?.symbol ?? "")}>
                        <td className="py-1.5 px-2 sticky left-0 bg-card font-mono font-medium">{row[0]?.symbol}</td>
                        <td className="py-1.5 px-3 text-[10px] text-muted-foreground truncate max-w-[150px]">{row[0]?.name}</td>
                        <td className="py-1.5 px-3"><div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: acInfo.color }} /><span className="text-[10px]">{acInfo.label}</span></div></td>
                        {row.map((cell, ci) => <td key={ci} className="py-1.5 px-3 text-right"><span className={cn("font-mono font-medium", cell.returnPct >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(cell.returnPct)}</span></td>)}
                        {row.map((cell, ci) => <td key={ci + "_r"} className="py-1.5 px-2 text-center font-mono text-[10px] text-muted-foreground">{cell.rank}</td>)}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
