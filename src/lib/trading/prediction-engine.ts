/**
 * Multi-Model Prediction Engine
 *
 * Combines multiple prediction models into an ensemble forecast:
 *  1. Hidden Markov Model (HMM) — regime-based probability projection
 *  2. Kalman Filter — adaptive price tracking with prediction
 *  3. ARIMA(1,1,1) — autoregressive integrated moving average
 *  4. GARCH(1,1) — volatility forecasting
 *  5. Mean-Reversion (OU) — Ornstein-Uhlenbeck pull prediction
 *  6. Momentum Continuation — trend persistence model
 *  7. Bayesian Ensemble — probability-weighted combination
 *
 * The ensemble self-learns by tracking each model's recent accuracy
 * and dynamically adjusting weights.
 */
import type { Candle } from "./types";

// ============================================================
// 1. HIDDEN MARKOV MODEL (simplified 3-state)
// States: BULL, BEAR, NEUTRAL
// ============================================================

export interface HMMState {
  name: string;
  prob: number;
}

export interface HMMResult {
  states: HMMState[];
  currentState: string;
  transitionMatrix: number[][]; // [from][to]
  emissionParams: { mean: number; std: number }[];
  predictedStates: { state: string; prob: number }[];
}

/**
 * Simplified HMM with 3 states (bull/bear/neutral).
 * Uses Baum-Welch-style EM on returns to estimate parameters.
 */
export function fitHMM(returns: number[], nStates: number = 3): HMMResult {
  if (returns.length < 30) {
    return {
      states: [{ name: "NEUTRAL", prob: 1 }],
      currentState: "NEUTRAL",
      transitionMatrix: [[1]],
      emissionParams: [{ mean: 0, std: 0.01 }],
      predictedStates: [{ state: "NEUTRAL", prob: 1 }],
    };
  }
  const stateNames = nStates === 3 ? ["BEAR", "NEUTRAL", "BULL"] : ["S0", "S1", "S2", "S3"].slice(0, nStates);
  // Initialize emission params: cluster returns into nStates groups
  const sorted = [...returns].sort((a, b) => a - b);
  const emissionParams: { mean: number; std: number }[] = [];
  for (let i = 0; i < nStates; i++) {
    const start = Math.floor((i / nStates) * sorted.length);
    const end = Math.floor(((i + 1) / nStates) * sorted.length);
    const slice = sorted.slice(start, end);
    const mean = slice.reduce((s, v) => s + v, 0) / Math.max(slice.length, 1);
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(slice.length - 1, 1);
    emissionParams.push({ mean, std: Math.sqrt(variance) || 0.001 });
  }
  // Initialize transition matrix (slight persistence bias)
  const transitionMatrix: number[][] = [];
  for (let i = 0; i < nStates; i++) {
    const row: number[] = [];
    for (let j = 0; j < nStates; j++) {
      row.push(i === j ? 0.6 : 0.4 / (nStates - 1));
    }
    transitionMatrix.push(row);
  }
  // Simplified EM: classify each return to nearest state, count transitions
  const classifications: number[] = returns.map((r) => {
    let bestState = 0;
    let bestDist = Infinity;
    for (let s = 0; s < nStates; s++) {
      const dist = Math.abs(r - emissionParams[s].mean);
      if (dist < bestDist) {
        bestDist = dist;
        bestState = s;
      }
    }
    return bestState;
  });
  // Update transition matrix from observed transitions
  for (let i = 0; i < nStates; i++) {
    let total = 0;
    for (let j = 0; j < nStates; j++) transitionMatrix[i][j] = 0.01;
    for (let t = 1; t < classifications.length; t++) {
      if (classifications[t - 1] === i) {
        transitionMatrix[i][classifications[t]] += 1;
        total++;
      }
    }
    for (let j = 0; j < nStates; j++) transitionMatrix[i][j] /= (total + nStates * 0.01);
  }
  // Current state distribution (from last classified return)
  const currentStateIdx = classifications[classifications.length - 1];
  const stateProbs: number[] = new Array(nStates).fill(0);
  stateProbs[currentStateIdx] = 1;
  // Predict next state probabilities
  const predictedStateProbs: number[] = new Array(nStates).fill(0);
  for (let j = 0; j < nStates; j++) {
    for (let i = 0; i < nStates; i++) {
      predictedStateProbs[j] += stateProbs[i] * transitionMatrix[i][j];
    }
  }
  // Predict 5 steps ahead
  const predictedStates: { state: string; prob: number }[] = [];
  let currentProbs = [...predictedStateProbs];
  for (let step = 0; step < 5; step++) {
    const nextProbs = new Array(nStates).fill(0);
    for (let j = 0; j < nStates; j++) {
      for (let i = 0; i < nStates; i++) {
        nextProbs[j] += currentProbs[i] * transitionMatrix[i][j];
      }
    }
    currentProbs = nextProbs;
  }
  for (let s = 0; s < nStates; s++) {
    predictedStates.push({ state: stateNames[s], prob: currentProbs[s] });
  }
  return {
    states: stateProbs.map((p, i) => ({ name: stateNames[i], prob: p })),
    currentState: stateNames[currentStateIdx],
    transitionMatrix,
    emissionParams,
    predictedStates,
  };
}

