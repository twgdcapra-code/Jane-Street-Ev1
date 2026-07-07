/**
 * Regime Detection + Signal Engine + Prompt Parser + Prediction + Learning
 *
 * This file consolidates the "intelligence" layer of the Indicators Lab:
 *  1. Regime detection — classifies market state and recommends indicators
 *  2. Signal engine — combines multiple indicators with AND/OR logic
 *  3. Prompt parser — converts natural language to signal configs
 *  4. Prediction engine — forecasts next candles using Markov + indicators
 *  5. Learning log — tracks signal outcomes and computes accuracy
 */
import type { Candle } from "./types";
import {
  adx, atr, bollingerBands, cci, ema, rsi, sma, stdev,
  superTrend, macd, stochastic, williamsR, mfi,
} from "./indicators-advanced";

// ============================================================
// 1. REGIME DETECTION
// ============================================================

export type MarketRegime =
  | "TRENDING_UP"
  | "TRENDING_DOWN"
  | "RANGING"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "TRANSITION";

export interface RegimeAssessment {
  regime: MarketRegime;
  confidence: number; // 0-100
  adx: number;
  volatility: number; // annualized
  volatilityPercentile: number;
  trendStrength: number;
  description: string;
  recommendedIndicators: { name: string; reason: string }[];
  recommendedStrategies: { name: string; reason: string }[];
}

