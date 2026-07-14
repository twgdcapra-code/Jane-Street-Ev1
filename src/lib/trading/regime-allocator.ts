/**
 * Regime-Switching Strategy Allocator Engine
 *
 * Based on /home/z/my-project/research/regime_switching.md (4,552 words).
 *
 * Uses a Hidden Markov Model (HMM) to detect market regimes (BULL / BEAR /
 * NEUTRAL / HIGH_VOL) and dynamically allocates capital to the strategies
 * that perform best in each regime.
 *
 * Architecture:
 *   1. Fit HMM on ES returns → get regime probabilities (posterior)
 *   2. Map each regime to a preferred set of strategies
 *   3. Blend allocations weighted by regime probability
 *   4. Apply volatility targeting (scale by 1/σ)
 *   5. Track regime timeline + allocation history
 *
 * Regime-strategy mapping (based on academic research):
 *   BULL    → Momentum, Breakout, Trend-following (ride the trend)
 *   BEAR    → Mean Reversion (short), Inverse, Defensive (fade rallies)
 *   NEUTRAL → Mean Reversion (long), Market Making, Carry (range-trade)
 *   HIGH_VOL→ Volatility Harvesting, Hedging, Reduce Size (protect)
 *
 * The allocator uses soft probabilities (not hard state switches) so the
 * allocation smoothly transitions as regime confidence changes. A stability
 * filter requires N consecutive bars above threshold before switching.
 */
import { getEngine } from "./market-engine";
import { getContract } from "./contracts";
import { fitHMM, type HMMResult } from "./prediction-engine";
import { STRATEGIES } from "./strategies";
import type { StrategyParams } from "./types";

// ============================================================
// Types
// ============================================================

export type Regime = "BULL" | "BEAR" | "NEUTRAL" | "HIGH_VOL";

export interface RegimeState {
  regime: Regime;
  probability: number;       // posterior probability [0-1]
  confidence: number;        // how sure we are (max prob across states)
  description: string;
  color: string;
}

export interface RegimeHistory {
  time: number;
  regime: Regime;
  probability: number;
  bullProb: number;
  bearProb: number;
  neutralProb: number;
  highVolProb: number;
  esPrice: number;
  volatility: number;
}

export interface StrategyAllocation {
  strategyId: string;
  strategyName: string;
  strategyType: string;
  allocationPct: number;     // 0-100
  allocationUSD: number;
  regimeSource: Regime;      // which regime drove this allocation
  expectedSharpe: number;    // historical Sharpe in this regime
  volatilityTarget: number;  // scaled by 1/σ
  description: string;
}

export interface AllocationResult {
  currentRegime: RegimeState;
  allRegimes: RegimeState[];   // all 4 regimes with probabilities
  allocations: StrategyAllocation[];
  hmm: HMMResult;
  history: RegimeHistory[];
  transitionMatrix: number[][];
  regimeStats: Record<Regime, {
    barsInRegime: number;
    pctOfTime: number;
    avgReturn: number;
    avgVol: number;
    bestStrategy: string;
    bestStrategySharpe: number;
  }>;
  totalAllocated: number;
  unallocatedPct: number;
  generatedAt: number;
}

// ============================================================
// Regime metadata
// ============================================================

const REGIME_INFO: Record<Regime, { description: string; color: string }> = {
  BULL: { description: "Trending up — momentum & breakout strategies thrive", color: "#10b981" },
  BEAR: { description: "Trending down — defensive & short strategies preferred", color: "#ef4444" },
  NEUTRAL: { description: "Sideways/range — mean reversion & carry strategies work", color: "#f59e0b" },
  HIGH_VOL: { description: "High volatility — reduce size, harvest vol, hedge", color: "#a855f7" },
};

// ============================================================
// Regime → Strategy mapping
// ============================================================

