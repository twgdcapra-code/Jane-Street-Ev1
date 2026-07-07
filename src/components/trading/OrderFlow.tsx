"use client";

import { useMemo } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { buildOrderFlowSnapshot } from "@/lib/trading/orderflow";
import { fmtPrice, fmtCompact, decimalsFor } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { Activity, BarChart3, Layers } from "lucide-react";

export function OrderFlow() {
  const selectedSymbol = useTradingStore((s) => s.selectedSymbol);
  const tickCount = useTradingStore((s) => s.tickCount);

  const snapshot = useMemo(
    () => buildOrderFlowSnapshot(selectedSymbol),
    [selectedSymbol, tickCount],
  );

  const decimals = decimalsFor(selectedSymbol);
  const maxLevelVol = Math.max(...snapshot.priceLevels.map((l) => l.totalVolume), 1);

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Buy Vol</div><div className="text-lg font-mono font-semibold text-emerald-400">{fmtCompact(snapshot.buyVolume, 0)}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Sell Vol</div><div className="text-lg font-mono font-semibold text-rose-400">{fmtCompact(snapshot.sellVolume, 0)}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Cum Delta</div><div className={cn("text-lg font-mono font-semibold", snapshot.cumulativeDelta >= 0 ? "text-emerald-400" : "text-rose-400")}>{snapshot.cumulativeDelta >= 0 ? "+" : ""}{fmtCompact(snapshot.cumulativeDelta, 0)}</div></Card>
        <Card className="p-3 border-amber-500/30 bg-amber-500/5"><div className="text-[10px] text-muted-foreground uppercase">POC</div><div className="text-lg font-mono font-semibold text-amber-400">{fmtPrice(snapshot.pocPrice, decimals)}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">VAH</div><div className="text-lg font-mono font-semibold text-foreground">{fmtPrice(snapshot.vah, decimals)}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">VAL</div><div className="text-lg font-mono font-semibold text-foreground">{fmtPrice(snapshot.val, decimals)}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Volume profile / DOM ladder */}
        <Card className="lg:col-span-2">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2"><Layers className="w-4 h-4" /> Volume Profile / DOM Ladder — {selectedSymbol}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="max-h-[500px] overflow-y-auto">
              <div className="grid grid-cols-12 gap-1 text-[10px] text-muted-foreground uppercase tracking-wider px-2 py-1 sticky top-0 bg-card z-10">
                <div className="col-span-3 text-right">Sell Vol</div>
                <div className="col-span-2 text-right">Price</div>
                <div className="col-span-1 text-center">Δ</div>
                <div className="col-span-3 text-left">Buy Vol</div>
                <div className="col-span-3 text-right">Total</div>
              </div>
              {snapshot.priceLevels.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-xs">No trades yet</div>
              ) : (
                snapshot.priceLevels.slice(0, 40).map((lvl) => {
                  const isPOC = lvl.price === snapshot.pocPrice;
                  const isInValueArea = lvl.price >= snapshot.val && lvl.price <= snapshot.vah;
                  const buyPct = (lvl.buyVolume / maxLevelVol) * 100;
                  const sellPct = (lvl.sellVolume / maxLevelVol) * 100;
                  return (
                    <div
                      key={lvl.price}
                      className={cn(
                        "grid grid-cols-12 gap-1 px-2 py-0.5 items-center text-xs font-mono border-b border-border/20",
                        isPOC && "bg-amber-500/10 border-amber-500/30",
                        !isPOC && isInValueArea && "bg-muted/20",
                      )}
                    >
                      <div className="col-span-3 text-right relative">
                        <div
                          className="absolute right-0 top-0 bottom-0 bg-rose-500/20 rounded-l"
                          style={{ width: `${sellPct}%` }}
                        />
                        <span className="relative z-10 text-rose-400">{lvl.sellVolume}</span>
                      </div>
                      <div className={cn("col-span-2 text-right font-semibold tabular-nums", isPOC && "text-amber-400")}>
                        {fmtPrice(lvl.price, decimals)}
                      </div>
                      <div className="col-span-1 text-center">
                        <span className={cn("text-[10px]", lvl.delta > 0 ? "text-emerald-400" : lvl.delta < 0 ? "text-rose-400" : "text-muted-foreground")}>
                          {lvl.delta > 0 ? "+" : ""}{lvl.delta}
                        </span>
                      </div>
                      <div className="col-span-3 relative">
                        <div
                          className="absolute left-0 top-0 bottom-0 bg-emerald-500/20 rounded-r"
                          style={{ width: `${buyPct}%` }}
                        />
                        <span className="relative z-10 text-emerald-400 pl-1">{lvl.buyVolume}</span>
                      </div>
                      <div className="col-span-3 text-right text-muted-foreground tabular-nums">
                        {lvl.totalVolume}
                        <span className="text-[9px] ml-1">({lvl.tradeCount})</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Trade tape */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> Trade Tape (Time & Sales)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-y-auto max-h-[500px]">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/40 border-y border-border sticky top-0">
                  <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                    <th className="text-left py-1.5 px-2">Time</th>
                    <th className="text-right py-1.5 px-2">Price</th>
                    <th className="text-right py-1.5 px-2">Size</th>
                    <th className="text-center py-1.5 px-2">Side</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.trades.slice(0, 100).map((t) => (
                    <tr key={t.id} className="border-b border-border/20 hover:bg-muted/30">
                      <td className="py-1 px-2 text-[10px] text-muted-foreground">
                        {new Date(t.timestamp).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </td>
                      <td className={cn("py-1 px-2 text-right tabular-nums", t.aggressor === "BUY" ? "text-emerald-400" : "text-rose-400")}>
                        {fmtPrice(t.price, decimals)}
                      </td>
                      <td className="py-1 px-2 text-right tabular-nums">{t.size}</td>
                      <td className="py-1 px-2 text-center">
                        <span className={cn("text-[10px] font-bold", t.aggressor === "BUY" ? "text-emerald-400" : "text-rose-400")}>
                          {t.aggressor === "BUY" ? "▲" : "▼"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Delta per minute chart */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Cumulative Delta per Minute</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={snapshot.deltaPerMin}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis
                  dataKey="time"
                  tickFormatter={(t) => new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} orientation="right" />
                <Tooltip
                  labelFormatter={(t) => new Date(t as number).toLocaleTimeString("en-US")}
                  formatter={(v: any) => [fmtCompact(Number(v), 0), "Delta"]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                />
                <ReferenceLine y={0} stroke="#666" />
                <Bar dataKey="delta" radius={[2, 2, 0, 0]}>
                  {snapshot.deltaPerMin.map((d, i) => (
                    <Cell key={i} fill={d.delta >= 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">
            Green bars = net buying pressure (market buys &gt; market sells). Red bars = net selling pressure. Persistent delta direction often precedes price moves.
          </div>
        </CardContent>
      </Card>

      {/* Order flow interpretation */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Order Flow Interpretation</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          <div className="flex items-center justify-between border-b border-border/30 py-1">
            <span className="text-muted-foreground">Cumulative Delta</span>
            <span className={cn("font-mono font-medium", snapshot.cumulativeDelta >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {snapshot.cumulativeDelta >= 0 ? "+" : ""}{fmtCompact(snapshot.cumulativeDelta, 0)} ({snapshot.cumulativeDelta >= 0 ? "Buying pressure" : "Selling pressure"})
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border/30 py-1">
            <span className="text-muted-foreground">Buy/Sell Ratio</span>
            <span className="font-mono font-medium">
              {snapshot.sellVolume > 0 ? (snapshot.buyVolume / snapshot.sellVolume).toFixed(2) : "∞"} : 1
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border/30 py-1">
            <span className="text-muted-foreground">Value Area Width</span>
            <span className="font-mono font-medium">
              {snapshot.vah > 0 && snapshot.val > 0 ? `${((snapshot.vah - snapshot.val) / snapshot.pocPrice * 100).toFixed(2)}% of POC` : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border/30 py-1">
            <span className="text-muted-foreground">Trade Count</span>
            <span className="font-mono font-medium">{snapshot.trades.length}</span>
          </div>
          <div className="flex items-center justify-between py-1">
            <span className="text-muted-foreground">Avg Trade Size</span>
            <span className="font-mono font-medium">
              {snapshot.trades.length > 0 ? (snapshot.totalVolume / snapshot.trades.length).toFixed(1) : "—"} contracts
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
