"use client";

import { useMemo } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { computeAccount } from "@/lib/trading/analytics";
import { fmtMoney, fmtPct, fmtPrice, fmtTime, pnlColor, bgPnlColor } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrderTicket } from "./OrderTicket";
import { OrderBlotter } from "./OrderBlotter";
import { ArrowDown, ArrowUp, DollarSign, Layers, Scale, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function Dashboard() {
  const quotes = useTradingStore((s) => s.quotes);
  const positions = useTradingStore((s) => s.positions);
  const orders = useTradingStore((s) => s.orders);
  const fills = useTradingStore((s) => s.fills);
  const cashBalance = useTradingStore((s) => s.cashBalance);

  const lastPrices = useMemo(
    () => Object.fromEntries(Object.entries(quotes).map(([k, v]) => [k, v.last])),
    [quotes],
  );
  const account = useMemo(
    () => computeAccount(Object.values(positions), cashBalance, lastPrices),
    [positions, cashBalance, lastPrices],
  );

  const openPositions = Object.values(positions).filter((p) => p.netQty !== 0);
  const workingOrders = orders.filter((o) => o.status === "WORKING");
  const todayFills = fills.slice(0, 50);

  return (
    <div className="space-y-4">
      {/* Account strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Account Equity"
          value={fmtMoney(account.equity, 0)}
          sub={`Cash ${fmtMoney(account.cashBalance, 0)}`}
          icon={DollarSign}
          tone="primary"
        />
        <MetricCard
          label="Session P&L"
          value={fmtMoney(account.sessionPnL, 0)}
          sub={fmtPct(account.equity > 0 ? (account.sessionPnL / account.equity) * 100 : 0)}
          tone={account.sessionPnL >= 0 ? "positive" : "negative"}
          icon={account.sessionPnL >= 0 ? TrendingUp : TrendingDown}
        />
        <MetricCard
          label="Buying Power"
          value={fmtMoney(account.buyingPower, 0)}
          sub={`Avail ${fmtMoney(account.availableMargin, 0)}`}
          icon={Zap}
        />
        <MetricCard
          label="Gross Exposure"
          value={fmtMoney(account.grossExposure, 0)}
          sub={`${account.leverage.toFixed(2)}x leverage`}
          icon={Layers}
        />
        <MetricCard
          label="Margin Used"
          value={fmtMoney(account.initialMarginUsed, 0)}
          sub={`Init / ${fmtMoney(account.maintenanceMarginUsed, 0)} maint`}
          icon={Scale}
        />
        <MetricCard
          label="Margin Call Level"
          value={`${(account.marginCallLevel * 100).toFixed(1)}%`}
          sub={account.marginCallLevel > 0.8 ? "ELEVATED" : "Safe"}
          tone={account.marginCallLevel > 0.8 ? "negative" : "neutral"}
          icon={Scale}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Positions */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="text-sm">Open Positions</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{openPositions.length} active</Badge>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs"
                onClick={() => useTradingStore.getState().flattenAll()}
                disabled={openPositions.length === 0}
              >
                FLATTEN ALL
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-y border-border">
                  <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                    <th className="text-left py-2 px-3">Symbol</th>
                    <th className="text-right py-2 px-3">Net Qty</th>
                    <th className="text-right py-2 px-3">Avg Price</th>
                    <th className="text-right py-2 px-3">Last</th>
                    <th className="text-right py-2 px-3">Exposure</th>
                    <th className="text-right py-2 px-3">Unreal P&L</th>
                    <th className="text-right py-2 px-3">Session</th>
                    <th className="text-right py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-muted-foreground text-xs">
                        No open positions. Place an order to begin.
                      </td>
                    </tr>
                  ) : (
                    openPositions.map((p) => {
                      const quote = quotes[p.symbol];
                      return (
                        <tr key={p.symbol} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="py-2 px-3 font-mono font-medium">{p.symbol}</td>
                          <td className={cn("py-2 px-3 text-right font-mono tabular-nums", p.netQty > 0 ? "text-emerald-400" : "text-rose-400")}>
                            {p.netQty > 0 ? "+" : ""}{p.netQty}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">{fmtPrice(p.avgPrice, p.symbol === "BRR" ? 0 : p.symbol === "6E" || p.symbol === "6B" ? 4 : 2)}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums">{quote ? fmtPrice(quote.last, p.symbol === "BRR" ? 0 : p.symbol === "6E" || p.symbol === "6B" ? 4 : 2) : "—"}</td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-muted-foreground">{fmtMoney(p.exposure, 0)}</td>
                          <td className={cn("py-2 px-3 text-right font-mono tabular-nums font-medium", pnlColor(p.unrealizedPnL))}>
                            {p.unrealizedPnL >= 0 ? "+" : ""}{fmtMoney(p.unrealizedPnL, 0)}
                          </td>
                          <td className={cn("py-2 px-3 text-right font-mono tabular-nums", pnlColor(p.sessionPnL))}>
                            {p.sessionPnL >= 0 ? "+" : ""}{fmtMoney(p.sessionPnL, 0)}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              onClick={() => useTradingStore.getState().flattenSymbol(p.symbol)}
                            >
                              Flatten
                            </Button>
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

        {/* Order ticket */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Order Ticket</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <OrderTicket compact />
          </CardContent>
        </Card>
      </div>

      {/* Working orders + recent fills */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Working Orders ({workingOrders.length})</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-y border-border sticky top-0">
                  <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                    <th className="text-left py-2 px-2">Time</th>
                    <th className="text-left py-2 px-2">Symbol</th>
                    <th className="text-left py-2 px-2">Side</th>
                    <th className="text-left py-2 px-2">Type</th>
                    <th className="text-right py-2 px-2">Qty</th>
                    <th className="text-right py-2 px-2">Price</th>
                    <th className="text-right py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {workingOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-6 text-muted-foreground text-xs">No working orders</td>
                    </tr>
                  ) : (
                    workingOrders.map((o) => (
                      <tr key={o.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-1.5 px-2 font-mono text-[10px] text-muted-foreground">{fmtTime(o.createdAt)}</td>
                        <td className="py-1.5 px-2 font-mono font-medium">{o.symbol}</td>
                        <td className={cn("py-1.5 px-2 font-medium", o.side === "BUY" ? "text-emerald-400" : "text-rose-400")}>{o.side}</td>
                        <td className="py-1.5 px-2 text-muted-foreground">{o.type}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{o.qty}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{o.price ? fmtPrice(o.price, 2) : o.stopPrice ? fmtPrice(o.stopPrice, 2) : "—"}</td>
                        <td className="py-1.5 px-2 text-right">
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2 text-rose-400" onClick={() => useTradingStore.getState().cancelOrder(o.id)}>
                            Cancel
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Recent Fills</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-y border-border sticky top-0">
                  <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                    <th className="text-left py-2 px-2">Time</th>
                    <th className="text-left py-2 px-2">Symbol</th>
                    <th className="text-left py-2 px-2">Side</th>
                    <th className="text-right py-2 px-2">Qty</th>
                    <th className="text-right py-2 px-2">Price</th>
                    <th className="text-right py-2 px-2">Comm</th>
                  </tr>
                </thead>
                <tbody>
                  {todayFills.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-6 text-muted-foreground text-xs">No fills yet</td>
                    </tr>
                  ) : (
                    todayFills.map((f) => (
                      <tr key={f.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-1.5 px-2 font-mono text-[10px] text-muted-foreground">{fmtTime(f.timestamp)}</td>
                        <td className="py-1.5 px-2 font-mono font-medium">{f.symbol}</td>
                        <td className={cn("py-1.5 px-2 font-medium", f.side === "BUY" ? "text-emerald-400" : "text-rose-400")}>{f.side}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{f.qty}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{fmtPrice(f.price, f.symbol === "BRR" ? 0 : 4)}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">${f.commission.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <OrderBlotter />
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  icon: any;
  tone?: "positive" | "negative" | "primary" | "neutral";
}) {
  return (
    <Card className={cn(
      "p-3 border",
      tone === "positive" && "border-emerald-500/30 bg-emerald-500/5",
      tone === "negative" && "border-rose-500/30 bg-rose-500/5",
      tone === "primary" && "border-primary/30 bg-primary/5",
    )}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={cn("text-lg font-mono font-semibold tabular-nums mt-0.5", tone === "positive" ? "text-emerald-400" : tone === "negative" ? "text-rose-400" : "text-foreground")}>{value}</div>
          {sub && <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{sub}</div>}
        </div>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
    </Card>
  );
}