export function detectRegime(candles: Candle[]): RegimeAssessment {
  if (candles.length < 50) {
    return {
      regime: "TRANSITION",
      confidence: 0,
      adx: 0,
      volatility: 0,
      volatilityPercentile: 50,
      trendStrength: 0,
      description: "Insufficient data for regime detection.",
      recommendedIndicators: [],
      recommendedStrategies: [],
    };
  }
  const closes = candles.map((c) => c.close);
  const adxArr = adx(candles, 14);
  const lastADX = (adxArr[adxArr.length - 1] as number) ?? 0;
  const atrArr = atr(candles, 14);
  const lastATR = (atrArr[atrArr.length - 1] as number) ?? 0;
  const lastPrice = closes[closes.length - 1];
  const volPct = (lastATR / lastPrice) * 100;
  // Annualized vol
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const meanRet = rets.reduce((s, v) => s + v, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, v) => s + (v - meanRet) ** 2, 0) / (rets.length - 1));
  const annualVol = sd * Math.sqrt(252) * 100;
  // Vol percentile: compare recent vol to historical
  const vols20: number[] = [];
  for (let i = 20; i < closes.length; i++) {
    const slice = closes.slice(i - 20, i + 1);
    const r: number[] = [];
    for (let j = 1; j < slice.length; j++) r.push(Math.log(slice[j] / slice[j - 1]));
    const m = r.reduce((s, v) => s + v, 0) / r.length;
    const v = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1));
    vols20.push(v);
  }
  const currentVol = vols20[vols20.length - 1] ?? sd;
  const sortedVols = [...vols20].sort((a, b) => a - b);
  const volPercentile = sortedVols.length > 0 ? (sortedVols.indexOf(currentVol) / sortedVols.length) * 100 : 50;
  // Trend direction: SMA50 vs SMA200 proxy, or price vs SMA50
  const sma50 = sma(closes, 50);
  const sma20 = sma(closes, 20);
  const lastSMA50 = sma50[sma50.length - 1] as number;
  const lastSMA20 = sma20[sma20.length - 1] as number;
  const trendDirection = lastPrice > lastSMA50 ? 1 : -1;
  const trendStrength = Math.abs((lastPrice - lastSMA50) / lastSMA50) * 100;
  // Determine regime
  let regime: MarketRegime;
  let confidence = 50;
  if (lastADX > 25 && trendDirection > 0) {
    regime = "TRENDING_UP";
    confidence = Math.min(95, 40 + lastADX);
  } else if (lastADX > 25 && trendDirection < 0) {
    regime = "TRENDING_DOWN";
    confidence = Math.min(95, 40 + lastADX);
  } else if (volPercentile > 80) {
    regime = "HIGH_VOLATILITY";
    confidence = Math.min(90, 50 + volPercentile / 2);
  } else if (volPercentile < 20) {
    regime = "LOW_VOLATILITY";
    confidence = Math.min(90, 50 + (100 - volPercentile) / 2);
  } else if (lastADX < 20) {
    regime = "RANGING";
    confidence = Math.min(85, 40 + (20 - lastADX) * 2);
  } else {
    regime = "TRANSITION";
    confidence = 40;
  }
  // Recommendations
  const recommendedIndicators: { name: string; reason: string }[] = [];
  const recommendedStrategies: { name: string; reason: string }[] = [];
  switch (regime) {
    case "TRENDING_UP":
      recommendedIndicators.push(
        { name: "SuperTrend", reason: "Best trend-following overlay in directional markets" },
        { name: "EMA 9/21", reason: "Fast EMA crossover for trend entry timing" },
        { name: "ADX", reason: "Confirms trend strength — >25 = strong trend" },
        { name: "Parabolic SAR", reason: "Trailing stop in trending markets" },
        { name: "Ichimoku", reason: "Cloud provides dynamic support in uptrends" },
      );
      recommendedStrategies.push(
        { name: "Momentum (EMA+RSI)", reason: "Buy pullbacks in uptrend when RSI < 50" },
        { name: "Breakout (Donchian)", reason: "Buy new highs in established uptrend" },
      );
      break;
    case "TRENDING_DOWN":
      recommendedIndicators.push(
        { name: "SuperTrend", reason: "Trails downtrend, signals on flip" },
        { name: "Parabolic SAR", reason: "Trailing stop in downtrend" },
        { name: "ADX", reason: "Confirms bearish trend strength" },
        { name: "Bollinger Bands", reason: "Upper band = shorting opportunity in downtrend" },
      );
      recommendedStrategies.push(
        { name: "Momentum (short)", reason: "Sell rallies when RSI > 50" },
        { name: "Mean Reversion (short)", reason: "Short bounces to SMA50" },
      );
      break;
    case "RANGING":
      recommendedIndicators.push(
        { name: "RSI", reason: "Overbought/oversold in range — primary tool" },
        { name: "Bollinger Bands", reason: "Mean revert from band touches" },
        { name: "Stochastic", reason: "Oscillator works well in ranges" },
        { name: "CCI", reason: "Cycles between +100/-100 in range" },
      );
      recommendedStrategies.push(
        { name: "Mean Reversion", reason: "Buy oversold, sell overbought" },
        { name: "Market Making", reason: "Capture spread in range-bound markets" },
      );
      break;
    case "HIGH_VOLATILITY":
      recommendedIndicators.push(
        { name: "ATR", reason: "Size positions inversely to ATR" },
        { name: "Keltner Channels", reason: "Wider bands handle vol better than Bollinger" },
        { name: "SuperTrend", reason: "Adapts to volatility expansion" },
      );
      recommendedStrategies.push(
        { name: "Volatility (VRP)", reason: "Short elevated vol — expect mean reversion" },
        { name: "Breakout", reason: "Vol expansion often precedes strong moves" },
      );
      break;
    case "LOW_VOLATILITY":
      recommendedIndicators.push(
        { name: "TTM Squeeze", reason: "Detects vol compression before expansion" },
        { name: "Bollinger Bands", reason: "Narrow bands = squeeze = pending breakout" },
        { name: "Donchian Channels", reason: "Breakout trigger when vol expands" },
      );
      recommendedStrategies.push(
        { name: "Breakout", reason: "Low vol precedes expansion — position for breakout" },
        { name: "Mean Reversion", reason: "Low vol = stable range = revert to mean" },
      );
      break;
    case "TRANSITION":
      recommendedIndicators.push(
        { name: "MACD", reason: "Detects momentum shifts in transition" },
        { name: "ADX", reason: "Watch for ADX rising above 25 = new trend forming" },
        { name: "Volume", reason: "Volume confirms direction in transition" },
      );
      recommendedStrategies.push(
        { name: "Wait & Watch", reason: "Transition regime — reduce size until direction clarifies" },
      );
      break;
  }
  const descriptions: Record<MarketRegime, string> = {
    TRENDING_UP: `Strong uptrend (ADX ${lastADX.toFixed(1)}). Price ${trendStrength.toFixed(1)}% above SMA50. Trend-following indicators preferred.`,
    TRENDING_DOWN: `Strong downtrend (ADX ${lastADX.toFixed(1)}). Price ${trendStrength.toFixed(1)}% below SMA50. Bearish trend-following preferred.`,
    RANGING: `Range-bound market (ADX ${lastADX.toFixed(1)} < 20). Mean-reversion indicators work best. Buy oversold, sell overbought.`,
    HIGH_VOLATILITY: `High volatility regime (vol ${annualVol.toFixed(1)}% ann., ${volPercentile.toFixed(0)}th percentile). Reduce position sizes, use wider stops.`,
    LOW_VOLATILITY: `Low volatility regime (vol ${annualVol.toFixed(1)}% ann., ${volPercentile.toFixed(0)}th percentile). Squeeze — expect breakout. TTM Squeeze recommended.`,
    TRANSITION: `Market in transition (ADX ${lastADX.toFixed(1)}). Direction unclear. Wait for confirmation.`,
  };
  return {
    regime,
    confidence,
    adx: lastADX,
    volatility: annualVol,
    volatilityPercentile: volPercentile,
    trendStrength,
    description: descriptions[regime],
    recommendedIndicators,
    recommendedStrategies,
  };
}

