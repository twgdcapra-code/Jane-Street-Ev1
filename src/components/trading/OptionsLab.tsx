"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS, getContract } from "@/lib/trading/contracts";
import {
  generateOptionChain,
  aggregateGreeks,
  OPTION_STRATEGIES,
  volSurface,
} from "@/lib/trading/options";
import { fmtMoney, fmtPrice } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from "recharts";
import { cn } from "@/lib/utils";
import { Layers, Sigma, TrendingUp } from "lucide-react";

export function OptionsLab() {
  const quotes = useTradingStore((s) => s.quotes);
  const [underlying, setUnderlying] = useState("ES");
  const [expiryDays, setExpiryDays] = useState(30);
  const [strikeCount, setStrikeCount] = useState(11);
  const [selectedStrategy, setSelectedStrategy] = useState<string>("long-straddle");
  const [view, setView] = useState<"chain" | "strategies" | "surface">("chain");

  const contract = getContract(underlying);
  const quote = quotes[underlying];
  const forwardPrice = quote?.last ?? contract.basePrice;
  const baseVol = contract.volatility;

  const chain = useMemo(
    () => generateOptionChain(underlying, forwardPrice, baseVol, expiryDays, strikeCount),
    [underlying, forwardPrice, baseVol, expiryDays, strikeCount, quotes],
  );

  const strategyDef = OPTION_STRATEGIES.find((s) => s.id === selectedStrategy);
  const strategyLegs = useMemo(
    () => strategyDef ? strategyDef.build(underlying, forwardPrice, baseVol, expiryDays) : [],
    [strategyDef, underlying, forwardPrice, baseVol, expiryDays],
  );
  const agg = useMemo(() => aggregateGreeks(strategyLegs), [strategyLegs]);

  // Payoff diagram for selected strategy
  const payoffData = useMemo(() => {
    if (strategyLegs.length === 0) return [];
    const strikes = strategyLegs.map((l) => l.spec.strike);
    const minS = Math.min(...strikes, forwardPrice) * 0.85;
    const maxS = Math.max(...strikes, forwardPrice) * 1.15;
    const out: { price: number; payoff: number }[] = [];
    for (let i = 0; i <= 100; i++) {
      const S = minS + (maxS - minS) * (i / 100);
      let payoff = -agg.netPrice;
      for (const leg of strategyLegs) {
        const intrinsic = leg.spec.isCall ? Math.max(0, S - leg.spec.strike) : Math.max(0, leg.spec.strike - S);
        payoff += leg.qty * intrinsic;
      }
      out.push({ price: S, payoff });
    }
    return out;
  }, [strategyLegs, agg, forwardPrice]);

  // Vol surface
  const surface = (() => volSurface(underlying, forwardPrice, baseVol, [7, 14, 30, 60, 90, 180], [-0.1, -0.05, -0.025, 0, 0.025, 0.05, 0.1]))();
  const surfaceData = useMemo(() => {
    const expiries = Array.from(new Set(surface.map((s) => s.expiry))).sort((a, b) => a - b);
    return expiries.map((e) => {
      const row: any = { expiry: `${e}d` };
      surface.filter((s) => s.expiry === e).forEach((s) => {
        row[`m${(s.moneyness * 100).toFixed(1)}`] = s.iv * 100;
      });
      return row;
    });
  }, [surface]);

  return (
    <div className="space-y-4">
      {/* Config */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sigma className="w-4 h-4" /> Options on Futures — Black's Model (1976)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-[10px] text-muted-foreground">Underlying</Label>
              <select
                value={underlying}
                onChange={(e) => setUnderlying(e.target.value)}
                className="bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono mt-0.5"
              >
                {CONTRACTS.filter((c) => ["ES", "NQ", "MNQ", "MES", "RTY", "YM", "CL", "GC", "SI", "ZN", "ZB", "BRR"].includes(c.symbol)).map((c) => (
                  <option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Expiry (days)</Label>
              <Input type="number" value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value))} className="h-8 w-24 text-xs font-mono mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Strikes</Label>
              <Input type="number" value={strikeCount} onChange={(e) => setStrikeCount(Number(e.target.value))} className="h-8 w-24 text-xs font-mono mt-0.5" />
            </div>
            <div className="text-xs">
              <div className="text-[10px] text-muted-foreground">Forward (F)</div>
              <div className="font-mono font-semibold mt-0.5">{fmtPrice(forwardPrice, 2)}</div>
            </div>
            <div className="text-xs">
              <div className="text-[10px] text-muted-foreground">Base IV</div>
              <div className="font-mono font-semibold mt-0.5">{(baseVol * 100).toFixed(1)}%</div>
            </div>
            <div className="text-xs">
              <div className="text-[10px] text-muted-foreground">Risk-free</div>
              <div className="font-mono font-semibold mt-0.5">4.50%</div>
            </div>
            <div className="ml-auto flex items-center gap-1 bg-muted/50 rounded-md p-1">
              <Button size="sm" variant={view === "chain" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setView("chain")}>Chain</Button>
              <Button size="sm" variant={view === "strategies" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setView("strategies")}>Strategies</Button>
              <Button size="sm" variant={view === "surface" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setView("surface")}>Vol Surface</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {view === "chain" && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2"><Layers className="w-4 h-4" /> Option Chain — {underlying} ({expiryDays}d)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-y border-border">
                  <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                    <th colSpan={6} className="text-center py-2 px-2 bg-emerald-500/5">CALLS</th>
                    <th className="text-center py-2 px-2 bg-muted/60">STRIKE</th>
                    <th colSpan={6} className="text-center py-2 px-2 bg-rose-500/5">PUTS</th>
                  </tr>
                  <tr className="text-muted-foreground text-[10px] uppercase tracking-wider border-b border-border">
                    <th className="text-right py-1.5 px-2">IV</th>
                    <th className="text-right py-1.5 px-2">Δ</th>
                    <th className="text-right py-1.5 px-2">γ</th>
                    <th className="text-right py-1.5 px-2">θ</th>
                    <th className="text-right py-1.5 px-2">ν</th>
                    <th className="text-right py-1.5 px-2">Price</th>
                    <th className="text-center py-1.5 px-2 font-mono">K</th>
                    <th className="text-right py-1.5 px-2">Price</th>
                    <th className="text-right py-1.5 px-2">ν</th>
                    <th className="text-right py-1.5 px-2">θ</th>
                    <th className="text-right py-1.5 px-2">γ</th>
                    <th className="text-right py-1.5 px-2">Δ</th>
                    <th className="text-right py-1.5 px-2">IV</th>
                  </tr>
                </thead>
                <tbody>
                  {chain.calls.map((call, i) => {
                    const put = chain.puts[i];
                    const isATM = call.moneyness === "ATM";
                    return (
                      <tr key={i} className={cn("border-b border-border/40 hover:bg-muted/30", isATM && "bg-amber-500/5")}>
                        <td className={cn("py-1.5 px-2 text-right font-mono text-[10px]", call.moneyness === "ITM" ? "text-emerald-400/70" : "text-muted-foreground")}>{(call.impliedVol * 100).toFixed(1)}%</td>
                        <td className="py-1.5 px-2 text-right font-mono text-[10px]">{call.delta.toFixed(3)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-[10px] text-muted-foreground">{call.gamma.toExponential(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-[10px] text-rose-400/70">{call.theta.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-[10px] text-muted-foreground">{call.vega.toFixed(2)}</td>
                        <td className={cn("py-1.5 px-2 text-right font-mono font-medium", call.moneyness === "ITM" ? "text-emerald-400" : "text-foreground")}>{call.price.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-center font-mono font-bold bg-muted/40">{call.strike.toFixed(2)}</td>
                        <td className={cn("py-1.5 px-2 text-right font-mono font-medium", put.moneyness === "ITM" ? "text-rose-400" : "text-foreground")}>{put.price.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-[10px] text-muted-foreground">{put.vega.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-[10px] text-rose-400/70">{put.theta.toFixed(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-[10px] text-muted-foreground">{put.gamma.toExponential(2)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-[10px]">{put.delta.toFixed(3)}</td>
                        <td className={cn("py-1.5 px-2 text-right font-mono text-[10px]", put.moneyness === "ITM" ? "text-rose-400/70" : "text-muted-foreground")}>{(put.impliedVol * 100).toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 text-[10px] text-muted-foreground">
              <span className="text-amber-400">●</span> Highlighted row = ATM strike. IV smile: OTM puts have slightly higher IV (equity skew). Greeks from Black's 1976 model.
            </div>
          </CardContent>
        </Card>
      )}

      {view === "strategies" && (
        <div className="space-y-4">
          {/* Strategy selector */}
          <div className="flex flex-wrap items-center gap-2">
            {OPTION_STRATEGIES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedStrategy(s.id)}
                className={cn(
                  "px-3 py-1.5 rounded-md border text-xs flex items-center gap-2 transition-colors",
                  selectedStrategy === s.id
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "border-border text-muted-foreground hover:bg-muted/40",
                )}
              >
                {s.name}
                <Badge variant="outline" className="text-[9px] h-3.5 px-1">{s.category}</Badge>
              </button>
            ))}
          </div>

          {strategyDef && (
            <>
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> {strategyDef.name}
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground">{strategyDef.description}</p>
                </CardHeader>
                <CardContent>
                  {/* Aggregated Greeks */}
                  <div className="grid grid-cols-3 md:grid-cols-7 gap-2 mb-3">
                    <Stat label="Net Price" value={fmtMoney(agg.netPrice, 2)} tone={agg.netPrice >= 0 ? "negative" : "positive"} />
                    <Stat label="Net Δ" value={agg.netDelta.toFixed(3)} tone={Math.abs(agg.netDelta) < 0.1 ? "positive" : "neutral"} />
                    <Stat label="Net γ" value={agg.netGamma.toExponential(2)} />
                    <Stat label="Net θ" value={agg.netTheta.toFixed(2)} tone={agg.netTheta > 0 ? "positive" : "negative"} />
                    <Stat label="Net ν" value={agg.netVega.toFixed(2)} tone={agg.netVega > 0 ? "positive" : "negative"} />
                    <Stat label="Max Loss" value={fmtMoney(agg.maxLoss, 0)} tone="negative" />
                    <Stat label="Max Gain" value={fmtMoney(agg.maxGain, 0)} tone="positive" />
                  </div>

                  {/* Payoff diagram */}
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={payoffData}>
                        <defs>
                          <linearGradient id="payoffPos" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="payoffNeg" x1="0" y1="1" x2="0" y2="0">
                            <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                        <XAxis
                          dataKey="price"
                          tickFormatter={(v) => fmtPrice(v, 0)}
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          interval={9}
                          label={{ value: "Underlying Price at Expiry", position: "insideBottom", offset: -2, fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={60} orientation="right" tickFormatter={(v) => fmtMoney(v, 0)} />
                        <Tooltip
                          labelFormatter={(v) => `Underlying: ${fmtPrice(Number(v), 2)}`}
                          formatter={(v: any) => fmtMoney(Number(v), 2)}
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                        />
                        <ReferenceLine y={0} stroke="#666" />
                        <ReferenceLine x={forwardPrice} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.7} label={{ value: "Fwd", fontSize: 9, fill: "#fbbf24" }} />
                        {!isNaN(agg.breakevenLow) && <ReferenceLine x={agg.breakevenLow} stroke="#10b981" strokeDasharray="2 2" strokeOpacity={0.5} label={{ value: "BE", fontSize: 9, fill: "#10b981" }} />}
                        {!isNaN(agg.breakevenHigh) && <ReferenceLine x={agg.breakevenHigh} stroke="#10b981" strokeDasharray="2 2" strokeOpacity={0.5} />}
                        <Area type="monotone" dataKey="payoff" stroke="#3b82f6" strokeWidth={1.5} fill="url(#payoffPos)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Yellow line = current forward price. Green dashed = breakevens. Max loss: <span className="font-mono text-rose-400">{fmtMoney(agg.maxLoss, 0)}</span>, Max gain: <span className="font-mono text-emerald-400">{fmtMoney(agg.maxGain, 0)}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Strategy legs */}
              <Card>
                <CardHeader className="py-3"><CardTitle className="text-sm">Strategy Legs</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-y border-border">
                      <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                        <th className="text-left py-2 px-3">Type</th>
                        <th className="text-left py-2 px-3">Side</th>
                        <th className="text-right py-2 px-3">Qty</th>
                        <th className="text-right py-2 px-3">Strike</th>
                        <th className="text-right py-2 px-3">Expiry</th>
                        <th className="text-right py-2 px-3">Price</th>
                        <th className="text-right py-2 px-3">IV</th>
                        <th className="text-right py-2 px-3">Δ</th>
                        <th className="text-right py-2 px-3">ν</th>
                        <th className="text-center py-2 px-3">Moneyness</th>
                      </tr>
                    </thead>
                    <tbody>
                      {strategyLegs.map((leg, i) => (
                        <tr key={i} className="border-b border-border/40 hover:bg-muted/30">
                          <td className="py-2 px-3 font-medium">{leg.spec.isCall ? "Call" : "Put"}</td>
                          <td className={cn("py-2 px-3 font-medium", leg.qty > 0 ? "text-emerald-400" : "text-rose-400")}>{leg.qty > 0 ? "LONG" : "SHORT"}</td>
                          <td className="py-2 px-3 text-right font-mono">{Math.abs(leg.qty)}</td>
                          <td className="py-2 px-3 text-right font-mono">{leg.spec.strike.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right font-mono text-muted-foreground">{leg.spec.expiryDays}d</td>
                          <td className="py-2 px-3 text-right font-mono">{leg.quote.price.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right font-mono text-muted-foreground">{(leg.quote.impliedVol * 100).toFixed(1)}%</td>
                          <td className="py-2 px-3 text-right font-mono">{leg.quote.delta.toFixed(3)}</td>
                          <td className="py-2 px-3 text-right font-mono text-muted-foreground">{leg.quote.vega.toFixed(2)}</td>
                          <td className="py-2 px-3 text-center">
                            <Badge variant="outline" className={cn("text-[9px] h-4 px-1", leg.quote.moneyness === "ITM" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : leg.quote.moneyness === "OTM" ? "bg-muted text-muted-foreground border-border" : "bg-amber-500/15 text-amber-400 border-amber-500/30")}>{leg.quote.moneyness}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {view === "surface" && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Implied Volatility Surface — {underlying}</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-y border-border">
                  <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                    <th className="text-left py-2 px-3">Expiry</th>
                    {[-0.1, -0.05, -0.025, 0, 0.025, 0.05, 0.1].map((m) => (
                      <th key={m} className="text-right py-2 px-3 font-mono">{(m * 100).toFixed(1)}%</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {surfaceData.map((row) => (
                    <tr key={row.expiry} className="border-b border-border/40">
                      <td className="py-2 px-3 font-mono font-medium">{row.expiry}</td>
                      {[-0.1, -0.05, -0.025, 0, 0.025, 0.05, 0.1].map((m) => {
                        const key = `m${(m * 100).toFixed(1)}`;
                        const iv = row[key];
                        // Color scale: red (high) to green (low) — but here we want hot/cool
                        const intensity = iv ? Math.min(1, (iv - (baseVol * 100 - 5)) / 15) : 0;
                        return (
                          <td
                            key={m}
                            className="py-2 px-3 text-right font-mono tabular-nums"
                            style={{
                              backgroundColor: iv ? `rgba(239, 68, 68, ${intensity * 0.4})` : undefined,
                              color: intensity > 0.5 ? "#fecaca" : "inherit",
                            }}
                          >
                            {iv ? `${iv.toFixed(1)}%` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-muted-foreground mt-3">
              Rows = days to expiry, columns = moneyness (K/F − 1). Equity index smile: OTM puts (negative moneyness) typically trade richer than calls due to crash protection demand.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }) {
  return (
    <div className={cn(
      "border rounded-md p-2",
      tone === "positive" && "border-emerald-500/30 bg-emerald-500/5",
      tone === "negative" && "border-rose-500/30 bg-rose-500/5",
      tone === "neutral" && "border-border bg-muted/30",
    )}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn(
        "text-sm font-mono font-semibold tabular-nums mt-0.5",
        tone === "positive" && "text-emerald-400",
        tone === "negative" && "text-rose-400",
      )}>{value}</div>
    </div>
  );
}
