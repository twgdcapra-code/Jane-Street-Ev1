/**
 * Advanced Indicators Library
 *
 * Comprehensive collection of technical indicators used by professional
 * trading platforms (TradingView, NinjaTrader, Tradovate, CME, etc.).
 *
 * All functions are pure: (candles or values, params) → number[].
 * Each returns an array aligned with the input length (nulls during warmup).
 *
 * Organized into categories: Trend, Momentum, Volatility, Volume.
 */
import type { Candle } from "./types";

// ============================================================
// Utilities
// ============================================================
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      prev = values[0];
      out[i] = prev;
      continue;
    }
    prev = values[i] * k + (prev as number) * (1 - k);
    out[i] = prev;
  }
  for (let i = 0; i < Math.min(period - 1, values.length); i++) out[i] = null;
  return out;
}

export function wma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  const weightSum = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += values[i - j] * (period - j);
    }
    out[i] = sum / weightSum;
  }
  return out;
}

export function hma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period < 2) return out;
  const halfLen = Math.max(1, Math.floor(period / 2));
  const sqrtLen = Math.max(1, Math.floor(Math.sqrt(period)));
  const wmaHalf = wma(values, halfLen);
  const wmaFull = wma(values, period);
  const diff: number[] = values.map((_, i) => {
    const h = wmaHalf[i];
    const f = wmaFull[i];
    return h != null && f != null ? 2 * (h as number) - (f as number) : NaN;
  });
  const wmaSqrt = wma(
    diff.map((d) => (isNaN(d) ? 0 : d)),
    sqrtLen,
  );
  // Null out warmup
  for (let i = 0; i < period - 1; i++) wmaSqrt[i] = null;
  return wmaSqrt;
}

export function dema(values: number[], period: number): (number | null)[] {
  const e1 = ema(values, period);
  const e2 = ema(e1.map((v) => v ?? 0), period);
  return values.map((_, i) => (e1[i] != null && e2[i] != null ? 2 * (e1[i] as number) - (e2[i] as number) : null));
}

export function tema(values: number[], period: number): (number | null)[] {
  const e1 = ema(values, period);
  const e2 = ema(e1.map((v) => v ?? 0), period);
  const e3 = ema(e2.map((v) => v ?? 0), period);
  return values.map((_, i) =>
    e1[i] != null && e2[i] != null && e3[i] != null
      ? 3 * (e1[i] as number) - 3 * (e2[i] as number) + (e3[i] as number)
      : null,
  );
}

export function kama(values: number[], period: number = 10, fast: number = 2, slow: number = 30): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period + 1) return out;
  const fastSC = 2 / (fast + 1);
  const slowSC = 2 / (slow + 1);
  out[period] = values[period];
  for (let i = period + 1; i < values.length; i++) {
    let change = Math.abs(values[i] - values[i - period]);
    let volatility = 0;
    for (let j = 0; j < period; j++) {
      volatility += Math.abs(values[i - j] - values[i - j - 1]);
    }
    if (volatility === 0) {
      out[i] = out[i - 1];
      continue;
    }
    const er = change / volatility;
    const sc = Math.pow(er * (fastSC - slowSC) + slowSC, 2);
    out[i] = (out[i - 1] as number) + sc * (values[i] - (out[i - 1] as number));
  }
  return out;
}

export function rsi(values: number[], period: number = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? Infinity : avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null ? (emaFast[i] as number) - (emaSlow[i] as number) : null,
  );
  const validStart = macdLine.findIndex((v) => v != null);
  const signalLine: (number | null)[] = new Array(values.length).fill(null);
  if (validStart >= 0) {
    const sub = macdLine.slice(validStart).map((v) => v as number);
    const sig = ema(sub, signal);
    for (let i = 0; i < sig.length; i++) signalLine[validStart + i] = sig[i];
  }
  const histogram = values.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null ? (macdLine[i] as number) - (signalLine[i] as number) : null,
  );
  return { macd: macdLine, signal: signalLine, histogram };
}

