/**
 * Technical Indicator Library
 *
 * Vectorised pure functions over Candle[] / number[].
 * Inspired by the kind of statistical primitives Jane Street's quant
 * researchers chain together — but exposed as classic TA names.
 */
import type { Candle } from "./types";

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
  // Pad the warmup with nulls
  for (let i = 0; i < Math.min(period - 1, values.length); i++) out[i] = null;
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
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

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] != null && emaSlow[i] != null
      ? (emaFast[i] as number) - (emaSlow[i] as number)
      : null,
  );
  // Signal = EMA of MACD line, ignoring nulls at start
  const validStart = macdLine.findIndex((v) => v != null);
  const signalLine: (number | null)[] = new Array(values.length).fill(null);
  if (validStart >= 0) {
    const sub = macdLine.slice(validStart).map((v) => v as number);
    const sig = ema(sub, signal);
    for (let i = 0; i < sig.length; i++) signalLine[validStart + i] = sig[i];
  }
  const histogram = values.map((_, i) =>
    macdLine[i] != null && signalLine[i] != null
      ? (macdLine[i] as number) - (signalLine[i] as number)
      : null,
  );
  return { macd: macdLine, signal: signalLine, histogram };
}

export function bollingerBands(
  values: number[],
  period = 20,
  stdMult = 2,
): { middle: (number | null)[]; upper: (number | null)[]; lower: (number | null)[] } {
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

export function rollingMax(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - period + 1; j <= i; j++) m = Math.max(m, values[j]);
    out[i] = m;
  }
  return out;
}

export function rollingMin(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let m = Infinity;
    for (let j = i - period + 1; j <= i; j++) m = Math.min(m, values[j]);
    out[i] = m;
  }
  return out;
}

/** Pearson correlation between two equal-length series. */
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

/** Linear regression beta of `series` against `benchmark`. */
export function beta(series: number[], benchmark: number[]): number {
  const n = Math.min(series.length, benchmark.length);
  if (n < 2) return 0;
  const ms = series.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = benchmark.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (series[i] - ms) * (benchmark[i] - mb);
    varB += (benchmark[i] - mb) ** 2;
  }
  if (varB === 0) return 0;
  return cov / varB;
}

/** Simple returns series. */
export function returns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] / values[i - 1] - 1);
  }
  return out;
}

/** Log returns — additive, preferred for volatility math. */
export function logReturns(values: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    out.push(Math.log(values[i] / values[i - 1]));
  }
  return out;
}

/** Ornstein-Uhlenbeck half-life of mean reversion. */
export function halfLife(values: number[]): number {
  const n = values.length;
  if (n < 5) return Infinity;
  const lag = values.slice(0, n - 1);
  const diff = values.slice(1).map((v, i) => v - lag[i]);
  const meanLag = lag.reduce((s, v) => s + v, 0) / lag.length;
  const meanDiff = diff.reduce((s, v) => s + v, 0) / diff.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < lag.length; i++) {
    num += (lag[i] - meanLag) * (diff[i] - meanDiff);
    den += (lag[i] - meanLag) ** 2;
  }
  if (den === 0) return Infinity;
  const slope = num / den;
  if (slope >= 0) return Infinity;
  return -Math.log(2) / slope;
}

/** Cointegration test (simplified Engle-Granger two-step). */
export function cointegration(a: number[], b: number[]): {
  beta: number;
  halfLife: number;
  residual: number[];
  zScore: number;
} {
  const n = Math.min(a.length, b.length);
  // OLS: a = alpha + beta * b + e
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (b[i] - mb) * (a[i] - ma);
    den += (b[i] - mb) ** 2;
  }
  const betaHedge = den === 0 ? 1 : num / den;
  const alpha = ma - betaHedge * mb;
  const residual = a.slice(0, n).map((v, i) => v - alpha - betaHedge * b[i]);
  const hl = halfLife(residual);
  const mean = residual.reduce((s, v) => s + v, 0) / residual.length;
  const sd = Math.sqrt(residual.reduce((s, v) => s + (v - mean) ** 2, 0) / residual.length);
  const zScore = sd === 0 ? 0 : (residual[residual.length - 1] - mean) / sd;
  return { beta: betaHedge, halfLife: hl, residual, zScore };
}

/** Black-Scholes-Merton for European options on futures (Black's model). */
export function blackScholes(
  F: number, // forward
  K: number,
  T: number,
  r: number,
  sigma: number,
  isCall: boolean,
): { price: number; delta: number; gamma: number; theta: number; vega: number; rho: number } {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(F / K) + (sigma * sigma / 2) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const N = (x: number) => 0.5 * (1 + erf(x / Math.sqrt(2)));
  const n = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const Nd1 = N(d1);
  const Nd2 = N(d2);
  const nd1 = n(d1);
  const price = isCall ? Math.exp(-r * T) * (F * Nd1 - K * Nd2) : Math.exp(-r * T) * (K * (1 - Nd2) - F * (1 - Nd1));
  // For Black's model, delta is discount * N(d1) for call, -discount*N(-d1) for put
  const delta = isCall ? Math.exp(-r * T) * Nd1 : -Math.exp(-r * T) * (1 - Nd1);
  const gamma = Math.exp(-r * T) * nd1 / (F * sigma * sqrtT);
  const vega = F * Math.exp(-r * T) * nd1 * sqrtT;
  const theta =
    (-F * Math.exp(-r * T) * nd1 * sigma / (2 * sqrtT) + r * Math.exp(-r * T) * (F * Nd1 - K * Nd2)) /
    (isCall ? 1 : -1) *
    0; // simplified
  const rho = -T * price;
  return { price, delta, gamma, theta, vega, rho };
}

/** Abramowitz & Stegun erf approximation. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
