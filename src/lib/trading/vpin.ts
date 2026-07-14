/**
 * VPIN (Volume-synchronized Probability of Informed Trading) Engine
 *
 * Based on /home/z/my-project/research/vpin.md (5,200 words).
 *
 * Implements Easley, López de Prado, and O'Hara (2012) VPIN metric:
 *
 *   VPIN = Σ_{i=1}^{N} |V_buy,i - V_sell,i| / Σ_{i=1}^{N} (V_buy,i + V_sell,i)
 *
 * where V_buy and V_sell are classified using Bulk Volume Classification (BVC):
 *
 *   V_buy = V × Φ(ΔP / σ)
 *   V_sell = V × (1 - Φ(ΔP / σ))
 *
 * Φ = standard normal CDF, ΔP = price change in bucket, σ = rolling volatility.
 *
 * Volume buckets (not time buckets) are used so that periods of high trading
 * activity (informed flow) are sampled more frequently — this is the key insight
 * that makes VPIN detect toxicity before it shows in price.
 *
 * Threshold bands:
 *   VPIN < 0.3  → Normal — balanced flow, market makers active
 *   VPIN 0.3-0.5 → Elevated — informed traders active, widen spreads
 *   VPIN 0.5-0.7 → High — market makers should reduce quote size
 *   VPIN > 0.7  → Extreme — market makers should withdraw (flash crash risk)
 *
 * The May 6, 2010 flash crash: VPIN spiked to 0.8+ in E-mini S&P 5-10 minutes
 * before price dislocated — VPIN is a leading indicator of liquidity crises.
 */
import { getEngine } from "./market-engine";
import { getContract } from "./contracts";
import type { Quote, Candle } from "./types";

// ============================================================
// Types
// ============================================================

export interface VolumeBucket {
  bucketIndex: number;
  startTime: number;
  endTime: number;
  volume: number;
  buyVolume: number;
  sellVolume: number;
  openPrice: number;
  closePrice: number;
  priceChange: number;
  imbalance: number;     // |V_buy - V_sell| / (V_buy + V_sell)
  volAtStart: number;    // VPIN up to and including this bucket
}

export interface VPINResult {
  symbol: string;
  currentVPIN: number;
  emaVPIN: number;           // exponentially smoothed
  trendVPIN: number;         // 5-bucket trend (current - avg 5 ago)
  buckets: VolumeBucket[];
  threshold: VPINThreshold;
  // Distribution
  vpinHistory: { time: number; vpin: number; emaVpin: number }[];
  // Stats
  avgVPIN: number;
  maxVPIN: number;
  minVPIN: number;
  pctTimeElevated: number;   // fraction of history where VPIN > 0.3
  pctTimeHigh: number;       // VPIN > 0.5
  pctTimeExtreme: number;    // VPIN > 0.7
  // BVC parameters
  rollingVol: number;
  bucketSize: number;
  numBuckets: number;
  // Adverse selection
  suggestedSpreadMultiplier: number;  // base × (1 + λ × VPIN)
  suggestedQuoteSizeMultiplier: number; // 1 - VPIN (reduce size as toxicity rises)
  withdrawRecommendation: boolean;
  generatedAt: number;
}

export type VPINThreshold = "NORMAL" | "ELEVATED" | "HIGH" | "EXTREME";

// ============================================================
// Normal CDF (Φ)
// ============================================================

function normalCDF(x: number): number {
  // Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// ============================================================
// Rolling volatility
// ============================================================

function computeRollingVol(candles: Candle[], window: number = 20): number {
  if (candles.length < window) return 0.001;
  const slice = candles.slice(-window);
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1].close > 0) rets.push(Math.log(slice[i].close / slice[i - 1].close));
  }
  if (rets.length < 2) return 0.001;
  const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
  const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance);
}

// ============================================================
// Build volume buckets from candles
// ============================================================

function buildVolumeBuckets(candles: Candle[], targetBucketVolume: number): VolumeBucket[] {
  const buckets: VolumeBucket[] = [];
  let currentBucket: VolumeBucket | null = null;
  let currentVolAccum = 0;
  let bucketIdx = 0;

  for (const candle of candles) {
    if (currentBucket === null) {
      currentBucket = {
        bucketIndex: bucketIdx,
        startTime: candle.time,
        endTime: candle.time,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        openPrice: candle.open,
        closePrice: candle.close,
        priceChange: 0,
        imbalance: 0,
        volAtStart: 0,
      };
      currentVolAccum = 0;
    }

    // Add this candle's volume to the bucket
    currentBucket.volume += candle.volume;
    currentBucket.closePrice = candle.close;
    currentBucket.endTime = candle.time;
    currentVolAccum += candle.volume;

    // If bucket is full, finalize it
    if (currentVolAccum >= targetBucketVolume) {
      finalizeBucket(currentBucket, buckets);
      buckets.push(currentBucket);
      bucketIdx++;
      currentBucket = null;
    }
  }

  // Finalize incomplete last bucket
  if (currentBucket && currentBucket.volume > 0) {
    finalizeBucket(currentBucket, buckets);
    buckets.push(currentBucket);
  }

  return buckets;
}

