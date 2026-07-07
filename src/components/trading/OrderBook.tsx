"use client";

import { useMemo } from "react";
import { getEngine } from "@/lib/trading/market-engine";
import { useTradingStore } from "@/lib/trading/store";
import { getContract } from "@/lib/trading/contracts";
import { fmtPrice, decimalsFor } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function OrderBook({ symbol }: { symbol: string }) {
  const quotes = useTradingStore((s) => s.quotes);
  const tickCount = useTradingStore((s) => s.tickCount);
  const quote = quotes[symbol];
  const book = useMemo(() => getEngine().getOrderBook(symbol, 10), [symbol, tickCount]);
  const contract = getContract(symbol);
  const decimals = decimalsFor(symbol);

  const maxSize = useMemo(
    () => Math.max(...book.bids.map((b) => b.size), ...book.asks.map((a) => a.size), 1),
    [book],
  );

  const cumulative = useMemo(() => {
    const bidCum: number[] = [];
    let bc = 0;
    for (const b of book.bids) {
      bc += b.size;
      bidCum.push(bc);
    }
    const askCum: number[] = [];
    let ac = 0;
    for (const a of book.asks) {
      ac += a.size;
      askCum.push(ac);
    }
    return { bidCum, askCum };
  }, [book]);

  const totalBid = cumulative.bidCum[cumulative.bidCum.length - 1] ?? 0;
  const totalAsk = cumulative.askCum[cumulative.askCum.length - 1] ?? 0;
  const imbalance = totalBid + totalAsk > 0 ? (totalBid - totalAsk) / (totalBid + totalAsk) : 0;

  return (
    <Card>
      <CardHeader className="py-2">
        <CardTitle className="text-xs flex items-center justify-between">
          <span>Order Book · {symbol}</span>
          <span className={cn("text-[10px] font-mono", imbalance > 0 ? "text-emerald-400" : "text-rose-400")}>
            {(imbalance * 100).toFixed(0)}%
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs font-mono">
        <div className="grid grid-cols-3 text-[10px] text-muted-foreground mb-1 px-1">
          <span>Price</span>
          <span className="text-right">Size</span>
          <span className="text-right">Cum</span>
        </div>
        {/* Asks (reversed so highest is on top) */}
        <div className="space-y-0.5">
          {book.asks.slice().reverse().map((a, i) => {
            const revIdx = book.asks.length - 1 - i;
            const pct = (a.size / maxSize) * 100;
            return (
              <div key={`a${i}`} className="relative grid grid-cols-3 px-1 py-0.5 hover:bg-rose-500/5">
                <div
                  className="absolute right-0 top-0 bottom-0 bg-rose-500/10"
                  style={{ width: `${pct}%` }}
                />
                <span className="text-rose-400 relative z-10">{fmtPrice(a.price, decimals)}</span>
                <span className="text-right relative z-10 text-foreground">{a.size}</span>
                <span className="text-right relative z-10 text-muted-foreground">{cumulative.askCum[revIdx]}</span>
              </div>
            );
          })}
        </div>
        {/* Spread */}
        <div className="my-1 py-1 border-y border-border/40 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>Spread</span>
          <span className="text-foreground">
            {quote ? fmtPrice(quote.ask - quote.bid, decimals) : "—"} ({quote ? ((quote.ask - quote.bid) / quote.last * 100).toFixed(3) : "—"}%)
          </span>
        </div>
        {/* Bids */}
        <div className="space-y-0.5">
          {book.bids.map((b, i) => {
            const pct = (b.size / maxSize) * 100;
            return (
              <div key={`b${i}`} className="relative grid grid-cols-3 px-1 py-0.5 hover:bg-emerald-500/5">
                <div
                  className="absolute right-0 top-0 bottom-0 bg-emerald-500/10"
                  style={{ width: `${pct}%`}}
                />
                <span className="text-emerald-400 relative z-10">{fmtPrice(b.price, decimals)}</span>
                <span className="text-right relative z-10 text-foreground">{b.size}</span>
                <span className="text-right relative z-10 text-muted-foreground">{cumulative.bidCum[i]}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-2 pt-1 border-t border-border/40 flex justify-between text-[10px] text-muted-foreground">
          <span>Bid: <span className="text-emerald-400">{totalBid}</span></span>
          <span>Ask: <span className="text-rose-400">{totalAsk}</span></span>
        </div>
      </CardContent>
    </Card>
  );
}