// ============================================================
// 2. KALMAN FILTER (local linear trend model)
// ============================================================

export interface KalmanResult {
  filtered: number[]; // smoothed price estimates
  predicted: number[]; // one-step-ahead predictions
  gain: number[]; // Kalman gain over time
  residuals: number[]; // prediction errors
  nextPrediction: number; // next bar prediction
  confidence: number;
}

export function kalmanPredict(closes: number[], processNoise: number = 0.001, measurementNoise: number = 0.01): KalmanResult {
  if (closes.length < 5) {
    return { filtered: [...closes], predicted: [...closes], gain: [1], residuals: [0], nextPrediction: closes[0] ?? 0, confidence: 0 };
  }
  const Q = processNoise; // process noise
  const R = measurementNoise; // measurement noise
  let x = closes[0]; // initial state estimate
  let v = 0; // initial velocity (trend)
  let P = 1; // error covariance
  const filtered: number[] = [x];
  const predicted: number[] = [x];
  const gain: number[] = [1];
  const residuals: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    // Predict
    const xPred = x + v;
    const vPred = v;
    const PPred = P + Q;
    // Update
    const K = PPred / (PPred + R);
    const residual = closes[i] - xPred;
    x = xPred + K * residual;
    v = vPred + K * 0.1 * residual; // slow trend update
    P = (1 - K) * PPred;
    filtered.push(x);
    predicted.push(xPred);
    gain.push(K);
    residuals.push(residual);
  }
  // Next prediction: x + v
  const nextPrediction = x + v;
  // Confidence: inverse of residual variance
  const recentResiduals = residuals.slice(-20);
  const meanRes = recentResiduals.reduce((s, v) => s + v, 0) / recentResiduals.length;
  const varRes = recentResiduals.reduce((s, v) => s + (v - meanRes) ** 2, 0) / Math.max(recentResiduals.length - 1, 1);
  const confidence = Math.max(0, Math.min(1, 1 - Math.sqrt(varRes) / (closes[closes.length - 1] * 0.01)));
  return { filtered, predicted, gain, residuals, nextPrediction, confidence };
}

// ============================================================
// 3. ARIMA(1,1,1) — simplified
// ============================================================

export interface ARIMAResult {
  forecast: number[];
  residuals: number[];
  params: { ar: number; ma: number };
  aic: number;
}

export function arimaForecast(closes: number[], steps: number = 5): ARIMAResult {
  if (closes.length < 20) {
    return { forecast: [], residuals: [], params: { ar: 0, ma: 0 }, aic: Infinity };
  }
  // Difference once (I=1)
  const diffed: number[] = [];
  for (let i = 1; i < closes.length; i++) diffed.push(closes[i] - closes[i - 1]);
  // Estimate AR(1) coefficient: phi = cor(y_t, y_{t-1})
  const mean = diffed.reduce((s, v) => s + v, 0) / diffed.length;
  let cov = 0;
  let var0 = 0;
  for (let i = 1; i < diffed.length; i++) {
    cov += (diffed[i] - mean) * (diffed[i - 1] - mean);
    var0 += (diffed[i - 1] - mean) ** 2;
  }
  const phi = var0 > 0 ? cov / var0 : 0;
  // Estimate MA(1): from residuals
  const residuals: number[] = diffed.map((d, i) => i === 0 ? 0 : d - phi * diffed[i - 1]);
  let maCov = 0;
  let maVar = 0;
  for (let i = 1; i < residuals.length; i++) {
    maCov += residuals[i] * residuals[i - 1];
    maVar += residuals[i] ** 2;
  }
  const theta = maVar > 0 ? maCov / maVar : 0;
  // Forecast
  const forecast: number[] = [];
  const lastDiff = diffed[diffed.length - 1];
  const lastResidual = residuals[residuals.length - 1];
  let predDiff = phi * lastDiff + theta * lastResidual;
  const lastClose = closes[closes.length - 1];
  let predPrice = lastClose + predDiff;
  for (let s = 0; s < steps; s++) {
    forecast.push(predPrice);
    predDiff = phi * predDiff;
    predPrice += predDiff;
  }
  // AIC (simplified)
  const ssr = residuals.reduce((s, r) => s + r * r, 0);
  const aic = closes.length * Math.log(ssr / closes.length) + 4;
  return { forecast, residuals, params: { ar: phi, ma: theta }, aic };
}

