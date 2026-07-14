"use client";
import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import {
  computeRegimeAllocation, ALLOCATION_PROFILES,
  type AllocationResult, type Regime,
} from "@/lib/trading/regime-allocator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import { Cell, Pie, PieChart as RePieChart } from "recharts";
import { cn } from "@/lib/utils";
import { Activity, BarChart3, Brain, Layers, PieChart, TrendingDown, TrendingUp, Zap } from "lucide-react";

type View = "dashboard" | "timeline" | "allocations" | "stats";
const VIEWS: { id: View; name: string; icon: any }[] = [
  { id: "dashboard", name: "Regime Dashboard", icon: Brain },
  { id: "timeline", name: "Regime Timeline", icon: Activity },
  { id: "allocations", name: "Strategy Allocations", icon: PieChart },
  { id: "stats", name: "Regime Statistics", icon: BarChart3 },
];

const REGIME_COLORS: Record<Regime, string> = {
  BULL: "#10b981",
  BEAR: "#ef4444",
  NEUTRAL: "#f59e0b",
  HIGH_VOL: "#a855f7",
};

function fmtPct(p: number): string { return `${(p * 100).toFixed(1)}%`; }
function fmtUsd(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function RegimeAllocator() {
  const tickCount = useTradingStore((s) => s.tickCount);
  const [view, setView] = useState<View>("dashboard");
  const [totalCapital, setTotalCapital] = useState(500_000);
  const [profileIdx, setProfileIdx] = useState(1); // Balanced

  const tickBucket = Math.floor(tickCount / 60);
  const result = useMemo(() => computeRegimeAllocation(totalCapital), [totalCapital, tickBucket]);

  return (
    <div className="space-y-4">
      {/* Config bar */}
      <Card>
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <div className="text-xs font-semibold">Allocator Config:</div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Capital:</span>
            <select value={totalCapital} onChange={(e) => setTotalCapital(Number(e.target.value))} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs h-7 font-mono">
              <option value={250000}>$250K</option>
              <option value={500000}>$500K</option>
              <option value={1000000}>$1M</option>
              <option value={5000000}>$5M</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Profile:</span>
            {ALLOCATION_PROFILES.map((p, i) => (
              <button key={p.id} onClick={() => setProfileIdx(i)}
                className={cn("px-2 py-1 rounded text-[10px] border",
                  profileIdx === i ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground ml-auto">
            {ALLOCATION_PROFILES[profileIdx].description}
          </div>
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

      {view === "dashboard" && <DashboardView result={result} />}
      {view === "timeline" && <TimelineView result={result} />}
      {view === "allocations" && <AllocationsView result={result} />}
      {view === "stats" && <StatsView result={result} />}
    </div>
  );
}

// ============================================================
// Dashboard View
// ============================================================
function DashboardView({ result }: { result: AllocationResult }) {
  return (
    <div className="space-y-3">
      {/* Current regime banner */}
      <Card className="border-2" style={{ borderColor: result.currentRegime.color + "60", backgroundColor: result.currentRegime.color + "10" }}>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-lg flex items-center justify-center" style={{ backgroundColor: result.currentRegime.color + "30" }}>
              {result.currentRegime.regime === "BULL" ? <TrendingUp className="w-7 h-7" style={{ color: result.currentRegime.color }} /> :
               result.currentRegime.regime === "BEAR" ? <TrendingDown className="w-7 h-7" style={{ color: result.currentRegime.color }} /> :
               result.currentRegime.regime === "HIGH_VOL" ? <Zap className="w-7 h-7" style={{ color: result.currentRegime.color }} /> :
               <Activity className="w-7 h-7" style={{ color: result.currentRegime.color }} />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold" style={{ color: result.currentRegime.color }}>{result.currentRegime.regime.replace("_", " ")}</span>
                <Badge variant="outline" className="text-[10px]" style={{ backgroundColor: result.currentRegime.color + "20", color: result.currentRegime.color }}>
                  {(result.currentRegime.confidence * 100).toFixed(0)}% confidence
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{result.currentRegime.description}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase text-muted-foreground">Capital Allocated</div>
              <div className="text-xl font-mono font-bold">{fmtUsd(result.totalAllocated)}</div>
              <div className="text-[10px] text-muted-foreground">{result.unallocatedPct.toFixed(1)}% unallocated (cash)</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* All regimes probability */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {result.allRegimes.map((r) => (
          <Card key={r.regime} className={cn("p-2.5 border", r.regime === result.currentRegime.regime ? "border-2" : "")} style={{ borderColor: r.color + (r.regime === result.currentRegime.regime ? "" : "40") }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold" style={{ color: r.color }}>{r.regime.replace("_", " ")}</span>
              <span className="text-sm font-mono font-bold">{(r.probability * 100).toFixed(1)}%</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${r.probability * 100}%`, backgroundColor: r.color }} />
            </div>
          </Card>
        ))}
      </div>

      {/* Top allocations */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Top Strategy Allocations</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border">
              <tr className="text-muted-foreground text-[10px] uppercase">
                <th className="text-left py-2 px-3">Strategy</th>
                <th className="text-center py-2 px-2">Regime</th>
                <th className="text-right py-2 px-3">Allocation</th>
                <th className="text-right py-2 px-3">USD</th>
                <th className="text-right py-2 px-3">Exp Sharpe</th>
                <th className="text-left py-2 px-3">Description</th>
              </tr>
            </thead>
            <tbody>
              {result.allocations.slice(0, 8).map((a) => (
                <tr key={a.strategyId} className="border-b border-border/30 hover:bg-muted/30">
                  <td className="py-1.5 px-3 font-medium">{a.strategyName}</td>
                  <td className="py-1.5 px-2 text-center">
                    <Badge variant="outline" className="text-[9px] h-4 px-1" style={{ backgroundColor: REGIME_COLORS[a.regimeSource] + "20", color: REGIME_COLORS[a.regimeSource] }}>
                      {a.regimeSource.replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono font-semibold">{a.allocationPct.toFixed(1)}%</td>
                  <td className="py-1.5 px-3 text-right font-mono">{fmtUsd(a.allocationUSD)}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono", a.expectedSharpe >= 1.5 ? "text-emerald-400" : a.expectedSharpe < 1 ? "text-amber-400" : "")}>{a.expectedSharpe.toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-[10px] text-muted-foreground truncate max-w-[200px]">{a.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* HMM transition matrix */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">HMM Transition Matrix (P[regime_t | regime_{`{t-1}`}])</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="text-xs font-mono">
              <thead><tr><th className="p-2"></th><th className="p-2 text-muted-foreground">BEAR</th><th className="p-2 text-muted-foreground">NEUTRAL</th><th className="p-2 text-muted-foreground">BULL</th></tr></thead>
              <tbody>
                {["BEAR", "NEUTRAL", "BULL"].map((from, i) => (
                  <tr key={from}>
                    <td className="p-2 text-muted-foreground font-semibold">{from}</td>
                    {["BEAR", "NEUTRAL", "BULL"].map((to, j) => {
                      const val = result.transitionMatrix[i]?.[j] ?? 0;
                      return (
                        <td key={to} className="p-2 text-center" style={{ backgroundColor: val > 0.5 ? REGIME_COLORS[to === "BEAR" ? "BEAR" : to === "BULL" ? "BULL" : "NEUTRAL"] + "30" : "transparent" }}>
                          <span className={cn(val > 0.5 ? "font-bold" : "")}>{(val * 100).toFixed(1)}%</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">Diagonal = regime persistence (higher = more stable regime). Off-diagonal = transition probability.</div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Timeline View
// ============================================================
function TimelineView({ result }: { result: AllocationResult }) {
  if (result.history.length === 0) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground text-xs">No history yet.</CardContent></Card>;
  }

  // Prepare data for the probability area chart
  const chartData = result.history.map((h) => ({
    time: new Date(h.time).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    bull: h.bullProb * 100,
    bear: h.bearProb * 100,
    neutral: h.neutralProb * 100,
    highVol: h.highVolProb * 100,
    price: h.esPrice,
  }));

  // Regime timeline (colored bars)
  const regimeTimeline = result.history.map((h) => ({
    time: new Date(h.time).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    regime: h.regime,
    color: REGIME_COLORS[h.regime],
    probability: h.probability,
  }));

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Regime Probability Over Time</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.max(1, Math.floor(chartData.length / 8))} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}%`, ""]} contentStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="bull" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.6} />
                <Area type="monotone" dataKey="neutral" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} />
                <Area type="monotone" dataKey="bear" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.6} />
                <Area type="monotone" dataKey="highVol" stackId="1" stroke="#a855f7" fill="#a855f7" fillOpacity={0.6} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Detected Regime Timeline</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center h-8 rounded-md overflow-hidden">
            {regimeTimeline.map((t, i) => (
              <div key={i} className="flex-1 h-full" style={{ backgroundColor: t.color }} title={`${t.time}: ${t.regime} (${(t.probability * 100).toFixed(0)}%)`} />
            ))}
          </div>
          <div className="flex items-center justify-between mt-1 text-[10px] text-muted-foreground">
            <span>{regimeTimeline[0]?.time}</span>
            <span>{regimeTimeline[regimeTimeline.length - 1]?.time}</span>
          </div>
          <div className="flex items-center gap-3 mt-2 text-[10px]">
            {(["BULL", "NEUTRAL", "BEAR", "HIGH_VOL"] as Regime[]).map((r) => (
              <div key={r} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: REGIME_COLORS[r] }} />
                <span className="text-muted-foreground">{r.replace("_", " ")}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Allocations View (Pie chart + table)
// ============================================================
function AllocationsView({ result }: { result: AllocationResult }) {
  const pieData = result.allocations.map((a) => ({
    name: a.strategyName,
    value: a.allocationPct,
    color: REGIME_COLORS[a.regimeSource],
  }));

  // Add unallocated
  if (result.unallocatedPct > 0) {
    pieData.push({ name: "Cash", value: result.unallocatedPct, color: "#6b7280" });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Allocation Pie</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={40} label={(entry: any) => `${entry.name}: ${entry.value.toFixed(1)}%`}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} contentStyle={{ fontSize: 11 }} />
                </RePieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Allocation Breakdown</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-2 px-3">Strategy</th><th className="text-center py-2 px-2">Regime</th><th className="text-right py-2 px-3">%</th><th className="text-right py-2 px-3">USD</th></tr></thead>
              <tbody>
                {result.allocations.map((a) => (
                  <tr key={a.strategyId} className="border-b border-border/30">
                    <td className="py-1.5 px-3 font-medium">{a.strategyName}</td>
                    <td className="py-1.5 px-2 text-center"><div className="w-3 h-3 rounded-full mx-auto" style={{ backgroundColor: REGIME_COLORS[a.regimeSource] }} /></td>
                    <td className="py-1.5 px-3 text-right font-mono">{a.allocationPct.toFixed(2)}%</td>
                    <td className="py-1.5 px-3 text-right font-mono">{fmtUsd(a.allocationUSD)}</td>
                  </tr>
                ))}
                {result.unallocatedPct > 0 && (
                  <tr className="border-b border-border/30 bg-muted/20">
                    <td className="py-1.5 px-3 font-medium text-muted-foreground">Cash (Unallocated)</td>
                    <td className="py-1.5 px-2 text-center"><div className="w-3 h-3 rounded-full mx-auto bg-gray-500" /></td>
                    <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{result.unallocatedPct.toFixed(2)}%</td>
                    <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{fmtUsd(result.totalAllocated * (result.unallocatedPct / Math.max(100 - result.unallocatedPct, 1)))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// Stats View
// ============================================================
function StatsView({ result }: { result: AllocationResult }) {
  return (
    <Card>
      <CardHeader className="py-2"><CardTitle className="text-xs">Regime Statistics (Historical)</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 p-2">
          {(["BULL", "BEAR", "NEUTRAL", "HIGH_VOL"] as Regime[]).map((regime) => {
            const stats = result.regimeStats[regime];
            return (
              <Card key={regime} className="p-3" style={{ borderColor: REGIME_COLORS[regime] + "40" }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: REGIME_COLORS[regime] }} />
                  <span className="text-sm font-semibold" style={{ color: REGIME_COLORS[regime] }}>{regime.replace("_", " ")}</span>
                </div>
                <div className="space-y-1 text-[10px]">
                  <div className="flex justify-between"><span className="text-muted-foreground">Bars:</span><span className="font-mono">{stats.barsInRegime}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">% of Time:</span><span className="font-mono font-semibold">{stats.pctOfTime.toFixed(1)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Avg Return:</span><span className={cn("font-mono", stats.avgReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{stats.avgReturn >= 0 ? "+" : ""}{stats.avgReturn.toFixed(3)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Avg Vol:</span><span className="font-mono">{(stats.avgVol * 100).toFixed(2)}%</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Best Strategy:</span><span className="font-mono text-primary">{stats.bestStrategy}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Exp Sharpe:</span><span className="font-mono text-emerald-400">{stats.bestStrategySharpe.toFixed(2)}</span></div>
                </div>
              </Card>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
