/**
 * Volatility Analyzer Engine
 *
 * Computes multiple volatility estimators and a GARCH(1,1) proxy forecast:
 *  - Realized vol (close-to-close, multiple windows)
 *  - Parkinson (high-low range)
 *  - Garman-Klass (OHLC)
 *  - Volatility regime classification
 *  - Vol-of-vol
 *  - GARCH(1,1) one-step-ahead forecast
 *
 * Used by the Volatility Analyzer panel for displaying vol term structure,
 * regime detection, and forward forecasts.
 */
import { CONTRACTS, getContract } from "./contracts";
import { getEngine } from "./market-engine";
import type { Candle } from "./types";

export interface VolSnapshot {
  symbol: string;
  name: string;
  assetClass: string;
  lastPrice: number;
  // Realized vol (close-to-close) at multiple windows
  realizedVol: { window: number; vol: number; annualized: number }[];
  // Alternative estimators (20-day)
  parkinsonVol: number;
  garmanKlassVol: number;
  // Vol of vol (how volatile is vol itself)
  volOfVol: number;
  // GARCH(1,1) forecast
  garchForecast: number;
  garchParams: { omega: number; alpha: number; beta: number; longRun: number };
  // Regime classification
  regime: "LOW" | "NORMAL" | "HIGH" | "EXTREME";
  regimeScore: number; // 0..100
  // Term structure of vol (annualized, at different horizons)
  termStructure: { horizon: number; vol: number }[];
  // Vol percentile (where is current vol vs last year?)
  volPercentile: number;
  // Mean reversion speed (half-life)
  meanReversionHalfLife: number;
}

const WINDOWS = [5, 10, 20, 50, 100];

/**
 * Compute realized volatility using log returns.
 */
export function realizedVolatility(closes: number[], window: number): number {
  if (closes.length < window + 1) return 0;
  const slice = closes.slice(-window - 1);
  const logRets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    logRets.push(Math.log(slice[i] / slice[i - 1]));
  }
  const mean = logRets.reduce((s, v) => s + v, 0) / logRets.length;
  const variance = logRets.reduce((s, v) => s + (v - mean) ** 2, 0) / (logRets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252); // annualized
}

/**
 * Parkinson estimator: uses high-low range.
 * σ² = (1/(4 ln 2)) × (1/N) × Σ [ln(H/L)]²
 */