// ============================================================
// 4. GARCH(1,1) Volatility Forecast
// ============================================================

export interface GARCHResult {
  forecast: number[]; // predicted volatility (daily) for next N steps
  params: { omega: number; alpha: number; beta: number };
  longRunVar: number;
  currentVar: number;
}

export function garchForecast(returns: number[], steps: number = 5): GARCHResult {
  if (returns.length < 30) {
    return { forecast: [], params: { omega: 0.0001, alpha: 0.1, beta: 0.85 }, longRunVar: 0.0001, currentVar: 0.0001 };
  }
  // Estimate GARCH(1,1) via method of moments
  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const sqRets = returns.map((r) => (r - mean) ** 2);
  const sampleVar = sqRets.reduce((s, v) => s + v, 0) / (sqRets.length - 1);
  // ACF of squared returns
  let ac1num = 0;
  for (let i = 1; i < sqRets.length; i++) ac1num += (sqRets[i] - sampleVar) * (sqRets[i - 1] - sampleVar);
  const ac1 = ac1num / (sqRets.reduce((s, v) => s + (v - sampleVar) ** 2, 0));
  let ac2num = 0;
  for (let i = 2; i < sqRets.length; i++) ac2num += (sqRets[i] - sampleVar) * (sqRets[i - 2] - sampleVar);
  const ac2 = ac2num / (sqRets.reduce((s, v) => s + (v - sampleVar) ** 2, 0));
  const persistence = Math.min(0.999, ac1 + ac2 * 0.5);
  const beta = Math.max(0.5, Math.min(0.95, persistence * 0.9));
  const alpha = Math.max(0.01, Math.min(0.3, persistence - beta));
  const omega = sampleVar * (1 - persistence);
  const longRunVar = omega / (1 - alpha - beta);
  // Current variance: EWMA of recent squared returns
  let currentVar = sampleVar;
  const lambda = 0.94;
  for (let i = 0; i < sqRets.length; i++) {
    currentVar = lambda * currentVar + (1 - lambda) * sqRets[i];
  }
  // Forecast: sigma2_t+h = omega + alpha*eps2 + beta*sigma2
  const forecast: number[] = [];
  let var_ = currentVar;
  for (let s = 0; s < steps; s++) {
    var_ = omega + alpha * (returns[returns.length - 1] - mean) ** 2 + beta * var_;
    forecast.push(Math.sqrt(var_));
  }
  return { forecast, params: { omega, alpha, beta }, longRunVar, currentVar };
}

// ============================================================
// 5. MEAN REVERSION (Ornstein-Uhlenbeck)
// ============================================================

export interface OUResult {
  halfLife: number;
  meanLevel: number;
  kappa: number; // mean reversion speed
  forecast: number[]; // predicted prices
  zScore: number;
}

