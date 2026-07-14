"use client";
import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import {
  computeAttribution, computeSummary, linkAttributionFrongello,
  type AttributionResult, type BenchmarkConfig,
} from "@/lib/trading/brinson-attribution";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { Activity, Award, BarChart3, Layers, PieChart, TrendingDown, TrendingUp } from "lucide-react";

type View = "summary" | "sectors" | "waterfall" | "timeseries";
const VIEWS: { id: View; name: string; icon: any }[] = [
  { id: "summary", name: "Summary", icon: PieChart },
  { id: "sectors", name: "Sector Breakdown", icon: Layers },
  { id: "waterfall", name: "Waterfall", icon: BarChart3 },
  { id: "timeseries", name: "Multi-Period Link", icon: Activity },
];

function fmtBps(b: number): string {
  const sign = b >= 0 ? "+" : "";
  return `${sign}${b.toFixed(2)} bps`;
}
function fmtPct(p: number): string {
  const sign = p >= 0 ? "+" : "";
  return `${sign}${p.toFixed(3)}%`;
}
function fmtUsd(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}
function fmtW(w: number): string {
  return `${(w * 100).toFixed(1)}%`;
}

export function StrategyAttribution() {
  const positions = useTradingStore((s) => s.positions);
  const quotes = useTradingStore((s) => s.quotes);
  const tickCount = useTradingStore((s) => s.tickCount);
  const [view, setView] = useState<View>("summary");
  const [benchmarkType, setBenchmarkType] = useState<BenchmarkConfig["type"]>("EQUAL_WEIGHT");
  const [lookback, setLookback] = useState<number>(30);
  // Multi-period tracking (simulated: re-evaluate with different lookbacks to create "periods")
  const [periodHistory, setPeriodHistory] = useState<AttributionResult[]>([]);

  const tickBucket = Math.floor(tickCount / 30);
  const result = useMemo(() => {
    const config: BenchmarkConfig = { type: benchmarkType, lookbackBars: lookback };
    return computeAttribution(Object.values(positions), quotes, config);
  }, [positions, quotes, benchmarkType, lookback, tickBucket]);

  const summary = useMemo(() => computeSummary(result), [result]);
  const linked = useMemo(() => linkAttributionFrongello(periodHistory), [periodHistory]);

  const addPeriod = () => {
    setPeriodHistory((prev) => [...prev, result].slice(-20));
  };
  const clearPeriods = () => setPeriodHistory([]);

  return (
    <div className="space-y-4">
      {/* Config bar */}
      <Card>
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <div className="text-xs font-semibold">Attribution Config:</div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Benchmark:</span>
            <select value={benchmarkType} onChange={(e) => setBenchmarkType(e.target.value as any)} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs h-7">
              <option value="EQUAL_WEIGHT">Equal Weight</option>
              <option value="VOL_WEIGHT">Vol Weighted</option>
              <option value="OI_WEIGHT">OI Weighted</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Lookback:</span>
            <select value={lookback} onChange={(e) => setLookback(Number(e.target.value))} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs h-7">
              <option value={6}>1 Day (6 bars)</option>
              <option value={30}>1 Week (30 bars)</option>
              <option value={126}>1 Month (126 bars)</option>
              <option value={378}>3 Months (378 bars)</option>
            </select>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={addPeriod}>
            <Activity className="w-3 h-3 mr-1" /> Snapshot Period
          </Button>
          {periodHistory.length > 0 && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={clearPeriods}>Clear ({periodHistory.length})</Button>
          )}
        </CardContent>
      </Card>

      {/* View switcher */}
      <div className="flex items-center gap-1 flex-wrap">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors",
              view === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>
            <v.icon className="w-3.5 h-3.5" />{v.name}
          </button>
        ))}
      </div>

      {view === "summary" && <SummaryView result={result} summary={summary} />}
      {view === "sectors" && <SectorBreakdownView result={result} />}
      {view === "waterfall" && <WaterfallView result={result} />}
      {view === "timeseries" && <TimeSeriesView periodHistory={periodHistory} linked={linked} />}
    </div>
  );
}

