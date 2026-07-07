"use client";

import { useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtDateTime, fmtPrice } from "@/lib/trading/format";
import { cn } from "@/lib/utils";
import { Trash2, X } from "lucide-react";
import type { OrderStatus } from "@/lib/trading/types";

const STATUS_COLORS: Record<OrderStatus, string> = {
  WORKING: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  PARTIALLY_FILLED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  FILLED: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
  REJECTED: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  PENDING: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
};

const FILTERS: { value: OrderStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "WORKING", label: "Working" },
  { value: "FILLED", label: "Filled" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REJECTED", label: "Rejected" },
];

export function OrderBlotter() {
  const orders = useTradingStore((s) => s.orders);
  const cancelOrder = useTradingStore((s) => s.cancelOrder);
  const [filter, setFilter] = useState<OrderStatus | "ALL">("ALL");

  const filtered = filter === "ALL" ? orders : orders.filter((o) => o.status === filter);

  return (
    <Card>
      <CardHeader className="py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm">Order Blotter</CardTitle>
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={filter === f.value ? "default" : "ghost"}
              size="sm"
              className="h-6 text-[10px] px-2"
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border sticky top-0">
              <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                <th className="text-left py-2 px-2">Created</th>
                <th className="text-left py-2 px-2">Symbol</th>
                <th className="text-left py-2 px-2">Side</th>
                <th className="text-left py-2 px-2">Type</th>
                <th className="text-left py-2 px-2">TIF</th>
                <th className="text-right py-2 px-2">Qty</th>
                <th className="text-right py-2 px-2">Filled</th>
                <th className="text-right py-2 px-2">Price</th>
                <th className="text-right py-2 px-2">Stop</th>
                <th className="text-right py-2 px-2">Avg Fill</th>
                <th className="text-center py-2 px-2">Status</th>
                <th className="text-left py-2 px-2">Tag</th>
                <th className="text-center py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={13} className="text-center py-8 text-muted-foreground text-xs">No orders</td>
                </tr>
              ) : (
                filtered.map((o) => (
                  <tr key={o.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-1.5 px-2 font-mono text-[10px] text-muted-foreground">{fmtDateTime(o.createdAt)}</td>
                    <td className="py-1.5 px-2 font-mono font-medium">{o.symbol}</td>
                    <td className={cn("py-1.5 px-2 font-medium", o.side === "BUY" ? "text-emerald-400" : "text-rose-400")}>{o.side}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{o.type}</td>
                    <td className="py-1.5 px-2 text-muted-foreground text-[10px]">{o.tif}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{o.qty}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{o.filledQty}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{o.price ? fmtPrice(o.price, 2) : "—"}</td>
                    <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{o.stopPrice ? fmtPrice(o.stopPrice, 2) : "—"}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{o.avgFillPrice > 0 ? fmtPrice(o.avgFillPrice, 2) : "—"}</td>
                    <td className="py-1.5 px-2 text-center">
                      <Badge variant="outline" className={cn("text-[9px] h-4 px-1 font-mono", STATUS_COLORS[o.status])}>
                        {o.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="py-1.5 px-2 text-muted-foreground text-[10px]">{o.tag ?? o.rejectReason ?? ""}</td>
                    <td className="py-1.5 px-2 text-center">
                      {o.status === "WORKING" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] px-2 text-rose-400 hover:text-rose-500"
                          onClick={() => cancelOrder(o.id)}
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