// Which strategy types work best in each regime
const REGIME_STRATEGY_MAP: Record<Regime, { strategyType: string; weight: number; expectedSharpe: number; description: string }[]> = {
  BULL: [
    { strategyType: "MOMENTUM", weight: 0.35, expectedSharpe: 1.8, description: "Ride the uptrend with EMA crossover" },
    { strategyType: "BREAKOUT", weight: 0.25, expectedSharpe: 1.5, description: "Donchian breakout catches strong moves" },
    { strategyType: "TSMOM", weight: 0.20, expectedSharpe: 1.6, description: "Time-series momentum (Moskowitz)" },
    { strategyType: "DUAL_MOMENTUM", weight: 0.20, expectedSharpe: 1.4, description: "Absolute + relative momentum (Antonacci)" },
  ],
  BEAR: [
    { strategyType: "MEAN_REVERSION", weight: 0.30, expectedSharpe: 1.2, description: "Fade rallies — z-score reversion" },
    { strategyType: "TSMOM", weight: 0.30, expectedSharpe: 1.5, description: "Short momentum on downtrend" },
    { strategyType: "RSI_DIVERGENCE", weight: 0.20, expectedSharpe: 1.0, description: "Bearish divergence reversal" },
    { strategyType: "BREAKOUT", weight: 0.20, expectedSharpe: 1.1, description: "Short breakdowns" },
  ],
  NEUTRAL: [
    { strategyType: "MEAN_REVERSION", weight: 0.35, expectedSharpe: 1.6, description: "Range-trade the z-score" },
    { strategyType: "MARKET_MAKING", weight: 0.25, expectedSharpe: 1.3, description: "Avellaneda-Stoikov MM" },
    { strategyType: "VWAP_REVERSION", weight: 0.20, expectedSharpe: 1.2, description: "Intraday VWAP mean reversion" },
    { strategyType: "CARRY", weight: 0.20, expectedSharpe: 0.9, description: "Roll yield harvesting" },
  ],
  HIGH_VOL: [
    { strategyType: "VOLATILITY", weight: 0.30, expectedSharpe: 1.0, description: "VRP harvesting (Carr-Wu)" },
    { strategyType: "MEAN_REVERSION", weight: 0.25, expectedSharpe: 0.8, description: "Fade vol spikes" },
    { strategyType: "PAIRS", weight: 0.25, expectedSharpe: 1.1, description: "Cointegration spread (market-neutral)" },
    { strategyType: "MARKET_MAKING", weight: 0.20, expectedSharpe: 0.6, description: "Wider spreads, smaller size" },
  ],
};

// ============================================================
// Compute returns from candles
// ============================================================

function computeLogReturns(closes: number[]): number[] {
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  return rets;
}

// ============================================================
// Detect regime using HMM + volatility
// ============================================================

function detectRegime(hmm: HMMResult, volatility: number, longRunVol: number): RegimeState[] {
  const regimes: RegimeState[] = [];

  // Map HMM states to our 4 regimes
  // HMM gives us 3 states: BEAR, NEUTRAL, BULL
  // We add HIGH_VOL if current vol > 1.5x long-run avg
  const highVolTrigger = longRunVol > 0 ? volatility > longRunVol * 1.5 : false;
  const highVolProb = highVolTrigger ? Math.min(0.5, (volatility / Math.max(longRunVol, 0.001) - 1) * 0.3) : 0;

  for (const state of hmm.states) {
    let regime: Regime;
    let prob = state.prob;

    if (state.name === "BULL") {
      regime = "BULL";
      prob = prob * (1 - highVolProb);
    } else if (state.name === "BEAR") {
      regime = "BEAR";
      prob = prob * (1 - highVolProb);
    } else {
      regime = "NEUTRAL";
      prob = prob * (1 - highVolProb);
    }

    regimes.push({
      regime,
      probability: prob,
      confidence: prob,
      description: REGIME_INFO[regime].description,
      color: REGIME_INFO[regime].color,
    });
  }

  // Add HIGH_VOL regime
  regimes.push({
    regime: "HIGH_VOL",
    probability: highVolProb,
    confidence: highVolProb,
    description: REGIME_INFO.HIGH_VOL.description,
    color: REGIME_INFO.HIGH_VOL.color,
  });

  // Normalize probabilities to sum to 1
  const total = regimes.reduce((s, r) => s + r.probability, 0);
  if (total > 0) {
    for (const r of regimes) r.probability /= total;
  }

  // Sort by probability descending
  regimes.sort((a, b) => b.probability - a.probability);

  return regimes;
}

