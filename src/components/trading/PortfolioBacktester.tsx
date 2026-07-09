"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS } from "@/lib/trading/contracts";
import { STRATEGIES, getStrategy } from "@/lib/trading/strategies";
import type { StrategyParams } from "@/lib/trading/types";
import {
  runPortfolioBacktest, monteCarloPortfolio, computeAllocation,
  type PortfolioBacktestConfig, type PortfolioBacktestResult,
  type AllocationMethod, type MonteCarloResult, type PortfolioStrategyConfig,
} from "@/lib/trading/portfolio-backtest";
import { fmtMoney, fmtPct, fmtPrice } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { Brain, Layers, Plus, Play, Trash2, TrendingUp, Activity, Target, Radar } from "lucide-react";

const ALLOCATION_METHODS: { value: AllocationMethod; label: string; description: string }[] = [
  { value: "EQUAL_WEIGHT", label: "Equal Weight", description: "Each strategy gets equal allocation. Simple baseline." },
  { value: "INVERSE_VOLATILITY", label: "Inverse Volatility", description: "Lower-vol strategies get more weight. No correlation needed." },
  { value: "RISK_PARITY", label: "Risk Parity (ERC)", description: "Equal risk contribution. Maillard-Roncalli-Teiletche (2010)." },
  { value: "KELLY", label: "Full Kelly", description: "f* = μ/σ². Maximizes geometric growth. High drawdown risk." },
  { value: "FRACTIONAL_KELLY", label: "Fractional Kelly (25%)", description: "¼ Kelly. Sacrifices ~25% growth for ~50% lower drawdown." },
  { value: "CORRELATION_AWARE", label: "Correlation-Aware", description: "Lower-correlation strategies get more weight. Maximizes diversification." },
];

interface StrategySlot {
  id: string;
  strategyId: string;
  symbol: string;
  params: StrategyParams;
}

let slotCounter = 0;