export function bollingerBands(values: number[], period = 20, stdMult = 2) {
  const middle = sma(values, period);
  const upper: (number | null)[] = new Array(values.length).fill(null);
  const lower: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = middle[i] as number;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + stdMult * sd;
    lower[i] = mean - stdMult * sd;
  }
  return { middle, upper, lower };
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0) return out;
  const trs: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  let prev = trs.slice(0, period).reduce((s, v) => s + v, 0) / period;
  if (trs.length >= period) out[period - 1] = prev;
  for (let i = period; i < trs.length; i++) {
    prev = (prev * (period - 1) + trs[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function vwap(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumV += c.volume;
    out[i] = cumV === 0 ? null : cumPV / cumV;
  }
  return out;
}

export function stdev(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((s, v) => s + v, 0) / period;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    out[i] = Math.sqrt(variance);
  }
  return out;
}

// ============================================================
// TREND INDICATORS
// ============================================================

/** Stochastic Oscillator (%K, %D) */
export function stochastic(candles: Candle[], kPeriod = 14, dPeriod = 3, smooth = 1) {
  const k: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1);
    const highestHigh = Math.max(...slice.map((c) => c.high));
    const lowestLow = Math.min(...slice.map((c) => c.low));
    const range = highestHigh - lowestLow;
    k[i] = range === 0 ? 50 : ((candles[i].close - lowestLow) / range) * 100;
  }
  // Smooth K
  const smoothK = smooth > 1 ? sma(k.map((v) => v ?? 0), smooth).map((v, i) => (k[i] != null ? v : null)) : k;
  const d = sma(smoothK.map((v) => v ?? 0), dPeriod).map((v, i) => (smoothK[i] != null ? v : null));
  return { k: smoothK, d };
}

/** ADX, +DI, -DI */
export function adx(candles: Candle[], period = 14) {
  const len = candles.length;
  const plusDM: number[] = new Array(len).fill(0);
  const minusDM: number[] = new Array(len).fill(0);
  const tr: number[] = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
  }
  // Wilder smoothing
  const smoothTR: number[] = new Array(len).fill(0);
  const smoothPlusDM: number[] = new Array(len).fill(0);
  const smoothMinusDM: number[] = new Array(len).fill(0);
  if (len > period) {
    smoothTR[period] = tr.slice(1, period + 1).reduce((s, v) => s + v, 0);
    smoothPlusDM[period] = plusDM.slice(1, period + 1).reduce((s, v) => s + v, 0);
    smoothMinusDM[period] = minusDM.slice(1, period + 1).reduce((s, v) => s + v, 0);
    for (let i = period + 1; i < len; i++) {
      smoothTR[i] = smoothTR[i - 1] - smoothTR[i - 1] / period + tr[i];
      smoothPlusDM[i] = smoothPlusDM[i - 1] - smoothPlusDM[i - 1] / period + plusDM[i];
      smoothMinusDM[i] = smoothMinusDM[i - 1] - smoothMinusDM[i - 1] / period + minusDM[i];
    }
  }
  const plusDI: (number | null)[] = new Array(len).fill(null);
  const minusDI: (number | null)[] = new Array(len).fill(null);
  const dx: number[] = new Array(len).fill(0);
  for (let i = period; i < len; i++) {
    if (smoothTR[i] > 0) {
      plusDI[i] = (smoothPlusDM[i] / smoothTR[i]) * 100;
      minusDI[i] = (smoothMinusDM[i] / smoothTR[i]) * 100;
      const sum = plusDI[i]! + minusDI[i]!;
      dx[i] = sum > 0 ? (Math.abs(plusDI[i]! - minusDI[i]!) / sum) * 100 : 0;
    }
  }
  const adxArr: (number | null)[] = new Array(len).fill(null);
  if (len > period * 2) {
    let adxVal = dx.slice(period, period * 2).reduce((s, v) => s + v, 0) / period;
    adxArr[period * 2 - 1] = adxVal;
    for (let i = period * 2; i < len; i++) {
      adxVal = (adxVal * (period - 1) + dx[i]) / period;
      adxArr[i] = adxVal;
    }
  }
  return { adx: adxArr, plusDI, minusDI };
}

