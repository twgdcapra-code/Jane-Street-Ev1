"use client";

import { useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS } from "@/lib/trading/contracts";
import type { AlgoType, AlgoParams } from "@/lib/trading/execution-algos";
import { fmtMoney, fmtPrice, fmtTime } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Cpu, Pause, Play, Square, Zap } from "lucide-react";

const ALGO_TYPES: { value: AlgoType; label: string; description: string }[] = [
  { value: "TWAP", label: "TWAP", description: "Time-Weighted Average Price — even slicing across horizon" },
  { value: "VWAP", label: "VWAP", description: "Volume-Weighted — slices weighted by U-shaped volume curve" },
  { value: "ICEBERG", label: "Iceberg", description: "Small visible quantity, refill on fill" },
  { value: "POV", label: "POV", description: "Percentage of Volume — dynamic sizing vs market volume" },
  { value: "IS", label: "Impl. Shortfall", description: "Risk-averse front-loading or passive back-loading" },
];

const STATUS_COLORS: Record<string, string> = {
  QUEUED: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  RUNNING: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  PAUSED: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  COMPLETED: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  CANCELLED: "bg-muted text-muted-foreground border-border",
  FAILED: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

export function ExecutionAlgos() {
  const algos = useTradingStore((s) => s.algos);
  const startAlgo = useTradingStore((s) => s.startAlgo);
  const cancelAlgo = useTradingStore((s) => s.cancelAlgo);
  const pauseAlgo = useTradingStore((s) => s.pauseAlgo);
  const resumeAlgo = useTradingStore((s) => s.resumeAlgo);
  const selectedSymbol = useTradingStore((s) => s.selectedSymbol);

  const [type, setType] = useState<AlgoType>("TWAP");
  const [symbol, setSymbol] = useState(selectedSymbol);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [totalQty, setTotalQty] = useState(10);
  const [durationSec, setDurationSec] = useState(60);
  const [slices, setSlices] = useState(5);
  const [visibleQty, setVisibleQty] = useState(2);
  const [targetPct, setTargetPct] = useState(0.1);
  const [urgency, setUrgency] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");

  const handleStart = () => {
    const params: AlgoParams = {
      totalQty,
      side,
      symbol,
      durationSec,
      slices,
      visibleQty,
      targetPct,
      urgency,
    };
    startAlgo(type, params);
  };

  const runningCount = algos.filter((a) => a.status === "RUNNING").length;
  const completedCount = algos.filter((a) => a.status === "COMPLETED").length;

  return (
    <div className="space-y-4">
      {/* Algo config */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cpu className="w-4 h-4" /> Algorithm Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Algo type selector */}
          <div>
            <Label className="text-[10px] text-muted-foreground">Algorithm Type</Label>
            <div className="grid grid-cols-5 gap-1 mt-0.5">
              {ALGO_TYPES.map((t) => (
                <Button
                  key={t.value}
                  variant={type === t.value ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-[10px] px-1"
                  onClick={() => setType(t.value)}
                  title={t.description}
                >
                  {t.label}
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">{ALGO_TYPES.find((t) => t.value === type)?.description}</p>
          </div>

          {/* Common params */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Symbol</Label>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full mt-0.5 bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono"
              >
                {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Side</Label>
              <div className="grid grid-cols-2 gap-1 mt-0.5">
                <Button
                  variant={side === "BUY" ? "default" : "outline"}
                  size="sm"
                  className={cn("h-7 text-[10px]", side === "BUY" && "bg-emerald-500 hover:bg-emerald-600 text-white")}
                  onClick={() => setSide("BUY")}
                >BUY</Button>
                <Button
                  variant={side === "SELL" ? "default" : "outline"}
                  size="sm"
                  className={cn("h-7 text-[10px]", side === "SELL" && "bg-rose-500 hover:bg-rose-600 text-white")}
                  onClick={() => setSide("SELL")}
                >SELL</Button>
              </div>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Total Qty</Label>
              <Input type="number" value={totalQty} onChange={(e) => setTotalQty(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Duration (sec)</Label>
              <Input type="number" value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
          </div>

          {/* Algo-specific params */}
          {(type === "TWAP" || type === "VWAP") && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Slices</Label>
                <Input type="number" value={slices} onChange={(e) => setSlices(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
              <div className="col-span-3 text-[10px] text-muted-foreground self-end pb-2">
                Each slice = {durationSec / slices}s apart, {(totalQty / slices).toFixed(1)} contracts per slice
                {type === "VWAP" && " (weighted by volume curve)"}
              </div>
            </div>
          )}

          {type === "ICEBERG" && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Visible Qty</Label>
                <Input type="number" value={visibleQty} onChange={(e) => setVisibleQty(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
              <div className="col-span-3 text-[10px] text-muted-foreground self-end pb-2">
                Refills every 2s with up to {visibleQty} contracts until {totalQty} filled
              </div>
            </div>
          )}

          {type === "POV" && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Target % of Vol</Label>
                <Input type="number" step="0.05" min="0.01" max="0.5" value={targetPct} onChange={(e) => setTargetPct(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
              <div className="col-span-3 text-[10px] text-muted-foreground self-end pb-2">
                Participates at {(targetPct * 100).toFixed(0)}% of real-time volume
              </div>
            </div>
          )}

          {type === "IS" && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="col-span-2">
                <Label className="text-[10px] text-muted-foreground">Urgency</Label>
                <div className="grid grid-cols-3 gap-1 mt-0.5">
                  {(["LOW", "MEDIUM", "HIGH"] as const).map((u) => (
                    <Button
                      key={u}
                      variant={urgency === u ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-[10px]"
                      onClick={() => setUrgency(u)}
                    >
                      {u}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="col-span-2 text-[10px] text-muted-foreground self-end pb-2">
                {urgency === "HIGH" ? "Aggressive front-loading, pays spread" : urgency === "LOW" ? "Passive back-loading, joins queue" : "Even participation"}
              </div>
            </div>
          )}

          <Button className="w-full" onClick={handleStart}>
            <Zap className="w-3 h-3 mr-1" /> Launch {type} Algo: {side} {totalQty} {symbol}
          </Button>
        </CardContent>
      </Card>

      {/* Active algos summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3"><div className="text-[10px] text-muted-foreground">Running</div><div className="text-lg font-mono font-semibold text-emerald-400">{runningCount}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground">Completed</div><div className="text-lg font-mono font-semibold text-blue-400">{completedCount}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground">Total Started</div><div className="text-lg font-mono font-semibold">{algos.length}</div></Card>
      </div>

      {/* Algo table */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Active Algorithms</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-2">Started</th>
                  <th className="text-left py-2 px-2">Type</th>
                  <th className="text-left py-2 px-2">Symbol</th>
                  <th className="text-left py-2 px-2">Side</th>
                  <th className="text-right py-2 px-2">Total</th>
                  <th className="text-right py-2 px-2">Filled</th>
                  <th className="text-right py-2 px-2">Avg Price</th>
                  <th className="text-right py-2 px-2">Bench</th>
                  <th className="text-right py-2 px-2">Slip (bps)</th>
                  <th className="text-right py-2 px-2">Progress</th>
                  <th className="text-center py-2 px-2">Status</th>
                  <th className="text-center py-2 px-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {algos.length === 0 ? (
                  <tr><td colSpan={12} className="text-center py-8 text-muted-foreground text-xs">No algos started. Configure and launch one above.</td></tr>
                ) : (
                  algos.map((a) => {
                    const progress = a.params.totalQty > 0 ? (a.filledQty / a.params.totalQty) * 100 : 0;
                    return (
                      <tr key={a.id} className="border-b border-border/40 hover:bg-muted/30">
                        <td className="py-1.5 px-2 font-mono text-[10px] text-muted-foreground">{fmtTime(a.startedAt)}</td>
                        <td className="py-1.5 px-2 font-medium">{a.type}</td>
                        <td className="py-1.5 px-2 font-mono">{a.params.symbol}</td>
                        <td className={cn("py-1.5 px-2 font-medium", a.params.side === "BUY" ? "text-emerald-400" : "text-rose-400")}>{a.params.side}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{a.params.totalQty}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-foreground">{a.filledQty}</td>
                        <td className="py-1.5 px-2 text-right font-mono">{a.avgFillPrice > 0 ? fmtPrice(a.avgFillPrice, 2) : "—"}</td>
                        <td className="py-1.5 px-2 text-right font-mono text-muted-foreground">{a.benchmarkPrice ? fmtPrice(a.benchmarkPrice, 2) : "—"}</td>
                        <td className={cn("py-1.5 px-2 text-right font-mono", (a.slippageBps ?? 0) > 0 ? "text-rose-400" : (a.slippageBps ?? 0) < 0 ? "text-emerald-400" : "text-muted-foreground")}>
                          {a.slippageBps != null ? a.slippageBps.toFixed(1) : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono">
                          <div className="flex items-center gap-1.5 justify-end">
                            <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={cn("h-full", a.status === "COMPLETED" ? "bg-blue-500" : "bg-emerald-500")} style={{ width: `${progress}%` }} />
                            </div>
                            <span className="text-[10px] tabular-nums">{progress.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <Badge variant="outline" className={cn("text-[9px] h-4 px-1 font-mono", STATUS_COLORS[a.status])}>{a.status}</Badge>
                        </td>
                        <td className="py-1.5 px-2 text-center whitespace-nowrap">
                          {a.status === "RUNNING" && (
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => pauseAlgo(a.id)} title="Pause">
                              <Pause className="w-3 h-3" />
                            </Button>
                          )}
                          {a.status === "PAUSED" && (
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => resumeAlgo(a.id)} title="Resume">
                              <Play className="w-3 h-3" />
                            </Button>
                          )}
                          {(a.status === "RUNNING" || a.status === "PAUSED" || a.status === "QUEUED") && (
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400" onClick={() => cancelAlgo(a.id)} title="Cancel">
                              <Square className="w-3 h-3" />
                            </Button>
                          )}
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

      {/* Algo log */}
      {algos.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Algorithm Activity Log</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-y-auto max-h-72 font-mono text-[11px]">
              {algos.flatMap((a) =>
                a.log.slice(-20).map((entry, i) => (
                  <div key={`${a.id}-${i}`} className="px-3 py-1 border-b border-border/30 hover:bg-muted/30 flex items-start gap-2">
                    <span className="text-muted-foreground text-[10px] tabular-nums shrink-0">{fmtTime(entry.time)}</span>
                    <Badge variant="outline" className="text-[9px] h-3.5 px-1 shrink-0">{a.type}</Badge>
                    <span className="text-[10px] text-muted-foreground shrink-0">{a.params.symbol}</span>
                    <span className="text-foreground flex-1">{entry.message}</span>
                  </div>
                )),
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
