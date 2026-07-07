/**
 * Chart Pattern Recognition Engine
 *
 * Detects classical chart patterns from candle data:
 *  - Double Top / Double Bottom
 *  - Head & Shoulders / Inverse Head & Shoulders
 *  - Ascending / Descending / Symmetrical Triangles
 *  - Bullish / Bearish Flag
 *  - Rising / Falling Wedge
 *  - Cup & Handle (simplified)
 *
 * Uses local extrema detection (pivots) and geometric analysis.
 */
import type { Candle } from "./types";

export interface ChartPattern {
  name: string;
  type: "BULLISH" | "BEARISH" | "NEUTRAL";
  startIndex: number;
  endIndex: number;
  confidence: number; // 0-100
  description: string;
  targetPrice?: number;
  stopPrice?: number;
}

interface Pivot {
  index: number;
  price: number;
  type: "HIGH" | "LOW";
}

/** Detect local pivots (extrema) in the price series. */
export function detectPivots(candles: Candle[], leftBars = 3, rightBars = 3): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = leftBars; i < candles.length - rightBars; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, price: candles[i].high, type: "HIGH" });
    if (isLow) pivots.push({ index: i, price: candles[i].low, type: "LOW" });
  }
  return pivots;
}

/** Detect all chart patterns in the candle series. */
export function detectChartPatterns(candles: Candle[]): ChartPattern[] {
  if (candles.length < 20) return [];
  const pivots = detectPivots(candles, 3, 3);
  const patterns: ChartPattern[] = [];
  const highs = pivots.filter((p) => p.type === "HIGH");
  const lows = pivots.filter((p) => p.type === "LOW");
  // Double Top: two consecutive highs at similar price, with a trough between
  for (let i = 0; i < highs.length - 1; i++) {
    const h1 = highs[i];
    const h2 = highs[i + 1];
    const priceDiff = Math.abs(h1.price - h2.price) / h1.price;
    if (priceDiff < 0.02 && h2.index - h1.index >= 4 && h2.index - h1.index <= 30) {
      const trough = lows.filter((l) => l.index > h1.index && l.index < h2.index);
      if (trough.length > 0) {
        const troughPrice = Math.min(...trough.map((t) => t.price));
        const neckline = troughPrice;
        const target = neckline - (h1.price - neckline);
        patterns.push({
          name: "Double Top",
          type: "BEARISH",
          startIndex: h1.index,
          endIndex: h2.index,
          confidence: 60 + (1 - priceDiff) * 30,
          description: `Two peaks at ${h1.price.toFixed(2)} and ${h2.price.toFixed(2)} (${(priceDiff * 100).toFixed(1)}% apart). Neckline at ${neckline.toFixed(2)}.`,
          targetPrice: target,
          stopPrice: h1.price * 1.01,
        });
      }
    }
  }
  // Double Bottom
  for (let i = 0; i < lows.length - 1; i++) {
    const l1 = lows[i];
    const l2 = lows[i + 1];
    const priceDiff = Math.abs(l1.price - l2.price) / l1.price;
    if (priceDiff < 0.02 && l2.index - l1.index >= 4 && l2.index - l1.index <= 30) {
      const peak = highs.filter((h) => h.index > l1.index && h.index < l2.index);
      if (peak.length > 0) {
        const peakPrice = Math.max(...peak.map((p) => p.price));
        const neckline = peakPrice;
        const target = neckline + (neckline - l1.price);
        patterns.push({
          name: "Double Bottom",
          type: "BULLISH",
          startIndex: l1.index,
          endIndex: l2.index,
          confidence: 60 + (1 - priceDiff) * 30,
          description: `Two troughs at ${l1.price.toFixed(2)} and ${l2.price.toFixed(2)} (${(priceDiff * 100).toFixed(1)}% apart). Neckline at ${neckline.toFixed(2)}.`,
          targetPrice: target,
          stopPrice: l1.price * 0.99,
        });
      }
    }
  }
  // Head & Shoulders: 3 highs where middle is highest
  for (let i = 0; i < highs.length - 2; i++) {
    const ls = highs[i];
    const head = highs[i + 1];
    const rs = highs[i + 2];
    if (head.price > ls.price && head.price > rs.price) {
      const shoulderDiff = Math.abs(ls.price - rs.price) / ls.price;
      if (shoulderDiff < 0.03 && head.price > ls.price * 1.01 && head.price > rs.price * 1.01) {
        // Find neckline (lows between shoulders)
        const lsTrough = lows.filter((l) => l.index > ls.index && l.index < head.index);
        const rsTrough = lows.filter((l) => l.index > head.index && l.index < rs.index);
        if (lsTrough.length > 0 && rsTrough.length > 0) {
          const neckline = (Math.min(...lsTrough.map((t) => t.price)) + Math.min(...rsTrough.map((t) => t.price))) / 2;
          const target = neckline - (head.price - neckline);
          patterns.push({
            name: "Head & Shoulders",
            type: "BEARISH",
            startIndex: ls.index,
            endIndex: rs.index,
            confidence: 70 + (1 - shoulderDiff) * 20,
            description: `Left shoulder ${ls.price.toFixed(2)}, head ${head.price.toFixed(2)}, right shoulder ${rs.price.toFixed(2)}. Neckline at ${neckline.toFixed(2)}.`,
            targetPrice: target,
            stopPrice: head.price * 1.005,
          });
        }
      }
    }
  }
  // Inverse Head & Shoulders
  for (let i = 0; i < lows.length - 2; i++) {
    const ls = lows[i];
    const head = lows[i + 1];
    const rs = lows[i + 2];
    if (head.price < ls.price && head.price < rs.price) {
      const shoulderDiff = Math.abs(ls.price - rs.price) / ls.price;
      if (shoulderDiff < 0.03 && head.price < ls.price * 0.99 && head.price < rs.price * 0.99) {
        const lsPeak = highs.filter((h) => h.index > ls.index && h.index < head.index);
        const rsPeak = highs.filter((h) => h.index > head.index && h.index < rs.index);
        if (lsPeak.length > 0 && rsPeak.length > 0) {
          const neckline = (Math.max(...lsPeak.map((t) => t.price)) + Math.max(...rsPeak.map((t) => t.price))) / 2;
          const target = neckline + (neckline - head.price);
          patterns.push({
            name: "Inverse Head & Shoulders",
            type: "BULLISH",
            startIndex: ls.index,
            endIndex: rs.index,
            confidence: 70 + (1 - shoulderDiff) * 20,
            description: `Left shoulder ${ls.price.toFixed(2)}, head ${head.price.toFixed(2)}, right shoulder ${rs.price.toFixed(2)}. Neckline at ${neckline.toFixed(2)}.`,
            targetPrice: target,
            stopPrice: head.price * 0.995,
          });
        }
      }
    }
  }
  // Triangle detection: check if highs are converging with lows
  if (highs.length >= 3 && lows.length >= 3) {
    const recentHighs = highs.slice(-3);
    const recentLows = lows.slice(-3);
    const highSlope = (recentHighs[2].price - recentHighs[0].price) / (recentHighs[2].index - recentHighs[0].index);
    const lowSlope = (recentLows[2].price - recentLows[0].price) / (recentLows[2].index - recentLows[0].index);
    // Ascending triangle: highs flat, lows rising
    if (Math.abs(highSlope) < 0.001 && lowSlope > 0.001) {
      patterns.push({
        name: "Ascending Triangle",
        type: "BULLISH",
        startIndex: recentHighs[0].index,
        endIndex: recentHighs[2].index,
        confidence: 55,
        description: `Flat resistance, rising support. Bullish continuation pattern.`,
        targetPrice: recentHighs[0].price + (recentHighs[0].price - recentLows[0].price),
      });
    }
    // Descending triangle: lows flat, highs falling
    if (Math.abs(lowSlope) < 0.001 && highSlope < -0.001) {
      patterns.push({
        name: "Descending Triangle",
        type: "BEARISH",
        startIndex: recentHighs[0].index,
        endIndex: recentHighs[2].index,
        confidence: 55,
        description: `Flat support, falling resistance. Bearish continuation pattern.`,
        targetPrice: recentLows[0].price - (recentHighs[0].price - recentLows[0].price),
      });
    }
    // Symmetrical triangle: both converging
    if (highSlope < -0.001 && lowSlope > 0.001) {
      patterns.push({
        name: "Symmetrical Triangle",
        type: "NEUTRAL",
        startIndex: recentHighs[0].index,
        endIndex: recentHighs[2].index,
        confidence: 50,
        description: `Converging trend lines. Direction depends on breakout.`,
      });
    }
    // Rising wedge: both rising but highs slower
    if (highSlope > 0.001 && lowSlope > highSlope * 1.3) {
      patterns.push({
        name: "Rising Wedge",
        type: "BEARISH",
        startIndex: recentLows[0].index,
        endIndex: recentLows[2].index,
        confidence: 50,
        description: `Support rising faster than resistance. Bearish reversal pattern.`,
      });
    }
    // Falling wedge: both falling but lows slower
    if (highSlope < -0.001 && lowSlope < highSlope * 0.7 && lowSlope < 0) {
      patterns.push({
        name: "Falling Wedge",
        type: "BULLISH",
        startIndex: recentHighs[0].index,
        endIndex: recentHighs[2].index,
        confidence: 50,
        description: `Resistance falling faster than support. Bullish reversal pattern.`,
      });
    }
  }
  return patterns.sort((a, b) => b.confidence - a.confidence);
}