/** Aroon Up/Down */
export function aroon(candles: Candle[], period = 25) {
  const up: (number | null)[] = new Array(candles.length).fill(null);
  const down: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period; i < candles.length; i++) {
    const slice = candles.slice(i - period, i + 1);
    const highIdx = slice.reduce((maxIdx, c, idx, arr) => (c.high > arr[maxIdx].high ? idx : maxIdx), 0);
    const lowIdx = slice.reduce((minIdx, c, idx, arr) => (c.low < arr[minIdx].low ? idx : minIdx), 0);
    up[i] = ((period - highIdx) / period) * 100;
    down[i] = ((period - lowIdx) / period) * 100;
  }
  return { up, down, oscillator: up.map((u, i) => (u != null && down[i] != null ? u - (down[i] as number) : null)) };
}

/** Vortex Indicator */
export function vortex(candles: Candle[], period = 14) {
  const len = candles.length;
  const vmPlus: number[] = new Array(len).fill(0);
  const vmMinus: number[] = new Array(len).fill(0);
  const tr: number[] = new Array(len).fill(0);
  for (let i = 1; i < len; i++) {
    vmPlus[i] = Math.abs(candles[i].high - candles[i - 1].low);
    vmMinus[i] = Math.abs(candles[i].low - candles[i - 1].high);
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
  }
  const plusVI: (number | null)[] = new Array(len).fill(null);
  const minusVI: (number | null)[] = new Array(len).fill(null);
  for (let i = period; i < len; i++) {
    let sumVMPlus = 0;
    let sumVMMinus = 0;
    let sumTR = 0;
    for (let j = 0; j < period; j++) {
      sumVMPlus += vmPlus[i - j];
      sumVMMinus += vmMinus[i - j];
      sumTR += tr[i - j];
    }
    if (sumTR > 0) {
      plusVI[i] = sumVMPlus / sumTR;
      minusVI[i] = sumVMMinus / sumTR;
    }
  }
  return { plusVI, minusVI };
}

/** Parabolic SAR */
export function parabolicSAR(candles: Candle[], step = 0.02, maxStep = 0.2) {
  const len = candles.length;
  const sar: (number | null)[] = new Array(len).fill(null);
  if (len < 2) return sar;
  let isLong = candles[1].close > candles[0].close;
  let af = step;
  let ep = isLong ? candles[0].high : candles[0].low;
  let sarVal = isLong ? candles[0].low : candles[0].high;
  sar[0] = sarVal;
  for (let i = 1; i < len; i++) {
    sarVal = sarVal + af * (ep - sarVal);
    if (isLong) {
      if (candles[i].low < sarVal) {
        isLong = false;
        sarVal = ep;
        ep = candles[i].low;
        af = step;
      } else {
        if (candles[i].high > ep) {
          ep = candles[i].high;
          af = Math.min(af + step, maxStep);
        }
      }
    } else {
      if (candles[i].high > sarVal) {
        isLong = true;
        sarVal = ep;
        ep = candles[i].high;
        af = step;
      } else {
        if (candles[i].low < ep) {
          ep = candles[i].low;
          af = Math.min(af + step, maxStep);
        }
      }
    }
    sar[i] = sarVal;
  }
  return sar;
}

