"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from "recharts";
import { getEngine } from "@/lib/trading/market-engine";
import { useTradingStore } from "@/lib/trading/store";
import { atr, bollingerBands, ema, macd, rsi, sma, vwap } from "@/lib/trading/indicators";
import { getContract } from "@/lib/trading/contracts";
import { fmtPrice, fmtTime } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OrderBook } from "./OrderBook";
import { cn } from "@/lib/utils";
import { CandlestickChart, LineChart as LineIcon, Activity } from "lucide-react";

type IndicatorId = "sma20" | "sma50" | "ema9" | "ema21" | "bollinger" | "vwap" | "rsi" | "macd" | "atr" | "volume";

const INDICATORS: { id: IndicatorId; label: string; group: string }[] = [
  { id: "sma20", label: "SMA 20", group: "Overlay" },
  { id: "sma50", label: "SMA 50", group: "Overlay" },
  { id: "ema9", label: "EMA 9", group: "Overlay" },
  { id: "ema21", label: "EMA 21", group: "Overlay" },
  { id: "bollinger", label: "Bollinger (20,2)", group: "Overlay" },
  { id: "vwap", label: "VWAP", group: "Overlay" },
  { id: "rsi", label: "RSI (14)", group: "Oscillator" },
  { id: "macd", label: "MACD", group: "Oscillator" },
  { id: "atr", label: "ATR (14)", group: "Oscillator" },
  { id: "volume", label: "Volume", group: "Volume" },
];

const TIMEFRAMES = [
  { label: "1m", value: 1 },
  { label: "5m", value: 5 },
  { label: "15m", value: 15 },
  { label: "1H", value: 60 },
];

