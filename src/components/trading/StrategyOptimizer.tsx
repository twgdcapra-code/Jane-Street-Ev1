"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS } from "@/lib/trading/contracts";
import { STRATEGIES, getStrategy } from "@/lib/trading/strategies";
import {
  buildParamRanges, walkForwardOptimize, geneticOptimize, cpcvValidate,
  computeDSR, sensitivityAnalysis, type FitnessMetric,
  type WFOResult, type GAResult, type CPCVResult, type DSRResult, type SensitivityResult,
} from "@/lib/trading/strategy-optimizer";
import { fmtMoney, fmtPct, fmtPrice } from "@/lib/trading/format";
import { getEngine } from "@/lib/trading/market-engine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart,
} from "recharts";
import { cn } from "@/lib/utils";
import { Brain, Cpu, Dna, FlaskConical, Play, Radar, Shield, Target, TrendingUp } from "lucide-react";

type OptMethod = "wfo" | "ga" | "cpcv" | "dsr" | "sensitivity";

const METHODS: { id: OptMethod; name: string; icon: any; description: string }[] = [
  { id: "ga", name: "Genetic Algorithm", icon: Dna, description: "Evolve optimal parameters using population genetics" },
  { id: "wfo", name: "Walk-Forward Opt.", icon: TrendingUp, description: "Test on rolling out-of-sample windows (Pardo 2008)" },
  { id: "cpcv", name: "CPCV", icon: Shield, description: "Combinatorial Purged CV (López de Prado 2018)" },
  { id: "dsr", name: "Deflated Sharpe", icon: Target, description: "Multiple-testing correction (Bailey-López de Prado 2014)" },
  { id: "sensitivity", name: "Sensitivity", icon: FlaskConical, description: "Parameter perturbation robustness analysis" },
];

const FITNESS_METRICS: { value: FitnessMetric; label: string }[] = [
  { value: "SHARPE", label: "Sharpe Ratio" },
  { value: "SORTINO", label: "Sortino Ratio" },
  { value: "CALMAR", label: "Calmar Ratio" },
  { value: "PROFIT_FACTOR", label: "Profit Factor" },
  { value: "RETURN_RISK", label: "Return / Risk" },
];