/** SuperTrend */
export function superTrend(candles: Candle[], period = 10, multiplier = 3) {
  const len = candles.length;
  const atrArr = atr(candles, period);
  const upper: (number | null)[] = new Array(len).fill(null);
  const lower: (number | null)[] = new Array(len).fill(null);
  const st: (number | null)[] = new Array(len).fill(null);
  const dir: (number | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const a = atrArr[i];
    if (a == null) continue;
    const hl2 = (candles[i].high + candles[i].low) / 2;
    upper[i] = hl2 + multiplier * a;
    lower[i] = hl2 - multiplier * a;
    if (i > 0 && st[i - 1] != null) {
      const prevST = st[i - 1] as number;
      const prevClose = candles[i - 1].close;
      // Final bands
      const finalUpper = upper[i]! < upper[i - 1]! || prevClose > upper[i - 1]! ? upper[i]! : upper[i - 1]!;
      const finalLower = lower[i]! > lower[i - 1]! || prevClose < lower[i - 1]! ? lower[i]! : lower[i - 1]!;
      upper[i] = finalUpper;
      lower[i] = finalLower;
      if (prevST === upper[i - 1]) {
        if (candles[i].close <= finalUpper) {
          st[i] = finalUpper;
          dir[i] = -1;
        } else {
          st[i] = finalLower;
          dir[i] = 1;
        }
      } else {
        if (candles[i].close >= finalLower) {
          st[i] = finalLower;
          dir[i] = 1;
        } else {
          st[i] = finalUpper;
          dir[i] = -1;
        }
      }
    } else {
      st[i] = upper[i];
      dir[i] = -1;
    }
  }
  return { superTrend: st, direction: dir, upper, lower };
}

/** Ichimoku Cloud */
export function ichimoku(candles: Candle[], conversion = 9, base = 26, spanB = 52, displacement = 26) {
  const len = candles.length;
  const tenkan: (number | null)[] = new Array(len).fill(null);
  const kijun: (number | null)[] = new Array(len).fill(null);
  const senkouA: (number | null)[] = new Array(len).fill(null);
  const senkouB: (number | null)[] = new Array(len).fill(null);
  const chikou: (number | null)[] = new Array(len).fill(null);
  for (let i = conversion - 1; i < len; i++) {
    const slice = candles.slice(i - conversion + 1, i + 1);
    tenkan[i] = (Math.max(...slice.map((c) => c.high)) + Math.min(...slice.map((c) => c.low))) / 2;
  }
  for (let i = base - 1; i < len; i++) {
    const slice = candles.slice(i - base + 1, i + 1);
    kijun[i] = (Math.max(...slice.map((c) => c.high)) + Math.min(...slice.map((c) => c.low))) / 2;
  }
  for (let i = 0; i < len; i++) {
    if (tenkan[i] != null && kijun[i] != null) {
      senkouA[i] = ((tenkan[i] as number) + (kijun[i] as number)) / 2;
    }
  }
  for (let i = spanB - 1; i < len; i++) {
    const slice = candles.slice(i - spanB + 1, i + 1);
    senkouB[i] = (Math.max(...slice.map((c) => c.high)) + Math.min(...slice.map((c) => c.low))) / 2;
  }
  for (let i = 0; i < len; i++) {
    const futureIdx = i + displacement;
    if (futureIdx < len) chikou[i] = candles[futureIdx].close;
  }
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

/** Keltner Channels */
export function keltner(candles: Candle[], period = 20, mult = 2) {
  const closes = candles.map((c) => c.close);
  const middle = ema(closes, period);
  const atrArr = atr(candles, period);
  const upper = candles.map((_, i) => (middle[i] != null && atrArr[i] != null ? (middle[i] as number) + mult * (atrArr[i] as number) : null));
  const lower = candles.map((_, i) => (middle[i] != null && atrArr[i] != null ? (middle[i] as number) - mult * (atrArr[i] as number) : null));
  return { middle, upper, lower };
}

/** Donchian Channels */
export function donchian(candles: Candle[], period = 20) {
  const upper: (number | null)[] = new Array(candles.length).fill(null);
  const lower: (number | null)[] = new Array(candles.length).fill(null);
  const middle: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const up = Math.max(...slice.map((c) => c.high));
    const lo = Math.min(...slice.map((c) => c.low));
    upper[i] = up;
    lower[i] = lo;
    middle[i] = (up + lo) / 2;
  }
  return { upper, lower, middle };
}