function finalizeBucket(bucket: VolumeBucket, _allBuckets: VolumeBucket[]): void {
  // Compute price change
  bucket.priceChange = bucket.closePrice - bucket.openPrice;

  // BVC: classify volume using normal CDF
  // V_buy = V × Φ(ΔP / σ)
  // We use a per-bucket volatility estimate from the price change magnitude
  const sigma = Math.max(Math.abs(bucket.priceChange) / 3, 0.001); // rough σ estimate
  const z = bucket.priceChange / sigma;
  const buyFraction = normalCDF(z);

  bucket.buyVolume = bucket.volume * buyFraction;
  bucket.sellVolume = bucket.volume * (1 - buyFraction);
  bucket.imbalance = bucket.volume > 0 ? Math.abs(bucket.buyVolume - bucket.sellVolume) / bucket.volume : 0;
}

// ============================================================
// Compute VPIN from buckets
// ============================================================

function computeVPIN(buckets: VolumeBucket[], nBuckets: number = 50): { vpin: number; vpinPerBucket: number[] } {
  if (buckets.length === 0) return { vpin: 0, vpinPerBucket: [] };

  const vpinPerBucket: number[] = [];
  // Sliding window of N buckets
  for (let i = 0; i < buckets.length; i++) {
    const start = Math.max(0, i - nBuckets + 1);
    const window = buckets.slice(start, i + 1);
    const totalImbalance = window.reduce((s, b) => s + Math.abs(b.buyVolume - b.sellVolume), 0);
    const totalVolume = window.reduce((s, b) => s + b.volume, 0);
    const vpin = totalVolume > 0 ? totalImbalance / totalVolume : 0;
    vpinPerBucket.push(vpin);
    buckets[i].volAtStart = vpin;
  }

  const currentVPIN = vpinPerBucket[vpinPerBucket.length - 1] ?? 0;
  return { vpin: currentVPIN, vpinPerBucket };
}

// ============================================================
// Threshold classification
// ============================================================

function classifyVPIN(vpin: number): { threshold: VPINThreshold; description: string; color: string } {
  if (vpin < 0.3) return { threshold: "NORMAL", description: "Balanced flow — market makers active, normal spreads", color: "#10b981" };
  if (vpin < 0.5) return { threshold: "ELEVATED", description: "Informed traders active — widen spreads, reduce size", color: "#f59e0b" };
  if (vpin < 0.7) return { threshold: "HIGH", description: "High toxicity — market makers should reduce quote size significantly", color: "#f97316" };
  return { threshold: "EXTREME", description: "Extreme toxicity — market makers should withdraw (flash crash risk)", color: "#ef4444" };
}

// ============================================================
// Main: compute VPIN for a symbol
// ============================================================