// ============================================================
// Summary View
// ============================================================
function SummaryView({ result, summary }: { result: AttributionResult; summary: ReturnType<typeof computeSummary> }) {
  return (
    <div className="space-y-3">
      {/* Top stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Card className={cn("p-2.5 border", result.activeReturn >= 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5")}>
          <div className="text-[9px] uppercase text-muted-foreground">Portfolio Return</div>
          <div className={cn("text-sm font-mono font-semibold", result.activeReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(result.portfolioReturn)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Benchmark Return</div>
          <div className="text-sm font-mono font-semibold text-muted-foreground">{fmtPct(result.benchmarkReturn)}</div>
        </Card>
        <Card className={cn("p-2.5 border", result.activeReturn >= 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5")}>
          <div className="text-[9px] uppercase text-muted-foreground">Active Return</div>
          <div className={cn("text-sm font-mono font-semibold", result.activeReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(result.activeReturn)} ({fmtBps(result.activeReturn * 100)})</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Allocation Effect</div>
          <div className={cn("text-sm font-mono font-semibold", result.allocationEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtBps(result.allocationEffect)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Selection Effect</div>
          <div className={cn("text-sm font-mono font-semibold", result.selectionEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtBps(result.selectionEffect)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Interaction</div>
          <div className={cn("text-sm font-mono font-semibold", result.interactionEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtBps(result.interactionEffect)}</div>
        </Card>
      </div>

      {/* Reconciliation check */}
      <Card className={cn("border", Math.abs(result.reconciliation) < 0.01 ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")}>
        <CardContent className="p-3 flex items-center gap-3">
          <Award className={cn("w-8 h-8", Math.abs(result.reconciliation) < 0.01 ? "text-emerald-400" : "text-amber-400")} />
          <div className="flex-1">
            <div className="text-sm font-semibold">Reconciliation Check</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              AA + SS + II = {fmtBps(result.allocationEffect + result.selectionEffect + result.interactionEffect)} ·
              AR = {fmtBps(result.activeReturn * 100)} ·
              Residual = {result.reconciliation.toFixed(4)} bps
            </div>
          </div>
          <Badge variant="outline" className={cn("text-[9px]", Math.abs(result.reconciliation) < 0.01 ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400")}>
            {Math.abs(result.reconciliation) < 0.01 ? "BALANCED" : "RESIDUAL"}
          </Badge>
        </CardContent>
      </Card>

      {/* Best / worst sectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {summary.bestSector && (
          <Card className="border-emerald-500/20 bg-emerald-500/5">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1"><TrendingUp className="w-4 h-4 text-emerald-400" /><span className="text-xs font-semibold">Best Sector</span></div>
              <div className="text-sm font-mono font-bold text-emerald-400">{summary.bestSector.sectorLabel}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Total Effect: {fmtBps(summary.bestSector.totalEffect)}</div>
            </CardContent>
          </Card>
        )}
        {summary.worstSector && (
          <Card className="border-rose-500/20 bg-rose-500/5">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1"><TrendingDown className="w-4 h-4 text-rose-400" /><span className="text-xs font-semibold">Worst Sector</span></div>
              <div className="text-sm font-mono font-bold text-rose-400">{summary.worstSector.sectorLabel}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Total Effect: {fmtBps(summary.worstSector.totalEffect)}</div>
            </CardContent>
          </Card>
        )}
        {summary.bestAllocationSector && (
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1"><Award className="w-4 h-4 text-primary" /><span className="text-xs font-semibold">Best Allocation</span></div>
              <div className="text-sm font-mono font-bold text-primary">{summary.bestAllocationSector.sectorLabel}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">AA: {fmtBps(summary.bestAllocationSector.allocationEffect)}</div>
            </CardContent>
          </Card>
        )}
        {summary.bestSelectionSector && (
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1"><Award className="w-4 h-4 text-amber-400" /><span className="text-xs font-semibold">Best Selection</span></div>
              <div className="text-sm font-mono font-bold text-amber-400">{summary.bestSelectionSector.sectorLabel}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">SS: {fmtBps(summary.bestSelectionSector.selectionEffect)}</div>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Positive Sectors</div>
            <div className="text-sm font-mono font-semibold text-emerald-400">{summary.positiveSectors}/{summary.totalSectors}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground">Portfolio Notional</div>
            <div className="text-sm font-mono font-semibold">{fmtUsd(result.totalPortfolioNotional)}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// Sector Breakdown View
// ============================================================
function SectorBreakdownView({ result }: { result: AttributionResult }) {
  const chartData = result.sectors.map((s) => ({
    sector: s.sectorLabel,
    Allocation: s.allocationEffect,
    Selection: s.selectionEffect,
    Interaction: s.interactionEffect,
    Total: s.totalEffect,
  }));

  return (
    <div className="space-y-3">
      {/* Stacked bar chart */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Attribution by Sector (stacked: AA + SS + II)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="sector" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} tickFormatter={(v) => `${v.toFixed(1)}bps`} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)} bps`, ""]} contentStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#666" />
                <Bar dataKey="Allocation" stackId="a" fill="#3b82f6" />
                <Bar dataKey="Selection" stackId="a" fill="#10b981" />
                <Bar dataKey="Interaction" stackId="a" fill="#a855f7" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Detailed table */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Sector Detail Table</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border">
                <tr className="text-muted-foreground text-[10px] uppercase">
                  <th className="text-left py-2 px-3">Sector</th>
                  <th className="text-right py-2 px-2">w_p</th>
                  <th className="text-right py-2 px-2">w_b</th>
                  <th className="text-right py-2 px-2">Δw</th>
                  <th className="text-right py-2 px-2">R_p,i</th>
                  <th className="text-right py-2 px-2">R_b,i</th>
                  <th className="text-right py-2 px-2">ΔR</th>
                  <th className="text-right py-2 px-3">AA (bps)</th>
                  <th className="text-right py-2 px-3">SS (bps)</th>
                  <th className="text-right py-2 px-3">II (bps)</th>
                  <th className="text-right py-2 px-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {result.sectors.map((s) => (
                  <tr key={s.sector} className="border-b border-border/30 hover:bg-muted/30">
                    <td className="py-1.5 px-3 font-medium">{s.sectorLabel}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmtW(s.portfolioWeight)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{fmtW(s.benchmarkWeight)}</td>
                    <td className={cn("py-1.5 px-2 text-right font-mono", s.weightDifference > 0 ? "text-emerald-400" : s.weightDifference < 0 ? "text-rose-400" : "")}>{fmtW(s.weightDifference)}</td>
                    <td className={cn("py-1.5 px-2 text-right font-mono", s.portfolioReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(s.portfolioReturn)}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{fmtPct(s.benchmarkReturn)}</td>
                    <td className={cn("py-1.5 px-2 text-right font-mono", s.returnDifference >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(s.returnDifference)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", s.allocationEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{s.allocationEffect.toFixed(2)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", s.selectionEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{s.selectionEffect.toFixed(2)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", s.interactionEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{s.interactionEffect.toFixed(2)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono font-semibold", s.totalEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{s.totalEffect.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/40 border-t border-border font-semibold">
                <tr>
                  <td className="py-2 px-3">TOTAL</td>
                  <td className="py-2 px-2 text-right font-mono">100.0%</td>
                  <td className="py-2 px-2 text-right font-mono text-muted-foreground">100.0%</td>
                  <td className="py-2 px-2 text-right font-mono">—</td>
                  <td className={cn("py-2 px-2 text-right font-mono", result.portfolioReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(result.portfolioReturn)}</td>
                  <td className="py-2 px-2 text-right font-mono text-muted-foreground">{fmtPct(result.benchmarkReturn)}</td>
                  <td className="py-2 px-2 text-right font-mono">—</td>
                  <td className={cn("py-2 px-3 text-right font-mono", result.allocationEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{result.allocationEffect.toFixed(2)}</td>
                  <td className={cn("py-2 px-3 text-right font-mono", result.selectionEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{result.selectionEffect.toFixed(2)}</td>
                  <td className={cn("py-2 px-3 text-right font-mono", result.interactionEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{result.interactionEffect.toFixed(2)}</td>
                  <td className={cn("py-2 px-3 text-right font-mono", result.activeReturn * 100 >= 0 ? "text-emerald-400" : "text-rose-400")}>{(result.activeReturn * 100).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Waterfall View
// ============================================================
function WaterfallView({ result }: { result: AttributionResult }) {
  // Waterfall: Benchmark → +AA → +SS → +II = Portfolio
  const waterfallData = [
    { label: "Benchmark", value: result.benchmarkReturn * 100, color: "#6b7280", type: "total" },
    { label: "Allocation", value: result.allocationEffect, color: "#3b82f6", type: "delta" },
    { label: "Selection", value: result.selectionEffect, color: "#10b981", type: "delta" },
    { label: "Interaction", value: result.interactionEffect, color: "#a855f7", type: "delta" },
    { label: "Portfolio", value: result.portfolioReturn * 100, color: result.activeReturn >= 0 ? "#10b981" : "#ef4444", type: "total" },
  ];

  return (
    <Card>
      <CardHeader className="py-2"><CardTitle className="text-xs">Attribution Waterfall: Benchmark → Portfolio</CardTitle></CardHeader>
      <CardContent>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={waterfallData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={60} tickFormatter={(v) => `${v.toFixed(1)}bps`} />
              <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)} bps`, ""]} contentStyle={{ fontSize: 11 }} />
              <ReferenceLine y={0} stroke="#666" />
              <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                {waterfallData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-2 text-center">
          {waterfallData.map((d, i) => (
            <div key={i} className="text-[10px]">
              <div className="font-semibold" style={{ color: d.color }}>{d.label}</div>
              <div className="font-mono">{d.value.toFixed(2)} bps</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Time Series (Multi-Period Linking) View
// ============================================================
function TimeSeriesView({ periodHistory, linked }: {
  periodHistory: AttributionResult[];
  linked: ReturnType<typeof linkAttributionFrongello>;
}) {
  if (periodHistory.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <div className="text-sm font-semibold mb-1">No period snapshots yet</div>
          <div className="text-xs text-muted-foreground">Click "Snapshot Period" in the config bar to capture attribution at the current moment. Multiple snapshots enable Frongello multi-period linking.</div>
        </CardContent>
      </Card>
    );
  }

  const chartData = periodHistory.map((p, i) => ({
    period: `P${i + 1}`,
    Allocation: p.allocationEffect,
    Selection: p.selectionEffect,
    Interaction: p.interactionEffect,
    Active: p.activeReturn * 100,
  }));

  return (
    <div className="space-y-3">
      {/* Linked summary */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <Activity className="w-8 h-8 text-primary" />
            <div className="flex-1">
              <div className="text-sm font-semibold">Frongello Multi-Period Linking ({linked.periodCount} periods)</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Linked AA: {fmtBps(linked.linkedAllocation)} · Linked SS: {fmtBps(linked.linkedSelection)} · Linked II: {fmtBps(linked.linkedInteraction)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[9px] uppercase text-muted-foreground">Total Active</div>
              <div className={cn("text-lg font-mono font-bold", linked.totalActiveReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtBps(linked.totalActiveReturn)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Time series chart */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Attribution Over Time (per period)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="period" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} tickFormatter={(v) => `${v.toFixed(0)}bps`} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)} bps`, ""]} contentStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#666" />
                <Bar dataKey="Allocation" stackId="a" fill="#3b82f6" />
                <Bar dataKey="Selection" stackId="a" fill="#10b981" />
                <Bar dataKey="Interaction" stackId="a" fill="#a855f7" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Period detail table */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Period History</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase">
                  <th className="text-left py-2 px-3">#</th>
                  <th className="text-right py-2 px-3">Portfolio %</th>
                  <th className="text-right py-2 px-3">Benchmark %</th>
                  <th className="text-right py-2 px-3">Active (bps)</th>
                  <th className="text-right py-2 px-3">AA</th>
                  <th className="text-right py-2 px-3">SS</th>
                  <th className="text-right py-2 px-3">II</th>
                </tr>
              </thead>
              <tbody>
                {periodHistory.map((p, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-1.5 px-3 font-mono">P{i + 1}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", p.portfolioReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(p.portfolioReturn)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{fmtPct(p.benchmarkReturn)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono font-semibold", p.activeReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtBps(p.activeReturn * 100)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", p.allocationEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{p.allocationEffect.toFixed(1)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", p.selectionEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{p.selectionEffect.toFixed(1)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", p.interactionEffect >= 0 ? "text-emerald-400" : "text-rose-400")}>{p.interactionEffect.toFixed(1)}</td>
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