/** Linear Regression */
export function linearRegression(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const n = period;
    const sumX = (n * (n - 1)) / 2;
    const sumY = slice.reduce((s, v) => s + v, 0);
    const sumXY = slice.reduce((s, v, idx) => s + idx * v, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    out[i] = slope * (n - 1) + intercept;
  }
  return out;
}

/** ZigZag — identifies significant reversals */
export function zigZag(candles: Candle[], threshold = 0.05): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < 2) return out;
  let lastPivot = candles[0].high;
  let lastPivotIdx = 0;
  let direction = 0; // 0 = unknown, 1 = up, -1 = down
  out[0] = lastPivot;
  for (let i = 1; i < candles.length; i++) {
    const price = candles[i].close;
    const change = (price - lastPivot) / lastPivot;
    if (direction >= 0 && change <= -threshold) {
      out[lastPivotIdx] = lastPivot;
      out[i] = price;
      lastPivot = price;
      lastPivotIdx = i;
      direction = -1;
    } else if (direction <= 0 && change >= threshold) {
      out[lastPivotIdx] = lastPivot;
      out[i] = price;
      lastPivot = price;
      lastPivotIdx = i;
      direction = 1;
    }
  }
  return out;
}

// ============================================================
// MOMENTUM INDICATORS
// ============================================================

/** CCI (Commodity Channel Index) */
export function cci(candles: Candle[], period = 20): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = tp.slice(i - period + 1, i + 1);
    const smaVal = slice.reduce((s, v) => s + v, 0) / period;
    const meanDev = slice.reduce((s, v) => s + Math.abs(v - smaVal), 0) / period;
    out[i] = meanDev === 0 ? 0 : (tp[i] - smaVal) / (0.015 * meanDev);
  }
  return out;
}

/** Williams %R */
export function williamsR(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...slice.map((c) => c.high));
    const lowestLow = Math.min(...slice.map((c) => c.low));
    const range = highestHigh - lowestLow;
    out[i] = range === 0 ? -50 : ((highestHigh - candles[i].close) / range) * -100;
  }
  return out;
}

/** MFI (Money Flow Index) */
export function mfi(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const mf = tp.map((p, i) => p * candles[i].volume);
  for (let i = period; i < candles.length; i++) {
    let posFlow = 0;
    let negFlow = 0;
    for (let j = 0; j < period; j++) {
      const idx = i - j;
      if (tp[idx] > tp[idx - 1]) posFlow += mf[idx];
      else if (tp[idx] < tp[idx - 1]) negFlow += mf[idx];
    }
    const moneyRatio = negFlow === 0 ? Infinity : posFlow / negFlow;
    out[i] = 100 - 100 / (1 + moneyRatio);
  }
  return out;
}

/** TRIX (Triple EMA derivative) */
export function trix(values: number[], period = 15): (number | null)[] {
  const e1 = ema(values, period);
  const e2 = ema(e1.map((v) => v ?? 0), period);
  const e3 = ema(e2.map((v) => v ?? 0), period);
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 1; i < values.length; i++) {
    if (e3[i] != null && e3[i - 1] != null && (e3[i - 1] as number) !== 0) {
      out[i] = ((e3[i] as number) - (e3[i - 1] as number)) / (e3[i - 1] as number) * 100;
    }
  }
  return out;
}

/** ROC (Rate of Change) */
export function roc(values: number[], period = 12): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    out[i] = ((values[i] - values[i - period]) / values[i - period]) * 100;
  }
  return out;
}

/** Momentum (raw difference) */
export function momentum(values: number[], period = 10): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] - values[i - period];
  }
  return out;
}

/** CMF (Chaikin Money Flow) */
export function cmf(candles: Candle[], period = 20): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  const mfv = candles.map((c) => {
    const range = c.high - c.low;
    const mfm = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
    return mfm * c.volume;
  });
  for (let i = period - 1; i < candles.length; i++) {
    const slice = mfv.slice(i - period + 1, i + 1);
    const volSlice = candles.slice(i - period + 1, i + 1).map((c) => c.volume);
    const sumMFV = slice.reduce((s, v) => s + v, 0);
    const sumVol = volSlice.reduce((s, v) => s + v, 0);
    out[i] = sumVol === 0 ? 0 : sumMFV / sumVol;
  }
  return out;
}