// ============================================================
// 2. SIGNAL ENGINE
// ============================================================

export interface IndicatorCondition {
  id: string;
  indicator: string;
  params: Record<string, number>;
  operator: "ABOVE" | "BELOW" | "CROSS_ABOVE" | "CROSS_BELOW" | "BETWEEN" | "OUTSIDE";
  value: number;
  value2?: number; // for BETWEEN
  weight: number; // contribution weight
}

export interface SignalRule {
  id: string;
  conditions: IndicatorCondition[];
  logic: "AND" | "OR"; // how conditions combine
  name: string;
  enabled: boolean;
}

export interface SignalEvaluation {
  rule: SignalRule;
  fired: boolean;
  strength: number; // 0-100
  contributingConditions: { condition: IndicatorCondition; met: boolean; currentValue: number | null }[];
}

/** Evaluate a single indicator condition against candles. */
export function evaluateCondition(cond: IndicatorCondition, candles: Candle[]): { met: boolean; currentValue: number | null } {
  const closes = candles.map((c) => c.close);
  let values: (number | null)[] = [];
  switch (cond.indicator) {
    case "RSI": values = rsi(closes, cond.params.period ?? 14); break;
    case "SMA": values = sma(closes, cond.params.period ?? 20); break;
    case "EMA": values = ema(closes, cond.params.period ?? 20); break;
    case "MACD": { const m = macd(closes, cond.params.fast ?? 12, cond.params.slow ?? 26, cond.params.signal ?? 9); values = m.histogram; break; }
    case "ATR": values = atr(candles, cond.params.period ?? 14); break;
    case "CCI": values = cci(candles, cond.params.period ?? 20); break;
    case "Stochastic": { const s = stochastic(candles, cond.params.kPeriod ?? 14, cond.params.dPeriod ?? 3); values = s.k; break; }
    case "WilliamsR": values = williamsR(candles, cond.params.period ?? 14); break;
    case "MFI": values = mfi(candles, cond.params.period ?? 14); break;
    case "Bollinger": { const b = bollingerBands(closes, cond.params.period ?? 20, cond.params.std ?? 2); values = b.upper; break; }
    case "SuperTrend": { const st = superTrend(candles, cond.params.period ?? 10, cond.params.mult ?? 3); values = st.superTrend; break; }
    case "ADX": { const a = adx(candles, cond.params.period ?? 14); values = a.adx; break; }
    default: values = closes;
  }
  const lastVal = values[values.length - 1];
  const prevVal = values[values.length - 2];
  if (lastVal == null) return { met: false, currentValue: null };
  switch (cond.operator) {
    case "ABOVE": return { met: lastVal > cond.value, currentValue: lastVal };
    case "BELOW": return { met: lastVal < cond.value, currentValue: lastVal };
    case "CROSS_ABOVE": return { met: prevVal != null && prevVal <= cond.value && lastVal > cond.value, currentValue: lastVal };
    case "CROSS_BELOW": return { met: prevVal != null && prevVal >= cond.value && lastVal < cond.value, currentValue: lastVal };
    case "BETWEEN": return { met: lastVal >= cond.value && lastVal <= (cond.value2 ?? cond.value), currentValue: lastVal };
    case "OUTSIDE": return { met: lastVal < cond.value || lastVal > (cond.value2 ?? cond.value), currentValue: lastVal };
    default: return { met: false, currentValue: lastVal };
  }
}

