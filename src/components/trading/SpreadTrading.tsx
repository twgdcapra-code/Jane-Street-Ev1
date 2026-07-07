"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { getEngine } from "@/lib/trading/market-engine";
import { getContract } from "@/lib/trading/contracts";
import {
  SPREAD_TEMPLATES,
  buildAllSpreadQuotes,
  buildSpreadHistory,
  type SpreadDef,
} from "@/lib/trading/spreads";
import { fmtMoney, fmtPrice } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Layers, Plus, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function SpreadTrading() {
  const quotes = useTradingStore((s) => s.quotes);
  const placeOrder = useTradingStore((s) => s.placeOrder);
  const [selected, setSelected] = useState<string>("ic-es-nq");
  const [filter, setFilter] = useState<string>("All");

  const spreadQuotes = useMemo(() => buildAllSpreadQuotes(quotes), [quotes]);

  const categories = useMemo(() => {
    const set = new Set(SPREAD_TEMPLATES.map((s) => s.category));
    return ["All", ...Array.from(set)];
  }, []);

  const selectedDef = SPREAD_TEMPLATES.find((s) => s.id === selected);
  const selectedQuote = spreadQuotes.find((s) => s.def.id === selected)?.quote;

  // Build spread history
  const history = useMemo(() => {
    if (!selectedDef) return [];
    const histMap: Record<string, { time: number; close: number }[]> = {};
    for (const leg of selectedDef.legs) {
      const h = getEngine().getHistory(leg.symbol);
      histMap[leg.symbol] = h.map((c) => ({ time: c.time, close: c.close }));
    }
    return buildSpreadHistory(selectedDef, histMap, 200);
  }, [selectedDef]);

  const handleTradeSpread = (def: SpreadDef, side: "BUY" | "SELL") => {
    // Place orders for each leg (simplified: market orders)
    for (const leg of def.legs) {
      const actualSide = side === "BUY" ? leg.side : leg.side === "BUY" ? "SELL" : "BUY";
      placeOrder({
        symbol: leg.symbol,
        side: actualSide,
        type: "MARKET",
        tif: "DAY",
        qty: leg.ratio,
        tag: `spread:${def.id}`,
      });
    }
  };

  // Stats from history
  const spreadStats = useMemo(() => {
    if (history.length < 2) return { mean: 0, sd: 0, min: 0, max: 0, z: 0 };
    const prices = history.map((h) => h.spreadPrice);
    const mean = prices.reduce((s, v) => s + v, 0) / prices.length;
    const variance = prices.reduce((s, v) => s + (v - mean) ** 2, 0) / prices.length;
    const sd = Math.sqrt(variance);
    const last = prices[prices.length - 1];
    return {
      mean,
      sd,
      min: Math.min(...prices),
      max: Math.max(...prices),
      z: sd === 0 ? 0 : (last - mean) / sd,
    };
  }, [history]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={cn(
                "px-2.5 py-1 text-xs rounded transition-colors",
                filter === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{SPREAD_TEMPLATES.length} spread templates</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Spread list */}
        <Card className="lg:col-span-1">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="w-4 h-4" /> Spread Templates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-[600px] overflow-y-auto pt-0">
            {SPREAD_TEMPLATES.filter((s) => filter === "All" || s.category === filter).map((s) => {
              const q = spreadQuotes.find((sq) => sq.def.id === s.id)?.quote;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                  className={cn(
                    "w-full text-left p-2.5 rounded-md border transition-colors",
                    selected === s.id
                      ? "bg-primary/10 border-primary/30"
                      : "bg-muted/30 border-border hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold truncate">{s.name}</span>
                    <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">{s.type.replace("_", " ")}</Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                    {s.legs.map((l, i) => (
                      <span key={i}>
                        {i > 0 && " / "}
                        <span className={l.side === "BUY" ? "text-emerald-400" : "text-rose-400"}>
                          {l.side === "BUY" ? "+" : "−"}{l.ratio} {l.symbol}
                        </span>
                      </span>
                    ))}
                  </div>
                  {q && (
                    <div className="text-[10px] mt-1 font-mono text-foreground">
                      Spread: {fmtPrice(q.spreadPrice, 2)} · Margin {fmtMoney(q.spreadMargin, 0)}
                    </div>
                  )}
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Selected spread detail */}
        <div className="lg:col-span-2 space-y-3">
          {selectedDef && (
            <>
              <Card>
                <CardHeader className="py-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" /> {selectedDef.name}
                    </CardTitle>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{selectedDef.description}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{selectedDef.type.replace("_", " ")}</Badge>
                </CardHeader>
                <CardContent>
                  {selectedQuote ? (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                        <Stat label="Spread Price" value={fmtPrice(selectedQuote.spreadPrice, 2)} tone={selectedQuote.spreadPrice >= 0 ? "positive" : "negative"} />
                        <Stat label="Spread Margin" value={fmtMoney(selectedQuote.spreadMargin, 0)} />
                        <Stat label="Notional Long" value={fmtMoney(selectedQuote.notionalLong, 0)} />
                        <Stat label="Notional Short" value={fmtMoney(selectedQuote.notionalShort, 0)} />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                        <Stat label="Mean (hist)" value={fmtPrice(spreadStats.mean, 2)} />
                        <Stat label="Stdev (hist)" value={fmtPrice(spreadStats.sd, 2)} />
                        <Stat label="Range (hist)" value={`${fmtPrice(spreadStats.min, 2)} – ${fmtPrice(spreadStats.max, 2)}`} />
                        <Stat
                          label="Z-Score (now)"
                          value={spreadStats.z.toFixed(2)}
                          tone={Math.abs(spreadStats.z) > 2 ? "warn" : "neutral"}
                        />
                      </div>
                      {/* Leg quotes */}
                      <div className="border border-border rounded-md overflow-hidden">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/40 border-b border-border">
                            <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                              <th className="text-left py-2 px-3">Leg</th>
                              <th className="text-left py-2 px-3">Side</th>
                              <th className="text-right py-2 px-3">Ratio</th>
                              <th className="text-right py-2 px-3">Bid</th>
                              <th className="text-right py-2 px-3">Ask</th>
                              <th className="text-right py-2 px-3">Margin/Leg</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedQuote.legQuotes.map((lq, i) => {
                              const c = getEngine().getQuote(lq.leg.symbol);
                              const contract = selectedDef.legs[i];
                              return (
                                <tr key={i} className="border-b border-border/40">
                                  <td className="py-2 px-3 font-mono font-medium">{lq.leg.symbol}</td>
                                  <td className={cn("py-2 px-3 font-medium", lq.leg.side === "BUY" ? "text-emerald-400" : "text-rose-400")}>
                                    {lq.leg.side}
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono">{lq.leg.ratio}</td>
                                  <td className="py-2 px-3 text-right font-mono text-emerald-400/80">{c ? fmtPrice(c.bid, 2) : "—"}</td>
                                  <td className="py-2 px-3 text-right font-mono text-rose-400/80">{c ? fmtPrice(c.ask, 2) : "—"}</td>
                                  <td className="py-2 px-3 text-right font-mono text-muted-foreground">
                                    {fmtMoney(lq.leg.ratio * (selectedQuote ? getLegMargin(lq.leg.symbol) : 0), 0)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <Button className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={() => handleTradeSpread(selectedDef, "BUY")}>
                          <Plus className="w-3 h-3 mr-1" /> BUY SPREAD
                        </Button>
                        <Button className="flex-1 bg-rose-500 hover:bg-rose-600 text-white" onClick={() => handleTradeSpread(selectedDef, "SELL")}>
                          <Plus className="w-3 h-3 mr-1" /> SELL SPREAD
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-xs">No quote available</div>
                  )}
                </CardContent>
              </Card>

              {/* Spread history chart */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm">Spread Price History (last 200 bars)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={history}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                        <XAxis
                          dataKey="time"
                          tickFormatter={(t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                          interval={Math.floor(history.length / 8)}
                        />
                        <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={70} orientation="right" />
                        <Tooltip
                          labelFormatter={(t) => new Date(t as number).toLocaleString("en-US")}
                          formatter={(v: any) => fmtPrice(Number(v), 2)}
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                        />
                        <ReferenceLine y={spreadStats.mean} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.6} label={{ value: "Mean", fontSize: 9, fill: "#f59e0b" }} />
                        <ReferenceLine y={spreadStats.mean + 2 * spreadStats.sd} stroke="#ef4444" strokeDasharray="2 2" strokeOpacity={0.3} />
                        <ReferenceLine y={spreadStats.mean - 2 * spreadStats.sd} stroke="#ef4444" strokeDasharray="2 2" strokeOpacity={0.3} />
                        <Line type="monotone" dataKey="spreadPrice" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Orange line = historical mean. Red dashed = ±2σ bands. Current z-score: <span className="font-mono text-foreground">{spreadStats.z.toFixed(2)}</span>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function getLegMargin(symbol: string): number {
  try {
    return getContract(symbol).marginInitial;
  } catch {
    return 0;
  }
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