export function ChartPanel({ symbol }: { symbol: string }) {
  const quotes = useTradingStore((s) => s.quotes);
  const [activeIndicators, setActiveIndicators] = useState<Set<IndicatorId>>(new Set(["sma20", "vwap", "rsi", "volume"]));
  const [chartType, setChartType] = useState<"candle" | "line">("candle");
  const [lookback, setLookback] = useState(150);

  const contract = getContract(symbol);
  const quote = quotes[symbol];
  const candles = useMemo(() => getEngine().getCandles(symbol, lookback), [symbol, lookback, quotes]);

  const decimals = symbol === "BRR" ? 0 : symbol === "6E" || symbol === "6B" || symbol === "NG" ? 4 : 2;

  // Compute indicators
  const closes = candles.map((c) => c.close);
  const sma20 = activeIndicators.has("sma20") ? sma(closes, 20) : [];
  const sma50 = activeIndicators.has("sma50") ? sma(closes, 50) : [];
  const ema9 = activeIndicators.has("ema9") ? ema(closes, 9) : [];
  const ema21 = activeIndicators.has("ema21") ? ema(closes, 21) : [];
  const bb = activeIndicators.has("bollinger") ? bollingerBands(closes, 20, 2) : null;
  const vwapArr = activeIndicators.has("vwap") ? vwap(candles) : [];
  const rsiArr = activeIndicators.has("rsi") ? rsi(closes, 14) : [];
  const macdData = activeIndicators.has("macd") ? macd(closes) : null;
  const atrArr = activeIndicators.has("atr") ? atr(candles, 14) : [];

  const chartData = candles.map((c, i) => ({
    time: c.time,
    timeStr: fmtTime(c.time),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    range: [c.low, c.high],
    bodyRange: [Math.min(c.open, c.close), Math.max(c.open, c.close)],
    isUp: c.close >= c.open,
    sma20: sma20[i] ?? null,
    sma50: sma50[i] ?? null,
    ema9: ema9[i] ?? null,
    ema21: ema21[i] ?? null,
    bbUpper: bb?.upper[i] ?? null,
    bbMiddle: bb?.middle[i] ?? null,
    bbLower: bb?.lower[i] ?? null,
    vwap: vwapArr[i] ?? null,
    rsi: rsiArr[i] ?? null,
    macd: macdData?.macd[i] ?? null,
    macdSignal: macdData?.signal[i] ?? null,
    macdHist: macdData?.histogram[i] ?? null,
    atr: atrArr[i] ?? null,
  }));

  const toggle = (id: IndicatorId) => {
    setActiveIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-mono font-bold tabular-nums">{quote ? fmtPrice(quote.last, decimals) : "—"}</span>
            <span className={cn("text-sm font-mono", quote && quote.change >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {quote && quote.change >= 0 ? "+" : ""}{quote ? fmtPrice(quote.change, decimals) : ""} ({quote ? quote.changePct.toFixed(2) : ""}%)
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {contract.name} · {contract.exchange} · Tick {contract.tickSize} · ${contract.tickValue}/tick
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center bg-muted/50 rounded-md p-0.5">
            <Button size="sm" variant={chartType === "candle" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setChartType("candle")}>
              <CandlestickChart className="w-3.5 h-3.5 mr-1" /> Candles
            </Button>
            <Button size="sm" variant={chartType === "line" ? "default" : "ghost"} className="h-7 text-xs" onClick={() => setChartType("line")}>
              <LineIcon className="w-3.5 h-3.5 mr-1" /> Line
            </Button>
          </div>
          <select
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value))}
            className="bg-muted/50 border border-border rounded-md px-2 py-1 text-xs h-8"
          >
            <option value={75}>75 bars</option>
            <option value={150}>150 bars</option>
            <option value={250}>250 bars</option>
            <option value={500}>500 bars</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Main chart */}
        <Card className="lg:col-span-3">
          <CardHeader className="py-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs font-medium flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" /> {symbol} · 1-min
            </CardTitle>
            <div className="flex items-center gap-1">
              {INDICATORS.map((ind) => (
                <button
                  key={ind.id}
                  onClick={() => toggle(ind.id)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] rounded border transition-colors",
                    activeIndicators.has(ind.id)
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "bg-transparent text-muted-foreground border-border hover:bg-muted/40",
                  )}
                  title={`${ind.group}: ${ind.label}`}
                >
                  {ind.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                {chartType === "candle" ? (
                  <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                    <XAxis dataKey="timeStr" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(chartData.length / 8)} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={55} orientation="right" />
                    <Tooltip content={<CandleTooltip decimals={decimals} />} />
                    {/* Bollinger bands area */}
                    {bb && (
                      <>
                        <Line type="monotone" dataKey="bbUpper" stroke="#f59e0b" strokeWidth={1} dot={false} strokeOpacity={0.6} />
                        <Line type="monotone" dataKey="bbLower" stroke="#f59e0b" strokeWidth={1} dot={false} strokeOpacity={0.6} />
                        <Line type="monotone" dataKey="bbMiddle" stroke="#f59e0b" strokeWidth={1} dot={false} strokeOpacity={0.4} strokeDasharray="4 4" />
                      </>
                    )}
                    {activeIndicators.has("sma20") && <Line type="monotone" dataKey="sma20" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls />}
                    {activeIndicators.has("sma50") && <Line type="monotone" dataKey="sma50" stroke="#a855f7" strokeWidth={1.5} dot={false} connectNulls />}
                    {activeIndicators.has("ema9") && <Line type="monotone" dataKey="ema9" stroke="#06b6d4" strokeWidth={1.5} dot={false} connectNulls />}
                    {activeIndicators.has("ema21") && <Line type="monotone" dataKey="ema21" stroke="#ec4899" strokeWidth={1.5} dot={false} connectNulls />}
                    {activeIndicators.has("vwap") && <Line type="monotone" dataKey="vwap" stroke="#facc15" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="2 2" />}
                    {/* Candle wicks */}
                    <Bar dataKey="range" fill="transparent" stroke="#666" strokeWidth={0.5}>
                      {chartData.map((d, i) => <Cell key={i} stroke={d.isUp ? "#10b981" : "#ef4444"} />)}
                    </Bar>
                    {/* Candle bodies */}
                    <Bar dataKey="bodyRange" strokeWidth={0}>
                      {chartData.map((d, i) => <Cell key={i} fill={d.isUp ? "#10b981" : "#ef4444"} />)}
                    </Bar>
                    {quote && (
                      <ReferenceLine y={quote.last} stroke="#fbbf24" strokeDasharray="4 4" strokeWidth={1} />
                    )}
                  </BarChart>
                ) : (
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                    <XAxis dataKey="timeStr" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(chartData.length / 8)} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={55} orientation="right" />
                    <Tooltip content={<CandleTooltip decimals={decimals} />} />
                    <Area type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={1.5} fill="url(#lineGrad)" dot={false} />
                    {activeIndicators.has("sma20") && <Line type="monotone" dataKey="sma20" stroke="#a855f7" strokeWidth={1.5} dot={false} connectNulls />}
                    {activeIndicators.has("vwap") && <Line type="monotone" dataKey="vwap" stroke="#facc15" strokeWidth={1.5} dot={false} connectNulls strokeDasharray="2 2" />}
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Volume subchart */}
            {activeIndicators.has("volume") && (
              <div className="h-[80px] mt-1 border-t border-border/40 pt-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 0, right: 5, left: 0, bottom: 0 }}>
                    <XAxis dataKey="timeStr" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(chartData.length / 6)} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={55} orientation="right" />
                    <Bar dataKey="volume" radius={[2, 2, 0, 0]}>
                      {chartData.map((d, i) => <Cell key={i} fill={d.isUp ? "#10b98155" : "#ef444455"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* RSI subchart */}
            {activeIndicators.has("rsi") && (
              <div className="h-[100px] mt-1 border-t border-border/40 pt-1">
                <div className="text-[10px] text-muted-foreground mb-0.5">RSI (14)</div>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 0, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                    <XAxis dataKey="timeStr" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(chartData.length / 6)} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={55} orientation="right" />
                    <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="2 2" strokeOpacity={0.4} />
                    <ReferenceLine y={30} stroke="#10b981" strokeDasharray="2 2" strokeOpacity={0.4} />
                    <Line type="monotone" dataKey="rsi" stroke="#8b5cf6" strokeWidth={1.5} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* MACD subchart */}
            {activeIndicators.has("macd") && (
              <div className="h-[100px] mt-1 border-t border-border/40 pt-1">
                <div className="text-[10px] text-muted-foreground mb-0.5">MACD (12,26,9)</div>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 0, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                    <XAxis dataKey="timeStr" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(chartData.length / 6)} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={55} orientation="right" />
                    <ReferenceLine y={0} stroke="#666" />
                    <Bar dataKey="macdHist" radius={[1, 1, 0, 0]}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={(d.macdHist ?? 0) >= 0 ? "#10b98188" : "#ef444488"} />
                      ))}
                    </Bar>
                    <Line type="monotone" dataKey="macd" stroke="#3b82f6" strokeWidth={1.5} dot={false} connectNulls />
                    <Line type="monotone" dataKey="macdSignal" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* ATR subchart */}
            {activeIndicators.has("atr") && (
              <div className="h-[80px] mt-1 border-t border-border/40 pt-1">
                <div className="text-[10px] text-muted-foreground mb-0.5">ATR (14)</div>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 0, right: 5, left: 0, bottom: 0 }}>
                    <XAxis dataKey="timeStr" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(chartData.length / 6)} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={55} orientation="right" />
                    <Line type="monotone" dataKey="atr" stroke="#06b6d4" strokeWidth={1.5} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Order book side */}
        <div className="space-y-3">
          <OrderBook symbol={symbol} />
          <Card>
            <CardHeader className="py-2">
              <CardTitle className="text-xs">Contract Spec</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1 pt-0">
              <SpecRow label="Symbol" value={contract.symbol} />
              <SpecRow label="Exchange" value={contract.exchange} />
              <SpecRow label="Asset Class" value={contract.assetClass} />
              <SpecRow label="Tick Size" value={contract.tickSize.toString()} />
              <SpecRow label="Tick Value" value={`$${contract.tickValue}`} />
              <SpecRow label="Point Value" value={`$${contract.pointValue.toLocaleString()}`} />
              <SpecRow label="Contract Size" value={contract.contractSize.toLocaleString()} />
              <SpecRow label="Init Margin" value={`$${contract.marginInitial.toLocaleString()}`} />
              <SpecRow label="Maint Margin" value={`$${contract.marginMaintenance.toLocaleString()}`} />
              <SpecRow label="Settlement" value={contract.settlement} />
              <SpecRow label="Volatility (ann.)" value={`${(contract.volatility * 100).toFixed(1)}%`} />
              <SpecRow label="Drift (ann.)" value={`${(contract.drift * 100).toFixed(1)}%`} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/30 py-0.5 last:border-0">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span className="font-mono text-[11px]">{value}</span>
    </div>
  );
}

