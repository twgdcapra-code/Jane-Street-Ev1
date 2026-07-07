"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { getContract } from "@/lib/trading/contracts";
import { fmtMoney, fmtPrice, fmtPct, fmtDateTime, fmtTime } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CartesianGrid, Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Legend, Line, LineChart, ReferenceLine } from "recharts";
import { cn } from "@/lib/utils";
import { BookOpen, Tag, TrendingUp } from "lucide-react";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#84cc16", "#f43f5e"];

export function TradeJournal() {
  const fills = useTradingStore((s) => s.fills);
  const positions = useTradingStore((s) => s.positions);
  const [filterTag, setFilterTag] = useState<string>("ALL");
  const [filterSymbol, setFilterSymbol] = useState<string>("ALL");
  const [noteInput, setNoteInput] = useState<Record<string, string>>({});
  // Persistent trade notes (in-memory; would be localStorage in production)
  const [tradeNotes, setTradeNotes] = useState<Record<string, string>>({});

  // All tags present in fills
  const allTags = useMemo(() => {
    const set = new Set<string>();
    fills.forEach((f) => {
      if (f.strategy) set.add(f.strategy);
      // Also extract from any tag we stored
    });
    return ["ALL", ...Array.from(set)];
  }, [fills]);

  const allSymbols = useMemo(() => {
    const set = new Set(fills.map((f) => f.symbol));
    return ["ALL", ...Array.from(set)];
  }, [fills]);

  // Filtered fills
  const filtered = useMemo(() => {
    return fills.filter((f) => {
      if (filterTag !== "ALL" && f.strategy !== filterTag) return false;
      if (filterSymbol !== "ALL" && f.symbol !== filterSymbol) return false;
      return true;
    });
  }, [fills, filterTag, filterSymbol]);

  // Aggregate P&L by tag (strategy)
  const pnlByTag = useMemo(() => {
    // Group fills into round-turn trades by symbol+tag
    const groups: Record<string, { qty: number; pnl: number; trades: number }> = {};
    // Simplified: each fill is treated as half of a round-turn.
    // To estimate P&L per tag, we pair consecutive BUY/SELL fills of same symbol+tag.
    const byKey: Record<string, typeof fills> = {};
    for (const f of fills) {
      const key = `${f.symbol}|${f.strategy ?? "untagged"}`;
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(f);
    }
    for (const [key, groupFills] of Object.entries(byKey)) {
      const [sym, tag] = key.split("|");
      let netQty = 0;
      let avgPrice = 0;
      let realized = 0;
      let trades = 0;
      for (const f of groupFills) {
        const contract = getContract(f.symbol);
        const signed = f.side === "BUY" ? f.qty : -f.qty;
        if (Math.sign(signed) === Math.sign(netQty) || netQty === 0) {
          // Adding to position
          const newQty = netQty + signed;
          avgPrice = newQty !== 0 ? (avgPrice * Math.abs(netQty) + f.price * Math.abs(signed)) / Math.abs(newQty) : 0;
          netQty = newQty;
        } else {
          // Reducing/closing
          const closedQty = Math.min(Math.abs(signed), Math.abs(netQty));
          const pnlPerUnit = (f.price - avgPrice) * (netQty > 0 ? 1 : -1);
          realized += closedQty * pnlPerUnit * contract.pointValue;
          netQty += signed;
          if (netQty === 0) {
            avgPrice = 0;
            trades++;
          } else {
            // Re-average on partial
            avgPrice = f.price; // simplified
          }
        }
        realized -= f.commission;
      }
      groups[tag] = groups[tag] || { qty: 0, pnl: 0, trades: 0 };
      groups[tag].pnl += realized;
      groups[tag].trades += trades;
      groups[tag].qty += groupFills.reduce((s, f) => s + f.qty, 0);
    }
    return Object.entries(groups).map(([tag, data]) => ({ tag, ...data }));
  }, [fills]);

  // Aggregate by symbol
  const pnlBySymbol = useMemo(() => {
    const groups: Record<string, { pnl: number; trades: number; volume: number }> = {};
    // For symbol attribution, use unrealized P&L of open positions + realized from fills
    for (const p of Object.values(positions)) {
      if (Math.abs(p.netQty) > 0 || p.realizedPnL !== 0) {
        groups[p.symbol] = groups[p.symbol] || { pnl: 0, trades: 0, volume: 0 };
        groups[p.symbol].pnl += p.totalPnL;
      }
    }
    for (const f of fills) {
      groups[f.symbol] = groups[f.symbol] || { pnl: 0, trades: 0, volume: 0 };
      groups[f.symbol].volume += f.qty;
      groups[f.symbol].trades++;
    }
    return Object.entries(groups).map(([symbol, data]) => ({ symbol, ...data }));
  }, [fills, positions]);

  // Total stats
  const stats = useMemo(() => {
    const totalFills = filtered.length;
    const totalVolume = filtered.reduce((s, f) => s + f.qty, 0);
    const totalCommission = filtered.reduce((s, f) => s + f.commission, 0);
    const totalFees = filtered.reduce((s, f) => s + f.fees, 0);
    const totalPnL = Object.values(positions).reduce((s, p) => s + p.totalPnL, 0);
    // Win rate by tag
    const wins = pnlByTag.filter((t) => t.pnl > 0).length;
    const winRate = pnlByTag.length > 0 ? (wins / pnlByTag.length) * 100 : 0;
    return { totalFills, totalVolume, totalCommission, totalFees, totalPnL, winRate };
  }, [filtered, positions, pnlByTag]);

  // Equity curve from fills
  const equityCurve = useMemo(() => {
    let equity = 1_000_000;
    const out: { time: number; equity: number; cumPnL: number }[] = [{ time: Date.now() - 86400000, equity, cumPnL: 0 }];
    // Iterate fills in chronological order (reverse since newest first)
    const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp);
    for (const f of sorted) {
      const contract = getContract(f.symbol);
      // Approximate: if SELL, realize gain vs avg buy (very simplified)
      if (f.side === "SELL") {
        // Crude: assume avg buy was last BUY of same symbol
        // For demo we just decrement commission from equity
      }
      equity -= f.commission + f.fees;
      out.push({ time: f.timestamp, equity, cumPnL: equity - 1_000_000 });
    }
    // Add current unrealized
    const unreal = Object.values(positions).reduce((s, p) => s + p.unrealizedPnL, 0);
    equity += unreal;
    out.push({ time: Date.now(), equity, cumPnL: equity - 1_000_000 });
    return out;
  }, [filtered, positions]);

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="Total Fills" value={String(stats.totalFills)} />
        <StatCard label="Volume (contracts)" value={stats.totalVolume.toLocaleString()} />
        <StatCard label="Commission Paid" value={fmtMoney(stats.totalCommission, 2)} tone="negative" />
        <StatCard label="Fees" value={fmtMoney(stats.totalFees, 2)} tone="negative" />
        <StatCard label="Open P&L" value={fmtMoney(stats.totalPnL, 0)} tone={stats.totalPnL >= 0 ? "positive" : "negative"} />
        <StatCard label="Tag Win Rate" value={`${stats.winRate.toFixed(0)}%`} tone={stats.winRate >= 50 ? "positive" : "negative"} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* P&L by tag */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2"><Tag className="w-4 h-4" /> P&L by Tag / Strategy</CardTitle>
          </CardHeader>
          <CardContent>
            {pnlByTag.length === 0 ? (
              <div className="h-[260px] flex items-center justify-center text-xs text-muted-foreground">No tagged trades yet</div>
            ) : (
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pnlByTag} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmtMoney(v, 0)} />
                    <YAxis type="category" dataKey="tag" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={100} />
                    <Tooltip
                      formatter={(v: any) => fmtMoney(Number(v), 0)}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                    />
                    <ReferenceLine x={0} stroke="#666" />
                    <Bar dataKey="pnl" radius={[0, 4, 4, 0]}>
                      {pnlByTag.map((d, i) => (
                        <Cell key={i} fill={d.pnl >= 0 ? "#10b981" : "#ef4444"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Equity curve */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Equity Curve (session)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis
                    dataKey="time"
                    tickFormatter={(t) => new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    interval={Math.max(1, Math.floor(equityCurve.length / 6))}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={70} orientation="right" domain={["auto", "auto"]} />
                  <Tooltip
                    labelFormatter={(t) => new Date(t as number).toLocaleString("en-US")}
                    formatter={(v: any) => fmtMoney(Number(v), 0)}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  />
                  <ReferenceLine y={1_000_000} stroke="#666" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <Line type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* P&L by symbol */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">P&L & Volume by Symbol</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-3">Symbol</th>
                  <th className="text-right py-2 px-3">Total P&L</th>
                  <th className="text-right py-2 px-3">Trades</th>
                  <th className="text-right py-2 px-3">Volume</th>
                  <th className="text-right py-2 px-3">Avg P&L / Trade</th>
                  <th className="text-right py-2 px-3">% of Total P&L</th>
                </tr>
              </thead>
              <tbody>
                {pnlBySymbol.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">No trades yet</td></tr>
                ) : (
                  pnlBySymbol.sort((a, b) => b.pnl - a.pnl).map((s) => {
                    const totalAbsPnL = pnlBySymbol.reduce((sum, x) => sum + Math.abs(x.pnl), 0);
                    const pct = totalAbsPnL > 0 ? (Math.abs(s.pnl) / totalAbsPnL) * 100 : 0;
                    return (
                      <tr key={s.symbol} className="border-b border-border/40 hover:bg-muted/30">
                        <td className="py-1.5 px-3 font-mono font-medium">{s.symbol}</td>
                        <td className={cn("py-1.5 px-3 text-right font-mono font-medium", s.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {s.pnl >= 0 ? "+" : ""}{fmtMoney(s.pnl, 0)}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono">{s.trades}</td>
                        <td className="py-1.5 px-3 text-right font-mono">{s.volume}</td>
                        <td className="py-1.5 px-3 text-right font-mono">
                          {s.trades > 0 ? fmtMoney(s.pnl / s.trades, 0) : "—"}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={cn("h-full", s.pnl >= 0 ? "bg-emerald-500" : "bg-rose-500")} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[10px] tabular-nums">{pct.toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Filter controls + Trade ledger */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><BookOpen className="w-4 h-4" /> Trade Journal</CardTitle>
          <div className="flex items-center gap-2">
            <select
              value={filterTag}
              onChange={(e) => setFilterTag(e.target.value)}
              className="bg-muted/50 border border-border rounded-md px-2 py-1 text-xs"
            >
              {allTags.map((t) => <option key={t} value={t}>{t === "ALL" ? "All tags" : t}</option>)}
            </select>
            <select
              value={filterSymbol}
              onChange={(e) => setFilterSymbol(e.target.value)}
              className="bg-muted/50 border border-border rounded-md px-2 py-1 text-xs"
            >
              {allSymbols.map((s) => <option key={s} value={s}>{s === "ALL" ? "All symbols" : s}</option>)}
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-2">Time</th>
                  <th className="text-left py-2 px-2">Symbol</th>
                  <th className="text-left py-2 px-2">Side</th>
                  <th className="text-right py-2 px-2">Qty</th>
                  <th className="text-right py-2 px-2">Price</th>
                  <th className="text-right py-2 px-2">Notional</th>
                  <th className="text-right py-2 px-2">Comm</th>
                  <th className="text-left py-2 px-2">Tag</th>
                  <th className="text-left py-2 px-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">No fills match filter</td></tr>
                ) : (
                  filtered.slice(0, 200).map((f) => {
                    const contract = getContract(f.symbol);
                    const notional = f.qty * f.price * contract.pointValue;
                    return (
                      <tr key={f.id} className="border-b border-border/40 hover:bg-muted/30">
                        <td className="py-1.5 px-2 text-[10px] text-muted-foreground font-mono">{fmtDateTime(f.timestamp)}</td>
                        <td className="py-1.5 px-2 font-mono font-medium">{f.symbol}</td>
                        <td className={cn("py-1.5 px-2 font-medium", f.side === "BUY" ? "text-emerald-400" : "text-rose-400")}>{f.side}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{f.qty}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{fmtPrice(f.price, f.symbol === "BRR" ? 0 : 4)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{fmtMoney(notional, 0)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">${f.commission.toFixed(2)}</td>
                        <td className="py-1.5 px-2">
                          {f.strategy && <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono">{f.strategy}</Badge>}
                        </td>
                        <td className="py-1.5 px-2">
                          <input
                            type="text"
                            value={tradeNotes[f.id] ?? ""}
                            onChange={(e) => setTradeNotes({ ...tradeNotes, [f.id]: e.target.value })}
                            placeholder="Add note..."
                            className="w-full bg-transparent border-0 focus:outline-none focus:bg-muted/30 rounded px-1 py-0.5 text-[11px]"
                          />
                        </td>
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

function StatCard({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }) {
  return (
    <Card className={cn(
      "p-3 border",
      tone === "positive" && "border-emerald-500/30 bg-emerald-500/5",
      tone === "negative" && "border-rose-500/30 bg-rose-500/5",
      tone === "neutral" && "border-border",
    )}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn(
        "text-lg font-mono font-semibold tabular-nums mt-0.5",
        tone === "positive" && "text-emerald-400",
        tone === "negative" && "text-rose-400",
      )}>{value}</div>
    </Card>
  );
}
