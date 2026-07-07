"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS } from "@/lib/trading/contracts";
import { buildVolSnapshot, buildAllVolSnapshots, type VolSnapshot } from "@/lib/trading/volatility";
import { fmtPrice, fmtPct, decimalsFor } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart, Cell } from "recharts";
import { cn } from "@/lib/utils";
import { Activity, BarChart3, Flame, TrendingUp, Waves } from "lucide-react";

const REGIME_COLORS: Record<VolSnapshot["regime"], string> = {
  LOW: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  NORMAL: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  HIGH: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  EXTREME: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const REGIME_DESC: Record<VolSnapshot["regime"], string> = {
  LOW: "Volatility in bottom 20th percentile. Calm market — consider selling premium or trend-following strategies.",
  NORMAL: "Volatility in typical range (20-80th percentile). Standard position sizing applies.",
  HIGH: "Volatility in 80-95th percentile. Reduce position sizes, widen stops, consider vol-long or hedge strategies.",
  EXTREME: "Volatility in top 5%. Crisis regime — defensive posture, cut risk, prepare for mean reversion.",
};

export function VolatilityAnalyzer() {
  const tickCount = useTradingStore((s) => s.tickCount);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const [selectedSymbol, setSelectedSymbol] = useState("ES");
  const [sortBy, setSortBy] = useState<"regime" | "vol" | "percentile">("regime");

  const snapshot = useMemo(() => buildVolSnapshot(selectedSymbol), [selectedSymbol, tickCount]);
  const allSnapshots = useMemo(() => buildAllVolSnapshots(), [tickCount]);

  const sorted = useMemo(() => {
    const arr = [...allSnapshots];
    if (sortBy === "regime") {
      const order = { EXTREME: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
      arr.sort((a, b) => order[a.regime] - order[b.regime]);
    } else if (sortBy === "vol") {
      arr.sort((a, b) => b.realizedVol[2]?.vol ?? 0 - (a.realizedVol[2]?.vol ?? 0));
    } else {
      arr.sort((a, b) => b.volPercentile - a.volPercentile);
    }
    return arr;
  }, [allSnapshots, sortBy]);

  const rvData = snapshot?.realizedVol.map((r) => ({ window: `${r.window}d`, vol: r.annualized })) ?? [];
  const tsData = snapshot?.termStructure.map((t) => ({ horizon: `${t.horizon}d`, vol: t.vol })) ?? [];

  return (
    <div className="space-y-4">
      {/* Regime summary across all contracts */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3 border-rose-500/30 bg-rose-500/5">
          <div className="text-[10px] text-muted-foreground uppercase">Extreme Vol</div>
          <div className="text-lg font-mono font-semibold text-rose-400">{allSnapshots.filter((s) => s.regime === "EXTREME").length}</div>
        </Card>
        <Card className="p-3 border-amber-500/30 bg-amber-500/5">
          <div className="text-[10px] text-muted-foreground uppercase">High Vol</div>
          <div className="text-lg font-mono font-semibold text-amber-400">{allSnapshots.filter((s) => s.regime === "HIGH").length}</div>
        </Card>
        <Card className="p-3 border-blue-500/30 bg-blue-500/5">
          <div className="text-[10px] text-muted-foreground uppercase">Normal Vol</div>
          <div className="text-lg font-mono font-semibold text-blue-400">{allSnapshots.filter((s) => s.regime === "NORMAL").length}</div>
        </Card>
        <Card className="p-3 border-emerald-500/30 bg-emerald-500/5">
          <div className="text-[10px] text-muted-foreground uppercase">Low Vol</div>
          <div className="text-lg font-mono font-semibold text-emerald-400">{allSnapshots.filter((s) => s.regime === "LOW").length}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Contract list */}
        <Card className="lg:col-span-1">
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">All Contracts</CardTitle>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-muted/50 border border-border rounded px-2 py-1 text-xs"
            >
              <option value="regime">Sort: Regime</option>
              <option value="vol">Sort: 20d Vol</option>
              <option value="percentile">Sort: Percentile</option>
            </select>
          </CardHeader>
          <CardContent className="space-y-1 max-h-[600px] overflow-y-auto pt-0">
            {sorted.map((s) => (
              <button
                key={s.symbol}
                onClick={() => {
                  setSelectedSymbol(s.symbol);
                  selectSymbol(s.symbol);
                }}
                className={cn(
                  "w-full text-left p-2 rounded-md border transition-colors",
                  selectedSymbol === s.symbol
                    ? "bg-primary/10 border-primary/30"
                    : "bg-muted/30 border-border hover:bg-muted/50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-semibold">{s.symbol}</span>
                  <Badge variant="outline" className={cn("text-[9px] h-4 px-1", REGIME_COLORS[s.regime])}>{s.regime}</Badge>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  20d: {s.realizedVol[2]?.annualized.toFixed(1)}% · {s.volPercentile.toFixed(0)}pct
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Selected snapshot detail */}
        <div className="lg:col-span-2 space-y-3">
          {snapshot && (
            <>
              <Card>
                <CardHeader className="py-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Waves className="w-4 h-4" /> {snapshot.name} ({snapshot.symbol})
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{REGIME_DESC[snapshot.regime]}</p>
                  </div>
                  <Badge variant="outline" className={cn("text-[10px]", REGIME_COLORS[snapshot.regime])}>{snapshot.regime}</Badge>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    <Stat label="Current Price" value={fmtPrice(snapshot.lastPrice, decimalsFor(snapshot.symbol))} />
                    <Stat
                      label="20d Realized Vol"
                      value={`${snapshot.realizedVol[2]?.annualized.toFixed(1)}%`}
                      tone={snapshot.realizedVol[2]?.annualized > 30 ? "warn" : "neutral"}
                    />
                    <Stat label="Vol Percentile" value={`${snapshot.volPercentile.toFixed(0)}%`} tone={snapshot.volPercentile > 80 ? "warn" : "neutral"} />
                    <Stat label="Vol-of-Vol" value={`${(snapshot.volOfVol * 100).toFixed(1)}%`} />
                    <Stat label="Parkinson (20d)" value={`${snapshot.parkinsonVol.toFixed(1)}%`} />
                    <Stat label="Garman-Klass" value={`${snapshot.garmanKlassVol.toFixed(1)}%`} />
                    <Stat
                      label="GARCH Forecast"
                      value={`${snapshot.garchForecast.toFixed(1)}%`}
                      tone={snapshot.garchForecast > (snapshot.realizedVol[2]?.annualized ?? 0) ? "warn" : "positive"}
                    />
                    <Stat
                      label="MR Half-Life"
                      value={isFinite(snapshot.meanReversionHalfLife) ? `${snapshot.meanReversionHalfLife.toFixed(0)}d` : "∞"}
                    />
                  </div>

                  {/* GARCH params */}
                  <div className="border border-border rounded-md p-2.5 bg-muted/30">
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">GARCH(1,1) Parameters</div>
                    <div className="grid grid-cols-4 gap-2 text-xs font-mono">
                      <div><span className="text-muted-foreground">ω</span> {snapshot.garchParams.omega.toExponential(2)}</div>
                      <div><span className="text-muted-foreground">α</span> {snapshot.garchParams.alpha.toFixed(3)}</div>
                      <div><span className="text-muted-foreground">β</span> {snapshot.garchParams.beta.toFixed(3)}</div>
                      <div><span className="text-muted-foreground">α+β</span> {(snapshot.garchParams.alpha + snapshot.garchParams.beta).toFixed(3)}</div>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1.5">
                      Persistence (α+β) = {(snapshot.garchParams.alpha + snapshot.garchParams.beta).toFixed(3)}.
                      {snapshot.garchParams.alpha + snapshot.garchParams.beta > 0.95 && " High persistence — vol shocks decay slowly."}
                      {snapshot.garchParams.alpha + snapshot.garchParams.beta < 0.85 && " Low persistence — vol mean-reverts quickly."}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Realized vol by window */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Realized Volatility by Window</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rvData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                        <XAxis dataKey="window" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} orientation="right" tickFormatter={(v) => `${v.toFixed(0)}%`} />
                        <Tooltip
                          formatter={(v: any) => `${Number(v).toFixed(1)}%`}
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                        />
                        <Bar dataKey="vol" radius={[4, 4, 0, 0]}>
                          {rvData.map((d, i) => (
                            <Cell key={i} fill={d.vol > 30 ? "#ef4444" : d.vol > 20 ? "#f59e0b" : "#3b82f6"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* GARCH term structure */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" /> GARCH Term Structure (forward vol forecast)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={tsData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                        <XAxis dataKey="horizon" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} orientation="right" tickFormatter={(v) => `${v.toFixed(0)}%`} domain={["auto", "auto"]} />
                        <Tooltip
                          formatter={(v: any) => `${Number(v).toFixed(1)}%`}
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                        />
                        <ReferenceLine y={snapshot.garchParams.longRun * 252 * 100} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: "Long-run", fontSize: 9, fill: "#fbbf24" }} />
                        <Line type="monotone" dataKey="vol" stroke="#a855f7" strokeWidth={2} dot={{ r: 4, fill: "#a855f7" }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-2">
                    Yellow line = long-run variance forecast. Term structure reverts to long-run at rate (α+β)^h.
                    {snapshot.garchForecast > (snapshot.realizedVol[2]?.annualized ?? 0) && " Forward vol forecast is HIGHER than current — expect vol expansion."}
                    {snapshot.garchForecast < (snapshot.realizedVol[2]?.annualized ?? 0) && " Forward vol forecast is LOWER than current — expect vol mean reversion."}
                  </div>
                </CardContent>
              </Card>

              {/* Trading implications */}
              <Card>
                <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> Volatility-Based Trading Implications</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-xs">
                  {snapshot.regime === "LOW" && (
                    <div className="p-2 border border-emerald-500/30 bg-emerald-500/5 rounded-md">
                      <div className="font-medium text-emerald-400">Low Vol Regime — Sell Premium / Trend Follow</div>
                      <div className="text-muted-foreground mt-0.5">
                        Vol is in the bottom {snapshot.volPercentile.toFixed(0)}% of historical. Options are cheap (low IV). Consider: long straddles (vol long), trend-following strategies (breakouts often follow low vol). Avoid: short vol (premium too thin).
                      </div>
                    </div>
                  )}
                  {snapshot.regime === "NORMAL" && (
                    <div className="p-2 border border-blue-500/30 bg-blue-500/5 rounded-md">
                      <div className="font-medium text-blue-400">Normal Vol Regime — Standard Sizing</div>
                      <div className="text-muted-foreground mt-0.5">
                        Vol is in typical range. Standard position sizing applies. Mean-reversion strategies may work if MR half-life ({isFinite(snapshot.meanReversionHalfLife) ? `${snapshot.meanReversionHalfLife.toFixed(0)}d` : "∞"}) is reasonable.
                      </div>
                    </div>
                  )}
                  {snapshot.regime === "HIGH" && (
                    <div className="p-2 border border-amber-500/30 bg-amber-500/5 rounded-md">
                      <div className="font-medium text-amber-400">High Vol Regime — Reduce Size / Sell Premium</div>
                      <div className="text-muted-foreground mt-0.5">
                        Vol is in the top {(100 - snapshot.volPercentile).toFixed(0)}% of historical. Reduce position sizes by ~30-50%. Options are expensive — consider selling premium (iron condors, strangles). Tighten stops.
                      </div>
                    </div>
                  )}
                  {snapshot.regime === "EXTREME" && (
                    <div className="p-2 border border-rose-500/30 bg-rose-500/5 rounded-md flex items-start gap-2">
                      <Flame className="w-4 h-4 text-rose-500 mt-0.5" />
                      <div>
                        <div className="font-medium text-rose-400">Extreme Vol Regime — Defensive</div>
                        <div className="text-muted-foreground mt-0.5">
                          Vol is in the top {(100 - snapshot.volPercentile).toFixed(0)}% — crisis territory. Cut risk aggressively. Vol-of-vol at {(snapshot.volOfVol * 100).toFixed(0)}% means vol itself is unstable. Prepare for sharp mean reversion once conditions stabilize.
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "warn" | "neutral" }) {
  return (
    <div className={cn(
      "border rounded-md p-2",
      tone === "positive" && "border-emerald-500/30 bg-emerald-500/5",
      tone === "negative" && "border-rose-500/30 bg-rose-500/5",
      tone === "warn" && "border-amber-500/30 bg-amber-500/5",
      tone === "neutral" && "border-border bg-muted/30",
    )}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn(
        "text-sm font-mono font-semibold tabular-nums mt-0.5",
        tone === "positive" && "text-emerald-400",
        tone === "negative" && "text-rose-400",
        tone === "warn" && "text-amber-400",
      )}>{value}</div>
    </div>
  );
}