/** Evaluate a full signal rule (combine conditions with AND/OR). */
export function evaluateRule(rule: SignalRule, candles: Candle[]): SignalEvaluation {
  const contributing = rule.conditions.map((c) => {
    const { met, currentValue } = evaluateCondition(c, candles);
    return { condition: c, met, currentValue };
  });
  let fired: boolean;
  if (rule.logic === "AND") {
    fired = contributing.every((c) => c.met);
  } else {
    fired = contributing.some((c) => c.met);
  }
  // Strength: weighted average of met conditions
  const totalWeight = rule.conditions.reduce((s, c) => s + c.weight, 0);
  const metWeight = contributing.filter((c) => c.met).reduce((s, c) => s + c.condition.weight, 0);
  const strength = totalWeight > 0 ? (metWeight / totalWeight) * 100 : 0;
  return { rule, fired, strength, contributingConditions: contributing };
}

// ============================================================
// 3. PROMPT PARSER
// ============================================================

export interface ParsedPrompt {
  conditions: IndicatorCondition[];
  logic: "AND" | "OR";
  description: string;
  understood: boolean;
}

/**
 * Parse a natural language prompt into signal conditions.
 * Uses keyword matching — not a full NLP engine, but handles common
 * trading terminology used in prompts like:
 *   "Find ES oversold with RSI below 30 and MACD bullish crossover"
 *   "Show me overbought signals when Stochastic above 80"
 *   "Bullish setup: price above SMA 50, ADX above 25"
 */