export function parkinsonVol(candles: Candle[], window: number = 20): number {
  if (candles.length < window) return 0;
  const slice = candles.slice(-window);
  const factor = 1 / (4 * Math.log(2));
  const sum = slice.reduce((s, c) => s + Math.log(c.high / c.low) ** 2, 0);
  const variance = factor * (sum / window);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * Garman-Klass estimator: uses OHLC.
 * σ² = (1/N) × Σ [ ½(ln(H/L))² - (2ln2 - 1)(ln(C/O))² ]
 */
export function garmanKlassVol(candles: Candle[], window: number = 20): number {
  if (candles.length < window) return 0;
  const slice = candles.slice(-window);
  const sum = slice.reduce((s, c) => {
    const hl = 0.5 * Math.log(c.high / c.low) ** 2;
    const co = (2 * Math.log(2) - 1) * Math.log(c.close / c.open) ** 2;
    return s + (hl - co);
  }, 0);
  const variance = sum / window;
  return Math.sqrt(Math.max(0, variance)) * Math.sqrt(252);
}

/**
 * Vol of vol: standard deviation of rolling 20-day vol over last 100 days.
 */
export function volOfVol(closes: number[], window: number = 20, lookback: number = 100): number {
  if (closes.length < window + lookback) return 0;
  const vols: number[] = [];
  for (let i = closes.length - lookback; i < closes.length - window; i++) {
    const slice = closes.slice(i, i + window + 1);
    vols.push(realizedVolatility(slice, window));
  }
  if (vols.length < 2) return 0;
  const mean = vols.reduce((s, v) => s + v, 0) / vols.length;
  const variance = vols.reduce((s, v) => s + (v - mean) ** 2, 0) / (vols.length - 1);
  const sd = Math.sqrt(variance);
  return mean > 0 ? sd / mean : 0;
}

/**
 * GARCH(1,1) parameter estimation (simplified MLE).
 * Returns parameters and 1-step-ahead forecast.
 *
 * Model: σ²_t = ω + α × r²_{t-1} + β × σ²_{t-1}
 * Long-run: ω / (1 - α - β)
 */
export function estimateGARCH(returns: number[]): {
  omega: number;
  alpha: number;
  beta: number;
  longRun: number;
  forecast: number;
} {
  if (returns.length < 30) {
    // Fallback: use sample variance
    const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
    const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1);
    return { omega: variance * 0.05, alpha: 0.1, beta: 0.85, longRun: variance, forecast: variance };
  }
  // Use sample variance as starting long-run estimate
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const sampleVar = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1);
  // Initial parameters (typical values for daily financial data)
  let omega = sampleVar * 0.05;
  let alpha = 0.10;
  let beta = 0.85;
  // Simple iterative estimation (not full MLE — that's too expensive in JS)
  // Use method of moments: estimate α and β from ACF of squared returns
  const sqRets = returns.map((r) => (r - mean) ** 2);
  const n = sqRets.length;
  // Lag-1 autocorrelation of squared returns
  const sqMean = sqRets.reduce((s, v) => s + v, 0) / n;
  let ac1num = 0;
  for (let i = 1; i < n; i++) ac1num += (sqRets[i] - sqMean) * (sqRets[i - 1] - sqMean);
  let ac1den = 0;
  for (let i = 0; i < n; i++) ac1den += (sqRets[i] - sqMean) ** 2;
  const ac1 = ac1den > 0 ? ac1num / ac1den : 0;
  // Lag-2
  let ac2num = 0;
  for (let i = 2; i < n; i++) ac2num += (sqRets[i] - sqMean) * (sqRets[i - 2] - sqMean);
  const ac2 = ac1den > 0 ? ac2num / ac1den : 0;
  // GARCH(1,1) implies: ac1 = α + β - αβ × (1 - α - β) / (1 - α - β) — approximation:
  // Solve: α + β ≈ ac1 + ac2 over ac1 (rough heuristic)
  // For simplicity, use the constraint α + β < 1 and solve via simple iteration
  const persistence = Math.min(0.995, ac1 + ac2 * 0.5); // typical
  beta = Math.max(0.5, Math.min(0.95, persistence * 0.9));
  alpha = Math.max(0.01, Math.min(0.3, persistence - beta));
  omega = sampleVar * (1 - persistence);
  const longRun = omega / (1 - alpha - beta);
  // Forecast: σ²_t = ω + α × r²_{t-1} + β × σ²_{t-1}
  const lastReturn = returns[returns.length - 1] - mean;
  const lastReturnSq = lastReturn * lastReturn;
  // σ²_{t-1} = exponentially-weighted moving average of past squared returns
  let prevVar = sampleVar;
  const lambda = 0.94;
  for (let i = 0; i < returns.length; i++) {
    const r = returns[i] - mean;
    prevVar = lambda * prevVar + (1 - lambda) * r * r;
  }
  const forecast = omega + alpha * lastReturnSq + beta * prevVar;
  return { omega, alpha, beta, longRun: Math.max(0.0001, longRun), forecast: Math.max(0.0001, forecast) };
}

/**
 * Classify volatility regime based on current vol vs historical distribution.
 */
export function classifyRegime(currentVol: number, historicalVols: number[]): {
  regime: VolSnapshot["regime"];
  score: number;
  percentile: number;
} {
  if (historicalVols.length === 0) return { regime: "NORMAL", score: 50, percentile: 50 };
  const sorted = [...historicalVols].sort((a, b) => a - b);
  // Find percentile of current vol
  let below = 0;
  for (const v of sorted) if (v < currentVol) below++;
  const percentile = (below / sorted.length) * 100;
  let regime: VolSnapshot["regime"];
  if (percentile < 20) regime = "LOW";
  else if (percentile < 80) regime = "NORMAL";
  else if (percentile < 95) regime = "HIGH";
  else regime = "EXTREME";
  return { regime, score: percentile, percentile };
}

/**
 * Estimate mean-reversion half-life of volatility.
 */
