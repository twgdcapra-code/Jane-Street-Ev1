"use client";

import { useState, useMemo } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { STRATEGIES, getStrategy } from "@/lib/trading/strategies";
import { runBacktest } from "@/lib/trading/backtest";
import { getEngine } from "@/lib/trading/market-engine";
import { CONTRACTS } from "@/lib/trading/contracts";
import { fmtMoney, fmtPct, fmtPrice, fmtDateTime } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Play, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BacktestResult } from "@/lib/trading/types";

export function Backtester() {
  const [strategyId, setStrategyId] = useState(STRATEGIES[0].id);
  const [symbol, setSymbol] = useState("ES");
  const [pairSymbol, setPairSymbol] = useState("NQ");
  const [initialCapital, setInitialCapital] = useState(100000);
  const [contractsPerTrade, setContractsPerTrade] = useState(1);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const def = getStrategy(strategyId)!;

  // Use historical + intraday data
  const candles = useMemo(() => {
    const history = getEngine().getHistory(symbol);
    return history.length > 0 ? history : getEngine().getCandles(symbol, 500);
  }, [symbol, result]);
  const pairCandles = useMemo(() => {
    if (def.type !== "PAIRS") return undefined;
    const history = getEngine().getHistory(pairSymbol);
    return history.length > 0 ? history : getEngine().getCandles(pairSymbol, 500);
  }, [pairSymbol, def.type]);
  const benchmark = useMemo(() => getEngine().getHistory("ES"), []);

  // Default params from schema
  const [params, setParams] = useState<Record<string, number>>(
    def.paramSchema.reduce((acc, p) => ({ ...acc, [p.key]: Number(p.default) }), {}),
  );

  const handleRun = () => {
    setRunning(true);
    setTimeout(() => {
      try {
        const r = runBacktest({
          strategyId,
          symbol,
          pairSymbol: def.type === "PAIRS" ? pairSymbol : undefined,
          params,
          candles,
          pairCandles,
          initialCapital,
          contractsPerTrade,
          benchmark,
        });
        setResult(r);
      } catch (e: any) {
        console.error(e);
      }
      setRunning(false);
    }, 50);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Config */}
        <Card className="lg:col-span-1">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Backtest Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div>
              <Label className="text-xs">Strategy</Label>
              <select
                value={strategyId}
                onChange={(e) => {
                  setStrategyId(e.target.value);
                  const d = getStrategy(e.target.value)!;
                  setParams(d.paramSchema.reduce((acc, p) => ({ ...acc, [p.key]: Number(p.default) }), {}));
                }}
                className="w-full mt-0.5 bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs"
              >
                {STRATEGIES.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Symbol</Label>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-full mt-0.5 bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono"
                >
                  {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}
                </select>
              </div>
              {def.type === "PAIRS" && (
                <div>
                  <Label className="text-xs">Pair Symbol</Label>
                  <select
                    value={pairSymbol}
                    onChange={(e) => setPairSymbol(e.target.value)}
                    className="w-full mt-0.5 bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono"
                  >
                    {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Initial Capital</Label>
                <Input
                  type="number"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(Number(e.target.value))}
                  className="h-8 text-xs font-mono mt-0.5"
                />
              </div>
              <div>
                <Label className="text-xs">Contracts / Trade</Label>
                <Input
                  type="number"
                  value={contractsPerTrade}
                  onChange={(e) => setContractsPerTrade(Number(e.target.value))}
                  className="h-8 text-xs font-mono mt-0.5"
                />
              </div>
            </div>
            <div className="pt-2 border-t border-border/40">
              <Label className="text-xs text-muted-foreground">Strategy Parameters</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {def.paramSchema.map((p) => (
                  <div key={p.key}>
                    <Label className="text-[10px] text-muted-foreground">{p.label}</Label>
                    <Input
                      type="number"
                      value={params[p.key] ?? 0}
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      onChange={(e) => setParams({ ...params, [p.key]: parseFloat(e.target.value) || 0 })}
                      className="h-7 text-xs font-mono mt-0.5"
                    />
                  </div>
                ))}
              </div>
            </div>
            <Button className="w-full" onClick={handleRun} disabled={running}>
              <Play className="w-3 h-3 mr-1" /> {running ? "Running..." : "Run Backtest"}
            </Button>
          </CardContent>
        </Card>

        {/* Results */}
        <Card className="lg:col-span-2">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Results
              {result && <Badge variant="outline" className="text-[10px] ml-2">{result.trades.length} trades</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {!result ? (
              <div className="h-[400px] flex items-center justify-center text-xs text-muted-foreground">
                Run a backtest to see results.
              </div>
            ) : (
              <div className="space-y-3">
                {/* Equity curve */}
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={result.equityCurve}>
                      <defs>
                        <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                      <XAxis
                        dataKey="time"
                        tickFormatter={(t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        interval={Math.floor(result.equityCurve.length / 8)}
                      />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={60} orientation="right" />
                      <Tooltip
                        labelFormatter={(t) => new Date(t as number).toLocaleString("en-US")}
                        formatter={(v: any) => fmtMoney(Number(v), 0)}
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                      />
                      <Area type="monotone" dataKey="equity" stroke="#10b981" strokeWidth={1.5} fill="url(#eqGrad)" />
                      <ReferenceLine y={result.initialCapital} stroke="#666" strokeDasharray="4 4" strokeOpacity={0.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Drawdown */}
                <div className="h-[100px]">
                  <div className="text-[10px] text-muted-foreground mb-0.5">Drawdown</div>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={result.equityCurve}>
                      <defs>
                        <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#ef4444" stopOpacity={0} />
                          <stop offset="100%" stopColor="#ef4444" stopOpacity={0.5} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="time"
                        tickFormatter={(t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                        interval={Math.floor(result.equityCurve.length / 6)}
                      />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={60} orientation="right" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} domain={["min", 0]} />
                      <Tooltip
                        labelFormatter={(t) => new Date(t as number).toLocaleString("en-US")}
                        formatter={(v: any) => `${(Number(v) * 100).toFixed(2)}%`}
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                      />
                      <Area type="monotone" dataKey="drawdown" stroke="#ef4444" strokeWidth={1} fill="url(#ddGrad)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Metrics grid */}
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  <Metric label="Total Return" value={fmtPct(result.metrics.totalReturnPct)} good={result.metrics.totalReturnPct > 0} />
                  <Metric label="CAGR" value={fmtPct(result.metrics.cagr)} good={result.metrics.cagr > 0} />
                  <Metric label="Sharpe" value={result.metrics.sharpe.toFixed(2)} good={result.metrics.sharpe > 1} />
                  <Metric label="Sortino" value={result.metrics.sortino.toFixed(2)} good={result.metrics.sortino > 1} />
                  <Metric label="Max DD" value={fmtPct(result.metrics.maxDrawdownPct)} good={result.metrics.maxDrawdownPct > -15} bad={result.metrics.maxDrawdownPct < -25} />
                  <Metric label="Calmar" value={result.metrics.calmar.toFixed(2)} good={result.metrics.calmar > 0.5} />
                  <Metric label="Win Rate" value={`${result.metrics.winRate.toFixed(1)}%`} good={result.metrics.winRate > 50} />
                  <Metric label="Profit Factor" value={isFinite(result.metrics.profitFactor) ? result.metrics.profitFactor.toFixed(2) : "∞"} good={result.metrics.profitFactor > 1.5} />
                  <Metric label="Avg Win" value={fmtMoney(result.metrics.avgWin, 0)} good={result.metrics.avgWin > 0} />
                  <Metric label="Avg Loss" value={fmtMoney(result.metrics.avgLoss, 0)} bad={result.metrics.avgLoss < 0} />
                  <Metric label="Expectancy" value={fmtMoney(result.metrics.expectancy, 0)} good={result.metrics.expectancy > 0} />
                  <Metric label="Volatility" value={`${result.metrics.volatility.toFixed(1)}%`} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Trade ledger */}
      {result && result.trades.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Trade Ledger ({result.trades.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-y border-border sticky top-0">
                  <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">Side</th>
                    <th className="text-left py-2 px-2">Symbol</th>
                    <th className="text-right py-2 px-2">Qty</th>
                    <th className="text-right py-2 px-2">Entry</th>
                    <th className="text-right py-2 px-2">Exit</th>
                    <th className="text-left py-2 px-2">Entry Time</th>
                    <th className="text-left py-2 px-2">Exit Time</th>
                    <th className="text-right py-2 px-2">Bars</th>
                    <th className="text-right py-2 px-2">P&L</th>
                    <th className="text-right py-2 px-2">P&L %</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.slice(0, 200).map((t, i) => (
                    <tr key={i} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="py-1.5 px-2 font-mono text-[10px] text-muted-foreground">{i + 1}</td>
                      <td className={cn("py-1.5 px-2 font-medium", t.side === "BUY" ? "text-emerald-400" : "text-rose-400")}>{t.side}</td>
                      <td className="py-1.5 px-2 font-mono">{t.symbol}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{t.qty}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{fmtPrice(t.entryPrice, 2)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{fmtPrice(t.exitPrice, 2)}</td>
                      <td className="py-1.5 px-2 text-[10px] text-muted-foreground">{fmtDateTime(t.entryTime)}</td>
                      <td className="py-1.5 px-2 text-[10px] text-muted-foreground">{fmtDateTime(t.exitTime)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{t.bars}</td>
                      <td className={cn("py-1.5 px-2 text-right font-mono font-medium", t.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {t.pnl >= 0 ? "+" : ""}{fmtMoney(t.pnl, 0)}
                      </td>
                      <td className={cn("py-1.5 px-2 text-right font-mono", t.pnlPct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {fmtPct(t.pnlPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Metric({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className={cn(
      "border rounded-md p-2",
      good && "border-emerald-500/30 bg-emerald-500/5",
      bad && "border-rose-500/30 bg-rose-500/5",
      !good && !bad && "border-border bg-muted/30",
    )}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn(
        "text-sm font-mono font-semibold tabular-nums mt-0.5",
        good && "text-emerald-400",
        bad && "text-rose-400",
      )}>{value}</div>
    </div>
  );
}