export function parsePrompt(prompt: string): ParsedPrompt {
  const lower = prompt.toLowerCase();
  const conditions: IndicatorCondition[] = [];
  // Detect logic
  const logic: "AND" | "OR" = lower.includes(" or ") ? "OR" : "AND";
  // RSI patterns
  const rsiMatch = lower.match(/rsi\s*(?:below|under|less than|<)\s*(\d+(?:\.\d+)?)/);
  if (rsiMatch) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "RSI",
      params: { period: 14 },
      operator: "BELOW",
      value: Number(rsiMatch[1]),
      weight: 1,
    });
  }
  const rsiAboveMatch = lower.match(/rsi\s*(?:above|over|greater than|>)\s*(\d+(?:\.\d+)?)/);
  if (rsiAboveMatch) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "RSI",
      params: { period: 14 },
      operator: "ABOVE",
      value: Number(rsiAboveMatch[1]),
      weight: 1,
    });
  }
  // "oversold" / "overbought"
  if (lower.includes("oversold") && !rsiMatch) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "RSI",
      params: { period: 14 },
      operator: "BELOW",
      value: 30,
      weight: 1,
    });
  }
  if (lower.includes("overbought") && !rsiAboveMatch) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "RSI",
      params: { period: 14 },
      operator: "ABOVE",
      value: 70,
      weight: 1,
    });
  }
  // MACD
  if (lower.includes("macd") && (lower.includes("bullish") || lower.includes("cross above") || lower.includes("positive"))) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "MACD",
      params: { fast: 12, slow: 26, signal: 9 },
      operator: "ABOVE",
      value: 0,
      weight: 1,
    });
  }
  if (lower.includes("macd") && (lower.includes("bearish") || lower.includes("cross below") || lower.includes("negative"))) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "MACD",
      params: { fast: 12, slow: 26, signal: 9 },
      operator: "BELOW",
      value: 0,
      weight: 1,
    });
  }
  // SMA
  const smaMatch = lower.match(/sma\s*(\d+)/);
  if (smaMatch) {
    const period = Number(smaMatch[1]);
    if (lower.includes("above") || lower.includes("over")) {
      conditions.push({
        id: `cond-${conditions.length}`,
        indicator: "SMA",
        params: { period },
        operator: "ABOVE",
        value: 0, // will be dynamic — price above SMA
        weight: 1,
      });
    }
  }
  // EMA
  const emaMatch = lower.match(/ema\s*(\d+)/);
  if (emaMatch) {
    const period = Number(emaMatch[1]);
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "EMA",
      params: { period },
      operator: "ABOVE",
      value: 0,
      weight: 1,
    });
  }
  // ADX
  const adxMatch = lower.match(/adx\s*(?:above|over|>)\s*(\d+)/);
  if (adxMatch) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "ADX",
      params: { period: 14 },
      operator: "ABOVE",
      value: Number(adxMatch[1]),
      weight: 1,
    });
  }
  if (lower.includes("trend") && lower.includes("strong") && !adxMatch) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "ADX",
      params: { period: 14 },
      operator: "ABOVE",
      value: 25,
      weight: 1,
    });
  }
  // Stochastic
  const stochMatch = lower.match(/stochastic?\s*(?:below|under|<)\s*(\d+)/);
  if (stochMatch) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "Stochastic",
      params: { kPeriod: 14, dPeriod: 3 },
      operator: "BELOW",
      value: Number(stochMatch[1]),
      weight: 1,
    });
  }
  const stochAboveMatch = lower.match(/stochastic?\s*(?:above|over|>)\s*(\d+)/);
  if (stochAboveMatch) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "Stochastic",
      params: { kPeriod: 14, dPeriod: 3 },
      operator: "ABOVE",
      value: Number(stochAboveMatch[1]),
      weight: 1,
    });
  }
  // CCI
  const cciMatch = lower.match(/cci\s*(?:below|under|<)\s*(-?\d+)/);
  if (cciMatch) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "CCI",
      params: { period: 20 },
      operator: "BELOW",
      value: Number(cciMatch[1]),
      weight: 1,
    });
  }
  // Bollinger
  if (lower.includes("bollinger") || lower.includes("lower band") || lower.includes("upper band")) {
    if (lower.includes("lower band") || lower.includes("oversold")) {
      conditions.push({
        id: `cond-${conditions.length}`,
        indicator: "Bollinger",
        params: { period: 20, std: 2 },
        operator: "BELOW",
        value: 0,
        weight: 1,
      });
    }
  }
  // ATR / volatility
  if (lower.includes("high vol") || lower.includes("volatile") || lower.includes("volatility")) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "ATR",
      params: { period: 14 },
      operator: "ABOVE",
      value: 0,
      weight: 1,
    });
  }
  // Williams %R
  if (lower.includes("williams")) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "WilliamsR",
      params: { period: 14 },
      operator: "BELOW",
      value: -80,
      weight: 1,
    });
  }
  // MFI
  if (lower.includes("mfi") || lower.includes("money flow")) {
    conditions.push({
      id: `cond-${conditions.length}`,
      indicator: "MFI",
      params: { period: 14 },
      operator: "BELOW",
      value: 20,
      weight: 1,
    });
  }
  return {
    conditions,
    logic,
    description: prompt,
    understood: conditions.length > 0,
  };
}

// ============================================================
// 4. PREDICTION ENGINE
// ============================================================

export interface CandlePrediction {
  // Predicted next N candles
  candles: { open: number; high: number; low: number; close: number; volume: number }[];
  // Direction probability
  bullProb: number;
  bearProb: number;
  neutralProb: number;
  // Expected move
  expectedMove: number;
  expectedMovePct: number;
  // Confidence
  confidence: number;
  // Methodology
  method: string;
}

