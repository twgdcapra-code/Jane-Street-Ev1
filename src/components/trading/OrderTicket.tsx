"use client";

import { useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { getContract } from "@/lib/trading/contracts";
import { fmtPrice } from "@/lib/trading/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { OrderType, Side, TimeInForce } from "@/lib/trading/types";

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "MARKET", label: "MKT" },
  { value: "LIMIT", label: "LMT" },
  { value: "STOP", label: "STP" },
  { value: "STOP_LIMIT", label: "STL" },
  { value: "MIT", label: "MIT" },
];

const TIF_OPTIONS: { value: TimeInForce; label: string }[] = [
  { value: "DAY", label: "DAY" },
  { value: "GTC", label: "GTC" },
  { value: "IOC", label: "IOC" },
  { value: "FOK", label: "FOK" },
];

export function OrderTicket({ compact = false }: { compact?: boolean }) {
  const selectedSymbol = useTradingStore((s) => s.selectedSymbol);
  // Remount inner component when symbol changes so price/stop defaults reset
  return <OrderTicketInner compact={compact} key={selectedSymbol} />;
}

function OrderTicketInner({ compact = false }: { compact?: boolean }) {
  const selectedSymbol = useTradingStore((s) => s.selectedSymbol);
  const quotes = useTradingStore((s) => s.quotes);
  const placeOrder = useTradingStore((s) => s.placeOrder);
  const quote = quotes[selectedSymbol];
  const contract = getContract(selectedSymbol);
  const decimals = selectedSymbol === "BRR" ? 0 : selectedSymbol === "6E" || selectedSymbol === "6B" || selectedSymbol === "NG" ? 4 : 2;

  const [side, setSide] = useState<Side>("BUY");
  const [type, setType] = useState<OrderType>("LIMIT");
  const [tif, setTif] = useState<TimeInForce>("GTC");
  const [qty, setQty] = useState(1);
  const initialPrice = quote ? (side === "BUY" ? quote.bid : quote.ask) : 0;
  const initialStop = quote ? quote.last : 0;
  const [price, setPrice] = useState<number>(initialPrice);
  const [stopPrice, setStopPrice] = useState<number>(initialStop);
  const [tag, setTag] = useState("");

  const handleSubmit = () => {
    if (qty <= 0) return;
    placeOrder({
      symbol: selectedSymbol,
      side,
      type,
      tif,
      qty,
      price: type === "LIMIT" || type === "STOP_LIMIT" || type === "MIT" ? price : undefined,
      stopPrice: type === "STOP" || type === "STOP_LIMIT" ? stopPrice : undefined,
      tag: tag || undefined,
    });
  };

  const marginRequired = Math.abs(qty) * contract.marginInitial;
  const notional = Math.abs(qty) * (price || quote?.last || 0) * contract.pointValue;

  return (
    <div className="space-y-2.5">
      {/* Symbol & price band */}
      <div className="flex items-center justify-between text-xs">
        <span className="font-mono font-semibold">{selectedSymbol}</span>
        {quote && (
          <span className="font-mono text-muted-foreground">
            BID <button onClick={() => setPrice(quote.bid)} className="text-emerald-400 hover:underline">{fmtPrice(quote.bid, decimals)}</button>
            {" · "}
            ASK <button onClick={() => setPrice(quote.ask)} className="text-rose-400 hover:underline">{fmtPrice(quote.ask, decimals)}</button>
          </span>
        )}
      </div>

      {/* Side toggle */}
      <div className="grid grid-cols-2 gap-1">
        <Button
          variant={side === "BUY" ? "default" : "outline"}
          size="sm"
          className={cn("h-8 font-semibold", side === "BUY" && "bg-emerald-500 hover:bg-emerald-600 text-white")}
          onClick={() => setSide("BUY")}
        >
          BUY
        </Button>
        <Button
          variant={side === "SELL" ? "default" : "outline"}
          size="sm"
          className={cn("h-8 font-semibold", side === "SELL" && "bg-rose-500 hover:bg-rose-600 text-white")}
          onClick={() => setSide("SELL")}
        >
          SELL
        </Button>
      </div>

      {/* Order type */}
      <div>
        <Label className="text-[10px] text-muted-foreground">Order Type</Label>
        <div className="grid grid-cols-5 gap-1 mt-0.5">
          {ORDER_TYPES.map((t) => (
            <Button
              key={t.value}
              variant={type === t.value ? "default" : "outline"}
              size="sm"
              className="h-7 text-[10px] px-1"
              onClick={() => setType(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Quantity */}
      <div>
        <Label className="text-[10px] text-muted-foreground">Quantity (contracts)</Label>
        <div className="flex items-center gap-1 mt-0.5">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setQty(Math.max(1, qty - 1))}>−</Button>
          <Input
            type="number"
            value={qty}
            onChange={(e) => setQty(Math.max(0, parseInt(e.target.value) || 0))}
            className="h-8 text-center font-mono"
          />
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setQty(qty + 1)}>+</Button>
        </div>
        <div className="flex gap-1 mt-1">
          {[1, 2, 5, 10].map((q) => (
            <Button key={q} variant="ghost" size="sm" className="h-6 text-[10px] flex-1" onClick={() => setQty(q)}>
              {q}
            </Button>
          ))}
        </div>
      </div>

      {/* Limit price */}
      {(type === "LIMIT" || type === "STOP_LIMIT" || type === "MIT") && (
        <div>
          <Label className="text-[10px] text-muted-foreground">Limit Price</Label>
          <Input
            type="number"
            step={contract.tickSize}
            value={price}
            onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
            className="h-8 font-mono mt-0.5"
          />
        </div>
      )}

      {/* Stop price */}
      {(type === "STOP" || type === "STOP_LIMIT") && (
        <div>
          <Label className="text-[10px] text-muted-foreground">Stop Price</Label>
          <Input
            type="number"
            step={contract.tickSize}
            value={stopPrice}
            onChange={(e) => setStopPrice(parseFloat(e.target.value) || 0)}
            className="h-8 font-mono mt-0.5"
          />
        </div>
      )}

      {/* TIF */}
      <div>
        <Label className="text-[10px] text-muted-foreground">Time in Force</Label>
        <div className="grid grid-cols-4 gap-1 mt-0.5">
          {TIF_OPTIONS.map((t) => (
            <Button
              key={t.value}
              variant={tif === t.value ? "default" : "outline"}
              size="sm"
              className="h-7 text-[10px] px-1"
              onClick={() => setTif(t.value)}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Tag */}
      {!compact && (
        <div>
          <Label className="text-[10px] text-muted-foreground">Tag (optional)</Label>
          <Input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="e.g. mean-reversion, hedge"
            className="h-8 mt-0.5"
          />
        </div>
      )}

      {/* Cost summary */}
      <div className="space-y-0.5 text-[10px] font-mono pt-1 border-t border-border/40">
        <Row label="Notional" value={`$${notional.toLocaleString("en-US", { maximumFractionDigits: 0 })}`} />
        <Row label="Init Margin Req." value={`$${marginRequired.toLocaleString("en-US")}`} />
        <Row label="Tick Value" value={`$${contract.tickValue}/tick`} />
        <Row label="Per Point" value={`$${contract.pointValue.toLocaleString()}`} />
      </div>

      <Button
        className={cn("w-full h-9 font-semibold", side === "BUY" ? "bg-emerald-500 hover:bg-emerald-600 text-white" : "bg-rose-500 hover:bg-rose-600 text-white")}
        onClick={handleSubmit}
        disabled={qty <= 0}
      >
        {side} {qty} {selectedSymbol} @ {type === "MARKET" ? "MKT" : type === "LIMIT" || type === "MIT" ? fmtPrice(price, decimals) : type === "STOP" ? fmtPrice(stopPrice, decimals) + " STOP" : `${fmtPrice(stopPrice, decimals)} / ${fmtPrice(price, decimals)}`}
      </Button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