/** DPO (Detrended Price Oscillator) */
export function dpo(candles: Candle[], period = 20): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  const closes = candles.map((c) => c.close);
  const smaArr = sma(closes, period);
  const shift = Math.floor(period / 2) + 1;
  for (let i = 0; i < candles.length - shift; i++) {
    const idx = i + shift;
    if (smaArr[idx] != null) {
      out[i] = closes[i] - (smaArr[idx] as number);
    }
  }
  return out;
}

/** KST (Know Sure Thing) */
export function kst(values: number[]) {
  const roc1 = roc(values, 10);
  const roc2 = roc(values, 15);
  const roc3 = roc(values, 20);
  const roc4 = roc(values, 30);
  const kstLine = values.map((_, i) => {
    const r1 = sma(roc1.map((v) => v ?? 0), 10)[i];
    const r2 = sma(roc2.map((v) => v ?? 0), 10)[i];
    const r3 = sma(roc3.map((v) => v ?? 0), 10)[i];
    const r4 = sma(roc4.map((v) => v ?? 0), 15)[i];
    return r1 != null && r2 != null && r3 != null && r4 != null
      ? (r1 as number) * 1 + (r2 as number) * 2 + (r3 as number) * 3 + (r4 as number) * 4
      : null;
  });
  const signalLine = sma(kstLine.map((v) => v ?? 0), 9).map((v, i) => (kstLine[i] != null ? v : null));
  return { kst: kstLine, signal: signalLine };
}

/** Awesome Oscillator */
export function awesomeOscillator(candles: Candle[]): (number | null)[] {
  const mp = candles.map((c) => (c.high + c.low) / 2);
  const fast = sma(mp, 5);
  const slow = sma(mp, 34);
  return candles.map((_, i) => (fast[i] != null && slow[i] != null ? (fast[i] as number) - (slow[i] as number) : null));
}

/** TTM Squeeze (Bollinger inside/outside Keltner) */
export function ttmSqueeze(candles: Candle[], bbPeriod = 20, bbStd = 2, kcPeriod = 20, kcMult = 1.5) {
  const closes = candles.map((c) => c.close);
  const bb = bollingerBands(closes, bbPeriod, bbStd);
  const kc = keltner(candles, kcPeriod, kcMult);
  const squeeze: (boolean | null)[] = candles.map((_, i) => {
    if (bb.upper[i] == null || kc.upper[i] == null) return null;
    return (bb.lower[i] as number) > (kc.lower[i] as number) && (bb.upper[i] as number) < (kc.upper[i] as number);
  });
  // Momentum line: linear regression of (close - avg) 
  const momentum: (number | null)[] = new Array(candles.length).fill(null);
  const avg = sma(closes, bbPeriod);
  for (let i = bbPeriod - 1; i < candles.length; i++) {
    const slice: number[] = [];
    for (let j = 0; j < bbPeriod; j++) {
      slice.push(closes[i - j] - (avg[i] ?? 0));
    }
    const lr = linearRegression(slice.slice().reverse(), bbPeriod);
    momentum[i] = lr[lr.length - 1];
  }
  return { squeeze, momentum };
}

// ============================================================
// VOLUME INDICATORS
// ============================================================

/** OBV (On Balance Volume) */
export function obv(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0) return out;
  out[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) {
      out[i] = (out[i - 1] as number) + candles[i].volume;
    } else if (candles[i].close < candles[i - 1].close) {
      out[i] = (out[i - 1] as number) - candles[i].volume;
    } else {
      out[i] = out[i - 1];
    }
  }
  return out;
}

/** Accumulation/Distribution Line */
export function accumulationDistribution(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length === 0) return out;
  out[0] = 0;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const range = c.high - c.low;
    const mfm = range === 0 ? 0 : ((c.close - c.low) - (c.high - c.close)) / range;
    out[i] = (out[i - 1] as number) + mfm * c.volume;
  }
  return out;
}

