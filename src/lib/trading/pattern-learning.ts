/**
 * Pattern Learning & Self-Improvement Engine
 *
 * Tracks prediction accuracy over time and adjusts model weights.
 * Also mines historical patterns for recurring setups.
 *
 * Key features:
 *  1. Prediction history tracking (every prediction recorded)
 *  2. Accuracy evaluation (direction + magnitude)
 *  3. Dynamic weight adjustment (reinforcement learning)
 *  4. Pattern mining (find recurring candle sequences)
 *  5. Adaptation log (tracks how the system improves over time)
 */

import type { Candle } from "./types";

// ============================================================
// 1. PREDICTION HISTORY TRACKING
// ============================================================

export interface PredictionRecord {
  id: string;
  timestamp: number;
  symbol: string;
  modelName: string;
  predictedPrice: number;
  predictedDirection: "UP" | "DOWN" | "FLAT";
  actualPrice?: number;
  actualDirection?: "UP" | "DOWN" | "FLAT";
  priceAtPrediction: number;
  barsAhead: number;
  // Evaluation
  directionCorrect?: boolean;
  mae?: number; // mean absolute error (price)
  mape?: number; // mean absolute percentage error
  evaluated: boolean;
  evaluatedAt?: number;
}

export interface ModelPerformance {
  modelName: string;
  totalPredictions: number;
  evaluatedPredictions: number;
  directionAccuracy: number; // % of correct direction calls
  mae: number; // average absolute error
  mape: number; // average % error
  weight: number; // current ensemble weight (0-1)
  recentAccuracy: number; // rolling 20-prediction accuracy
  streak: number; // current correct streak (positive) or wrong streak (negative)
  last10: boolean[]; // last 10 results
}

// ============================================================
// 2. ACCURACY EVALUATION
// ============================================================

export function evaluatePrediction(record: PredictionRecord, actualPrice: number): PredictionRecord {
  const direction: "UP" | "DOWN" | "FLAT" = actualPrice > record.priceAtPrediction ? "UP" : actualPrice < record.priceAtPrediction ? "DOWN" : "FLAT";
  const directionCorrect = record.predictedDirection === direction;
  const mae = Math.abs(record.predictedPrice - actualPrice);
  const mape = record.priceAtPrediction > 0 ? (mae / record.priceAtPrediction) * 100 : 0;
  return {
    ...record,
    actualPrice,
    actualDirection: direction,
    directionCorrect,
    mae,
    mape,
    evaluated: true,
    evaluatedAt: Date.now(),
  };
}

/**
 * Evaluate all pending predictions that are due (enough bars have passed).
 */
export function evaluatePendingPredictions(
  records: PredictionRecord[],
  candles: Candle[],
): PredictionRecord[] {
  return records.map((r) => {
    if (r.evaluated) return r;
    // Find the candle at prediction time + barsAhead
    const targetTime = r.timestamp + r.barsAhead * 60000; // assume 1-min bars
    const now = Date.now();
    if (now < targetTime && candles.length > 0) {
      // Not enough time has passed yet
      return r;
    }
    // Find the candle closest to target time
    const futureCandle = candles.find((c) => c.time >= targetTime);
    if (!futureCandle) return r;
    return evaluatePrediction(r, futureCandle.close);
  });
}

// ============================================================
// 3. DYNAMIC WEIGHT ADJUSTMENT (reinforcement learning)
// ============================================================

export function computeModelPerformance(records: PredictionRecord[], modelName: string): ModelPerformance {
  const modelRecords = records.filter((r) => r.modelName === modelName);
  const evaluated = modelRecords.filter((r) => r.evaluated);
  const total = modelRecords.length;
  const evaluatedCount = evaluated.length;
  const directionCorrect = evaluated.filter((r) => r.directionCorrect).length;
  const directionAccuracy = evaluatedCount > 0 ? directionCorrect / evaluatedCount : 0;
  const mae = evaluatedCount > 0 ? evaluated.reduce((s, r) => s + (r.mae ?? 0), 0) / evaluatedCount : 0;
  const mape = evaluatedCount > 0 ? evaluated.reduce((s, r) => s + (r.mape ?? 0), 0) / evaluatedCount : 0;
  // Recent accuracy: last 20 evaluated
  const recent = evaluated.slice(-20);
  const recentCorrect = recent.filter((r) => r.directionCorrect).length;
  const recentAccuracy = recent.length > 0 ? recentCorrect / recent.length : 0;
  // Streak
  let streak = 0;
  for (let i = evaluated.length - 1; i >= 0; i--) {
    if (evaluated[i].directionCorrect) streak = streak >= 0 ? streak + 1 : 1;
    else streak = streak <= 0 ? streak - 1 : -1;
  }
  // Last 10
  const last10 = evaluated.slice(-10).map((r) => r.directionCorrect ?? false);
  // Weight: based on recent accuracy with a floor of 0.05 and ceiling of 0.5
  const weight = Math.max(0.05, Math.min(0.5, recentAccuracy));
  return {
    modelName,
    totalPredictions: total,
    evaluatedPredictions: evaluatedCount,
    directionAccuracy,
    mae,
    mape,
    weight,
    recentAccuracy,
    streak,
    last10,
  };
}

