"use client";
import { useMemo, useState, useRef } from "react";
import {
  runMonteCarlo, PRESET_SCENARIOS, PATH_METHODS,
  type MonteCarloConfig, type MonteCarloResult, type PathMethod, type StressScenario,
} from "@/lib/trading/monte-carlo-stress";
import { STRATEGIES } from "@/lib/trading/strategies";
import { CONTRACTS } from "@/lib/trading/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Activity, BarChart3, Gauge, Loader2, Play, Settings, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from "recharts";

type View = "summary" | "distribution" | "equity" | "paths";
const VIEWS: { id: View; name: string; icon: any }[] = [
  { id: "summary", name: "Robustness Summary", icon: Gauge },
  { id: "distribution", name: "P&L Distribution", icon: BarChart3 },
  { id: "equity", name: "Equity Curve Fan", icon: TrendingUp },
  { id: "paths", name: "Sample Paths", icon: Activity },
];

function fmtUsd(v: number): string {
  const sign = v >= 0 ? "+" : "";
  if (Math.abs(v) >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `${sign}$${(v / 1_000).toFixed(1)}K`;
  return `${sign}$${v.toFixed(0)}`;
}
function fmtPct(v: number): string { return `${(v * 100).toFixed(1)}%`; }

export function MonteCarloStressor() {
  const [view, setView] = useState<View>("summary");
  const [config, setConfig] = useState<MonteCarloConfig>({
    symbol: "ES",
    strategyId: "MEAN_REVERSION",
    strategyParams: { lookback: 30, entryZ: 2, exitZ: 0, stopZ: 4 } as any,
    numPaths: 1000,
    numBars: 126,
    method: "GBM",
    stressScenario: "NORMAL",
    initialCapital: 100_000,
    contractsPerTrade: 1,
    seed: 42,
  });
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRun = () => {
    setLoading(true);
    // Defer to next tick so spinner can render
    setTimeout(() => {
      try {
        const r = runMonteCarlo(config);
        setResult(r);
      } finally {
        setLoading(false);
      }
    }, 50);
  };

  return (
    <div className="space-y-4">
      {/* Config card */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Settings className="w-3.5 h-3.5" /> Monte Carlo Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Symbol</Label>
              <select value={config.symbol} onChange={(e) => setConfig({ ...config, symbol: e.target.value })} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8 font-mono">
                {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Strategy</Label>
              <select value={config.strategyId} onChange={(e) => setConfig({ ...config, strategyId: e.target.value })} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
                {STRATEGIES.map((s) => <option key={s.type} value={s.type}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Path Method</Label>
              <select value={config.method} onChange={(e) => setConfig({ ...config, method: e.target.value as PathMethod })} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
                {PATH_METHODS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Stress Scenario</Label>
              <select value={config.stressScenario} onChange={(e) => setConfig({ ...config, stressScenario: e.target.value as StressScenario })} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
                {PRESET_SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Number of Paths</Label>
              <select value={config.numPaths} onChange={(e) => setConfig({ ...config, numPaths: Number(e.target.value) })} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
                <option value={500}>500 (fast)</option>
                <option value={1000}>1,000</option>
                <option value={5000}>5,000</option>
                <option value={10000}>10,000 (slow)</option>
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Simulation Length</Label>
              <select value={config.numBars} onChange={(e) => setConfig({ ...config, numBars: Number(e.target.value) })} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
                <option value={30}>1 Week (30 bars)</option>
                <option value={126}>1 Month (126 bars)</option>
                <option value={252}>3 Months (252 bars)</option>
                <option value={504}>6 Months (504 bars)</option>
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Initial Capital</Label>
              <Input type="number" value={config.initialCapital} onChange={(e) => setConfig({ ...config, initialCapital: Number(e.target.value) })} className="h-8 text-xs font-mono mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Contracts per Trade</Label>
              <Input type="number" value={config.contractsPerTrade} onChange={(e) => setConfig({ ...config, contractsPerTrade: Number(e.target.value) })} className="h-8 text-xs font-mono mt-0.5" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleRun} disabled={loading}>
              {loading ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Running {config.numPaths.toLocaleString()} paths...</> : <><Play className="w-3.5 h-3.5 mr-1" /> Run Monte Carlo Simulation</>}
            </Button>
            {result && (
              <div className="text-[10px] text-muted-foreground">
                Last run: {result.durationMs}ms · {result.paths.length} paths · {PRESET_SCENARIOS.find((s) => s.id === config.stressScenario)?.name}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* View switcher */}
      <div className="flex items-center gap-1 flex-wrap">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)} disabled={!result}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50",
              view === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>
            <v.icon className="w-3.5 h-3.5" />{v.name}
          </button>
        ))}
      </div>

      {!result && !loading && (
        <Card>
          <CardContent className="p-8 text-center">
            <Zap className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <div className="text-sm font-semibold mb-1">No simulation yet</div>
            <div className="text-xs text-muted-foreground">Configure parameters above and click "Run Monte Carlo Simulation" to stress-test the strategy across {config.numPaths.toLocaleString()} alternate price paths.</div>
          </CardContent>
        </Card>
      )}

      {result && view === "summary" && <SummaryView result={result} />}
      {result && view === "distribution" && <DistributionView result={result} />}
      {result && view === "equity" && <EquityFanView result={result} />}
      {result && view === "paths" && <SamplePathsView result={result} />}
    </div>
  );
}

// ============================================================
// Summary View
// ============================================================
function SummaryView({ result }: { result: MonteCarloResult }) {
  const ruinPct = result.probabilityOfRuin * 100;
  const profitPct = result.probabilityOfProfit * 100;
  const targetPct = result.probabilityOfTargetReturn * 100;

  return (
    <div className="space-y-3">
      {/* Top cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card className={cn("p-2.5 border", result.pnlMean >= 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5")}>
          <div className="text-[9px] uppercase text-muted-foreground">Mean P&L</div>
          <div className={cn("text-sm font-mono font-semibold", result.pnlMean >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtUsd(result.pnlMean)}</div>
        </Card>
        <Card className="p-2.5 border-rose-500/20 bg-rose-500/5">
          <div className="text-[9px] uppercase text-muted-foreground">5th Percentile (Worst)</div>
          <div className="text-sm font-mono font-semibold text-rose-400">{fmtUsd(result.pnlPercentiles.p5)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Median (50th)</div>
          <div className="text-sm font-mono font-semibold">{fmtUsd(result.pnlPercentiles.p50)}</div>
        </Card>
        <Card className="p-2.5 border-emerald-500/20 bg-emerald-500/5">
          <div className="text-[9px] uppercase text-muted-foreground">95th Percentile (Best)</div>
          <div className="text-sm font-mono font-semibold text-emerald-400">{fmtUsd(result.pnlPercentiles.p95)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Std Dev</div>
          <div className="text-sm font-mono font-semibold">{fmtUsd(result.pnlStd)}</div>
        </Card>
      </div>

      {/* Robustness metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className={cn("border", ruinPct > 20 ? "border-rose-500/40 bg-rose-500/10" : ruinPct > 5 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/20 bg-emerald-500/5")}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className={cn("w-5 h-5", ruinPct > 20 ? "text-rose-400" : ruinPct > 5 ? "text-amber-400" : "text-emerald-400")} />
              <span className="text-xs font-semibold">Probability of Ruin</span>
            </div>
            <div className={cn("text-2xl font-mono font-bold", ruinPct > 20 ? "text-rose-400" : ruinPct > 5 ? "text-amber-400" : "text-emerald-400")}>{ruinPct.toFixed(1)}%</div>
            <div className="text-[10px] text-muted-foreground mt-1">P&L &lt; -50% of initial capital</div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              <span className="text-xs font-semibold">Probability of Profit</span>
            </div>
            <div className="text-2xl font-mono font-bold text-emerald-400">{profitPct.toFixed(1)}%</div>
            <div className="text-[10px] text-muted-foreground mt-1">P&L &gt; $0</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 mb-2">
              <Gauge className="w-5 h-5 text-primary" />
              <span className="text-xs font-semibold">Probability of +10% Return</span>
            </div>
            <div className="text-2xl font-mono font-bold text-primary">{targetPct.toFixed(1)}%</div>
            <div className="text-[10px] text-muted-foreground mt-1">P&L &gt; 10% of initial capital</div>
          </CardContent>
        </Card>
      </div>

      {/* Sharpe + MDD + Deflated Sharpe */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Mean Sharpe</div>
          <div className={cn("text-sm font-mono font-semibold", result.sharpeMean >= 1 ? "text-emerald-400" : result.sharpeMean < 0 ? "text-rose-400" : "")}>{result.sharpeMean.toFixed(2)}</div>
          <div className="text-[9px] text-muted-foreground mt-0.5">5th: {result.sharpePercentiles.p5.toFixed(2)} / 95th: {result.sharpePercentiles.p95.toFixed(2)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Mean Max DD</div>
          <div className="text-sm font-mono font-semibold text-rose-400">{fmtUsd(result.mddMean)}</div>
          <div className="text-[9px] text-muted-foreground mt-0.5">95th: {fmtUsd(result.mddPercentiles.p95)}</div>
        </Card>
        <Card className={cn("p-2.5 border", result.deflatedSharpe > 0.5 ? "border-emerald-500/20 bg-emerald-500/5" : result.deflatedSharpe < 0 ? "border-rose-500/20 bg-rose-500/5" : "border-amber-500/20 bg-amber-500/5")}>
          <div className="text-[9px] uppercase text-muted-foreground">Deflated Sharpe Ratio</div>
          <div className={cn("text-sm font-mono font-semibold", result.deflatedSharpe > 0.5 ? "text-emerald-400" : result.deflatedSharpe < 0 ? "text-rose-400" : "text-amber-400")}>{result.deflatedSharpe.toFixed(3)}</div>
          <div className="text-[9px] text-muted-foreground mt-0.5">Bailey-LdP 2014 (overfitting-adjusted)</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">P&L Range</div>
          <div className="text-sm font-mono font-semibold">{fmtUsd(result.pnlPercentiles.p95 - result.pnlPercentiles.p5)}</div>
          <div className="text-[9px] text-muted-foreground mt-0.5">95th - 5th percentile</div>
        </Card>
      </div>

      {/* Scenario description */}
      <Card>
        <CardContent className="p-3">
          <div className="text-[10px] uppercase text-muted-foreground mb-1">Stress Scenario Applied</div>
          <div className="text-xs">{PRESET_SCENARIOS.find((s) => s.id === result.config.stressScenario)?.description}</div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Distribution View
// ============================================================
function DistributionView({ result }: { result: MonteCarloResult }) {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Terminal P&L Distribution ({result.paths.length} paths)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={result.histogram}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} angle={-25} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} />
                <Tooltip formatter={(v: any) => [`${v} paths`, "Count"]} contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {result.histogram.map((d, i) => {
                    const mid = result.histogram.length / 2;
                    const isPositive = i >= mid;
                    return <Cell key={i} fill={isPositive ? "#10b981" : "#ef4444"} />;
                  })}
                </Bar>
                <ReferenceLine x={result.histogram.findIndex((h) => h.lowerBound > 0) >= 0 ? result.histogram[Math.floor(result.histogram.length / 2)]?.bucket : 0} stroke="#666" strokeDasharray="3 3" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Percentile Breakdown</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-2 px-3">Percentile</th><th className="text-right py-2 px-3">P&L</th><th className="text-left py-2 px-3">Interpretation</th></tr></thead>
            <tbody>
              {[
                { p: "5th (Worst Case)", v: result.pnlPercentiles.p5, color: "text-rose-400", desc: "95% of paths did better than this" },
                { p: "10th", v: result.pnlPercentiles.p10, color: "text-rose-400", desc: "90% of paths did better" },
                { p: "25th (Lower Quartile)", v: result.pnlPercentiles.p25, color: "text-amber-400", desc: "75% of paths did better" },
                { p: "50th (Median)", v: result.pnlPercentiles.p50, color: "text-foreground", desc: "50% better, 50% worse" },
                { p: "75th (Upper Quartile)", v: result.pnlPercentiles.p75, color: "text-emerald-400", desc: "25% of paths did better" },
                { p: "90th", v: result.pnlPercentiles.p90, color: "text-emerald-400", desc: "10% of paths did better" },
                { p: "95th (Best Case)", v: result.pnlPercentiles.p95, color: "text-emerald-400", desc: "5% of paths did better than this" },
              ].map((row) => (
                <tr key={row.p} className="border-b border-border/30">
                  <td className="py-1.5 px-3 font-medium">{row.p}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono font-semibold", row.color)}>{fmtUsd(row.v)}</td>
                  <td className="py-1.5 px-3 text-[10px] text-muted-foreground">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Equity Curve Fan View
// ============================================================
function EquityFanView({ result }: { result: MonteCarloResult }) {
  const chartData = result.equityBands.map((b) => ({
    time: b.time,
    p5: b.p5,
    p25: b.p25,
    p50: b.p50,
    p75: b.p75,
    p95: b.p95,
  }));

  return (
    <Card>
      <CardHeader className="py-2"><CardTitle className="text-xs">Equity Curve Fan Chart — Confidence Bands Over Time</CardTitle></CardHeader>
      <CardContent>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={70} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: any) => [`$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, ""]} contentStyle={{ fontSize: 11 }} />
              <ReferenceLine y={result.config.initialCapital} stroke="#666" strokeDasharray="3 3" strokeOpacity={0.5} />
              {/* 5-95 band (widest, lightest) */}
              <Area type="monotone" dataKey="p95" stroke="none" fill="#10b981" fillOpacity={0.05} />
              <Area type="monotone" dataKey="p5" stroke="none" fill="#ef4444" fillOpacity={0.05} />
              {/* 25-75 band */}
              <Area type="monotone" dataKey="p75" stroke="#10b981" strokeWidth={1} strokeOpacity={0.4} fill="#10b981" fillOpacity={0.1} />
              <Area type="monotone" dataKey="p25" stroke="#ef4444" strokeWidth={1} strokeOpacity={0.4} fill="#ef4444" fillOpacity={0.1} />
              {/* Median line */}
              <Line type="monotone" dataKey="p50" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center justify-center gap-4 text-[10px]">
          <div className="flex items-center gap-1"><div className="w-3 h-2 bg-emerald-500/10 border border-emerald-500/40" /><span className="text-muted-foreground">25-75% band</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-2 bg-emerald-500/5" /><span className="text-muted-foreground">5-95% band</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-blue-500" /><span className="text-muted-foreground">Median (50th)</span></div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Sample Paths View
// ============================================================
function SamplePathsView({ result }: { result: MonteCarloResult }) {
  // Show 20 sample paths + the median
  const sampleSize = Math.min(20, result.paths.length);
  const sample = result.paths.slice(0, sampleSize);
  const maxLen = Math.max(...sample.map((p) => p.equityCurve.length));
  const chartData = Array.from({ length: maxLen }, (_, i) => {
    const row: any = { time: i };
    sample.forEach((p, pi) => {
      row[`path${pi}`] = p.equityCurve[i] ?? p.equityCurve[p.equityCurve.length - 1];
    });
    row.median = result.equityBands[i]?.p50 ?? result.equityBands[result.equityBands.length - 1]?.p50;
    return row;
  });

  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#84cc16", "#f97316"];

  return (
    <Card>
      <CardHeader className="py-2"><CardTitle className="text-xs">Sample Equity Paths ({sampleSize} random paths + median)</CardTitle></CardHeader>
      <CardContent>
        <div className="h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={70} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
              <Tooltip formatter={(v: any) => [`$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, ""]} contentStyle={{ fontSize: 11 }} />
              <ReferenceLine y={result.config.initialCapital} stroke="#666" strokeDasharray="3 3" strokeOpacity={0.5} />
              {sample.map((p, pi) => (
                <Line key={pi} type="monotone" dataKey={`path${pi}`} stroke={colors[pi % colors.length]} strokeWidth={1} strokeOpacity={0.4} dot={false} />
              ))}
              <Line type="monotone" dataKey="median" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
