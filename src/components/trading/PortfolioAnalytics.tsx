"use client";

import { useMemo, useState, useEffect } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { getEngine } from "@/lib/trading/market-engine";
import { CONTRACTS } from "@/lib/trading/contracts";
import { computeCorrelationMatrix, computePortfolioMetrics } from "@/lib/trading/analytics";
import { fmtMoney, fmtPct } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

export function PortfolioAnalytics() {
  const positions = useTradingStore((s) => s.positions);
  const cashBalance = useTradingStore((s) => s.cashBalance);
  const fills = useTradingStore((s) => s.fills);
  const tickCount = useTradingStore((s) => s.tickCount);

  const [equityHistory, setEquityHistory] = useState<{ time: number; equity: number }[]>([]);
  const [benchmarkHistory, setBenchmarkHistory] = useState<{ time: number; equity: number }[]>([]);

  // Sample equity over time
  useEffect(() => {
    const id = setInterval(() => {
      const activePositions = Object.values(positions).filter((p) => p.netQty !== 0);
      const equity = cashBalance + activePositions.reduce((s, p) => s + p.unrealizedPnL, 0);
      const now = Date.now();
      setEquityHistory((prev) => [...prev.slice(-199), { time: now, equity }]);
      // Benchmark: ES-only buy & hold @ 1 contract
      const esQuote = useTradingStore.getState().quotes["ES"];
      if (esQuote) {
        const benchEq = 1000000 + (esQuote.last - 5400) * 50;
        setBenchmarkHistory((prev) => [...prev.slice(-199), { time: now, equity: benchEq }]);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [positions, cashBalance]);

  const activePositions = Object.values(positions).filter((p) => p.netQty !== 0);

  const history = useMemo(() => {
    const h: Record<string, any[]> = {};
    for (const c of CONTRACTS) h[c.symbol] = getEngine().getHistory(c.symbol);
    return h;
  }, []);

  const correlation = useMemo(
    () => computeCorrelationMatrix(CONTRACTS.map((c) => c.symbol), history, 100),
    [history, tickCount],
  );

  const metrics = useMemo(
    () => computePortfolioMetrics(
      equityHistory.length > 1 ? equityHistory.map((e) => e.equity) : [1_000_000, 1_000_000],
      benchmarkHistory.length > 1 ? benchmarkHistory.map((e) => e.equity) : [1_000_000, 1_000_000],
    ),
    [equityHistory, benchmarkHistory],
  );

  const totalFills = fills.length;
  const winFills = fills.filter((f) => f.side === "SELL").length; // simplified

  // Equity vs benchmark chart
  const equityData = useMemo(
    () => equityHistory.map((e, i) => ({
      time: e.time,
      strategy: e.equity,
      benchmark: benchmarkHistory[i]?.equity ?? e.equity,
    })),
    [equityHistory, benchmarkHistory],
  );

  return (
    <div className="space-y-4">
      {/* Top metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard label="Total Return" value={fmtPct(metrics.totalReturnPct)} good={metrics.totalReturnPct > 0} />
        <MetricCard label="CAGR" value={fmtPct(metrics.cagr)} good={metrics.cagr > 0} />
        <MetricCard label="Sharpe" value={metrics.sharpe.toFixed(2)} good={metrics.sharpe > 1} />
        <MetricCard label="Sortino" value={metrics.sortino.toFixed(2)} good={metrics.sortino > 1} />
        <MetricCard label="Volatility" value={`${metrics.volatility.toFixed(1)}%`} />
        <MetricCard label="Max DD" value={fmtPct(metrics.maxDrawdownPct)} bad={metrics.maxDrawdownPct < -10} />
        <MetricCard label="Beta" value={metrics.beta.toFixed(2)} />
        <MetricCard label="Alpha (ann.)" value={fmtPct(metrics.alpha)} good={metrics.alpha > 0} />
        <MetricCard label="Info Ratio" value={metrics.informationRatio.toFixed(2)} good={metrics.informationRatio > 0} />
        <MetricCard label="Calmar" value={metrics.calmar.toFixed(2)} good={metrics.calmar > 0.5} />
        <MetricCard label="Ulcer" value={metrics.ulcer.toFixed(2)} bad={metrics.ulcer > 5} />
        <MetricCard label="Skewness" value={metrics.skewness.toFixed(2)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Equity vs benchmark */}
        <Card className="lg:col-span-2">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Equity vs Benchmark (ES B&H)</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(t) => new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    interval={Math.max(1, Math.floor(equityData.length / 6))}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={70} orientation="right" domain={["auto", "auto"]} />
                  <Tooltip
                    labelFormatter={(t) => new Date(t as number).toLocaleString("en-US")}
                    formatter={(v: any) => fmtMoney(Number(v), 0)}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  />
                  <Line type="monotone" dataKey="strategy" stroke="#10b981" strokeWidth={2} dot={false} name="Strategy" />
                  <Line type="monotone" dataKey="benchmark" stroke="#6b7280" strokeWidth={1.5} dot={false} strokeDasharray="4 4" name="ES B&H" />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
              <div className="border border-border rounded-md p-2">
                <div className="text-[10px] text-muted-foreground">Up Capture</div>
                <div className="font-mono font-semibold text-emerald-400">{metrics.upCapture.toFixed(1)}%</div>
              </div>
              <div className="border border-border rounded-md p-2">
                <div className="text-[10px] text-muted-foreground">Down Capture</div>
                <div className="font-mono font-semibold text-rose-400">{metrics.downCapture.toFixed(1)}%</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Returns distribution */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Returns Distribution</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChartCustom equity={equityHistory.map((e) => e.equity)} />
              </ResponsiveContainer>
            </div>
            <div className="text-[10px] text-muted-foreground mt-2 text-center">
              Skew: {metrics.skewness.toFixed(2)} · Kurtosis: {metrics.kurtosis.toFixed(2)} (excess)
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Correlation matrix */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Cross-Asset Correlation Matrix (100-bar log returns)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <table className="text-[10px] font-mono">
              <thead>
                <tr>
                  <th className="p-1"></th>
                  {correlation.symbols.map((s) => (
                    <th key={s} className="p-1 text-muted-foreground font-medium">{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {correlation.matrix.map((row, i) => (
                  <tr key={correlation.symbols[i]}>
                    <td className="p-1 text-muted-foreground font-medium pr-2">{correlation.symbols[i]}</td>
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
                        title={`${correlation.symbols[i]} vs ${correlation.symbols[j]}`}
                      >
                        {v.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">Color scale: green = positive correlation, red = negative. Diagonal is always 1.0.</div>
        </CardContent>
      </Card>

      {/* Trade stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Trade Statistics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs pt-0">
            <StatRow label="Total Fills" value={String(totalFills)} />
            <StatRow label="Positive Days" value={String(metrics.positiveMonths)} />
            <StatRow label="Negative Days" value={String(metrics.negativeMonths)} />
            <StatRow label="Win Rate" value={`${(metrics.positiveMonths / Math.max(metrics.positiveMonths + metrics.negativeMonths, 1) * 100).toFixed(1)}%`} />
            <StatRow label="Active Positions" value={String(activePositions.length)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Portfolio Exposure by Asset Class</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs pt-0">
            {Object.entries(
              activePositions.reduce((acc, p) => {
                const c = CONTRACTS.find((c) => c.symbol === p.symbol);
                const cls = c?.assetClass ?? "other";
                acc[cls] = (acc[cls] ?? 0) + p.exposure;
                return acc;
              }, {} as Record<string, number>),
            ).map(([cls, exp]) => (
              <StatRow key={cls} label={cls} value={fmtMoney(exp, 0)} />
            ))}
            {activePositions.length === 0 && (
              <div className="text-muted-foreground text-center py-2">No open positions</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Risk-Adjusted Returns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs pt-0">
            <StatRow label="Sharpe (ann.)" value={metrics.sharpe.toFixed(3)} />
            <StatRow label="Sortino (ann.)" value={metrics.sortino.toFixed(3)} />
            <StatRow label="Information Ratio" value={metrics.informationRatio.toFixed(3)} />
            <StatRow label="Calmar" value={metrics.calmar.toFixed(3)} />
            <StatRow label="Ulcer Index" value={metrics.ulcer.toFixed(3)} />
            <StatRow label="Alpha (ann.)" value={fmtPct(metrics.alpha)} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <Card className={cn(
      "p-3 border",
      good && "border-emerald-500/30 bg-emerald-500/5",
      bad && "border-rose-500/30 bg-rose-500/5",
      !good && !bad && "border-border",
    )}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "text-lg font-mono font-semibold tabular-nums mt-0.5",
        good && "text-emerald-400",
        bad && "text-rose-400",
      )}>{value}</div>
    </Card>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/30 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}

// Custom histogram of equity returns
function BarChartCustom({ equity }: { equity: number[] }) {
  const data = useMemo(() => {
    if (equity.length < 3) return [];
    const rets = equity.slice(1).map((e, i) => (e / equity[i] - 1) * 100);
    const bins = 20;
    const min = Math.min(...rets);
    const max = Math.max(...rets);
    const step = (max - min) / bins;
    const arr = Array.from({ length: bins }, (_, i) => ({
      bucket: `${(min + i * step).toFixed(2)}%`,
      count: 0,
      isPositive: min + i * step >= 0,
    }));
    for (const r of rets) {
      const idx = Math.min(bins - 1, Math.max(0, Math.floor((r - min) / step)));
      arr[idx].count++;
    }
    return arr;
  }, [equity]);

  if (data.length === 0) {
    return <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Not enough data</div>;
  }
  return (
    <BarChart data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
      <XAxis dataKey="bucket" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} interval={2} angle={-30} textAnchor="end" height={40} />
      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={30} />
      <Tooltip
        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
      />
      <Bar dataKey="count">
        {data.map((d, i) => (
          <Cell key={i} fill={d.isPositive ? "#10b98155" : "#ef444455"} />
        ))}
      </Bar>
    </BarChart>
  );
}