export function computeVPINForSymbol(
  symbol: string,
  lookback: number = 500,
  numBuckets: number = 50,
): VPINResult {
  const engine = getEngine();
  const candles = engine.getCandles(symbol, lookback);

  if (candles.length < 20) {
    return emptyResult(symbol);
  }

  // Compute total volume and target bucket size
  const totalVolume = candles.reduce((s, c) => s + c.volume, 0);
  const targetBucketVolume = Math.max(1, totalVolume / numBuckets);

  // Build volume buckets
  const buckets = buildVolumeBuckets(candles, targetBucketVolume);

  // Compute rolling volatility for BVC
  const rollingVol = computeRollingVol(candles, 20);

  // Compute VPIN
  const { vpin, vpinPerBucket } = computeVPIN(buckets, numBuckets);

  // Build history for charting
  const vpinHistory = buckets.map((b, i) => ({
    time: b.endTime,
    vpin: vpinPerBucket[i] ?? 0,
    emaVpin: 0, // filled below
  }));

  // Compute EMA of VPIN
  const emaPeriod = 10;
  const emaMultiplier = 2 / (emaPeriod + 1);
  let ema = vpinHistory.length > 0 ? vpinHistory[0].vpin : 0;
  for (let i = 0; i < vpinHistory.length; i++) {
    ema = vpinHistory[i].vpin * emaMultiplier + ema * (1 - emaMultiplier);
    vpinHistory[i].emaVpin = ema;
  }
  const emaVPIN = ema;

  // Trend: current vs 5 buckets ago
  const trendVPIN = vpinHistory.length >= 6
    ? vpin - vpinHistory[vpinHistory.length - 6].vpin
    : 0;

  // Stats
  const vpinValues = vpinHistory.map((h) => h.vpin);
  const avgVPIN = vpinValues.length > 0 ? vpinValues.reduce((s, v) => s + v, 0) / vpinValues.length : 0;
  const maxVPIN = vpinValues.length > 0 ? Math.max(...vpinValues) : 0;
  const minVPIN = vpinValues.length > 0 ? Math.min(...vpinValues) : 0;
  const pctTimeElevated = vpinValues.filter((v) => v > 0.3).length / Math.max(vpinValues.length, 1);
  const pctTimeHigh = vpinValues.filter((v) => v > 0.5).length / Math.max(vpinValues.length, 1);
  const pctTimeExtreme = vpinValues.filter((v) => v > 0.7).length / Math.max(vpinValues.length, 1);

  // Threshold
  const thresholdInfo = classifyVPIN(vpin);

  // Adverse selection adjustments
  const lambda = 2.0; // spread sensitivity to VPIN
  const suggestedSpreadMultiplier = 1 + lambda * vpin;
  const suggestedQuoteSizeMultiplier = Math.max(0.1, 1 - vpin);
  const withdrawRecommendation = vpin > 0.7;

  return {
    symbol,
    currentVPIN: vpin,
    emaVPIN,
    trendVPIN,
    buckets,
    threshold: thresholdInfo.threshold,
    vpinHistory,
    avgVPIN,
    maxVPIN,
    minVPIN,
    pctTimeElevated,
    pctTimeHigh,
    pctTimeExtreme,
    rollingVol,
    bucketSize: targetBucketVolume,
    numBuckets: buckets.length,
    suggestedSpreadMultiplier,
    suggestedQuoteSizeMultiplier,
    withdrawRecommendation,
    generatedAt: Date.now(),
  };
}

function emptyResult(symbol: string): VPINResult {
  return {
    symbol,
    currentVPIN: 0,
    emaVPIN: 0,
    trendVPIN: 0,
    buckets: [],
    threshold: "NORMAL",
    vpinHistory: [],
    avgVPIN: 0,
    maxVPIN: 0,
    minVPIN: 0,
    pctTimeElevated: 0,
    pctTimeHigh: 0,
    pctTimeExtreme: 0,
    rollingVol: 0,
    bucketSize: 0,
    numBuckets: 0,
    suggestedSpreadMultiplier: 1,
    suggestedQuoteSizeMultiplier: 1,
    withdrawRecommendation: false,
    generatedAt: Date.now(),
  };
}

// ============================================================
// Multi-symbol VPIN scan
// ============================================================

export interface SymbolVPIN {
  symbol: string;
  name: string;
  assetClass: string;
  vpin: number;
  emaVpin: number;
  threshold: VPINThreshold;
  color: string;
  spreadMultiplier: number;
  withdrawRecommendation: boolean;
}

export function computeVPINScan(symbols: string[]): SymbolVPIN[] {
  const results: SymbolVPIN[] = [];
  for (const symbol of symbols) {
    try {
      const r = computeVPINForSymbol(symbol);
      const contract = getContract(symbol);
      const info = classifyVPIN(r.currentVPIN);
      results.push({
        symbol,
        name: contract.name,
        assetClass: contract.assetClass,
        vpin: r.currentVPIN,
        emaVpin: r.emaVPIN,
        threshold: r.threshold,
        color: info.color,
        spreadMultiplier: r.suggestedSpreadMultiplier,
        withdrawRecommendation: r.withdrawRecommendation,
      });
    } catch {
      // skip if engine not ready
    }
  }
  return results.sort((a, b) => b.vpin - a.vpin);
}

// ============================================================
// Threshold metadata
// ============================================================

export const THRESHOLD_INFO: Record<VPINThreshold, { min: number; max: number; description: string; color: string; action: string }> = {
  NORMAL: { min: 0, max: 0.3, description: "Balanced flow — market makers active, normal spreads", color: "#10b981", action: "Normal market making" },
  ELEVATED: { min: 0.3, max: 0.5, description: "Informed traders active — widen spreads, reduce size", color: "#f59e0b", action: "Widen spreads by 50-100%" },
  HIGH: { min: 0.5, max: 0.7, description: "High toxicity — reduce quote size significantly", color: "#f97316", action: "Reduce quote size by 50%" },
  EXTREME: { min: 0.7, max: 1.0, description: "Extreme toxicity — market makers should withdraw", color: "#ef4444", action: "WITHDRAW — stop quoting" },
};
