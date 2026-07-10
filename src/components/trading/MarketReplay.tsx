"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS, getContract } from "@/lib/trading/contracts";
import {
  SCENARIO_LIBRARY, createReplayState, stepReplay, placeReplayTrade,
  flattenReplay, resetReplay, getPlaybackInterval, computeReplayMetrics,
  type ReplayState, type PlaybackSpeed, type ReplayScenario, type ScenarioType,
} from "@/lib/trading/market-replay";
import { fmtMoney, fmtPrice, fmtPct, fmtTime, decimalsFor } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  Activity, AlertTriangle, Brain, Eye, FastForward, Flame, Pause, Play,
  RotateCcw, SkipForward, Target, TrendingDown, TrendingUp, Zap,
} from "lucide-react";

const EXTREME_TYPES: ScenarioType[] = ["FLASH_CRASH", "VOLMAGGEDDON", "COVID_CRASH", "SWISS_FRANC_UNPEG", "SVB_COLLAPSE"];
const NEWS_TYPES: ScenarioType[] = ["FOMC_DECISION", "NFP_RELEASE"];

function getScenarioBadgeType(type: ScenarioType): "EXTREME" | "NEWS" | "NORMAL" {
  if (EXTREME_TYPES.includes(type)) return "EXTREME";
  if (NEWS_TYPES.includes(type)) return "NEWS";
  return "NORMAL";
}

const SPEEDS: { value: PlaybackSpeed; label: string }[] = [
  { value: 0.5, label: "0.5×" },
  { value: 1, label: "1×" },
  { value: 2, label: "2×" },
  { value: 5, label: "5×" },
  { value: 10, label: "10×" },
  { value: 0, label: "Instant" },
];