export function ouForecast(closes: number[], steps: number = 5): OUResult {
  if (closes.length < 30) {
    return { halfLife: Infinity, meanLevel: closes[0] ?? 0, kappa: 0, forecast: [], zScore: 0 };
  }
  // Estimate OU parameters via OLS: dx = kappa * (theta - x) * dt + sigma * dW
  // => dx = a + b * x_{t-1}, where b = -kappa, a = kappa * theta
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  const n = closes.length - 1;
  for (let i = 1; i < closes.length; i++) {
    const x = closes[i - 1];
    const y = closes[i] - closes[i - 1]; // dx
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const b = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const a = (sumY - b * sumX) / n;
  const kappa = -b;
  const theta = kappa > 0 ? a / kappa : closes[closes.length - 1];
  const halfLife = kappa > 0 ? Math.log(2) / kappa : Infinity;
  // Z-score: how far from mean
  const recentSlice = closes.slice(-30);
  const sma = recentSlice.reduce((s, v) => s + v, 0) / recentSlice.length;
  const sd = Math.sqrt(recentSlice.reduce((s, v) => s + (v - sma) ** 2, 0) / recentSlice.length);
  const zScore = sd > 0 ? (closes[closes.length - 1] - sma) / sd : 0;
  // Forecast: x_t+h = theta + (x_t - theta) * exp(-kappa * h)
  const forecast: number[] = [];
  const currentPrice = closes[closes.length - 1];
  for (let s = 1; s <= steps; s++) {
    const pred = theta + (currentPrice - theta) * Math.exp(-kappa * s);
    forecast.push(pred);
  }
  return { halfLife, meanLevel: theta, kappa, forecast, zScore };
}

// ============================================================
// 6. MOMENTUM CONTINUATION
// ============================================================

export interface MomentumResult {
  forecast: number[];
  roc: number; // rate of change
  strength: number; // 0-1
}

export function momentumForecast(closes: number[], lookback: number = 10, steps: number = 5): MomentumResult {
  if (closes.length < lookback + 1) {
    return { forecast: [], roc: 0, strength: 0 };
  }
  const past = closes[closes.length - 1 - lookback];
  const current = closes[closes.length - 1];
  const roc = (current - past) / past;
  // Strength: |roc| relative to typical |roc|
  const rocs: number[] = [];
  for (let i = lookback; i < closes.length; i++) {
    rocs.push((closes[i] - closes[i - lookback]) / closes[i - lookback]);
  }
  const meanRoc = rocs.reduce((s, v) => s + Math.abs(v), 0) / rocs.length;
  const strength = meanRoc > 0 ? Math.min(1, Math.abs(roc) / (meanRoc * 2)) : 0;
  // Forecast: continue at decaying rate
  const forecast: number[] = [];
  let price = current;
  const decayRate = 0.85; // each step retains 85% of momentum
  for (let s = 1; s <= steps; s++) {
    const stepRoc = roc * Math.pow(decayRate, s);
    price = price * (1 + stepRoc / lookback);
    forecast.push(price);
  }
  return { forecast, roc, strength };
}

// ============================================================
// 7. BAYESIAN ENSEMBLE
// ============================================================

export interface ModelPrediction {
  name: string;
  forecast: number[];
  weight: number; // dynamic weight based on recent accuracy
  confidence: number;
}

export interface EnsemblePrediction {
  combined: number[]; // weighted average forecast
  models: ModelPrediction[];
  bullProb: number;
  bearProb: number;
  expectedMove: number;
  expectedMovePct: number;
  confidence: number;
  // For neon candle overlay
  predictedCandles: { open: number; high: number; low: number; close: number; volume: number }[];
  // Accuracy tracking for self-learning
  modelAccuracies: { name: string; accuracy: number; samples: number }[];
}

/**
 * Run all prediction models and combine into ensemble forecast.
 * `pastAccuracies` is used for self-learning weight adjustment.
 */
export function ensemblePredict(
  candles: Candle[],
  steps: number = 5,
  pastAccuracies?: { name: string; accuracy: number; samples: number }[],
): EnsemblePrediction {
  if (candles.length < 50) {
    return {
      combined: [],
      models: [],
      bullProb: 0.33,
      bearProb: 0.33,
      expectedMove: 0,
      expectedMovePct: 0,
      confidence: 0,
      predictedCandles: [],
      modelAccuracies: [],
    };
  }
  const closes = candles.map((c) => c.close);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) returns.push(closes[i] / closes[i - 1] - 1);
  const lastPrice = closes[closes.length - 1];

  // Run each model
  const kalman = kalmanPredict(closes);
  const arima = arimaForecast(closes, steps);
  const garch = garchForecast(returns, steps);
  const ou = ouForecast(closes, steps);
  const momentum = momentumForecast(closes, 10, steps);

  // HMM gives probabilities, not price — use for direction
  const hmm = fitHMM(returns, 3);
  const bullProbHMM = hmm.predictedStates.find((s) => s.state === "BULL")?.prob ?? 0.33;
  const bearProbHMM = hmm.predictedStates.find((s) => s.state === "BEAR")?.prob ?? 0.33;

  // Build model predictions
  const models: ModelPrediction[] = [
    {
      name: "Kalman Filter",
      forecast: Array(steps).fill(kalman.nextPrediction),
      weight: pastAccuracies?.find((a) => a.name === "Kalman Filter")?.accuracy ?? 0.2,
      confidence: kalman.confidence,
    },
    {
      name: "ARIMA(1,1,1)",
      forecast: arima.forecast,
      weight: pastAccuracies?.find((a) => a.name === "ARIMA(1,1,1)")?.accuracy ?? 0.2,
      confidence: Math.max(0, 1 - arima.aic / 10000),
    },
    {
      name: "Mean Reversion (OU)",
      forecast: ou.forecast,
      weight: pastAccuracies?.find((a) => a.name === "Mean Reversion (OU)")?.accuracy ?? 0.2,
      confidence: Math.max(0, Math.min(1, 1 - Math.abs(ou.zScore) / 4)),
    },
    {
      name: "Momentum",
      forecast: momentum.forecast,
      weight: pastAccuracies?.find((a) => a.name === "Momentum")?.accuracy ?? 0.2,
      confidence: momentum.strength,
    },
    {
      name: "HMM Ensemble",
      forecast: ou.forecast.map((p, i) => {
        // HMM-influenced: blend OU with momentum based on HMM probs
        const momP = momentum.forecast[i] ?? p;
        return p * (1 - bullProbHMM * 0.3) + momP * (bullProbHMM * 0.3);
      }),
      weight: pastAccuracies?.find((a) => a.name === "HMM Ensemble")?.accuracy ?? 0.2,
      confidence: (bullProbHMM + bearProbHMM) / 2,
    },
  ];

  // Normalize weights
  const totalWeight = models.reduce((s, m) => s + Math.max(0.01, m.weight), 0);
  for (const m of models) m.weight = Math.max(0.01, m.weight) / totalWeight;

  // Combined forecast: weighted average
  const combined: number[] = [];
  for (let s = 0; s < steps; s++) {
    let sum = 0;
    for (const m of models) {
      sum += (m.forecast[s] ?? lastPrice) * m.weight;
    }
    combined.push(sum);
  }

  // Direction probabilities from ensemble
  const expectedMove = combined[combined.length - 1] - lastPrice;
  const expectedMovePct = (expectedMove / lastPrice) * 100;
  // Convert to probabilities
  const bullProb = Math.max(0, Math.min(1, 0.5 + expectedMovePct / 2));
  const bearProb = 1 - bullProb;

  // Build predicted candles (neon overlay)
  // Use GARCH forecast for high/low range
  const predictedCandles: EnsemblePrediction["predictedCandles"] = [];
  let prevClose = lastPrice;
  for (let s = 0; s < steps; s++) {
    const close = combined[s];
    const open = prevClose;
    const dailyVol = garch.forecast[s] ?? 0.01;
    const range = lastPrice * dailyVol;
    const high = Math.max(open, close) + range * 0.4;
    const low = Math.min(open, close) - range * 0.4;
    const volume = Math.floor(candles[candles.length - 1].volume * (0.7 + Math.random() * 0.6));
    predictedCandles.push({ open, high, low, close, volume });
    prevClose = close;
  }

  // Overall confidence: weighted average of model confidences
  const confidence = models.reduce((s, m) => s + m.confidence * m.weight, 0);

  return {
    combined,
    models,
    bullProb,
    bearProb,
    expectedMove,
    expectedMovePct,
    confidence,
    predictedCandles,
    modelAccuracies: pastAccuracies ?? models.map((m) => ({ name: m.name, accuracy: 0.2, samples: 0 })),
  };
}

// ============================================================
// SELF-LEARNING: Track model accuracy and update weights
// ============================================================

export interface AccuracyTracker {
  modelName: string;
  predictions: { time: number; predicted: number; actual: number; error: number; correct: boolean }[];
  accuracy: number;
  samples: number;
}

/**
 * Evaluate past predictions against actual prices.
 * A prediction is "correct" if the direction (up/down) matches.
 */
export function evaluatePredictionAccuracy(
  history: { time: number; predicted: number; actualPrice: number; prevPrice: number }[],
): { accuracy: number; correct: number; total: number; mae: number } {
  if (history.length === 0) return { accuracy: 0, correct: 0, total: 0, mae: 0 };
  let correct = 0;
  let totalError = 0;
  for (const h of history) {
    const predictedDir = h.predicted > h.prevPrice ? 1 : -1;
    const actualDir = h.actualPrice > h.prevPrice ? 1 : -1;
    if (predictedDir === actualDir) correct++;
    totalError += Math.abs(h.predicted - h.actualPrice) / h.prevPrice;
  }
  return {
    accuracy: correct / history.length,
    correct,
    total: history.length,
    mae: totalError / history.length,
  };
}
