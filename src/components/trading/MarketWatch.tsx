"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS } from "@/lib/trading/contracts";
import { fmtCompact, fmtPct, fmtPrice, decimalsFor } from "@/lib/trading/format";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import type { FuturesContract } from "@/lib/trading/types";

const ASSET_CLASS_LABELS: Record<FuturesContract["assetClass"], string> = {
  equity_index: "Equity",
  rate: "Rates",
  fx: "FX",
  metal: "Metals",
  energy: "Energy",
  agri: "Agri",
  crypto: "Crypto",
};

const ASSET_CLASSES = ["all", "equity_index", "rate", "fx", "metal", "energy", "crypto"] as const;

export function MarketWatch() {
  const quotes = useTradingStore((s) => s.quotes);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    return CONTRACTS.filter((c) => filter === "all" || c.assetClass === filter)
      .filter((c) => c.symbol.toLowerCase().includes(search.toLowerCase()) || c.name.toLowerCase().includes(search.toLowerCase()))
      .map((c) => ({ contract: c, quote: quotes[c.symbol] }))
      .filter((r) => r.quote);
  }, [quotes, filter, search]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
          {ASSET_CLASSES.map((ac) => (
            <button
              key={ac}
              onClick={() => setFilter(ac)}
              className={cn(
                "px-2.5 py-1 text-xs rounded transition-colors capitalize",
                filter === ac ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {ac === "all" ? "All" : ASSET_CLASS_LABELS[ac as FuturesContract["assetClass"]]}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search symbol or name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="ml-auto text-xs text-muted-foreground">{rows.length} contracts</div>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-b border-border">
              <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                <th className="text-left py-2 px-3">Symbol</th>
                <th className="text-left py-2 px-3">Name</th>
                <th className="text-left py-2 px-3">Class</th>
                <th className="text-left py-2 px-3">Exch</th>
                <th className="text-right py-2 px-3">Bid</th>
                <th className="text-right py-2 px-3">Bid Sz</th>
                <th className="text-right py-2 px-3">Ask</th>
                <th className="text-right py-2 px-3">Ask Sz</th>
                <th className="text-right py-2 px-3">Last</th>
                <th className="text-right py-2 px-3">Chg</th>
                <th className="text-right py-2 px-3">Chg%</th>
                <th className="text-right py-2 px-3">Volume</th>
                <th className="text-right py-2 px-3">Open Int</th>
                <th className="text-right py-2 px-3">VWAP</th>
                <th className="text-right py-2 px-3">Hi/Lo</th>
                <th className="text-center py-2 px-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ contract, quote }) => {
                const decimals = decimalsFor(contract.symbol);
                const up = quote.change >= 0;
                return (
                  <tr
                    key={contract.symbol}
                    className="border-b border-border/40 hover:bg-muted/30 cursor-pointer"
                    onClick={() => selectSymbol(contract.symbol)}
                  >
                    <td className="py-1.5 px-3 font-mono font-semibold">{contract.symbol}</td>
                    <td className="py-1.5 px-3 text-muted-foreground truncate max-w-[180px]">{contract.name}</td>
                    <td className="py-1.5 px-3"><Badge variant="outline" className="text-[9px] h-4 px-1">{ASSET_CLASS_LABELS[contract.assetClass]}</Badge></td>
                    <td className="py-1.5 px-3 text-muted-foreground font-mono text-[10px]">{contract.exchange}</td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-emerald-400/80">{fmtPrice(quote.bid, decimals)}</td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-muted-foreground text-[10px]">{quote.bidSize}</td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-rose-400/80">{fmtPrice(quote.ask, decimals)}</td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-muted-foreground text-[10px]">{quote.askSize}</td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums font-medium">{fmtPrice(quote.last, decimals)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono tabular-nums", up ? "text-emerald-400" : "text-rose-400")}>
                      <span className="inline-flex items-center gap-0.5">
                        {up ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                        {up ? "+" : ""}{fmtPrice(quote.change, decimals)}
                      </span>
                    </td>
                    <td className={cn("py-1.5 px-3 text-right font-mono tabular-nums", up ? "text-emerald-400" : "text-rose-400")}>
                      {fmtPct(quote.changePct)}
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-muted-foreground">{fmtCompact(quote.volume, 0)}</td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-muted-foreground">{fmtCompact(quote.openInterest, 0)}</td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-muted-foreground">{fmtPrice(quote.vwap, decimals)}</td>
                    <td className="py-1.5 px-3 text-right font-mono tabular-nums text-muted-foreground text-[10px]">
                      {fmtPrice(quote.high, decimals)} / {fmtPrice(quote.low, decimals)}
                    </td>
                    <td className="py-1.5 px-3 text-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[10px] px-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectSymbol(contract.symbol);
                        }}
                      >
                        Chart →
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