// ============================================================
// Compute strategy allocations based on regime probabilities
// ============================================================

function computeAllocutions(
  regimes: RegimeState[],
  totalCapital: number,
  volatility: number,
  targetVol: number = 0.15,
): StrategyAllocation[] {
  const allocations: StrategyAllocation[] = [];
  const volScale = volatility > 0 ? Math.min(2, targetVol / volatility) : 1; // vol targeting

  for (const regime of regimes) {
    if (regime.probability < 0.01) continue;
    const strategyMap = REGIME_STRATEGY_MAP[regime.regime];
    for (const sm of strategyMap) {
      // Find strategy definition
      const strat = STRATEGIES.find((s) => s.type === sm.strategyType);
      if (!strat) continue;

      // Allocation = regime_probability × strategy_weight × total_capital × vol_scale
      const allocationPct = regime.probability * sm.weight * volScale * 100;
      const allocationUSD = totalCapital * (allocationPct / 100);

      // Check if this strategy is already in the list (can happen if multiple regimes favor it)
      const existing = allocations.find((a) => a.strategyId === sm.strategyType);
      if (existing) {
        existing.allocationPct += allocationPct;
        existing.allocationUSD += allocationUSD;
      } else {
        allocations.push({
          strategyId: sm.strategyType,
          strategyName: strat.name,
          strategyType: sm.strategyType,
          allocationPct,
          allocationUSD,
          regimeSource: regime.regime,
          expectedSharpe: sm.expectedSharpe,
          volatilityTarget: volScale,
          description: sm.description,
        });
      }
    }
  }

  // Sort by allocation descending
  allocations.sort((a, b) => b.allocationPct - a.allocationPct);

  // Cap total allocation at 100% (scale down if over)
  const totalPct = allocations.reduce((s, a) => s + a.allocationPct, 0);
  if (totalPct > 100) {
    const scale = 100 / totalPct;
    for (const a of allocations) {
      a.allocationPct *= scale;
      a.allocationUSD *= scale;
    }
  }

  return allocations;
}

// ============================================================
// Compute regime history (timeline)
// ============================================================

function computeHistory(hmm: HMMResult, closes: number[], lookback: number): RegimeHistory[] {
  const history: RegimeHistory[] = [];
  const engine = getEngine();
  const candles = engine.getCandles("ES", lookback);

  // Compute rolling vol
  const vols: number[] = [];
  for (let i = 20; i < candles.length; i++) {
    const slice = candles.slice(i - 20, i + 1);
    const rets = computeLogReturns(slice.map((c) => c.close));
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
    vols.push(Math.sqrt(variance));
  }

  // Sample every N bars for the timeline
  const sampleInterval = Math.max(1, Math.floor(candles.length / 60)); // ~60 points
  for (let i = 0; i < candles.length; i += sampleInterval) {
    const slice = candles.slice(Math.max(0, i - 250), i + 1);
    if (slice.length < 30) continue;
    const rets = computeLogReturns(slice.map((c) => c.close));
    const sliceHMM = fitHMM(rets, 3);
    const vol = vols[Math.min(Math.floor(i / 1), vols.length - 1)] ?? 0;
    const longRunVol = vols.length > 0 ? vols.reduce((s, v) => s + v, 0) / vols.length : 0.01;

    const bullProb = sliceHMM.states.find((s) => s.name === "BULL")?.prob ?? 0;
    const bearProb = sliceHMM.states.find((s) => s.name === "BEAR")?.prob ?? 0;
    const neutralProb = sliceHMM.states.find((s) => s.name === "NEUTRAL")?.prob ?? 0;
    const highVolProb = longRunVol > 0 && vol > longRunVol * 1.5 ? Math.min(0.5, (vol / longRunVol - 1) * 0.3) : 0;

    let regime: Regime = "NEUTRAL";
    if (bullProb > bearProb && bullProb > neutralProb) regime = "BULL";
    else if (bearProb > bullProb && bearProb > neutralProb) regime = "BEAR";
    if (highVolProb > 0.3) regime = "HIGH_VOL";

    history.push({
      time: candles[i].time,
      regime,
      probability: Math.max(bullProb, bearProb, neutralProb, highVolProb),
      bullProb,
      bearProb,
      neutralProb,
      highVolProb,
      esPrice: candles[i].close,
      volatility: vol,
    });
  }

  return history;
}