/**
 * Predict next N candles using:
 *  1. Markov chain on returns (transition probabilities)
 *  2. Indicator-based directional bias
 *  3. ATR-based range estimation
 *  4. Mean reversion adjustment
 */
export function predictCandles(candles: Candle[], lookforward: number = 5): CandlePrediction {
  if (candles.length < 50) {
    return {
      candles: [],
      bullProb: 0.33,
      bearProb: 0.33,
      neutralProb: 0.34,
      expectedMove: 0,
      expectedMovePct: 0,
      confidence: 0,
      method: "Insufficient data",
    };
  }
  const closes = candles.map((c) => c.close);
  const lastPrice = closes[closes.length - 1];
  // 1. Markov: compute transition probabilities of returns
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1);
  // Classify returns into states: up (>0.2σ), down (<-0.2σ), neutral
  const meanRet = rets.reduce((s, v) => s + v, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, v) => s + (v - meanRet) ** 2, 0) / (rets.length - 1));
  const threshold = sd * 0.2;
  // Transition matrix: [up→up, up→down, up→neutral, down→up, down→down, down→neutral, neutral→up, neutral→down, neutral→neutral]
  const transitions = { up: { up: 0, down: 0, neutral: 0 }, down: { up: 0, down: 0, neutral: 0 }, neutral: { up: 0, down: 0, neutral: 0 } };
  let prevState: "up" | "down" | "neutral" = "neutral";
  for (let i = 0; i < rets.length; i++) {
    const state: "up" | "down" | "neutral" = rets[i] > threshold ? "up" : rets[i] < -threshold ? "down" : "neutral";
    transitions[prevState][state]++;
    prevState = state;
  }
  // Normalize
  const totalUp = transitions.up.up + transitions.up.down + transitions.up.neutral;
  const totalDown = transitions.down.up + transitions.down.down + transitions.down.neutral;
  const totalNeutral = transitions.neutral.up + transitions.neutral.down + transitions.neutral.neutral;
  if (totalUp > 0) { transitions.up.up /= totalUp; transitions.up.down /= totalUp; transitions.up.neutral /= totalUp; }
  if (totalDown > 0) { transitions.down.up /= totalDown; transitions.down.down /= totalDown; transitions.down.neutral /= totalDown; }
  if (totalNeutral > 0) { transitions.neutral.up /= totalNeutral; transitions.neutral.down /= totalNeutral; transitions.neutral.neutral /= totalNeutral; }
  // Current state
  const lastRet = rets[rets.length - 1];
  const currentState: "up" | "down" | "neutral" = lastRet > threshold ? "up" : lastRet < -threshold ? "down" : "neutral";
  // 2. Indicator bias
  const rsiArr = rsi(closes, 14);
  const lastRSI = (rsiArr[rsiArr.length - 1] as number) ?? 50;
  const macdData = macd(closes);
  const lastMACDHist = macdData.histogram[macdData.histogram.length - 1];
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const emaBull = (ema9[ema9.length - 1] as number) > (ema21[ema21.length - 1] as number);
  // Combine: Markov base probability + indicator adjustment
  let bullProb = (transitions[currentState].up + transitions[currentState].neutral * 0.4);
  let bearProb = (transitions[currentState].down + transitions[currentState].neutral * 0.4);
  // Indicator adjustments
  if (lastRSI < 30) bullProb += 0.15; // oversold → bounce
  if (lastRSI > 70) bearProb += 0.15; // overbought → pullback
  if (lastMACDHist != null && lastMACDHist > 0) bullProb += 0.10;
  if (lastMACDHist != null && lastMACDHist < 0) bearProb += 0.10;
  if (emaBull) bullProb += 0.05; else bearProb += 0.05;
  // Normalize
  const total = bullProb + bearProb + 0.2;
  bullProb /= total;
  bearProb /= total;
  const neutralProb = 1 - bullProb - bearProb;
  // 3. ATR for range
  const atrArr = atr(candles, 14);
  const lastATR = (atrArr[atrArr.length - 1] as number) ?? 0;
  // 4. Mean reversion: if price far from SMA20, expect reversion
  const sma20 = sma(closes, 20);
  const lastSMA20 = (sma20[sma20.length - 1] as number) ?? lastPrice;
  const deviation = (lastPrice - lastSMA20) / lastSMA20;
  const meanReversionPull = -deviation * 0.3; // 30% of deviation pulls back
  // Generate predicted candles
  const predictedCandles: CandlePrediction["candles"] = [];
  let currentPrice = lastPrice;
  for (let i = 0; i < lookforward; i++) {
    // Expected return: probability-weighted
    const upMove = meanRet + sd * 0.5;
    const downMove = meanRet - sd * 0.5;
    const neutralMove = meanRet;
    let expectedRet = bullProb * upMove + bearProb * downMove + neutralProb * neutralMove;
    // Add mean reversion pull (stronger for later candles)
    expectedRet += meanReversionPull / lookforward;
    const open = currentPrice;
    const close = currentPrice * (1 + expectedRet);
    const range = lastATR * (0.8 + Math.random() * 0.4);
    const high = Math.max(open, close) + range * 0.3;
    const low = Math.min(open, close) - range * 0.3;
    const volume = Math.floor(candles[candles.length - 1].volume * (0.7 + Math.random() * 0.6));
    predictedCandles.push({ open, high, low, close, volume });
    currentPrice = close;
  }
  const expectedMove = predictedCandles.length > 0 ? predictedCandles[predictedCandles.length - 1].close - lastPrice : 0;
  const expectedMovePct = (expectedMove / lastPrice) * 100;
  // Confidence: based on how far probabilities deviate from 50/50
  const confidence = Math.min(95, Math.abs(bullProb - bearProb) * 200 + 30);
  return {
    candles: predictedCandles,
    bullProb,
    bearProb,
    neutralProb,
    expectedMove,
    expectedMovePct,
    confidence,
    method: `Markov chain (${rets.length} obs) + RSI/MACD/EMA bias + ATR range + mean reversion (dev ${(deviation * 100).toFixed(2)}%)`,
  };
}