export function volHalfLife(closes: number[], window: number = 20): number {
  if (closes.length < 60) return 0;
  // Compute rolling vol series
  const vols: number[] = [];
  for (let i = window; i < closes.length; i++) {
    const slice = closes.slice(i - window, i + 1);
    vols.push(realizedVolatility(slice, window));
  }
  if (vols.length < 20) return 0;
  // OU half-life: regress Δvol_t on vol_{t-1}
  // slope = -ln(2) / HL → HL = -ln(2) / slope
  const n = vols.length - 1;
  const lagged = vols.slice(0, n);
  const diff = vols.slice(1).map((v, i) => v - lagged[i]);
  const meanLag = lagged.reduce((s, v) => s + v, 0) / n;
  const meanDiff = diff.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (lagged[i] - meanLag) * (diff[i] - meanDiff);
    den += (lagged[i] - meanLag) ** 2;
  }
  if (den === 0) return 0;
  const slope = num / den;
  if (slope >= 0) return Infinity;
  return -Math.log(2) / slope;
}

/**
 * Build a complete vol snapshot for a symbol.
 */
export function buildVolSnapshot(symbol: string): VolSnapshot | null {
  const engine = getEngine();
  const contract = getContract(symbol);
  const candles = engine.getCandles(symbol, 250);
  const history = engine.getHistory(symbol);
  if (candles.length < 30 && history.length < 30) return null;
  const allCandles = history.length > candles.length ? history : candles;
  if (allCandles.length < 30) return null;
  const closes = allCandles.map((c) => c.close);
  const lastPrice = closes[closes.length - 1];
  // Realized vol at multiple windows
  const realizedVol = WINDOWS.map((w) => {
    const v = realizedVolatility(closes, w);
    return { window: w, vol: v, annualized: v * 100 };
  });
  // Alternative estimators
  const parkinson = parkinsonVol(allCandles, 20);
  const garmanKlass = garmanKlassVol(allCandles, 20);
  // Vol of vol
  const vov = volOfVol(closes, 20, 100);
  // GARCH
  const logRets: number[] = [];
  for (let i = 1; i < closes.length; i++) logRets.push(Math.log(closes[i] / closes[i - 1]));
  const garch = estimateGARCH(logRets);
  const garchForecastAnnualized = Math.sqrt(garch.forecast * 252);
  // Regime: current 20d vol vs historical 20d vols
  const historical20dVols: number[] = [];
  for (let i = 100; i < closes.length; i++) {
    historical20dVols.push(realizedVolatility(closes.slice(0, i + 1), 20));
  }
  const currentVol = realizedVol.find((r) => r.window === 20)?.vol ?? 0;
  const regime = classifyRegime(currentVol, historical20dVols);
  // Term structure: vol at different forecast horizons (using GARCH persistence)
  const persistence = garch.alpha + garch.beta;
  const termStructure = [5, 10, 20, 60, 120].map((h) => {
    // GARCH term structure: σ²_t+h → long-run as h → ∞
    // σ²_t+h = longRun + (σ²_t - longRun) × persistence^h
    const forecastVar = garch.longRun + (garch.forecast - garch.longRun) * Math.pow(persistence, h);
    return { horizon: h, vol: Math.sqrt(forecastVar * 252) * 100 };
  });
  // Mean reversion half-life
  const hl = volHalfLife(closes, 20);
  return {
    symbol,
    name: contract.name,
    assetClass: contract.assetClass,
    lastPrice,
    realizedVol,
    parkinsonVol: parkinson * 100,
    garmanKlassVol: garmanKlass * 100,
    volOfVol: vov,
    garchForecast: garchForecastAnnualized * 100,
    garchParams: garch,
    regime: regime.regime,
    regimeScore: regime.score,
    termStructure,
    volPercentile: regime.percentile,
    meanReversionHalfLife: hl,
  };
}

/**
 * Build vol snapshots for all contracts.
 */
export function buildAllVolSnapshots(): VolSnapshot[] {
  const out: VolSnapshot[] = [];
  for (const c of CONTRACTS) {
    const snap = buildVolSnapshot(c.symbol);
    if (snap) out.push(snap);
  }
  return out.sort((a, b) => b.regimeScore - a.regimeScore);
}