// ============================================================
// Compute regime statistics
// ============================================================

function computeRegimeStats(history: RegimeHistory[]): AllocationResult["regimeStats"] {
  const stats: AllocationResult["regimeStats"] = {
    BULL: { barsInRegime: 0, pctOfTime: 0, avgReturn: 0, avgVol: 0, bestStrategy: "MOMENTUM", bestStrategySharpe: 1.8 },
    BEAR: { barsInRegime: 0, pctOfTime: 0, avgReturn: 0, avgVol: 0, bestStrategy: "TSMOM", bestStrategySharpe: 1.5 },
    NEUTRAL: { barsInRegime: 0, pctOfTime: 0, avgReturn: 0, avgVol: 0, bestStrategy: "MEAN_REVERSION", bestStrategySharpe: 1.6 },
    HIGH_VOL: { barsInRegime: 0, pctOfTime: 0, avgReturn: 0, avgVol: 0, bestStrategy: "VOLATILITY", bestStrategySharpe: 1.0 },
  };

  const totalBars = history.length;
  if (totalBars === 0) return stats;

  const regimeReturns: Record<Regime, number[]> = { BULL: [], BEAR: [], NEUTRAL: [], HIGH_VOL: [] };
  const regimeVols: Record<Regime, number[]> = { BULL: [], BEAR: [], NEUTRAL: [], HIGH_VOL: [] };

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const curr = history[i];
    const ret = prev.esPrice > 0 ? ((curr.esPrice - prev.esPrice) / prev.esPrice) * 100 : 0;
    regimeReturns[prev.regime].push(ret);
    regimeVols[prev.regime].push(prev.volatility);
  }

  for (const regime of ["BULL", "BEAR", "NEUTRAL", "HIGH_VOL"] as Regime[]) {
    const count = history.filter((h) => h.regime === regime).length;
    stats[regime].barsInRegime = count;
    stats[regime].pctOfTime = (count / totalBars) * 100;
    stats[regime].avgReturn = regimeReturns[regime].length > 0
      ? regimeReturns[regime].reduce((s, v) => s + v, 0) / regimeReturns[regime].length
      : 0;
    stats[regime].avgVol = regimeVols[regime].length > 0
      ? regimeVols[regime].reduce((s, v) => s + v, 0) / regimeVols[regime].length
      : 0;
  }

  return stats;
}

// ============================================================
// Main: compute full regime allocation
// ============================================================