export function MarketReplay() {
  const [scenario, setScenario] = useState<ReplayScenario | null>(null);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [tradeQty, setTradeQty] = useState(1);
  const [showObjective, setShowObjective] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);

  // Load scenario
  const loadScenario = (sc: ReplayScenario) => {
    setScenario(sc);
    setReplay(createReplayState(sc, 100000));
    setSpeed(1);
    selectSymbol(sc.symbol);
  };

  // Playback control
  const play = useCallback(() => {
    if (!replay || replay.status === "COMPLETED") return;
    setReplay((prev) => prev ? { ...prev, status: "PLAYING", startedAt: prev.startedAt ?? Date.now() } : null);
  }, [replay]);

  const pause = useCallback(() => {
    setReplay((prev) => prev ? { ...prev, status: "PAUSED" } : null);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const step = useCallback(() => {
    setReplay((prev) => prev ? stepReplay(prev) : null);
  }, []);

  const reset = useCallback(() => {
    setReplay((prev) => prev ? resetReplay(prev) : null);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Auto-step when playing
  useEffect(() => {
    if (!replay || replay.status !== "PLAYING") {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    // Instant mode uses 1ms interval; other modes use their respective intervals
    const interval = speed === 0 ? 1 : getPlaybackInterval(speed);
    intervalRef.current = setInterval(() => {
      setReplay((prev) => {
        if (!prev || prev.status !== "PLAYING") return prev;
        const next = stepReplay(prev);
        if (next.status === "COMPLETED" && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return next;
      });
    }, interval);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [replay?.status, speed]);

  // Trading actions
  const buy = () => {
    if (!replay) return;
    setReplay(placeReplayTrade(replay, "BUY", tradeQty));
  };
  const sell = () => {
    if (!replay) return;
    setReplay(placeReplayTrade(replay, "SELL", tradeQty));
  };
  const flatten = () => {
    if (!replay) return;
    setReplay(flattenReplay(replay));
  };

  const metrics = replay ? computeReplayMetrics(replay) : null;
  const decimals = scenario ? decimalsFor(scenario.symbol) : 2;
  const currentCandle = replay?.candles[replay.currentBar - 1];
  const visibleCandles = replay ? replay.candles.slice(0, replay.currentBar) : [];
  const progressPct = replay ? (replay.currentBar / replay.totalBars) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Scenario selector */}
      {!replay && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Brain className="w-4 h-4" /> Historical Scenario Library</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {SCENARIO_LIBRARY.map((sc) => (
              <button
                key={sc.id}
                onClick={() => loadScenario(sc)}
                className={cn(
                  "text-left p-3 rounded-md border transition-colors",
                  "border-border bg-muted/30 hover:bg-muted/50 hover:border-primary/30",
                )}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold">{sc.name}</span>
                  {getScenarioBadgeType(sc.type) === "EXTREME" ? (
                    <Badge variant="outline" className="text-[9px] bg-rose-500/15 text-rose-400 border-rose-500/30 shrink-0">EXTREME</Badge>
                  ) : getScenarioBadgeType(sc.type) === "NEWS" ? (
                    <Badge variant="outline" className="text-[9px] bg-amber-500/15 text-amber-400 border-amber-500/30 shrink-0">NEWS</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[9px] bg-blue-500/15 text-blue-400 border-blue-500/30 shrink-0">NORMAL</Badge>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground line-clamp-3">{sc.description}</p>
                <div className="flex items-center gap-2 mt-1.5 text-[10px] font-mono text-muted-foreground">
                  <span>{sc.symbol}</span>
                  <span>·</span>
                  <span>{sc.date}</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Replay interface */}
      {replay && scenario && (
        <>
          {/* Header with scenario info */}
          <Card className={cn("border", getScenarioBadgeType(scenario.type) === "EXTREME" ? "border-rose-500/30 bg-rose-500/5" : getScenarioBadgeType(scenario.type) === "NEWS" ? "border-amber-500/30 bg-amber-500/5" : "border-border")}>
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {scenario.type === "FLASH_CRASH" && <Flame className="w-4 h-4 text-rose-500" />}
                    <span className="text-sm font-semibold">{scenario.name}</span>
                    <Badge variant="outline" className="text-[9px]">{scenario.symbol}</Badge>
                    <Badge variant="outline" className="text-[9px]">{scenario.date}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{scenario.description}</p>
                </div>
                <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => { reset(); setReplay(null); setScenario(null); }}>
                  ← Back to Scenarios
                </Button>
              </div>
              {showObjective && (
                <div className="mt-2 flex items-start gap-2 p-2 border border-border/40 rounded-md bg-muted/20">
                  <Target className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Learning Objective</div>
                    <p className="text-xs mt-0.5">{scenario.learningObjective}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="h-6 text-[10px] shrink-0" onClick={() => setShowObjective(false)}>Hide</Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Playback controls + progress */}
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                {replay.status === "PLAYING" ? (
                  <Button size="sm" onClick={pause} className="h-8"><Pause className="w-3.5 h-3.5 mr-1" /> Pause</Button>
                ) : (
                  <Button size="sm" onClick={play} className="h-8" disabled={replay.status === "COMPLETED"}><Play className="w-3.5 h-3.5 mr-1" /> Play</Button>
                )}
                <Button size="sm" variant="outline" onClick={step} className="h-8" disabled={replay.status === "COMPLETED"}><SkipForward className="w-3.5 h-3.5 mr-1" /> Step</Button>
                <Button size="sm" variant="outline" onClick={reset} className="h-8"><RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset</Button>
                <div className="flex items-center gap-1 ml-2">
                  <FastForward className="w-3.5 h-3.5 text-muted-foreground" />
                  {SPEEDS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setSpeed(s.value)}
                      className={cn("px-2 py-1 text-xs rounded", speed === s.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/40")}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="flex-1" />
                <Badge variant="outline" className={cn("text-[10px]", replay.status === "PLAYING" ? "bg-emerald-500/15 text-emerald-400" : replay.status === "COMPLETED" ? "bg-blue-500/15 text-blue-400" : "bg-muted")}>
                  {replay.status}
                </Badge>
              </div>
              {/* Progress bar */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-muted-foreground w-16">{replay.currentBar} / {replay.totalBars}</span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div className={cn("h-full transition-all", replay.status === "COMPLETED" ? "bg-blue-500" : "bg-primary")} style={{ width: `${progressPct}%` }} />
                </div>
                <span className="text-[10px] font-mono text-muted-foreground w-12 text-right">{progressPct.toFixed(0)}%</span>
              </div>
            </CardContent>
          </Card>

          {/* Live chart + trading panel */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            {/* Chart */}
            <Card className="lg:col-span-3">
              <CardHeader className="py-2 flex flex-row items-center justify-between">
                <CardTitle className="text-xs flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5" /> {scenario.symbol} — Replay Chart
                </CardTitle>
                {currentCandle && (
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-mono">Last: <span className="font-bold">{fmtPrice(currentCandle.close, decimals)}</span></span>
                    <span className={cn("font-mono", currentCandle.close >= currentCandle.open ? "text-emerald-400" : "text-rose-400")}>
                      {currentCandle.close >= currentCandle.open ? "▲" : "▼"} {fmtPrice(Math.abs(currentCandle.close - currentCandle.open), decimals)}
                    </span>
                  </div>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={visibleCandles.map((c, i) => ({
                      time: fmtTime(c.time),
                      open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
                      range: [c.low, c.high],
                      bodyRange: [Math.min(c.open, c.close), Math.max(c.open, c.close)],
                      isUp: c.close >= c.open,
                      barIdx: i,
                    }))} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.15} />
                      <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.max(1, Math.floor(visibleCandles.length / 10))} />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={60} orientation="right" />
                      <Tooltip content={<ReplayCandleTooltip decimals={decimals} />} />
                      <Bar dataKey="range" fill="transparent" stroke="#666" strokeWidth={0.5}>
                        {visibleCandles.map((d: any, i: number) => <Cell key={i} stroke={d.isUp ? "#10b981" : "#ef4444"} />)}
                      </Bar>
                      <Bar dataKey="bodyRange" strokeWidth={0}>
                        {visibleCandles.map((d: any, i: number) => <Cell key={i} fill={d.isUp ? "#10b981" : "#ef4444"} />)}
                      </Bar>
                      {/* Key levels */}
                      {scenario.keyLevels.map((kl, i) => {
                        const basePrice = replay.candles[0]?.close ?? 1;
                        const levelPrice = basePrice * kl.price;
                        return <ReferenceLine key={i} y={levelPrice} stroke="#fbbf24" strokeDasharray="2 2" strokeOpacity={0.4} label={{ value: kl.label, fontSize: 9, fill: "#fbbf24" }} />;
                      })}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {/* Volume subchart */}
                <div className="h-[50px] mt-1 border-t border-border/40 pt-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={visibleCandles.map((c) => ({ time: fmtTime(c.time), volume: c.volume, isUp: c.close >= c.open }))} margin={{ top: 0, right: 5, left: 0, bottom: 0 }}>
                      <XAxis dataKey="time" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} interval={Math.max(1, Math.floor(visibleCandles.length / 8))} />
                      <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} width={60} orientation="right" />
                      <Bar dataKey="volume" radius={[1, 1, 0, 0]}>
                        {visibleCandles.map((c, i) => <Cell key={i} fill={c.close >= c.open ? "#10b98155" : "#ef444455"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Trading panel */}
            <Card>
              <CardHeader className="py-2"><CardTitle className="text-xs">Replay Trading</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {/* Position info */}
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Position</span><span className={cn("font-mono font-bold", replay.position > 0 ? "text-emerald-400" : replay.position < 0 ? "text-rose-400" : "")}>{replay.position > 0 ? "+" : ""}{replay.position}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Avg Entry</span><span className="font-mono">{replay.position !== 0 ? fmtPrice(replay.avgEntryPrice, decimals) : "—"}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Unrealized</span><span className={cn("font-mono", replay.unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtMoney(replay.unrealizedPnL, 0)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Realized</span><span className={cn("font-mono", replay.realizedPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>{fmtMoney(replay.realizedPnL, 0)}</span></div>
                  <div className="border-t border-border/40 pt-1 flex justify-between"><span className="text-muted-foreground">Equity</span><span className="font-mono font-bold">{fmtMoney(replay.startingEquity + replay.realizedPnL + replay.unrealizedPnL, 0)}</span></div>
                </div>
                {/* Trade buttons */}
                <div>
                  <Label className="text-[10px] text-muted-foreground">Quantity</Label>
                  <Input type="number" value={tradeQty} onChange={(e) => setTradeQty(Math.max(1, Number(e.target.value)))} className="h-8 text-xs font-mono mt-0.5" />
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <Button size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white" onClick={buy} disabled={replay.status === "COMPLETED"}>
                    <TrendingUp className="w-3 h-3 mr-1" /> BUY
                  </Button>
                  <Button size="sm" className="bg-rose-500 hover:bg-rose-600 text-white" onClick={sell} disabled={replay.status === "COMPLETED"}>
                    <TrendingDown className="w-3 h-3 mr-1" /> SELL
                  </Button>
                </div>
                <Button size="sm" variant="outline" className="w-full text-rose-400" onClick={flatten} disabled={replay.position === 0}>
                  <Zap className="w-3 h-3 mr-1" /> FLATTEN
                </Button>
                {/* Bid/Ask */}
                {replay.quote && (
                  <div className="border border-border/40 rounded-md p-2 text-xs font-mono space-y-0.5">
                    <div className="flex justify-between"><span className="text-muted-foreground">Bid</span><span className="text-emerald-400">{fmtPrice(replay.quote.bid, decimals)} × {replay.quote.bidSize}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Ask</span><span className="text-rose-400">{fmtPrice(replay.quote.ask, decimals)} × {replay.quote.askSize}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Spread</span><span>{fmtPrice(replay.quote.ask - replay.quote.bid, decimals)}</span></div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Performance metrics */}
          {metrics && (
            <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-8 gap-2">
              <Metric label="Equity" value={fmtMoney(metrics.finalEquity, 0)} good={metrics.totalReturn > 0} bad={metrics.totalReturn < 0} />
              <Metric label="Return" value={fmtPct(metrics.totalReturnPct)} good={metrics.totalReturnPct > 0} bad={metrics.totalReturnPct < 0} />
              <Metric label="Sharpe" value={metrics.sharpe.toFixed(2)} good={metrics.sharpe > 1} />
              <Metric label="Max DD" value={fmtMoney(metrics.maxDrawdown, 0)} bad={metrics.maxDrawdown < -5000} />
              <Metric label="Trades" value={String(metrics.totalTrades)} />
              <Metric label="Win Rate" value={`${metrics.winRate.toFixed(0)}%`} good={metrics.winRate > 50} />
              <Metric label="Best" value={fmtMoney(metrics.bestTrade, 0)} good={metrics.bestTrade > 0} />
              <Metric label="Worst" value={fmtMoney(metrics.worstTrade, 0)} bad={metrics.worstTrade < 0} />
            </div>
          )}

          {/* Equity curve */}
          {replay.equityCurve.length > 2 && (
            <Card>
              <CardHeader className="py-2"><CardTitle className="text-xs">Replay Equity Curve</CardTitle></CardHeader>
              <CardContent>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={replay.equityCurve.map((e) => ({ bar: e.bar, equity: e.equity }))}>
                      <defs>
                        <linearGradient id="replayEq" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                      <XAxis dataKey="bar" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={60} orientation="right" domain={["auto", "auto"]} />
                      <Tooltip formatter={(v: any) => fmtMoney(Number(v), 0)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                      <ReferenceLine y={replay.startingEquity} stroke="#666" strokeDasharray="4 4" strokeOpacity={0.5} />
                      <Area type="monotone" dataKey="equity" stroke="#3b82f6" strokeWidth={2} fill="url(#replayEq)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Trade log */}
          {replay.trades.length > 0 && (
            <Card>
              <CardHeader className="py-2"><CardTitle className="text-xs">Replay Trade Log ({replay.trades.length})</CardTitle></CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-y border-border sticky top-0">
                      <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                        <th className="text-left py-2 px-3">Bar</th>
                        <th className="text-left py-2 px-3">Side</th>
                        <th className="text-right py-2 px-3">Qty</th>
                        <th className="text-right py-2 px-3">Price</th>
                        <th className="text-right py-2 px-3">P&L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {replay.trades.slice().reverse().map((t, i) => (
                        <tr key={i} className="border-b border-border/40">
                          <td className="py-1.5 px-3 font-mono text-[10px] text-muted-foreground">{t.barIndex}</td>
                          <td className={cn("py-1.5 px-3 font-medium", t.side === "BUY" ? "text-emerald-400" : "text-rose-400")}>{t.side}</td>
                          <td className="py-1.5 px-3 text-right font-mono">{t.qty}</td>
                          <td className="py-1.5 px-3 text-right font-mono">{fmtPrice(t.price, decimals)}</td>
                          <td className={cn("py-1.5 px-3 text-right font-mono", t.pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>{t.pnl >= 0 ? "+" : ""}{fmtMoney(t.pnl, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Completion summary */}
          {replay.status === "COMPLETED" && metrics && (
            <Card className={cn("border", metrics.totalReturn >= 0 ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5")}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  {metrics.totalReturn >= 0 ? <TrendingUp className="w-6 h-6 text-emerald-400" /> : <TrendingDown className="w-6 h-6 text-rose-400" />}
                  <div className="flex-1">
                    <div className="text-sm font-semibold">Replay Complete — {metrics.totalReturn >= 0 ? "Profitable" : "Unprofitable"} Session</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Final equity: {fmtMoney(metrics.finalEquity, 0)} · Return: {fmtPct(metrics.totalReturnPct)} · Sharpe: {metrics.sharpe.toFixed(2)} · Win rate: {metrics.winRate.toFixed(0)}% · {metrics.totalTrades} trades · Max DD: {fmtMoney(metrics.maxDrawdown, 0)}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={reset}><RotateCcw className="w-3 h-3 mr-1" /> Replay Again</Button>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function ReplayCandleTooltip({ active, payload, decimals }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-card border border-border rounded-md p-2 text-xs shadow-lg">
      <div className="font-mono text-muted-foreground mb-1">{d.time}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
        <span className="text-muted-foreground">O:</span><span>{fmtPrice(d.open, decimals)}</span>
        <span className="text-muted-foreground">H:</span><span className="text-emerald-400">{fmtPrice(d.high, decimals)}</span>
        <span className="text-muted-foreground">L:</span><span className="text-rose-400">{fmtPrice(d.low, decimals)}</span>
        <span className="text-muted-foreground">C:</span><span className={d.isUp ? "text-emerald-400" : "text-rose-400"}>{fmtPrice(d.close, decimals)}</span>
        <span className="text-muted-foreground">Vol:</span><span>{d.volume?.toLocaleString()}</span>
        <span className="text-muted-foreground">Bar:</span><span>{d.barIdx}</span>
      </div>
    </div>
  );
}

function Metric({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <Card className={cn("p-2 border", good && "border-emerald-500/30 bg-emerald-500/5", bad && "border-rose-500/30 bg-rose-500/5")}>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-sm font-mono font-semibold tabular-nums mt-0.5", good && "text-emerald-400", bad && "text-rose-400")}>{value}</div>
    </Card>
  );
}
