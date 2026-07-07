/**
 * Multi-Timeframe Aggregation Engine
 *
 * The MarketEngine produces 1-minute candles natively. This engine resamples
 * them into 1-second (synthetic), 1-minute, 5-minute, 15-minute, 30-minute,
 * and 1-hour candles for the Indicators Lab.
 *
 * For 1-second timeframe, we interpolate from the tick stream by generating
 * synthetic sub-minute candles between the latest known prices.
 */
import { getEngine } from "./market-engine";
import type { Candle } from "./types";

export type Timeframe = "1s" | "1m" | "5m" | "15m" | "30m" | "1h";

export const TIMEFRAMES: { value: Timeframe; label: string; seconds: number }[] = [
  { value: "1s", label: "1 Second", seconds: 1 },
  { value: "1m", label: "1 Minute", seconds: 60 },
  { value: "5m", label: "5 Minutes", seconds: 300 },
  { value: "15m", label: "15 Minutes", seconds: 900 },
  { value: "30m", label: "30 Minutes", seconds: 1800 },
  { value: "1h", label: "1 Hour", seconds: 3600 },
];

/**
 * Get candles for a specific timeframe for a symbol.
 * Uses the 1-minute candles from the engine and aggregates them.
 * For 1s, generates synthetic 1-second candles by interpolating.
 */
export function getCandlesForTimeframe(symbol: string, tf: Timeframe, lookback: number = 200): Candle[] {
  const engine = getEngine();
  // Get more 1-minute candles than needed so we have enough after aggregation
  const sourceCount = tf === "1s" ? Math.ceil(lookback / 60) + 60 : Math.ceil(lookback * (tf === "1m" ? 1 : tf === "5m" ? 5 : tf === "15m" ? 15 : tf === "30m" ? 30 : 60)) + 60;
  const sourceCandles = engine.getCandles(symbol, Math.min(500, sourceCount));
  if (sourceCandles.length === 0) return [];
  if (tf === "1m") {
    return sourceCandles.slice(-lookback);
  }
  if (tf === "1s") {
    return generate1sCandles(sourceCandles, lookback, symbol);
  }
  // Aggregate
  const tfSeconds = TIMEFRAMES.find((t) => t.value === tf)!.seconds;
  return aggregateCandles(sourceCandles, tfSeconds, lookback);
}

/**
 * Aggregate 1-minute candles into larger timeframe candles.
 */
function aggregateCandles(source: Candle[], tfSeconds: number, lookback: number): Candle[] {
  const out: Candle[] = [];
  const buckets = new Map<number, Candle[]>();
  for (const c of source) {
    const bucketTime = Math.floor(c.time / (tfSeconds * 1000)) * (tfSeconds * 1000);
    if (!buckets.has(bucketTime)) buckets.set(bucketTime, []);
    buckets.get(bucketTime)!.push(c);
  }
  const sortedTimes = Array.from(buckets.keys()).sort((a, b) => a - b);
  for (const t of sortedTimes) {
    const group = buckets.get(t)!;
    if (group.length === 0) continue;
    const open = group[0].open;
    const close = group[group.length - 1].close;
    const high = Math.max(...group.map((c) => c.high));
    const low = Math.min(...group.map((c) => c.low));
    const volume = group.reduce((s, c) => s + c.volume, 0);
    out.push({ time: t, open, high, low, close, volume });
  }
  return out.slice(-lookback);
}

/**
 * Generate synthetic 1-second candles by interpolating between 1-minute closes.
 * Uses the market engine's current price as the latest point.
 */
function generate1sCandles(source: Candle[], lookback: number, symbol: string): Candle[] {
  if (source.length < 2) return [];
  const out: Candle[] = [];
  const quote = getEngine().getQuote(symbol);
  const lastPrice = quote?.last ?? source[source.length - 1].close;
  // Use last ~3 minutes of 1-min candles to generate 1-second candles
  const recent = source.slice(-3);
  // Generate 1-second candles from the closes
  const prices: { time: number; price: number }[] = [];
  for (const c of recent) {
    prices.push({ time: c.time, price: c.close });
  }
  prices.push({ time: Date.now(), price: lastPrice });
  // Interpolate between each pair
  for (let i = 0; i < prices.length - 1; i++) {
    const start = prices[i];
    const end = prices[i + 1];
    const dur = end.time - start.time;
    const steps = Math.max(1, Math.floor(dur / 1000));
    for (let s = 0; s < steps; s++) {
      const t = start.time + s * 1000;
      const pct = s / steps;
      // Add small random noise for realism
      const noise = (Math.random() - 0.5) * Math.abs(end.price - start.price) * 0.1;
      const px = start.price + (end.price - start.price) * pct + noise;
      const prevPx = s === 0 ? start.price : start.price + (end.price - start.price) * ((s - 1) / steps);
      const high = Math.max(px, prevPx) + Math.abs(noise) * 0.5;
      const low = Math.min(px, prevPx) - Math.abs(noise) * 0.5;
      out.push({
        time: t,
        open: prevPx,
        high,
        low,
        close: px,
        volume: Math.floor(Math.random() * 50) + 10,
      });
    }
  }
  return out.slice(-lookback);
}