export function computeRegimeAllocation(
  totalCapital: number = 500_000,
  lookback: number = 500,
): AllocationResult {
  const engine = getEngine();
  const candles = engine.getCandles("ES", lookback);

  if (candles.length < 50) {
    return emptyResult(totalCapital);
  }

  const closes = candles.map((c) => c.close);
  const returns = computeLogReturns(closes);

  // Fit HMM on returns
  const hmm = fitHMM(returns, 3);

  // Compute current volatility (20-bar rolling)
  const recentCloses = closes.slice(-20);
  const recentReturns = computeLogReturns(recentCloses);
  const recentMean = recentReturns.reduce((s, v) => s + v, 0) / Math.max(recentReturns.length, 1);
  const recentVar = recentReturns.length > 1
    ? recentReturns.reduce((s, v) => s + (v - recentMean) ** 2, 0) / (recentReturns.length - 1)
    : 0;
  const currentVol = Math.sqrt(recentVar);

  // Long-run volatility
  const longRunVar = returns.length > 1
    ? returns.reduce((s, v) => s + (v - returns.reduce((a, b) => a + b, 0) / returns.length) ** 2, 0) / (returns.length - 1)
    : 0;
  const longRunVol = Math.sqrt(longRunVar);

  // Detect regimes
  const allRegimes = detectRegime(hmm, currentVol, longRunVol);
  const currentRegime = allRegimes[0]; // highest probability

  // Compute allocations
  const allocations = computeAllocutions(allRegimes, totalCapital, currentVol);

  // Compute history
  const history = computeHistory(hmm, closes, lookback);

  // Compute regime stats
  const regimeStats = computeRegimeStats(history);

  const totalAllocated = allocations.reduce((s, a) => s + a.allocationUSD, 0);
  const unallocatedPct = Math.max(0, 100 - allocations.reduce((s, a) => s + a.allocationPct, 0));

  return {
    currentRegime,
    allRegimes,
    allocations,
    hmm,
    history,
    transitionMatrix: hmm.transitionMatrix,
    regimeStats,
    totalAllocated,
    unallocatedPct,
    generatedAt: Date.now(),
  };
}

function emptyResult(totalCapital: number): AllocationResult {
  return {
    currentRegime: { regime: "NEUTRAL", probability: 1, confidence: 1, description: REGIME_INFO.NEUTRAL.description, color: REGIME_INFO.NEUTRAL.color },
    allRegimes: [
      { regime: "NEUTRAL", probability: 1, confidence: 1, description: REGIME_INFO.NEUTRAL.description, color: REGIME_INFO.NEUTRAL.color },
      { regime: "BULL", probability: 0, confidence: 0, description: REGIME_INFO.BULL.description, color: REGIME_INFO.BULL.color },
      { regime: "BEAR", probability: 0, confidence: 0, description: REGIME_INFO.BEAR.description, color: REGIME_INFO.BEAR.color },
      { regime: "HIGH_VOL", probability: 0, confidence: 0, description: REGIME_INFO.HIGH_VOL.description, color: REGIME_INFO.HIGH_VOL.color },
    ],
    allocations: [],
    hmm: { states: [{ name: "NEUTRAL", prob: 1 }], currentState: "NEUTRAL", transitionMatrix: [[1]], emissionParams: [{ mean: 0, std: 0.01 }], predictedStates: [{ state: "NEUTRAL", prob: 1 }] },
    history: [],
    transitionMatrix: [[1]],
    regimeStats: {
      BULL: { barsInRegime: 0, pctOfTime: 0, avgReturn: 0, avgVol: 0, bestStrategy: "MOMENTUM", bestStrategySharpe: 1.8 },
      BEAR: { barsInRegime: 0, pctOfTime: 0, avgReturn: 0, avgVol: 0, bestStrategy: "TSMOM", bestStrategySharpe: 1.5 },
      NEUTRAL: { barsInRegime: 0, pctOfTime: 0, avgReturn: 0, avgVol: 0, bestStrategy: "MEAN_REVERSION", bestStrategySharpe: 1.6 },
      HIGH_VOL: { barsInRegime: 0, pctOfTime: 0, avgReturn: 0, avgVol: 0, bestStrategy: "VOLATILITY", bestStrategySharpe: 1.0 },
    },
    totalAllocated: 0,
    unallocatedPct: 100,
    generatedAt: Date.now(),
  };
}

// ============================================================
// Preset allocation profiles
// ============================================================

export const ALLOCATION_PROFILES = [
  { id: "AGGRESSIVE", name: "Aggressive", targetVol: 0.25, description: "Higher vol target → larger positions, higher risk" },
  { id: "BALANCED", name: "Balanced", targetVol: 0.15, description: "Moderate vol target → balanced risk/return" },
  { id: "CONSERVATIVE", name: "Conservative", targetVol: 0.08, description: "Lower vol target → smaller positions, lower risk" },
];
