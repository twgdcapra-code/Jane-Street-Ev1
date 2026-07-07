"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { getEngine } from "@/lib/trading/market-engine";
import { CONTRACTS, getContract } from "@/lib/trading/contracts";
import { computeRiskMetrics, monteCarloVar, runStressTest, STRESS_SCENARIOS } from "@/lib/trading/risk";
import { fmtMoney, fmtPct } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, ReferenceLine } from "recharts";
import { ShieldAlert, Activity, AlertTriangle, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function RiskManager() {
  const positions = useTradingStore((s) => s.positions);
  const quotes = useTradingStore((s) => s.quotes);
  const cashBalance = useTradingStore((s) => s.cashBalance);
  const flattenAll = useTradingStore((s) => s.flattenAll);
  const [mcPaths, setMcPaths] = useState(500);
  const [horizon, setHorizon] = useState(1);

  const activePositions = Object.values(positions).filter((p) => p.netQty !== 0);

  const history = useMemo(() => {
    const h: Record<string, any[]> = {};
    for (const c of CONTRACTS) {
      h[c.symbol] = getEngine().getHistory(c.symbol);
    }
    return h;
  }, []);

  const risk = useMemo(
    () => computeRiskMetrics({ positions: activePositions, history, accountEquity: cashBalance, horizonDays: horizon, mcPaths }),
    [activePositions, history, cashBalance, horizon, mcPaths],
  );

  const mcResult = useMemo(
    () => monteCarloVar(activePositions, history, horizon, mcPaths),
    [activePositions, history, horizon, mcPaths],
  );

  const stressResults = useMemo(
    () => STRESS_SCENARIOS.map((sc) => runStressTest(activePositions, sc)),
    [activePositions],
  );

  const equity = cashBalance + activePositions.reduce((s, p) => s + p.unrealizedPnL, 0);

  // MC distribution histogram
  const histogram = useMemo(() => {
    if (mcResult.distribution.length === 0) return [];
    const bins = 30;
    const min = Math.min(...mcResult.distribution);
    const max = Math.max(...mcResult.distribution);
    const step = (max - min) / bins;
    const binsArr = Array.from({ length: bins }, (_, i) => ({
      range: `${fmtMoney(min + i * step, 0)}`,
      mid: min + (i + 0.5) * step,
      count: 0,
    }));
    for (const v of mcResult.distribution) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((v - min) / step)));
      binsArr[idx].count++;
    }
    return binsArr;
  }, [mcResult]);

  return (
    <div className="space-y-4">
      {/* Risk header with kill switch */}
      <Card className="border-rose-500/30">
        <CardContent className="p-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-500" />
            <div>
              <div className="text-sm font-semibold">Risk Management System</div>
              <div className="text-[10px] text-muted-foreground">Live VaR, stress tests, Monte Carlo simulation · "No silos" integrated view</div>
            </div>
          </div>
          <Button variant="destructive" size="sm" onClick={flattenAll} disabled={activePositions.length === 0}>
            <AlertTriangle className="w-3 h-3 mr-1" /> KILL SWITCH (Flatten All)
          </Button>
        </CardContent>
      </Card>

      {/* Top-line risk metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <RiskCard
          label="1-Day VaR (95%)"
          value={fmtMoney(risk.var95, 0)}
          sub={`${(risk.var95 / Math.max(equity, 1) * 100).toFixed(2)}% of equity`}
          tone={risk.var95 / equity > 0.05 ? "warn" : "ok"}
        />
        <RiskCard
          label="1-Day VaR (99%)"
          value={fmtMoney(risk.var99, 0)}
          sub={`${(risk.var99 / Math.max(equity, 1) * 100).toFixed(2)}% of equity`}
          tone={risk.var99 / equity > 0.08 ? "warn" : "ok"}
        />
        <RiskCard
          label="CVaR (95%)"
          value={fmtMoney(risk.cvar95, 0)}
          sub={`Expected shortfall`}
          tone="neutral"
        />
        <RiskCard
          label="Portfolio Vol (ann.)"
          value={`${(risk.portfolioVolatility * 100).toFixed(1)}%`}
          sub={`β = ${risk.portfolioBeta.toFixed(2)}`}
          tone="neutral"
        />
        <RiskCard
          label="Gross Exposure"
          value={fmtMoney(risk.grossExposure, 0)}
          sub={`Net ${fmtMoney(risk.netExposure, 0)}`}
          tone="neutral"
        />
        <RiskCard
          label="Leverage"
          value={`${risk.leverage.toFixed(2)}x`}
          sub={`Diversification ${risk.diversificationRatio.toFixed(2)}`}
          tone={risk.leverage > 5 ? "warn" : "ok"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Stress tests */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingDown className="w-4 h-4" /> Stress Test Scenarios
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {stressResults.map((sc) => {
              const worst = sc.worstImpact;
              const isPositive = sc.portfolioImpact > 0;
              return (
                <div key={sc.name} className="border border-border rounded-md p-2.5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-medium">{sc.name}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{sc.description}</div>
                    </div>
                    <div className="text-right">
                      <div className={cn("text-sm font-mono font-semibold", isPositive ? "text-emerald-400" : "text-rose-400")}>
                        {isPositive ? "+" : ""}{fmtMoney(sc.portfolioImpact, 0)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {sc.worstPosition && `worst: ${sc.worstPosition} ${isPositive ? "+" : ""}${fmtMoney(worst, 0)}`}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Monte Carlo distribution */}
        <Card>
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" /> Monte Carlo VaR ({mcPaths} paths, {horizon}d)
            </CardTitle>
            <div className="flex items-center gap-1">
              <select
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
                className="bg-muted/50 border border-border rounded px-1.5 py-0.5 text-[10px]"
              >
                <option value={1}>1d</option>
                <option value={5}>5d</option>
                <option value={10}>10d</option>
                <option value={21}>21d</option>
              </select>
              <select
                value={mcPaths}
                onChange={(e) => setMcPaths(Number(e.target.value))}
                className="bg-muted/50 border border-border rounded px-1.5 py-0.5 text-[10px]"
              >
                <option value={100}>100 paths</option>
                <option value={500}>500 paths</option>
                <option value={1000}>1000 paths</option>
                <option value={5000}>5000 paths</option>
              </select>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {activePositions.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-xs text-muted-foreground">
                Open positions to compute Monte Carlo VaR
              </div>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2 mb-3 text-center">
                  <div>
                    <div className="text-[10px] text-muted-foreground">VaR 95%</div>
                    <div className="text-sm font-mono font-semibold text-rose-400">{fmtMoney(mcResult.var95, 0)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">VaR 99%</div>
                    <div className="text-sm font-mono font-semibold text-rose-400">{fmtMoney(mcResult.var99, 0)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">CVaR 95%</div>
                    <div className="text-sm font-mono font-semibold text-rose-400">{fmtMoney(mcResult.cvar95, 0)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">CVaR 99%</div>
                    <div className="text-sm font-mono font-semibold text-rose-400">{fmtMoney(mcResult.cvar99, 0)}</div>
                  </div>
                </div>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histogram}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                      <XAxis dataKey="range" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} interval={4} angle={-30} textAnchor="end" height={40} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={30} />
                      <Tooltip
                        formatter={(v: any) => [`${v} paths`, "Frequency"]}
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                      />
                      <Bar dataKey="count" fill="#3b82f6" />
                      <ReferenceLine x={histogram.findIndex((h) => h.mid >= -mcResult.var95)} stroke="#f59e0b" strokeDasharray="3 3" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">Distribution of simulated portfolio P&L over {horizon} day(s). Vertical line marks 95% VaR.</div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Position risk contribution */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Position Risk Contribution</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-3">Symbol</th>
                  <th className="text-right py-2 px-3">Net Qty</th>
                  <th className="text-right py-2 px-3">Exposure</th>
                  <th className="text-right py-2 px-3">Beta</th>
                  <th className="text-right py-2 px-3">Dollar Beta</th>
                  <th className="text-right py-2 px-3">Unreal P&L</th>
                  <th className="text-right py-2 px-3">Margin</th>
                </tr>
              </thead>
              <tbody>
                {activePositions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-muted-foreground">No open positions</td>
                  </tr>
                ) : (
                  activePositions.map((p) => {
                    const c = getContract(p.symbol);
                    const margin = Math.abs(p.netQty) * c.marginInitial;
                    const dollarBeta = p.exposure * p.beta * Math.sign(p.netQty);
                    return (
                      <tr key={p.symbol} className="border-b border-border/40 hover:bg-muted/30">
                        <td className="py-1.5 px-3 font-mono font-medium">{p.symbol}</td>
                        <td className={cn("py-1.5 px-3 text-right font-mono", p.netQty > 0 ? "text-emerald-400" : "text-rose-400")}>
                          {p.netQty > 0 ? "+" : ""}{p.netQty}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono">{fmtMoney(p.exposure, 0)}</td>
                        <td className="py-1.5 px-3 text-right font-mono">{p.beta.toFixed(2)}</td>
                        <td className="py-1.5 px-3 text-right font-mono">{fmtMoney(dollarBeta, 0)}</td>
                        <td className={cn("py-1.5 px-3 text-right font-mono", p.unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {p.unrealizedPnL >= 0 ? "+" : ""}{fmtMoney(p.unrealizedPnL, 0)}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{fmtMoney(margin, 0)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RiskCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "ok" | "warn" | "neutral" }) {
  return (
    <Card className={cn(
      "p-3 border",
      tone === "warn" && "border-amber-500/30 bg-amber-500/5",
      tone === "ok" && "border-emerald-500/20 bg-emerald-500/5",
      tone === "neutral" && "border-border",
    )}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "text-lg font-mono font-semibold tabular-nums mt-0.5",
        tone === "warn" && "text-amber-400",
        tone === "ok" && "text-foreground",
        tone === "neutral" && "text-foreground",
      )}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{sub}</div>}
    </Card>
  );
}