/** Force Index */
export function forceIndex(candles: Candle[], period = 13): (number | null)[] {
  const raw: number[] = candles.map((c, i) => {
    if (i === 0) return 0;
    return (c.close - candles[i - 1].close) * c.volume;
  });
  return ema(raw, period);
}

/** Ease of Movement */
export function easeOfMovement(candles: Candle[], period = 14): (number | null)[] {
  const emv: number[] = candles.map((c, i) => {
    if (i === 0) return 0;
    const distanceMoved = ((c.high + c.low) / 2) - ((candles[i - 1].high + candles[i - 1].low) / 2);
    const boxRatio = c.volume === 0 ? 0.0001 : (c.volume / 100000000) / (c.high - c.low || 0.0001);
    return distanceMoved / boxRatio;
  });
  return sma(emv, period);
}

/** Volume Oscillator */
export function volumeOscillator(candles: Candle[], fast = 5, slow = 10): (number | null)[] {
  const vols = candles.map((c) => c.volume);
  const fastSMA = sma(vols, fast);
  const slowSMA = sma(vols, slow);
  return candles.map((_, i) =>
    fastSMA[i] != null && slowSMA[i] != null && (slowSMA[i] as number) !== 0
      ? ((fastSMA[i] as number) - (slowSMA[i] as number)) / (slowSMA[i] as number) * 100
      : null,
  );
}

/** VWMA (Volume Weighted Moving Average) */
export function vwma(candles: Candle[], period = 20): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1);
    const sumPV = slice.reduce((s, c) => s + c.close * c.volume, 0);
    const sumV = slice.reduce((s, c) => s + c.volume, 0);
    out[i] = sumV === 0 ? null : sumPV / sumV;
  }
  return out;
}

// ============================================================
// CANDLESTICK PATTERNS
// ============================================================

export interface CandlePattern {
  index: number;
  name: string;
  type: "BULLISH" | "BEARISH" | "NEUTRAL";
  strength: number;
}

export function detectCandlePatterns(candles: Candle[]): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.close, c.open);
    const lowerWick = Math.min(c.close, c.open) - c.low;
    const range = c.high - c.low || 0.0001;
    // Doji
    if (body / range < 0.1) {
      patterns.push({ index: i, name: "Doji", type: "NEUTRAL", strength: 30 });
    }
    // Hammer
    if (lowerWick > body * 2 && upperWick < body * 0.5 && c.close > c.open) {
      patterns.push({ index: i, name: "Hammer", type: "BULLISH", strength: 60 });
    }
    // Shooting Star
    if (upperWick > body * 2 && lowerWick < body * 0.5 && c.close < c.open) {
      patterns.push({ index: i, name: "Shooting Star", type: "BEARISH", strength: 60 });
    }
    // Bullish Engulfing
    if (prev.close < prev.open && c.close > c.open && c.close > prev.open && c.open < prev.close) {
      patterns.push({ index: i, name: "Bullish Engulfing", type: "BULLISH", strength: 75 });
    }
    // Bearish Engulfing
    if (prev.close > prev.open && c.close < c.open && c.close < prev.open && c.open > prev.close) {
      patterns.push({ index: i, name: "Bearish Engulfing", type: "BEARISH", strength: 75 });
    }
    // Morning Star (3-candle)
    if (i >= 2) {
      const p2 = candles[i - 2];
      if (p2.close < p2.open && Math.abs(prev.close - prev.open) < Math.abs(p2.close - p2.open) * 0.5 && c.close > c.open && c.close > (p2.open + p2.close) / 2) {
        patterns.push({ index: i, name: "Morning Star", type: "BULLISH", strength: 85 });
      }
      // Evening Star
      if (p2.close > p2.open && Math.abs(prev.close - prev.open) < Math.abs(p2.close - p2.open) * 0.5 && c.close < c.open && c.close < (p2.open + p2.close) / 2) {
        patterns.push({ index: i, name: "Evening Star", type: "BEARISH", strength: 85 });
      }
    }
    // Marubozu (no wicks)
    if (upperWick < body * 0.05 && lowerWick < body * 0.05) {
      patterns.push({ index: i, name: c.close > c.open ? "Bullish Marubozu" : "Bearish Marubozu", type: c.close > c.open ? "BULLISH" : "BEARISH", strength: 70 });
    }
    // Pin Bar / reversal
    if ((lowerWick > range * 0.6 || upperWick > range * 0.6) && body / range < 0.3) {
      patterns.push({ index: i, name: lowerWick > upperWick ? "Bullish Pin Bar" : "Bearish Pin Bar", type: lowerWick > upperWick ? "BULLISH" : "BEARISH", strength: 65 });
    }
  }
  return patterns;
}