export function StrategyOptimizer() {
  const [method, setMethod] = useState<OptMethod>("ga");
  const [strategyId, setStrategyId] = useState("mean_reversion");
  const [symbol, setSymbol] = useState("ES");
  const [fitnessMetric, setFitnessMetric] = useState<FitnessMetric>("SHARPE");
  const [running, setRunning] = useState(false);
  // GA config
  const [popSize, setPopSize] = useState(30);
  const [generations, setGenerations] = useState(20);
  const [mutationRate, setMutationRate] = useState(0.15);
  // WFO config
  const [windowSize, setWindowSize] = useState(100);
  const [stepSize, setStepSize] = useState(30);
  // CPCV config
  const [nGroups, setNGroups] = useState(6);
  const [nTestGroups, setNTestGroups] = useState(2);
  // DSR config
  const [observedSharpe, setObservedSharpe] = useState(1.5);
  const [numTrials, setNumTrials] = useState(50);
  const [trackYears, setTrackYears] = useState(2);
  // Results
  const [gaResult, setGaResult] = useState<GAResult | null>(null);
  const [wfoResult, setWfoResult] = useState<WFOResult | null>(null);
  const [cpcvResult, setCpcvResult] = useState<CPCVResult | null>(null);
  const [dsrResult, setDsrResult] = useState<DSRResult | null>(null);
  const [sensResult, setSensResult] = useState<SensitivityResult[] | null>(null);

  const paramRanges = useMemo(() => buildParamRanges(strategyId), [strategyId]);
  const def = getStrategy(strategyId);

  const handleRun = () => {
    setRunning(true);
    setTimeout(() => {
      try {
        const engine = getEngine();
        const candles = engine.getHistory(symbol).length > 50
          ? engine.getHistory(symbol)
          : engine.getCandles(symbol, 250);
        if (method === "ga") {
          const result = geneticOptimize(strategyId, symbol, paramRanges, candles, popSize, generations, 0.7, mutationRate, 2, fitnessMetric, 3);
          setGaResult(result);
        } else if (method === "wfo") {
          const result = walkForwardOptimize(strategyId, symbol, paramRanges, candles, windowSize, stepSize, 0.7, fitnessMetric, 15);
          setWfoResult(result);
        } else if (method === "cpcv") {
          const defaultParams: Record<string, number> = {};
          paramRanges.forEach((r) => defaultParams[r.key] = (def?.paramSchema.find((p) => p.key === r.key)?.default ?? r.min) as number);
          const result = cpcvValidate(strategyId, symbol, defaultParams, candles, nGroups, nTestGroups, 5);
          setCpcvResult(result);
        } else if (method === "dsr") {
          const result = computeDSR(observedSharpe, numTrials, trackYears);
          setDsrResult(result);
        } else if (method === "sensitivity") {
          const defaultParams: Record<string, number> = {};
          paramRanges.forEach((r) => defaultParams[r.key] = (def?.paramSchema.find((p) => p.key === r.key)?.default ?? r.min) as number);
          const result = sensitivityAnalysis(strategyId, symbol, defaultParams, paramRanges, candles, 3);
          setSensResult(result);
        }
      } catch (e) {
        console.error("Optimizer error:", e);
      }
      setRunning(false);
    }, 50);
  };

  return (
    <div className="space-y-4">
      {/* Configuration */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Cpu className="w-4 h-4" /> Strategy Optimizer</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {/* Method selector */}
          <div>
            <Label className="text-[10px] text-muted-foreground">Optimization Method</Label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5 mt-0.5">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    "p-2 rounded-md border text-left transition-colors",
                    method === m.id ? "bg-primary/15 border-primary/30" : "border-border hover:bg-muted/40",
                  )}
                >
                  <m.icon className="w-3.5 h-3.5 mb-1" />
                  <div className="text-[10px] font-medium">{m.name}</div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{METHODS.find((m) => m.id === method)?.description}</p>
          </div>
          {/* Strategy + symbol */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-[10px] text-muted-foreground">Strategy</Label>
              <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs">
                {STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Symbol</Label>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs font-mono">
                {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}
              </select>
            </div>
            {(method === "ga" || method === "wfo") && (
              <div>
                <Label className="text-[10px] text-muted-foreground">Fitness Metric</Label>
                <select value={fitnessMetric} onChange={(e) => setFitnessMetric(e.target.value as FitnessMetric)} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs">
                  {FITNESS_METRICS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
            )}
          </div>
          {/* Method-specific config */}
          {method === "ga" && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">Population Size</Label>
                <Input type="number" value={popSize} onChange={(e) => setPopSize(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Generations</Label>
                <Input type="number" value={generations} onChange={(e) => setGenerations(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Mutation Rate</Label>
                <Input type="number" step="0.05" value={mutationRate} onChange={(e) => setMutationRate(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
            </div>
          )}
          {method === "wfo" && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">Window Size (bars)</Label>
                <Input type="number" value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Step Size (bars)</Label>
                <Input type="number" value={stepSize} onChange={(e) => setStepSize(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
              <div className="text-[10px] text-muted-foreground self-end pb-2">IS/OOS split: 70/30</div>
            </div>
          )}
          {method === "cpcv" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">N Groups</Label>
                <Input type="number" value={nGroups} onChange={(e) => setNGroups(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">K Test Groups</Label>
                <Input type="number" value={nTestGroups} onChange={(e) => setNTestGroups(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
            </div>
          )}
          {method === "dsr" && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">Observed Sharpe</Label>
                <Input type="number" step="0.1" value={observedSharpe} onChange={(e) => setObservedSharpe(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Number of Trials</Label>
                <Input type="number" value={numTrials} onChange={(e) => setNumTrials(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Track Record (years)</Label>
                <Input type="number" step="0.5" value={trackYears} onChange={(e) => setTrackYears(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
            </div>
          )}
          <Button className="w-full" onClick={handleRun} disabled={running}>
            <Play className="w-3 h-3 mr-1" /> {running ? "Optimizing..." : `Run ${METHODS.find((m) => m.id === method)?.name}`}
          </Button>
          {/* Parameter ranges display */}
          {paramRanges.length > 0 && (method === "ga" || method === "wfo" || method === "sensitivity") && (
            <div className="border-t border-border/40 pt-2">
              <div className="text-[10px] text-muted-foreground uppercase mb-1">Search Space ({paramRanges.length} params)</div>
              <div className="flex flex-wrap gap-2">
                {paramRanges.map((r) => (
                  <Badge key={r.key} variant="outline" className="text-[9px]">{r.label}: [{r.min}–{r.max}] step {r.step}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {method === "ga" && gaResult && <GAResultView result={gaResult} />}
      {method === "wfo" && wfoResult && <WFOResultView result={wfoResult} />}
      {method === "cpcv" && cpcvResult && <CPCVResultView result={cpcvResult} />}
      {method === "dsr" && dsrResult && <DSRResultView result={dsrResult} />}
      {method === "sensitivity" && sensResult && <SensitivityView result={sensResult} />}

      {!gaResult && !wfoResult && !cpcvResult && !dsrResult && !sensResult && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            Select an optimization method and click Run to find optimal strategy parameters.
            <br />
            <span className="text-[10px]">Methods: Genetic Algorithm, Walk-Forward, CPCV, Deflated Sharpe Ratio, Sensitivity Analysis</span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// GA RESULT VIEW
// ============================================================
function GAResultView({ result }: { result: GAResult }) {
  const chartData = result.generations.map((g) => ({ gen: g.index, best: g.bestFitness, avg: g.avgFitness }));
  return (
    <div className="space-y-3">
      <Card className={cn("border", result.bestFitness > 1 ? "border-emerald-500/30 bg-emerald-500/5" : "border-border")}>
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground">{result.explanation}</p>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="p-2.5 border-emerald-500/30 bg-emerald-500/5"><div className="text-[9px] uppercase text-muted-foreground">Best Fitness</div><div className="text-sm font-mono font-semibold text-emerald-400">{result.bestFitness.toFixed(3)}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Convergence</div><div className="text-sm font-mono font-semibold">{(result.convergence * 100).toFixed(0)}%</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Generations</div><div className="text-sm font-mono font-semibold">{result.generations.length}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Best Sharpe</div><div className="text-sm font-mono font-semibold">{result.bestMetrics?.sharpe.toFixed(2) ?? "—"}</div></Card>
      </div>
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Convergence Curve (Fitness per Generation)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="gen" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} label={{ value: "Generation", position: "insideBottom", offset: -2, fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} />
                <Tooltip formatter={(v: any) => Number(v).toFixed(3)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                <Line type="monotone" dataKey="best" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name="Best" />
                <Line type="monotone" dataKey="avg" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Average" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Optimal Parameters</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border">
              <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                <th className="text-left py-2 px-3">Parameter</th>
                <th className="text-right py-2 px-3">Optimal Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.bestParams).map(([key, val]) => (
                <tr key={key} className="border-b border-border/40">
                  <td className="py-2 px-3 font-mono">{key}</td>
                  <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-400">{String(val)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      {result.bestMetrics && (
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Backtest Metrics with Optimal Params</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-border">
              <Metric label="Return" value={fmtPct(result.bestMetrics.totalReturnPct)} good={result.bestMetrics.totalReturnPct > 0} />
              <Metric label="Sharpe" value={result.bestMetrics.sharpe.toFixed(2)} good={result.bestMetrics.sharpe > 1} />
              <Metric label="Sortino" value={result.bestMetrics.sortino.toFixed(2)} />
              <Metric label="Max DD" value={fmtPct(result.bestMetrics.maxDrawdownPct)} />
              <Metric label="Win Rate" value={`${result.bestMetrics.winRate.toFixed(0)}%`} />
              <Metric label="Trades" value={String(result.bestMetrics.totalTrades)} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// WFO RESULT VIEW
// ============================================================
function WFOResultView({ result }: { result: WFOResult }) {
  const chartData = result.windows.map((w) => ({ window: w.index + 1, is: w.isSharpe, oos: w.oosSharpe }));
  return (
    <div className="space-y-3">
      <Card className={cn("border", result.walkForwardEfficiency > 0.5 ? "border-emerald-500/30 bg-emerald-500/5" : result.walkForwardEfficiency < 0.3 ? "border-rose-500/30 bg-rose-500/5" : "border-amber-500/30 bg-amber-500/5")}>
        <CardContent className="p-3"><p className="text-xs text-muted-foreground">{result.explanation}</p></CardContent>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">WFE</div><div className={cn("text-sm font-mono font-semibold", result.walkForwardEfficiency > 0.5 ? "text-emerald-400" : result.walkForwardEfficiency < 0.3 ? "text-rose-400" : "text-amber-400")}>{result.walkForwardEfficiency.toFixed(2)}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Avg IS Sharpe</div><div className="text-sm font-mono font-semibold">{result.avgIsSharpe.toFixed(2)}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Avg OOS Sharpe</div><div className="text-sm font-mono font-semibold">{result.avgOoSSharpe.toFixed(2)}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Pass Rate</div><div className={cn("text-sm font-mono font-semibold", result.passRate > 0.5 ? "text-emerald-400" : "text-rose-400")}>{(result.passRate * 100).toFixed(0)}%</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Param Stability</div><div className={cn("text-sm font-mono font-semibold", result.parameterStability > 0.7 ? "text-emerald-400" : "")}>{(result.parameterStability * 100).toFixed(0)}%</div></Card>
      </div>
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">IS vs OOS Sharpe per Window</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="window" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} />
                <Tooltip formatter={(v: any) => Number(v).toFixed(2)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#666" />
                <Bar dataKey="is" fill="#3b82f6" name="In-Sample" radius={[2, 2, 0, 0]} />
                <Bar dataKey="oos" fill="#10b981" name="Out-of-Sample" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// CPCV RESULT VIEW
// ============================================================
function CPCVResultView({ result }: { result: CPCVResult }) {
  const chartData = result.paths.map((p) => ({ path: p.index + 1, sharpe: p.sharpe, groups: p.testGroups.join(",") }));
  return (
    <div className="space-y-3">
      <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">{result.explanation}</p></CardContent></Card>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Total Paths</div><div className="text-sm font-mono font-semibold">{result.totalPaths}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Avg Sharpe</div><div className={cn("text-sm font-mono font-semibold", result.avgSharpe > 0 ? "text-emerald-400" : "text-rose-400")}>{result.avgSharpe.toFixed(2)}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Sharpe Std</div><div className="text-sm font-mono font-semibold">{result.sharpeStd.toFixed(2)}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Prob(Sharpe&gt;0)</div><div className={cn("text-sm font-mono font-semibold", result.probSharpePositive > 0.7 ? "text-emerald-400" : "text-amber-400")}>{(result.probSharpePositive * 100).toFixed(0)}%</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Range</div><div className="text-sm font-mono font-semibold">{result.minSharpe.toFixed(1)} – {result.maxSharpe.toFixed(1)}</div></Card>
      </div>
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Sharpe Distribution Across {result.totalPaths} CPCV Paths</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="path" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} />
                <Tooltip formatter={(v: any) => Number(v).toFixed(2)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#666" />
                <Bar dataKey="sharpe" radius={[2, 2, 0, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.sharpe >= 0 ? "#10b981" : "#ef4444"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// DSR RESULT VIEW
// ============================================================
function DSRResultView({ result }: { result: DSRResult }) {
  return (
    <div className="space-y-3">
      <Card className={cn("border", result.isSignificant ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5")}>
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            {result.isSignificant ? <Shield className="w-5 h-5 text-emerald-400" /> : <Shield className="w-5 h-5 text-rose-400" />}
            <p className="text-xs text-muted-foreground">{result.explanation}</p>
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Observed Sharpe</div><div className="text-sm font-mono font-semibold">{result.observedSharpe.toFixed(2)}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Expected Max (null)</div><div className="text-sm font-mono font-semibold text-amber-400">{result.expectedMaxSharpe.toFixed(2)}</div></Card>
        <Card className={cn("p-2.5 border", result.isSignificant ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5")}>
          <div className="text-[9px] uppercase text-muted-foreground">Deflated Sharpe</div>
          <div className={cn("text-sm font-mono font-semibold", result.deflatedSharpe > 0 ? "text-emerald-400" : "text-rose-400")}>{result.deflatedSharpe.toFixed(2)}</div>
        </Card>
        <Card className={cn("p-2.5 border", result.isSignificant ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5")}>
          <div className="text-[9px] uppercase text-muted-foreground">PSR</div>
          <div className={cn("text-sm font-mono font-semibold", result.isSignificant ? "text-emerald-400" : "text-rose-400")}>{(result.psr * 100).toFixed(1)}%</div>
        </Card>
      </div>
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Interpretation</CardTitle></CardHeader>
        <CardContent className="text-xs space-y-2">
          <div className="flex items-start gap-2">
            <span className={cn("w-4 h-4 rounded-full shrink-0 mt-0.5", result.observedSharpe > result.expectedMaxSharpe ? "bg-emerald-500" : "bg-rose-500")} />
            <span>Observed Sharpe ({result.observedSharpe.toFixed(2)}) {result.observedSharpe > result.expectedMaxSharpe ? "exceeds" : "does not exceed"} the expected maximum ({result.expectedMaxSharpe.toFixed(2)}) from {result.numTrials} trials under the null hypothesis.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className={cn("w-4 h-4 rounded-full shrink-0 mt-0.5", result.psr > 0.95 ? "bg-emerald-500" : "bg-rose-500")} />
            <span>Probabilistic Sharpe Ratio: {(result.psr * 100).toFixed(1)}%. {result.psr > 0.95 ? "Above 95% confidence threshold — the strategy has genuine predictive power." : "Below 95% — the observed Sharpe could be explained by multiple testing."}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full shrink-0 mt-0.5 bg-blue-500" />
            <span>Minimum Track Record Length: {result.minTRL.toFixed(1)} years. The strategy needs at least this many years of live trading to confirm its Sharpe at 95% confidence.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// SENSITIVITY VIEW
// ============================================================
function SensitivityView({ result }: { result: SensitivityResult[] }) {
  return (
    <div className="space-y-3">
      {result.map((s, i) => (
        <Card key={i}>
          <CardHeader className="py-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs">{s.paramLabel} (optimal: {s.optimalValue})</CardTitle>
            <Badge variant="outline" className={cn("text-[9px]", s.robustness > 0.7 ? "bg-emerald-500/15 text-emerald-400" : s.robustness > 0.4 ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400")}>
              Robustness: {(s.robustness * 100).toFixed(0)}%
            </Badge>
          </CardHeader>
          <CardContent>
            <div className="h-[150px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={s.values.map((v) => ({ value: v.value, fitness: v.fitness, sharpe: v.sharpe }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis dataKey="value" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} />
                  <Tooltip formatter={(v: any) => Number(v).toFixed(3)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                  <ReferenceLine x={s.optimalValue} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: "Optimal", fontSize: 9, fill: "#fbbf24" }} />
                  <Area type="monotone" dataKey="fitness" stroke="#3b82f6" strokeWidth={2} fill="#3b82f633" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Metric({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className={cn("bg-card p-2", good && "text-emerald-400", bad && "text-rose-400")}>
      <div className="text-[9px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-mono font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
