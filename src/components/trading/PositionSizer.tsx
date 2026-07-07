"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS, getContract } from "@/lib/trading/contracts";
import {
  compareSizingMethods,
  expectedDrawdown,
  type SizingInput,
  type SizingResult,
} from "@/lib/trading/position-sizing";
import { fmtMoney, fmtPrice, fmtPct, decimalsFor } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { Calculator, Target, TrendingUp, Shield } from "lucide-react";

export function PositionSizer() {
  const quotes = useTradingStore((s) => s.quotes);
  const accountEquity = useTradingStore((s) => s.cashBalance);
  const positions = useTradingStore((s) => s.positions);
  const placeOrder = useTradingStore((s) => s.placeOrder);
  const [symbol, setSymbol] = useState("ES");
  const [entryPrice, setEntryPrice] = useState(quotes[symbol]?.last ?? 5000);
  const [stopPrice, setStopPrice] = useState((quotes[symbol]?.last ?? 5000) * 0.98);
  const [riskPct, setRiskPct] = useState(1.0);
  const [winRate, setWinRate] = useState(0.55);
  const [avgWin, setAvgWin] = useState(500);
  const [avgLoss, setAvgLoss] = useState(400);
  const [targetVol, setTargetVol] = useState(0.15);
  const [assetVol, setAssetVol] = useState(0.20);
  const [maxContracts, setMaxContracts] = useState(50);
  const [equityOverride, setEquityOverride] = useState<number | null>(null);

  const contract = getContract(symbol);
  const decimals = decimalsFor(symbol);
  const effectiveEquity = equityOverride ?? accountEquity;

  // Live quote for entry/stop suggestions
  const currentQuote = quotes[symbol];
  const syncToCurrent = () => {
    if (currentQuote) {
      setEntryPrice(currentQuote.last);
      setStopPrice(currentQuote.last * 0.98);
    }
  };

  const input: SizingInput = {
    accountEquity: effectiveEquity,
    riskPerTradePct: riskPct,
    entryPrice,
    stopPrice,
    symbol,
    winRate,
    avgWin,
    avgLoss,
    targetVol,
    assetVol,
    maxContracts,
  };

  const results = useMemo(() => compareSizingMethods(input), [
    effectiveEquity, riskPct, entryPrice, stopPrice, symbol, winRate, avgWin, avgLoss, targetVol, assetVol, maxContracts,
  ]);

  const chartData = results.map((r) => ({
    name: r.methodology.length > 25 ? r.methodology.slice(0, 22) + "…" : r.methodology,
    fullName: r.methodology,
    contracts: r.contracts,
    risk: r.riskDollars,
    notional: r.notional,
  }));

  const stopDistance = Math.abs(entryPrice - stopPrice);
  const stopDistancePct = (stopDistance / entryPrice) * 100;
  const riskPerContract = stopDistance * contract.pointValue;

  return (
    <div className="space-y-4">
      {/* Input config */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Calculator className="w-4 h-4" /> Position Sizing Calculator</CardTitle>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={syncToCurrent}>
            Sync to Live Price
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-[10px] text-muted-foreground">Symbol</Label>
              <select
                value={symbol}
                onChange={(e) => {
                  const s = e.target.value;
                  setSymbol(s);
                  const q = quotes[s];
                  if (q) {
                    setEntryPrice(q.last);
                    setStopPrice(q.last * 0.98);
                  }
                }}
                className="w-full mt-0.5 bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono"
              >
                {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Account Equity</Label>
              <Input
                type="number"
                value={effectiveEquity}
                onChange={(e) => setEquityOverride(Number(e.target.value))}
                className="h-8 text-xs font-mono mt-0.5"
              />
              <div className="text-[9px] text-muted-foreground mt-0.5">Default: live account ${accountEquity.toLocaleString()}</div>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Entry Price</Label>
              <Input
                type="number"
                step={contract.tickSize}
                value={entryPrice}
                onChange={(e) => setEntryPrice(Number(e.target.value))}
                className="h-8 text-xs font-mono mt-0.5"
              />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Stop Price</Label>
              <Input
                type="number"
                step={contract.tickSize}
                value={stopPrice}
                onChange={(e) => setStopPrice(Number(e.target.value))}
                className="h-8 text-xs font-mono mt-0.5"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-border/40">
            <div>
              <Label className="text-[10px] text-muted-foreground">Risk per Trade (%)</Label>
              <Input type="number" step="0.1" value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Win Rate (0-1)</Label>
              <Input type="number" step="0.01" min="0" max="1" value={winRate} onChange={(e) => setWinRate(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Avg Win ($)</Label>
              <Input type="number" value={avgWin} onChange={(e) => setAvgWin(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Avg Loss ($)</Label>
              <Input type="number" value={avgLoss} onChange={(e) => setAvgLoss(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-[10px] text-muted-foreground">Target Vol (annual)</Label>
              <Input type="number" step="0.01" value={targetVol} onChange={(e) => setTargetVol(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Asset Vol (annual)</Label>
              <Input type="number" step="0.01" value={assetVol} onChange={(e) => setAssetVol(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Max Contracts Cap</Label>
              <Input type="number" value={maxContracts} onChange={(e) => setMaxContracts(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
            <div className="flex items-end">
              <div className="text-xs text-muted-foreground">
                Stop distance: <span className="font-mono text-foreground">{fmtPrice(stopDistance, decimals)}</span> ({fmtPct(stopDistancePct)})
                <br />Risk/contract: <span className="font-mono text-foreground">{fmtMoney(riskPerContract, 0)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Comparison chart */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Methodology Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={130} />
                <Tooltip
                  formatter={(v: any, name: string) => name === "contracts" ? [`${v} contracts`, "Contracts"] : [fmtMoney(Number(v), 0), name]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                />
                <Bar dataKey="contracts" radius={[0, 4, 4, 0]}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={["#3b82f6", "#10b981", "#06b6d4", "#a855f7", "#f59e0b", "#ec4899"][i % 6]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Results table */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Detailed Results</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-3">Methodology</th>
                  <th className="text-right py-2 px-3">Contracts</th>
                  <th className="text-right py-2 px-3">Risk $</th>
                  <th className="text-right py-2 px-3">Risk %</th>
                  <th className="text-right py-2 px-3">Notional</th>
                  <th className="text-right py-2 px-3">Margin</th>
                  <th className="text-right py-2 px-3">Margin %</th>
                  <th className="text-center py-2 px-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="py-2 px-3 font-medium">{r.methodology}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold tabular-nums">{r.contracts}</td>
                    <td className={cn("py-2 px-3 text-right font-mono tabular-nums", r.riskDollars > effectiveEquity * 0.05 ? "text-rose-400" : "text-foreground")}>{fmtMoney(r.riskDollars, 0)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{fmtPct(r.riskPctOfEquity)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-muted-foreground">{fmtMoney(r.notional, 0)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums">{fmtMoney(r.marginRequired, 0)}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-muted-foreground">{fmtPct(r.marginPctOfEquity)}</td>
                    <td className="py-2 px-3 text-center">
                      {r.contracts > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 text-[10px] px-2"
                          onClick={() => {
                            placeOrder({
                              symbol,
                              side: "BUY",
                              type: "MARKET",
                              tif: "DAY",
                              qty: r.contracts,
                              tag: `sizing:${r.methodology.split(" ")[0].toLowerCase()}`,
                            });
                          }}
                        >
                          Place
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Explanations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {results.map((r, i) => (
          <Card key={i}>
            <CardHeader className="py-3 flex flex-row items-center justify-between">
              <CardTitle className="text-xs flex items-center gap-2">
                {r.methodology.includes("Kelly") ? <Target className="w-3.5 h-3.5" /> : r.methodology.includes("Volatility") ? <TrendingUp className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                {r.methodology}
              </CardTitle>
              <Badge variant="outline" className="text-[10px]">{r.contracts} contracts</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{r.explanation}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Drawdown expectation */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" /> Expected Drawdown (per recommended size)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {results.slice(0, 3).map((r, i) => {
              if (r.contracts === 0) return null;
              const dd95 = expectedDrawdown(r.contracts, entryPrice, assetVol, symbol, 20, 0.95);
              const dd99 = expectedDrawdown(r.contracts, entryPrice, assetVol, symbol, 20, 0.99);
              const ddPctEquity95 = (dd95.dollars / effectiveEquity) * 100;
              const ddPctEquity99 = (dd99.dollars / effectiveEquity) * 100;
              return (
                <div key={i} className="border border-border rounded-md p-3">
                  <div className="text-xs font-medium mb-2">{r.methodology}</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">20-day 95% DD</span>
                      <span className="font-mono">{fmtMoney(dd95.dollars, 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">95% DD % equity</span>
                      <span className={cn("font-mono", ddPctEquity95 > 10 ? "text-rose-400" : "text-foreground")}>{fmtPct(ddPctEquity95)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">20-day 99% DD</span>
                      <span className="font-mono">{fmtMoney(dd99.dollars, 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">99% DD % equity</span>
                      <span className={cn("font-mono", ddPctEquity99 > 15 ? "text-rose-400" : "text-amber-400")}>{fmtPct(ddPctEquity99)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">95% DD % of position</span>
                      <span className="font-mono text-muted-foreground">{dd95.pctOfPosition.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