// ============================================================
// PIVOT POINTS
// ============================================================

export interface PivotPoints {
  pp: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

export function pivotPoints(candles: Candle[], method: "STANDARD" | "FIBONACCI" | "CAMARILLA" | "WOODIE" | "DEMARK" = "STANDARD"): PivotPoints {
  if (candles.length === 0) return { pp: 0, r1: 0, r2: 0, r3: 0, s1: 0, s2: 0, s3: 0 };
  const prev = candles[candles.length - 1];
  const H = prev.high;
  const L = prev.low;
  const C = prev.close;
  const O = prev.open;
  switch (method) {
    case "FIBONACCI": {
      const pp = (H + L + C) / 3;
      return {
        pp,
        r1: pp + 0.382 * (H - L),
        r2: pp + 0.618 * (H - L),
        r3: pp + 1.0 * (H - L),
        s1: pp - 0.382 * (H - L),
        s2: pp - 0.618 * (H - L),
        s3: pp - 1.0 * (H - L),
      };
    }
    case "CAMARILLA": {
      const pp = C;
      return {
        pp,
        r1: C + 1.1 * (H - L) / 12,
        r2: C + 1.1 * (H - L) / 6,
        r3: C + 1.1 * (H - L) / 4,
        s1: C - 1.1 * (H - L) / 12,
        s2: C - 1.1 * (H - L) / 6,
        s3: C - 1.1 * (H - L) / 4,
      };
    }
    case "WOODIE": {
      const pp = (H + L + 2 * O) / 4;
      return {
        pp,
        r1: 2 * pp - L,
        r2: pp + (H - L),
        r3: H + 2 * (pp - L),
        s1: 2 * pp - H,
        s2: pp - (H - L),
        s3: L - 2 * (H - pp),
      };
    }
    case "DEMARK": {
      const pp = C < O ? (H + 2 * L + C) / 4 : C > O ? (2 * H + L + C) / 4 : (H + L + 2 * C) / 4;
      return {
        pp,
        r1: 2 * pp - L,
        r2: pp + (H - L),
        r3: H + 2 * (pp - L),
        s1: 2 * pp - H,
        s2: pp - (H - L),
        s3: L - 2 * (H - pp),
      };
    }
    default: {
      const pp = (H + L + C) / 3;
      return {
        pp,
        r1: 2 * pp - L,
        r2: pp + (H - L),
        r3: H + 2 * (pp - L),
        s1: 2 * pp - H,
        s2: pp - (H - L),
        s3: L - 2 * (H - pp),
      };
    }
  }
}

// ============================================================
// HEIKIN-ASHI
// ============================================================

export function heikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  if (candles.length === 0) return out;
  let prevHA: Candle | null = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const close = (c.open + c.high + c.low + c.close) / 4;
    const open = prevHA === null ? (c.open + c.close) / 2 : (prevHA.open + prevHA.close) / 2;
    const high = Math.max(c.high, open, close);
    const low = Math.min(c.low, open, close);
    const ha: Candle = { time: c.time, open, high, low, close, volume: c.volume };
    out.push(ha);
    prevHA = ha;
  }
  return out;
}