// ============================================================
// 5. LEARNING LOG
// ============================================================

export interface SignalLogEntry {
  id: string;
  timestamp: number;
  symbol: string;
  ruleName: string;
  conditions: string;
  fired: boolean;
  strength: number;
  priceAtSignal: number;
  // Outcome (filled later when we check)
  priceAfter5Bars?: number;
  outcome?: "WIN" | "LOSS" | "NEUTRAL";
  outcomePct?: number;
  evaluated: boolean;
}

export interface LearningStats {
  totalSignals: number;
  firedSignals: number;
  evaluatedSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  // Per-rule accuracy
  perRule: { ruleName: string; signals: number; wins: number; losses: number; winRate: number; avgReturn: number }[];
  // Best performing rule
  bestRule: string | null;
  worstRule: string | null;
  // Learnings
  insights: string[];
}

/**
 * Evaluate past signals — check if price moved in expected direction.
 * Called periodically to update outcomes.
 */
export function evaluateSignalOutcomes(
  entries: SignalLogEntry[],
  candles: Candle[],
  barsLater: number = 5,
): SignalLogEntry[] {
  const priceByOffset = (startIdx: number, offset: number): number | null => {
    const idx = startIdx + offset;
    return idx < candles.length ? candles[idx].close : null;
  };
  return entries.map((e) => {
    if (e.evaluated) return e;
    // Find the candle index at signal time
    const signalIdx = candles.findIndex((c) => c.time >= e.timestamp);
    if (signalIdx < 0 || signalIdx + barsLater >= candles.length) return e; // not enough data yet
    const priceAfter = priceByOffset(signalIdx, barsLater);
    if (priceAfter == null) return e;
    const move = (priceAfter - e.priceAtSignal) / e.priceAtSignal * 100;
    // Win = price moved up after bullish signal, down after bearish
    const isBullish = e.conditions.toLowerCase().includes("bull") || e.conditions.toLowerCase().includes("buy") || e.conditions.toLowerCase().includes("oversold");
    const isBearish = e.conditions.toLowerCase().includes("bear") || e.conditions.toLowerCase().includes("sell") || e.conditions.toLowerCase().includes("overbought");
    let outcome: "WIN" | "LOSS" | "NEUTRAL";
    if (Math.abs(move) < 0.1) outcome = "NEUTRAL";
    else if (isBullish) outcome = move > 0 ? "WIN" : "LOSS";
    else if (isBearish) outcome = move < 0 ? "WIN" : "LOSS";
    else outcome = move > 0 ? "WIN" : move < 0 ? "LOSS" : "NEUTRAL";
    return { ...e, priceAfter5Bars: priceAfter, outcome, outcomePct: move, evaluated: true };
  });
}