function CandleTooltip({ active, payload, decimals }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-card border border-border rounded-md p-2 text-xs shadow-lg">
      <div className="font-mono text-muted-foreground mb-1">{d.timeStr}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
        <span className="text-muted-foreground">O:</span><span className="text-foreground">{fmtPrice(d.open, decimals)}</span>
        <span className="text-muted-foreground">H:</span><span className="text-emerald-400">{fmtPrice(d.high, decimals)}</span>
        <span className="text-muted-foreground">L:</span><span className="text-rose-400">{fmtPrice(d.low, decimals)}</span>
        <span className="text-muted-foreground">C:</span><span className={d.isUp ? "text-emerald-400" : "text-rose-400"}>{fmtPrice(d.close, decimals)}</span>
        <span className="text-muted-foreground">Vol:</span><span className="text-foreground">{d.volume?.toLocaleString()}</span>
        {d.sma20 != null && <><span className="text-muted-foreground">SMA20:</span><span className="text-blue-400">{fmtPrice(d.sma20, decimals)}</span></>}
        {d.vwap != null && <><span className="text-muted-foreground">VWAP:</span><span className="text-yellow-400">{fmtPrice(d.vwap, decimals)}</span></>}
        {d.rsi != null && <><span className="text-muted-foreground">RSI:</span><span className="text-purple-400">{d.rsi.toFixed(1)}</span></>}
      </div>
    </div>
  );
}