/**
 * Compute performance for all models and return normalized weights.
 */
export function computeEnsembleWeights(records: PredictionRecord[], modelNames: string[]): ModelPerformance[] {
  const performances = modelNames.map((name) => computeModelPerformance(records, name));
  // Normalize weights to sum to 1
  const totalWeight = performances.reduce((s, p) => s + p.weight, 0);
  if (totalWeight > 0) {
    for (const p of performances) p.weight = p.weight / totalWeight;
  } else {
    // Equal weights as fallback
    for (const p of performances) p.weight = 1 / modelNames.length;
  }
  return performances;
}

// ============================================================
// 4. PATTERN MINING (find recurring candle sequences)
// ============================================================

export interface CandlePattern {
  id: string;
  sequence: ("UP" | "DOWN")[]; // simplified to up/down candles
  length: number;
  occurrences: number;
  avgFollowUpReturn: number; // average return after pattern
  winRate: number; // % of times the follow-up was positive
  lastSeen: number;
  significance: number; // 0-1, how statistically significant
}

/**
 * Mine candle patterns of a given length from history.
 * Returns patterns sorted by significance.
 */
export function minePatterns(candles: Candle[], patternLength: number = 3, minOccurrences: number = 3): CandlePattern[] {
  if (candles.length < patternLength + 5) return [];
  const patterns = new Map<string, { sequence: ("UP" | "DOWN")[]; followUps: number[]; lastSeen: number }>();
  for (let i = 0; i <= candles.length - patternLength - 1; i++) {
    const sequence: ("UP" | "DOWN")[] = [];
    for (let j = 0; j < patternLength; j++) {
      sequence.push(candles[i + j].close >= candles[i + j].open ? "UP" : "DOWN");
    }
    const key = sequence.join("-");
    const followUpReturn = (candles[i + patternLength].close - candles[i + patternLength - 1].close) / candles[i + patternLength - 1].close;
    if (!patterns.has(key)) {
      patterns.set(key, { sequence, followUps: [], lastSeen: candles[i].time });
    }
    const p = patterns.get(key)!;
    p.followUps.push(followUpReturn);
    p.lastSeen = Math.max(p.lastSeen, candles[i].time);
  }
  const results: CandlePattern[] = [];
  for (const [key, p] of patterns) {
    if (p.followUps.length < minOccurrences) continue;
    const avgReturn = p.followUps.reduce((s, v) => s + v, 0) / p.followUps.length;
    const wins = p.followUps.filter((v) => v > 0).length;
    const winRate = wins / p.followUps.length;
    // Significance: how far winRate is from 0.5, scaled by sample size
    const z = Math.abs(winRate - 0.5) * Math.sqrt(p.followUps.length);
    const significance = Math.min(1, z / 2); // cap at 1
    results.push({
      id: `pat-${key}`,
      sequence: p.sequence,
      length: patternLength,
      occurrences: p.followUps.length,
      avgFollowUpReturn: avgReturn,
      winRate,
      lastSeen: p.lastSeen,
      significance,
    });
  }
  return results.sort((a, b) => b.significance - a.significance);
}

/**
 * Check if the current candle sequence matches any known pattern.
 */
export function matchCurrentPattern(candles: Candle[], patterns: CandlePattern[], patternLength: number = 3): CandlePattern | null {
  if (candles.length < patternLength) return null;
  const currentSeq: ("UP" | "DOWN")[] = [];
  for (let i = candles.length - patternLength; i < candles.length; i++) {
    currentSeq.push(candles[i].close >= candles[i].open ? "UP" : "DOWN");
  }
  const key = currentSeq.join("-");
  return patterns.find((p) => p.id === `pat-${key}`) ?? null;
}

// ============================================================
// 5. ADAPTATION LOG (track system improvement over time)
// ============================================================

export interface AdaptationEntry {
  timestamp: number;
  event: string;
  details: string;
  metric?: number;
}

export function logAdaptation(entries: AdaptationEntry[], event: string, details: string, metric?: number): AdaptationEntry[] {
  return [{ timestamp: Date.now(), event, details, metric }, ...entries].slice(0, 100);
}