/**
 * Compute learning statistics from the signal log.
 */
export function computeLearningStats(entries: SignalLogEntry[]): LearningStats {
  const fired = entries.filter((e) => e.fired);
  const evaluated = fired.filter((e) => e.evaluated);
  const wins = evaluated.filter((e) => e.outcome === "WIN");
  const losses = evaluated.filter((e) => e.outcome === "LOSS");
  const winRate = evaluated.length > 0 ? (wins.length / evaluated.length) * 100 : 0;
  const avgWinPct = wins.length > 0 ? wins.reduce((s, e) => s + Math.abs(e.outcomePct ?? 0), 0) / wins.length : 0;
  const avgLossPct = losses.length > 0 ? losses.reduce((s, e) => s + Math.abs(e.outcomePct ?? 0), 0) / losses.length : 0;
  // Per-rule
  const ruleMap = new Map<string, { signals: number; wins: number; losses: number; returns: number[] }>();
  for (const e of evaluated) {
    if (!ruleMap.has(e.ruleName)) ruleMap.set(e.ruleName, { signals: 0, wins: 0, losses: 0, returns: [] });
    const r = ruleMap.get(e.ruleName)!;
    r.signals++;
    if (e.outcome === "WIN") r.wins++;
    if (e.outcome === "LOSS") r.losses++;
    r.returns.push(e.outcomePct ?? 0);
  }
  const perRule = Array.from(ruleMap.entries()).map(([ruleName, r]) => ({
    ruleName,
    signals: r.signals,
    wins: r.wins,
    losses: r.losses,
    winRate: r.signals > 0 ? (r.wins / r.signals) * 100 : 0,
    avgReturn: r.returns.length > 0 ? r.returns.reduce((s, v) => s + v, 0) / r.returns.length : 0,
  }));
  perRule.sort((a, b) => b.winRate - a.winRate);
  // Insights
  const insights: string[] = [];
  if (perRule.length > 0) {
    const best = perRule[0];
    insights.push(`Best performing rule: "${best.ruleName}" with ${best.winRate.toFixed(1)}% win rate over ${best.signals} signals.`);
    if (perRule.length > 1) {
      const worst = perRule[perRule.length - 1];
      insights.push(`Worst performing rule: "${worst.ruleName}" with ${worst.winRate.toFixed(1)}% win rate. Consider disabling or refining.`);
    }
    if (winRate > 60) insights.push(`Overall win rate ${winRate.toFixed(1)}% is above 60% — signals are predictive.`);
    else if (winRate < 40) insights.push(`Overall win rate ${winRate.toFixed(1)}% is below 40% — consider adjusting thresholds.`);
    if (avgWinPct > avgLossPct * 1.5) insights.push(`Risk/reward favorable: avg win ${avgWinPct.toFixed(2)}% vs avg loss ${avgLossPct.toFixed(2)}%.`);
    else if (avgLossPct > avgWinPct) insights.push(`Risk/reward unfavorable: avg loss exceeds avg win. Tighten stops or widen targets.`);
  }
  return {
    totalSignals: entries.length,
    firedSignals: fired.length,
    evaluatedSignals: evaluated.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWinPct,
    avgLossPct,
    perRule,
    bestRule: perRule[0]?.ruleName ?? null,
    worstRule: perRule[perRule.length - 1]?.ruleName ?? null,
    insights,
  };
}