export function PortfolioBacktester() {
  const [slots, setSlots] = useState<StrategySlot[]>([
    { id: `slot-${slotCounter++}`, strategyId: "mean_reversion", symbol: "ES", params: { lookback: 30, entryZ: 2, exitZ: 0, stopZ: 4 } },
    { id: `slot-${slotCounter++}`, strategyId: "momentum", symbol: "NQ", params: { fast: 9, slow: 21, rsiPeriod: 14, rsiUpper: 70, rsiLower: 30 } },
  ]);
  const [allocationMethod, setAllocationMethod] = useState<AllocationMethod>("RISK_PARITY");
  const [initialCapital, setInitialCapital] = useState(500000);
  const [rebalanceFreq, setRebalanceFreq] = useState(20);
  const [result, setResult] = useState<PortfolioBacktestResult | null>(null);
  const [mcResult, setMcResult] = useState<MonteCarloResult | null>(null);
  const [running, setRunning] = useState(false);
  const [mcPaths, setMcPaths] = useState(1000);
  const [activeView, setActiveView] = useState<"equity" | "correlation" | "contribution" | "montecarlo">("equity");

  const addSlot = () => {
    const def = STRATEGIES[slots.length % STRATEGIES.length];
    const defaultParams: StrategyParams = {};
    for (const p of def.paramSchema) defaultParams[p.key] = p.default;
    setSlots([...slots, {
      id: `slot-${slotCounter++}`,
      strategyId: def.id,
      symbol: CONTRACTS[slots.length % CONTRACTS.length].symbol,
      params: defaultParams,
    }]);
  };

  const removeSlot = (id: string) => setSlots(slots.filter((s) => s.id !== id));

  const updateSlot = (id: string, updates: Partial<StrategySlot>) =>
    setSlots(slots.map((s) => (s.id === id ? { ...s, ...updates } : s)));

  const updateParam = (id: string, key: string, value: number) =>
    setSlots(slots.map((s) => (s.id === id ? { ...s, params: { ...s.params, [key]: value } } : s)));

  const handleRun = () => {
    setRunning(true);
    setTimeout(() => {
      try {
        const config: PortfolioBacktestConfig = {
          strategies: slots.map((s) => ({
            strategyId: s.strategyId,
            symbol: s.symbol,
            params: s.params,
            weight: 1 / slots.length,
          })),
          allocationMethod,
          initialCapital,
          rebalanceFrequency: rebalanceFreq,
          kellyFraction: 0.25,
        };
        const res = runPortfolioBacktest(config);
        setResult(res);
        // Run Monte Carlo
        const mc = monteCarloPortfolio(res.equityCurve.map((e) => e.equity), initialCapital, mcPaths);
        setMcResult(mc);
      } catch (e) {
        console.error("Portfolio backtest error:", e);
      }
      setRunning(false);
    }, 50);
  };

  return (
    <div className="space-y-4">
      {/* Configuration */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Layers className="w-4 h-4" /> Strategy Portfolio Configuration</CardTitle>
          <Button size="sm" onClick={addSlot}><Plus className="w-3 h-3 mr-1" /> Add Strategy</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {slots.map((slot, i) => {
            const def = getStrategy(slot.strategyId);
            return (
              <div key={slot.id} className="border border-border rounded-md p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px]">#{i + 1}</Badge>
                    <select
                      value={slot.strategyId}
                      onChange={(e) => {
                        const newDef = getStrategy(e.target.value);
                        const defaultParams: StrategyParams = {};
                        if (newDef) for (const p of newDef.paramSchema) defaultParams[p.key] = p.default;
                        updateSlot(slot.id, { strategyId: e.target.value, params: defaultParams });
                      }}
                      className="bg-muted/50 border border-border rounded px-2 py-1 text-xs"
                    >
                      {STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <select
                      value={slot.symbol}
                      onChange={(e) => updateSlot(slot.id, { symbol: e.target.value })}
                      className="bg-muted/50 border border-border rounded px-2 py-1 text-xs font-mono"
                    >
                      {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}
                    </select>
                  </div>
                  {slots.length > 1 && (
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400" onClick={() => removeSlot(slot.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
                {def && def.paramSchema.length > 0 && (
                  <div className="grid grid-cols-4 md:grid-cols-6 gap-1.5">
                    {def.paramSchema.map((p) => (
                      <div key={p.key}>
                        <Label className="text-[9px] text-muted-foreground">{p.label}</Label>
                        <Input
                          type="number"
                          value={Number(slot.params[p.key] ?? p.default)}
                          min={p.min}
                          max={p.max}
                          step={p.step}
                          onChange={(e) => updateParam(slot.id, p.key, Number(e.target.value))}
                          className="h-6 text-[10px] font-mono mt-0.5"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Allocation + capital config */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-border/40">
            <div>
              <Label className="text-[10px] text-muted-foreground">Allocation Method</Label>
              <select
                value={allocationMethod}
                onChange={(e) => setAllocationMethod(e.target.value as AllocationMethod)}
                className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs"
              >
                {ALLOCATION_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Initial Capital</Label>
              <Input type="number" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Rebalance (bars)</Label>
              <Input type="number" value={rebalanceFreq} onChange={(e) => setRebalanceFreq(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">MC Simulations</Label>
              <Input type="number" value={mcPaths} onChange={(e) => setMcPaths(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground">{ALLOCATION_METHODS.find((m) => m.value === allocationMethod)?.description}</div>
          <Button className="w-full" onClick={handleRun} disabled={running || slots.length === 0}>
            <Play className="w-3 h-3 mr-1" /> {running ? "Running Portfolio Backtest..." : `Run Portfolio Backtest (${slots.length} strategies)`}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <>
          {/* Portfolio metrics strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-8 gap-2">
            <Metric label="Total Return" value={fmtPct(result.portfolioMetrics.totalReturnPct)} good={result.portfolioMetrics.totalReturnPct > 0} />
            <Metric label="Sharpe" value={result.portfolioMetrics.sharpe.toFixed(2)} good={result.portfolioMetrics.sharpe > 1} />
            <Metric label="Sortino" value={result.portfolioMetrics.sortino.toFixed(2)} good={result.portfolioMetrics.sortino > 1} />
            <Metric label="Max DD" value={fmtPct(result.portfolioMetrics.maxDrawdownPct)} bad={result.portfolioMetrics.maxDrawdownPct < -15} />
            <Metric label="Volatility" value={`${result.portfolioMetrics.volatility.toFixed(1)}%`} />
            <Metric label="Divers. Ratio" value={result.portfolioMetrics.diversificationRatio.toFixed(2)} good={result.portfolioMetrics.diversificationRatio > 1.5} />
            <Metric label="Calmar" value={result.portfolioMetrics.calmar.toFixed(2)} good={result.portfolioMetrics.calmar > 0.5} />
            <Metric label="Avg Corr" value={result.portfolioMetrics.avgCorrelation.toFixed(2)} good={result.portfolioMetrics.avgCorrelation < 0.3} />
          </div>

          {/* View selector */}
          <div className="flex items-center gap-1">
            {([
              { id: "equity" as const, name: "Equity Curve", icon: TrendingUp },
              { id: "correlation" as const, name: "Correlation Matrix", icon: Activity },
              { id: "contribution" as const, name: "Strategy Contribution", icon: Target },
              { id: "montecarlo" as const, name: "Monte Carlo", icon: Brain },
            ]).map((v) => (
              <button
                key={v.id}
                onClick={() => setActiveView(v.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors",
                  activeView === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40",
                )}
              >
                <v.icon className="w-3.5 h-3.5" />
                {v.name}
              </button>
            ))}
          </div>

          {/* View content */}
          {activeView === "equity" && <EquityView result={result} />}
          {activeView === "correlation" && <CorrelationView result={result} />}
          {activeView === "contribution" && <ContributionView result={result} />}
          {activeView === "montecarlo" && mcResult && <MonteCarloView result={mcResult} initialCapital={initialCapital} />}

          {/* Allocation details */}
          <Card>
            <CardHeader className="py-2"><CardTitle className="text-xs">Allocation Details</CardTitle></CardHeader>
            <CardContent className="text-xs space-y-2">
              <p className="text-muted-foreground">{result.allocationResult.explanation}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {result.strategyResults.map((sr, i) => (
                  <div key={i} className="border border-border/40 rounded-md p-2">
                    <div className="text-[10px] text-muted-foreground">{sr.strategy} ({sr.symbol})</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${sr.weight * 100}%` }} />
                      </div>
                      <span className="font-mono text-[10px]">{(sr.weight * 100).toFixed(1)}%</span>
                    </div>
                    <div className="text-[10px] mt-1 font-mono text-muted-foreground">
                      Return: {fmtPct(sr.metrics.totalReturnPct)} · Sharpe: {sr.metrics.sharpe.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!result && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            Configure your strategy portfolio above and click "Run Portfolio Backtest" to see results.
            <br />
            <span className="text-[10px]">Supports {STRATEGIES.length} strategies across {CONTRACTS.length} contracts with 6 allocation methods.</span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// EQUITY VIEW
// ============================================================
function EquityView({ result }: { result: PortfolioBacktestResult }) {
  const chartData = result.equityCurve.map((e, i) => ({
    time: new Date(e.time).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    equity: e.equity,
    drawdown: e.drawdown * 100,
  }));

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Portfolio Equity Curve</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="portEqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(chartData.length / 8)} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={70} orientation="right" domain={["auto", "auto"]} />
                <Tooltip formatter={(v: any) => fmtMoney(Number(v), 0)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                <ReferenceLine y={result.config.initialCapital} stroke="#666" strokeDasharray="4 4" strokeOpacity={0.5} />
                <Area type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} fill="url(#portEqGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Portfolio Drawdown</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(chartData.length / 6)} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={70} orientation="right" tickFormatter={(v) => `${v.toFixed(0)}%`} domain={["min", 0]} />
                <Tooltip formatter={(v: any) => `${Number(v).toFixed(2)}%`} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                <Area type="monotone" dataKey="drawdown" stroke="#ef4444" strokeWidth={1} fill="url(#ddGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// CORRELATION VIEW
// ============================================================
function CorrelationView({ result }: { result: PortfolioBacktestResult }) {
  const { symbols, matrix } = result.correlationMatrix;
  return (
    <Card>
      <CardHeader className="py-2"><CardTitle className="text-xs">Strategy Correlation Matrix</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="text-[10px] font-mono">
            <thead>
              <tr>
                <th className="p-1"></th>
                {symbols.map((s, i) => <th key={i} className="p-1 text-muted-foreground text-[9px] max-w-[80px] truncate">{s}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, i) => (
                <tr key={i}>
                  <td className="p-1 text-muted-foreground text-[9px] max-w-[80px] truncate pr-2">{symbols[i]}</td>
                  {row.map((v, j) => (
                    <td
                      key={j}
                      className={cn(
                        "p-1.5 text-center tabular-nums border border-border/30",
                        v > 0.7 && "bg-emerald-500/30 text-emerald-300",
                        v > 0.3 && v <= 0.7 && "bg-emerald-500/15 text-emerald-400",
                        v < -0.3 && v >= -0.7 && "bg-rose-500/15 text-rose-400",
                        v < -0.7 && "bg-rose-500/30 text-rose-300",
                        Math.abs(v) <= 0.3 && "text-muted-foreground",
                        i === j && "bg-primary/20",
                      )}
                      title={`${symbols[i]} vs ${symbols[j]}`}
                    >
                      {v.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[10px] text-muted-foreground mt-2">
          Average pairwise correlation: <span className="font-mono text-foreground">{result.portfolioMetrics.avgCorrelation.toFixed(3)}</span>
          {result.portfolioMetrics.avgCorrelation < 0.3 && " — excellent diversification."}
          {result.portfolioMetrics.avgCorrelation >= 0.3 && result.portfolioMetrics.avgCorrelation < 0.6 && " — moderate diversification."}
          {result.portfolioMetrics.avgCorrelation >= 0.6 && " — poor diversification, strategies are too correlated."}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// CONTRIBUTION VIEW
// ============================================================
function ContributionView({ result }: { result: PortfolioBacktestResult }) {
  const data = result.portfolioMetrics.strategyContributions.map((c) => ({
    name: c.name.length > 20 ? c.name.slice(0, 18) + "…" : c.name,
    fullName: c.name,
    return: c.return,
    weight: c.weight * 100,
    contribution: c.contribution,
    sharpe: c.sharpe,
  }));

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Strategy P&L Contribution</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={140} />
                <Tooltip formatter={(v: any) => `${Number(v).toFixed(2)}%`} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                <ReferenceLine x={0} stroke="#666" />
                <Bar dataKey="return" radius={[0, 4, 4, 0]} name="Strategy Return">
                  {data.map((d, i) => <Cell key={i} fill={d.return >= 0 ? "#10b981" : "#ef4444"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Allocation Weights</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border">
              <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                <th className="text-left py-2 px-3">Strategy</th>
                <th className="text-right py-2 px-3">Weight</th>
                <th className="text-right py-2 px-3">Return</th>
                <th className="text-right py-2 px-3">Sharpe</th>
                <th className="text-right py-2 px-3">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {result.portfolioMetrics.strategyContributions.map((c, i) => (
                <tr key={i} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="py-2 px-3">{c.name}</td>
                  <td className="py-2 px-3 text-right font-mono">{(c.weight * 100).toFixed(1)}%</td>
                  <td className={cn("py-2 px-3 text-right font-mono", c.return >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(c.return)}</td>
                  <td className="py-2 px-3 text-right font-mono">{c.sharpe.toFixed(2)}</td>
                  <td className={cn("py-2 px-3 text-right font-mono font-medium", c.contribution >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtMoney(c.contribution, 0)}</td>
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
// MONTE CARLO VIEW
// ============================================================
function MonteCarloView({ result, initialCapital }: { result: MonteCarloResult; initialCapital: number }) {
  const data = [
    { name: "5th pct", value: result.percentile5 },
    { name: "25th pct", value: result.percentile25 },
    { name: "50th pct", value: result.percentile50 },
    { name: "75th pct", value: result.percentile75 },
    { name: "95th pct", value: result.percentile95 },
  ];
  const ddData = [
    { name: "5th pct (best)", value: result.maxDrawdown5th },
    { name: "50th pct (median)", value: result.maxDrawdown50th },
    { name: "95th pct (worst)", value: result.maxDrawdown95th },
  ];
  const sharpeData = [
    { name: "5th pct", value: result.sharpe5th },
    { name: "50th pct", value: result.sharpe50th },
    { name: "95th pct", value: result.sharpe95th },
  ];

  return (
    <div className="space-y-3">
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-3">
          <p className="text-xs text-muted-foreground">{result.explanation}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Return Distribution (%)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={40} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                  <Tooltip formatter={(v: any) => `${Number(v).toFixed(2)}%`} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                  <ReferenceLine x={0} stroke="#666" />
                  <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                    {data.map((d, i) => <Cell key={i} fill={d.value >= 0 ? "#10b981" : "#ef4444"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Drawdown Distribution (%)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ddData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={40} tickFormatter={(v) => `${v.toFixed(0)}%`} domain={["min", 0]} />
                  <Tooltip formatter={(v: any) => `${Number(v).toFixed(2)}%`} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                  <Bar dataKey="value" fill="#ef4444" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Sharpe Distribution</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sharpeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={40} />
                  <Tooltip formatter={(v: any) => Number(v).toFixed(2)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                  <ReferenceLine y={1} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.4} />
                  <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                    {sharpeData.map((d, i) => <Cell key={i} fill={d.value > 1 ? "#10b981" : d.value > 0 ? "#f59e0b" : "#ef4444"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3 border-emerald-500/30 bg-emerald-500/5">
          <div className="text-[10px] text-muted-foreground uppercase">Prob. of Profit</div>
          <div className="text-lg font-mono font-semibold text-emerald-400">{(result.probabilityOfProfit * 100).toFixed(0)}%</div>
        </Card>
        <Card className="p-3 border-rose-500/30 bg-rose-500/5">
          <div className="text-[10px] text-muted-foreground uppercase">Prob. of Ruin (&gt;50% loss)</div>
          <div className="text-lg font-mono font-semibold text-rose-400">{(result.probabilityOfRuin * 100).toFixed(1)}%</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Median Return</div>
          <div className={cn("text-lg font-mono font-semibold", result.percentile50 >= 0 ? "text-emerald-400" : "text-rose-400")}>{result.percentile50.toFixed(1)}%</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground uppercase">95th pct Return</div>
          <div className="text-lg font-mono font-semibold text-emerald-400">{result.percentile95.toFixed(1)}%</div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// HELPER COMPONENTS
// ============================================================
function Metric({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <Card className={cn(
      "p-2.5 border",
      good && "border-emerald-500/30 bg-emerald-500/5",
      bad && "border-rose-500/30 bg-rose-500/5",
    )}>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "text-sm font-mono font-semibold tabular-nums mt-0.5",
        good && "text-emerald-400",
        bad && "text-rose-400",
      )}>{value}</div>
    </Card>
  );
}
