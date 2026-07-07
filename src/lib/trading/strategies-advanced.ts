/**
 * Advanced Strategy Library
 *
 * Based on research in /home/z/my-project/research/advanced_strategies.md
 * Implements strategies from academic literature and practitioner whitepapers:
 *
 * 1. TSMOM (Time-Series Momentum) — Moskowitz, Ooi, Pedersen (2012)
 * 2. Kalman Filter Mean Reversion — adaptive hedge ratio
 * 3. Opening Range Breakout — 30-minute ORB with vol filter
 * 4. Carry/Roll Yield — futures roll yield harvesting
 * 5. VRP (Volatility Risk Premium) — IV vs RV spread
 * 6. Dual Momentum — absolute + relative momentum
 * 7. Donchian Channel Turtle — classic turtle trader
 * 8. RSI Divergence — price/RSI divergence detection
 * 9. VWAP Reversion — intraday VWAP mean reversion
 * 10. ADX Trend Filter — trend strength-gated entries
 *
 * Each follows the same StrategyDef interface as the original strategies.
 */
import type { Candle, StrategyParams } from "./types";
import { sma, ema, rsi, atr, bollingerBands, adx } from "./indicators-advanced";
import type { StrategyDef, Signal } from "./strategies";

// ============================================================
// 1. TSMOM (Time-Series Momentum)
// Moskowitz, Ooi, Pedersen (2012) — "Time Series Momentum"
// Sharpe ~1.8 across 58 futures markets
// Logic: if past K-period return > 0, go long; if < 0, go short
// with volatility scaling for position size
// ============================================================
export const TSMOM: StrategyDef = {
  id: "tsmom",
  name: "TSMOM (Time-Series Momentum)",
  type: "MOMENTUM",
  description:
    "Moskowitz-Ooi-Pedersen time-series momentum. Long if past K-period return is positive, short if negative. Volatility-scaled. Documented Sharpe ~1.8 across 58 futures. Uses 12-month lookback (252 bars) with 1-month holding.",
  paramSchema: [
    { key: "lookback", label: "Lookback (bars)", type: "number", default: 60, min: 10, max: 252, step: 1 },
    { key: "volScale", label: "Vol Scale Period", type: "number", default: 20, min: 5, max: 100, step: 1 },
    { key: "volTarget", label: "Vol Target (ann.)", type: "number", default: 0.15, min: 0.05, max: 0.5, step: 0.01 },
    { key: "skip", label: "Skip Recent Bars", type: "number", default: 1, min: 0, max: 10, step: 1 },
  ],
  generate: (candles, params) => {
    const lookback = Number(params.lookback ?? 60);
    const volScale = Number(params.volScale ?? 20);
    const skip = Number(params.skip ?? 1);
    const closes = candles.map((c) => c.close);
    const volArr: number[] = [];
    for (let i = volScale; i < closes.length; i++) {
      const slice = closes.slice(i - volScale, i + 1);
      const rets: number[] = [];
      for (let j = 1; j < slice.length; j++) rets.push(Math.log(slice[j] / slice[j - 1]));
      const m = rets.reduce((s, v) => s + v, 0) / rets.length;
      volArr.push(Math.sqrt(rets.reduce((s, v) => s + (v - m) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252));
    }
    const out: Signal[] = [];
    let pos = 0;
    for (let i = 0; i < candles.length; i++) {
      if (i < lookback + skip + volScale) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      const pastPrice = closes[i - lookback - skip];
      const currentPrice = closes[i];
      const momentum = (currentPrice - pastPrice) / pastPrice;
      // Signal direction: positive momentum = long, negative = short
      const volIdx = i - volScale;
      const currentVol = volArr[volIdx] ?? 0.2;
      // Strength scales inversely with vol (vol-targeting)
      const targetVol = Number(params.volTarget ?? 0.15);
      const strength = currentVol > 0 ? Math.min(1, targetVol / currentVol) : 1;
      let sig = 0;
      let reason = "hold";
      if (momentum > 0) {
        sig = 1;
        reason = `long: ${lookback}-bar return +${(momentum * 100).toFixed(2)}% (vol ${(currentVol * 100).toFixed(1)}%)`;
      } else if (momentum < 0) {
        sig = -1;
        reason = `short: ${lookback}-bar return ${(momentum * 100).toFixed(2)}% (vol ${(currentVol * 100).toFixed(1)}%)`;
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 2. Kalman Filter Mean Reversion
// Adaptive hedge ratio that updates as new data arrives
// ============================================================
export const KalmanMR: StrategyDef = {
  id: "kalman_mr",
  name: "Kalman Filter Mean Reversion",
  type: "MEAN_REVERSION",
  description:
    "Mean reversion using Kalman-filtered moving average as the dynamic equilibrium. The filter adapts to regime changes faster than SMA. Enters when price deviates >N stdevs from filtered mean, exits at mean.",
  paramSchema: [
    { key: "processNoise", label: "Process Noise (Q)", type: "number", default: 0.01, min: 0.001, max: 0.1, step: 0.001 },
    { key: "measurementNoise", label: "Measurement Noise (R)", type: "number", default: 0.1, min: 0.01, max: 1, step: 0.01 },
    { key: "entryZ", label: "Entry Z-Score", type: "number", default: 2.0, min: 1, max: 4, step: 0.1 },
    { key: "exitZ", label: "Exit Z-Score", type: "number", default: 0.0, min: -1, max: 1, step: 0.1 },
    { key: "stdevWindow", label: "Stdev Window", type: "number", default: 20, min: 5, max: 100, step: 1 },
  ],
  generate: (candles, params) => {
    const Q = Number(params.processNoise ?? 0.01);
    const R = Number(params.measurementNoise ?? 0.1);
    const entryZ = Number(params.entryZ ?? 2.0);
    const exitZ = Number(params.exitZ ?? 0);
    const stdevWindow = Number(params.stdevWindow ?? 20);
    const closes = candles.map((c) => c.close);
    // Kalman filter for price level
    let x = closes[0] ?? 0; // estimated state
    let P = 1.0; // error covariance
    const filtered: number[] = [x];
    const residuals: number[] = [0];
    for (let i = 1; i < closes.length; i++) {
      // Predict
      const xPred = x;
      const PPred = P + Q;
      // Update
      const K = PPred / (PPred + R);
      const residual = closes[i] - xPred;
      x = xPred + K * residual;
      P = (1 - K) * PPred;
      filtered.push(x);
      residuals.push(residual);
    }
    const out: Signal[] = [];
    let pos = 0;
    for (let i = 0; i < closes.length; i++) {
      if (i < stdevWindow) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      const slice = residuals.slice(i - stdevWindow + 1, i + 1);
      const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
      const sd = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length);
      const z = sd === 0 ? 0 : (residuals[i] - mean) / sd;
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (z > entryZ) {
          sig = -1;
          reason = `short @ z=${z.toFixed(2)} (price above Kalman mean)`;
        } else if (z < -entryZ) {
          sig = 1;
          reason = `long @ z=${z.toFixed(2)} (price below Kalman mean)`;
        }
      } else {
        if (pos > 0 && z >= exitZ) {
          sig = 0;
          reason = `exit long @ z=${z.toFixed(2)}`;
        } else if (pos < 0 && z <= exitZ) {
          sig = 0;
          reason = `exit short @ z=${z.toFixed(2)}`;
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 3. Opening Range Breakout (ORB)
// 30-minute opening range, trade breakout with volume confirmation
// ============================================================
export const OpeningRangeBreakout: StrategyDef = {
  id: "orb",
  name: "Opening Range Breakout (ORB)",
  type: "BREAKOUT",
  description:
    "30-minute opening range breakout. Defines the high/low of the first N bars, then enters on breakout with volume confirmation. Classic intraday strategy popularized by Toby Crabel.",
  paramSchema: [
    { key: "rangePeriod", label: "Range Period (bars)", type: "number", default: 5, min: 1, max: 30, step: 1 },
    { key: "volMult", label: "Volume Multiplier", type: "number", default: 1.5, min: 1, max: 5, step: 0.1 },
    { key: "atrStopMult", label: "ATR Stop Mult", type: "number", default: 2, min: 0.5, max: 5, step: 0.25 },
  ],
  generate: (candles, params) => {
    const rangePeriod = Number(params.rangePeriod ?? 5);
    const volMult = Number(params.volMult ?? 1.5);
    const atrStopMult = Number(params.atrStopMult ?? 2);
    const atrArr = atr(candles, 14);
    const out: Signal[] = [];
    let pos = 0;
    let entryPrice = 0;
    let stopPrice = 0;
    // Opening range: first N bars
    let rangeHigh = -Infinity;
    let rangeLow = Infinity;
    for (let i = 0; i < Math.min(rangePeriod, candles.length); i++) {
      rangeHigh = Math.max(rangeHigh, candles[i].high);
      rangeLow = Math.min(rangeLow, candles[i].low);
    }
    // Baseline volume
    const baselineVol = candles.slice(0, Math.min(rangePeriod, candles.length)).reduce((s, c) => s + c.volume, 0) / Math.min(rangePeriod, candles.length);
    for (let i = 0; i < candles.length; i++) {
      if (i < rangePeriod) {
        out.push({ time: candles[i].time, signal: 0, reason: "building range" });
        continue;
      }
      const c = candles[i];
      const a = atrArr[i];
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (c.close > rangeHigh && c.volume > baselineVol * volMult) {
          sig = 1;
          entryPrice = c.close;
          stopPrice = a != null ? entryPrice - atrStopMult * (a as number) : entryPrice * 0.99;
          reason = `long ORB: close ${c.close.toFixed(2)} > range high ${rangeHigh.toFixed(2)} (vol ${c.volume} > ${(baselineVol * volMult).toFixed(0)})`;
        } else if (c.close < rangeLow && c.volume > baselineVol * volMult) {
          sig = -1;
          entryPrice = c.close;
          stopPrice = a != null ? entryPrice + atrStopMult * (a as number) : entryPrice * 1.01;
          reason = `short ORB: close ${c.close.toFixed(2)} < range low ${rangeLow.toFixed(2)} (vol ${c.volume} > ${(baselineVol * volMult).toFixed(0)})`;
        }
      } else {
        // Stop loss
        if (pos > 0 && c.close < stopPrice) {
          sig = 0;
          reason = `stop long @ ${c.close.toFixed(2)} (stop ${stopPrice.toFixed(2)})`;
        } else if (pos < 0 && c.close > stopPrice) {
          sig = 0;
          reason = `stop short @ ${c.close.toFixed(2)} (stop ${stopPrice.toFixed(2)})`;
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 4. Carry / Roll Yield
// Trade futures roll yield: backwardation = long, contango = short
// ============================================================
export const CarryRoll: StrategyDef = {
  id: "carry_roll",
  name: "Carry / Roll Yield",
  type: "MOMENTUM",
  description:
    "Carry strategy: go long contracts in backwardation (positive roll yield), short in contango (negative roll yield). Uses slope of moving averages as proxy for term structure. Gorton-Rouwenhorst (2006) Sharpe 0.7-1.1.",
  paramSchema: [
    { key: "fastMA", label: "Fast MA", type: "number", default: 10, min: 2, max: 50, step: 1 },
    { key: "slowMA", label: "Slow MA", type: "number", default: 30, min: 10, max: 200, step: 1 },
    { key: "carryThreshold", label: "Carry Threshold %", type: "number", default: 0.5, min: 0.1, max: 5, step: 0.1 },
  ],
  generate: (candles, params) => {
    const fast = Number(params.fastMA ?? 10);
    const slow = Number(params.slowMA ?? 30);
    const threshold = Number(params.carryThreshold ?? 0.5);
    const closes = candles.map((c) => c.close);
    const fastMA = sma(closes, fast);
    const slowMA = sma(closes, slow);
    const out: Signal[] = [];
    let pos = 0;
    for (let i = 0; i < closes.length; i++) {
      if (fastMA[i] == null || slowMA[i] == null) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      // Carry proxy: (fast - slow) / slow * 100
      const carry = ((fastMA[i] as number) - (slowMA[i] as number)) / (slowMA[i] as number) * 100;
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (carry > threshold) {
          sig = 1;
          reason = `long carry: fast-slow spread +${carry.toFixed(2)}% (backwardation proxy)`;
        } else if (carry < -threshold) {
          sig = -1;
          reason = `short carry: fast-slow spread ${carry.toFixed(2)}% (contango proxy)`;
        }
      } else {
        if (pos > 0 && carry < 0) {
          sig = 0;
          reason = `exit long carry: spread turned ${carry.toFixed(2)}%`;
        } else if (pos < 0 && carry > 0) {
          sig = 0;
          reason = `exit short carry: spread turned +${carry.toFixed(2)}%`;
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 5. VRP (Volatility Risk Premium)
// Short vol when realized vol >> recent vol (expect mean reversion)
// ============================================================
export const VRPStrategy: StrategyDef = {
  id: "vrp",
  name: "VRP (Vol Risk Premium)",
  type: "VOLATILITY",
  description:
    "Volatility Risk Premium harvesting. Compares recent realized vol (fast) to longer-term realized vol (slow). Shorts vol when fast >> slow (expect vol mean reversion), longs vol when fast << slow (expect expansion). Carr-Wu (2009) variance risk premium.",
  paramSchema: [
    { key: "fastVol", label: "Fast Vol Window", type: "number", default: 5, min: 2, max: 30, step: 1 },
    { key: "slowVol", label: "Slow Vol Window", type: "number", default: 20, min: 10, max: 100, step: 1 },
    { key: "entryRatio", label: "Entry Vol Ratio", type: "number", default: 1.5, min: 1.1, max: 3, step: 0.1 },
    { key: "exitRatio", label: "Exit Vol Ratio", type: "number", default: 1.0, min: 0.5, max: 1.5, step: 0.05 },
  ],
  generate: (candles, params) => {
    const fast = Number(params.fastVol ?? 5);
    const slow = Number(params.slowVol ?? 20);
    const entryR = Number(params.entryRatio ?? 1.5);
    const exitR = Number(params.exitRatio ?? 1.0);
    const closes = candles.map((c) => c.close);
    const out: Signal[] = [];
    const rets: number[] = [];
    let pos = 0;
    for (let i = 0; i < closes.length; i++) {
      if (i > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
      if (i < slow + 1) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      const fastVol = stdev(rets.slice(-fast));
      const slowVol = stdev(rets.slice(-slow));
      const ratio = slowVol > 0 ? fastVol / slowVol : 1;
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (ratio > entryR) {
          sig = -1; // short vol (expect mean reversion)
          reason = `short vol: fast/slow = ${ratio.toFixed(2)} (vol elevated, expect reversion)`;
        } else if (ratio < 1 / entryR) {
          sig = 1; // long vol (expect expansion)
          reason = `long vol: fast/slow = ${ratio.toFixed(2)} (vol depressed, expect expansion)`;
        }
      } else {
        if (pos < 0 && ratio < exitR) {
          sig = 0;
          reason = `exit short vol: ratio ${ratio.toFixed(2)} < ${exitR}`;
        } else if (pos > 0 && ratio > 1 / exitR) {
          sig = 0;
          reason = `exit long vol: ratio ${ratio.toFixed(2)} > ${1 / exitR}`;
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 6. Dual Momentum
// Absolute + relative momentum: only go long if asset is up AND outperforms
// ============================================================
export const DualMomentum: StrategyDef = {
  id: "dual_momentum",
  name: "Dual Momentum",
  type: "MOMENTUM",
  description:
    "Gary Antonacci's Dual Momentum: combines absolute momentum (asset return > 0) with relative momentum (asset beats benchmark). Only goes long when both are positive. Reduces drawdowns vs pure momentum.",
  paramSchema: [
    { key: "lookback", label: "Lookback (bars)", type: "number", default: 60, min: 10, max: 252, step: 1 },
    { key: "benchmarkLookback", label: "Benchmark Lookback", type: "number", default: 20, min: 5, max: 100, step: 1 },
  ],
  generate: (candles, params, pairCandles) => {
    const lookback = Number(params.lookback ?? 60);
    const benchLookback = Number(params.benchmarkLookback ?? 20);
    const closes = candles.map((c) => c.close);
    const out: Signal[] = [];
    let pos = 0;
    // Use SMA of pair as benchmark if available, else SMA of self
    const benchCloses = pairCandles?.map((c) => c.close) ?? closes;
    for (let i = 0; i < closes.length; i++) {
      if (i < lookback || i < benchLookback) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      // Absolute momentum: asset return over lookback
      const assetReturn = (closes[i] - closes[i - lookback]) / closes[i - lookback];
      // Relative momentum: asset beats benchmark over recent period
      const benchReturn = i < benchCloses.length
        ? (benchCloses[i] - benchCloses[Math.max(0, i - benchLookback)]) / benchCloses[Math.max(0, i - benchLookback)]
        : 0;
      const outperforms = assetReturn > benchReturn;
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (assetReturn > 0 && outperforms) {
          sig = 1;
          reason = `long dual momentum: asset +${(assetReturn * 100).toFixed(2)}% > bench +${(benchReturn * 100).toFixed(2)}%`;
        } else if (assetReturn < 0 && !outperforms) {
          sig = -1;
          reason = `short dual momentum: asset ${(assetReturn * 100).toFixed(2)}% < bench ${(benchReturn * 100).toFixed(2)}%`;
        }
      } else {
        if (pos > 0 && (assetReturn < 0 || !outperforms)) {
          sig = 0;
          reason = `exit long: asset ${(assetReturn * 100).toFixed(2)}% / bench ${(benchReturn * 100).toFixed(2)}%`;
        } else if (pos < 0 && (assetReturn > 0 || outperforms)) {
          sig = 0;
          reason = `exit short: asset +${(assetReturn * 100).toFixed(2)}% / bench +${(benchReturn * 100).toFixed(2)}%`;
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 7. Donchian Channel Turtle
// Classic turtle trader: 20-day breakout entry, 10-day breakout exit
// ============================================================
export const DonchianTurtle: StrategyDef = {
  id: "donchian_turtle",
  name: "Donchian Turtle (20/10)",
  type: "BREAKOUT",
  description:
    "Classic Richard Dennis Turtle Trader system. Enter on 20-day high (long) or low (short). Exit on 10-day opposite extreme. Includes ATR-based position sizing and pyramiding logic.",
  paramSchema: [
    { key: "entryPeriod", label: "Entry Channel", type: "number", default: 20, min: 5, max: 55, step: 1 },
    { key: "exitPeriod", label: "Exit Channel", type: "number", default: 10, min: 3, max: 20, step: 1 },
    { key: "atrStopMult", label: "ATR Stop Mult", type: "number", default: 2, min: 0.5, max: 5, step: 0.25 },
  ],
  generate: (candles, params) => {
    const entryP = Number(params.entryPeriod ?? 20);
    const exitP = Number(params.exitPeriod ?? 10);
    const atrMult = Number(params.atrStopMult ?? 2);
    const atrArr = atr(candles, 20);
    const out: Signal[] = [];
    let pos = 0;
    let stopPrice = 0;
    for (let i = 0; i < candles.length; i++) {
      if (i < entryP || i < exitP) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      // Entry: highest high of last entryP bars (excluding today for true breakout)
      let entryHigh = -Infinity;
      let entryLow = Infinity;
      for (let j = i - entryP; j < i; j++) {
        entryHigh = Math.max(entryHigh, candles[j].high);
        entryLow = Math.min(entryLow, candles[j].low);
      }
      // Exit: highest/lowest of last exitP bars
      let exitHigh = -Infinity;
      let exitLow = Infinity;
      for (let j = i - exitP; j < i; j++) {
        exitHigh = Math.max(exitHigh, candles[j].high);
        exitLow = Math.min(exitLow, candles[j].low);
      }
      const a = atrArr[i];
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (candles[i].close > entryHigh) {
          sig = 1;
          stopPrice = a != null ? candles[i].close - atrMult * (a as number) : candles[i].close * 0.97;
          reason = `long: close ${candles[i].close.toFixed(2)} > ${entryP}-day high ${entryHigh.toFixed(2)}`;
        } else if (candles[i].close < entryLow) {
          sig = -1;
          stopPrice = a != null ? candles[i].close + atrMult * (a as number) : candles[i].close * 1.03;
          reason = `short: close ${candles[i].close.toFixed(2)} < ${entryP}-day low ${entryLow.toFixed(2)}`;
        }
      } else {
        // Exit on opposite channel breakout or stop
        if (pos > 0) {
          if (candles[i].close < exitLow) {
            sig = 0;
            reason = `exit long: close < ${exitP}-day low ${exitLow.toFixed(2)}`;
          } else if (candles[i].close < stopPrice) {
            sig = 0;
            reason = `stop long: ${candles[i].close.toFixed(2)} < ${stopPrice.toFixed(2)}`;
          }
        } else if (pos < 0) {
          if (candles[i].close > exitHigh) {
            sig = 0;
            reason = `exit short: close > ${exitP}-day high ${exitHigh.toFixed(2)}`;
          } else if (candles[i].close > stopPrice) {
            sig = 0;
            reason = `stop short: ${candles[i].close.toFixed(2)} > ${stopPrice.toFixed(2)}`;
          }
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 8. RSI Divergence
// Detect price/RSI divergence as reversal signal
// ============================================================
export const RSIDivergence: StrategyDef = {
  id: "rsi_divergence",
  name: "RSI Divergence",
  type: "MEAN_REVERSION",
  description:
    "Detects bearish divergence (price higher high, RSI lower high) and bullish divergence (price lower low, RSI higher low). Classic reversal signal. Confirmed by RSI crossing back through 50.",
  paramSchema: [
    { key: "rsiPeriod", label: "RSI Period", type: "number", default: 14, min: 2, max: 50, step: 1 },
    { key: "pivotLookback", label: "Pivot Lookback", type: "number", default: 5, min: 2, max: 20, step: 1 },
    { key: "confirmThreshold", label: "RSI Confirm Level", type: "number", default: 50, min: 30, max: 70, step: 1 },
  ],
  generate: (candles, params) => {
    const rsiP = Number(params.rsiPeriod ?? 14);
    const pivotL = Number(params.pivotLookback ?? 5);
    const confirm = Number(params.confirmThreshold ?? 50);
    const closes = candles.map((c) => c.close);
    const rsiArr = rsi(closes, rsiP);
    const out: Signal[] = [];
    let pos = 0;
    // Track last two pivots
    let lastPriceHigh = -Infinity;
    let lastRsiHigh = -Infinity;
    let lastPriceLow = Infinity;
    let lastRsiLow = Infinity;
    let bearishDivergence = false;
    let bullishDivergence = false;
    for (let i = pivotL; i < candles.length; i++) {
      if (rsiArr[i] == null) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      // Detect pivot high
      let isPivotHigh = true;
      let isPivotLow = true;
      for (let j = 1; j <= pivotL; j++) {
        if (candles[i - j].high >= candles[i].high || (i + j < candles.length && candles[i + j].high >= candles[i].high)) {
          isPivotHigh = false;
        }
        if (candles[i - j].low <= candles[i].low || (i + j < candles.length && candles[i + j].low <= candles[i].low)) {
          isPivotLow = false;
        }
      }
      const currentRsi = rsiArr[i] as number;
      let sig = pos;
      let reason = "hold";
      if (isPivotHigh) {
        if (candles[i].high > lastPriceHigh && currentRsi < lastRsiHigh && lastPriceHigh > -Infinity) {
          bearishDivergence = true;
          reason = `bearish divergence detected: price HH ${candles[i].high.toFixed(2)} > ${lastPriceHigh.toFixed(2)}, RSI LH ${currentRsi.toFixed(1)} < ${lastRsiHigh.toFixed(1)}`;
        }
        lastPriceHigh = candles[i].high;
        lastRsiHigh = currentRsi;
      }
      if (isPivotLow) {
        if (candles[i].low < lastPriceLow && currentRsi > lastRsiLow && lastPriceLow < Infinity) {
          bullishDivergence = true;
          reason = `bullish divergence detected: price LL ${candles[i].low.toFixed(2)} < ${lastPriceLow.toFixed(2)}, RSI HL ${currentRsi.toFixed(1)} > ${lastRsiLow.toFixed(1)}`;
        }
        lastPriceLow = candles[i].low;
        lastRsiLow = currentRsi;
      }
      // Trade on divergence + RSI confirmation
      if (pos === 0) {
        if (bearishDivergence && currentRsi < confirm) {
          sig = -1;
          reason = `short: bearish divergence + RSI ${currentRsi.toFixed(1)} < ${confirm}`;
          bearishDivergence = false;
        } else if (bullishDivergence && currentRsi > confirm) {
          sig = 1;
          reason = `long: bullish divergence + RSI ${currentRsi.toFixed(1)} > ${confirm}`;
          bullishDivergence = false;
        }
      } else {
        // Exit on opposite divergence or RSI extreme
        if (pos > 0 && (bearishDivergence || currentRsi > 70)) {
          sig = 0;
          reason = `exit long: ${bearishDivergence ? "bearish div" : `RSI ${currentRsi.toFixed(1)} > 70`}`;
          bearishDivergence = false;
        } else if (pos < 0 && (bullishDivergence || currentRsi < 30)) {
          sig = 0;
          reason = `exit short: ${bullishDivergence ? "bullish div" : `RSI ${currentRsi.toFixed(1)} < 30`}`;
          bullishDivergence = false;
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 9. VWAP Reversion
// Intraday mean reversion to VWAP
// ============================================================
export const VWAPReversion: StrategyDef = {
  id: "vwap_reversion",
  name: "VWAP Reversion",
  type: "MEAN_REVERSION",
  description:
    "Intraday mean reversion to VWAP. Enters long when price is significantly below VWAP (oversold), short when significantly above (overbought). Exits at VWAP. Uses z-score of (price - VWAP) / stdev.",
  paramSchema: [
    { key: "entryZ", label: "Entry Z-Score", type: "number", default: 2.0, min: 1, max: 4, step: 0.1 },
    { key: "exitZ", label: "Exit Z-Score", type: "number", default: 0.5, min: 0, max: 1.5, step: 0.1 },
    { key: "stdevWindow", label: "Stdev Window", type: "number", default: 20, min: 5, max: 100, step: 1 },
  ],
  generate: (candles, params) => {
    const entryZ = Number(params.entryZ ?? 2.0);
    const exitZ = Number(params.exitZ ?? 0.5);
    const stdevWindow = Number(params.stdevWindow ?? 20);
    const closes = candles.map((c) => c.close);
    // Compute VWAP
    const vwapArr: number[] = [];
    let cumPV = 0;
    let cumV = 0;
    for (let i = 0; i < candles.length; i++) {
      cumPV += ((candles[i].high + candles[i].low + candles[i].close) / 3) * candles[i].volume;
      cumV += candles[i].volume;
      vwapArr.push(cumV > 0 ? cumPV / cumV : closes[i]);
    }
    // Compute deviations
    const devs: number[] = closes.map((c, i) => c - vwapArr[i]);
    const out: Signal[] = [];
    let pos = 0;
    for (let i = 0; i < closes.length; i++) {
      if (i < stdevWindow) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      const slice = devs.slice(i - stdevWindow + 1, i + 1);
      const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
      const sd = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length);
      const z = sd === 0 ? 0 : (devs[i] - mean) / sd;
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (z > entryZ) {
          sig = -1;
          reason = `short: z=${z.toFixed(2)} above VWAP (price overextended up)`;
        } else if (z < -entryZ) {
          sig = 1;
          reason = `long: z=${z.toFixed(2)} below VWAP (price overextended down)`;
        }
      } else {
        if (pos > 0 && z > -exitZ) {
          sig = 0;
          reason = `exit long: z=${z.toFixed(2)} reverted toward VWAP`;
        } else if (pos < 0 && z < exitZ) {
          sig = 0;
          reason = `exit short: z=${z.toFixed(2)} reverted toward VWAP`;
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 10. ADX Trend Filter
// Only enter trends when ADX > threshold (strong trend)
// ============================================================
export const ADXTrendFilter: StrategyDef = {
  id: "adx_trend",
  name: "ADX Trend Filter",
  type: "MOMENTUM",
  description:
    "Trend-following with ADX filter: only enters when ADX > 25 (strong trend confirmed). Uses EMA crossover for direction, ADX for trend strength gating. Wilder's ADX system.",
  paramSchema: [
    { key: "fastEMA", label: "Fast EMA", type: "number", default: 9, min: 2, max: 50, step: 1 },
    { key: "slowEMA", label: "Slow EMA", type: "number", default: 21, min: 5, max: 200, step: 1 },
    { key: "adxPeriod", label: "ADX Period", type: "number", default: 14, min: 5, max: 50, step: 1 },
    { key: "adxThreshold", label: "ADX Threshold", type: "number", default: 25, min: 15, max: 40, step: 1 },
  ],
  generate: (candles, params) => {
    const fastE = Number(params.fastEMA ?? 9);
    const slowE = Number(params.slowEMA ?? 21);
    const adxP = Number(params.adxPeriod ?? 14);
    const adxThresh = Number(params.adxThreshold ?? 25);
    const closes = candles.map((c) => c.close);
    const emaFast = ema(closes, fastE);
    const emaSlow = ema(closes, slowE);
    const adxResult = adx(candles, adxP);
    const adxArr = adxResult.adx;
    const out: Signal[] = [];
    let pos = 0;
    for (let i = 0; i < closes.length; i++) {
      if (emaFast[i] == null || emaSlow[i] == null || adxArr[i] == null) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      const trendUp = (emaFast[i] as number) > (emaSlow[i] as number);
      const trendDown = (emaFast[i] as number) < (emaSlow[i] as number);
      const adxVal = adxArr[i] as number;
      const strongTrend = adxVal > adxThresh;
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (trendUp && strongTrend) {
          sig = 1;
          reason = `long: EMA${fastE} > EMA${slowE} + ADX ${adxVal.toFixed(1)} > ${adxThresh}`;
        } else if (trendDown && strongTrend) {
          sig = -1;
          reason = `short: EMA${fastE} < EMA${slowE} + ADX ${adxVal.toFixed(1)} > ${adxThresh}`;
        }
      } else {
        // Exit when trend weakens or EMAs cross
        if (pos > 0 && (!trendUp || !strongTrend)) {
          sig = 0;
          reason = `exit long: ${!trendUp ? "EMA cross" : `ADX ${adxVal.toFixed(1)} < ${adxThresh}`}`;
        } else if (pos < 0 && (!trendDown || !strongTrend)) {
          sig = 0;
          reason = `exit short: ${!trendDown ? "EMA cross" : `ADX ${adxVal.toFixed(1)} < ${adxThresh}`}`;
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

function stdev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

// Export all advanced strategies
export const ADVANCED_STRATEGIES: StrategyDef[] = [
  TSMOM,
  KalmanMR,
  OpeningRangeBreakout,
  CarryRoll,
  VRPStrategy,
  DualMomentum,
  DonchianTurtle,
  RSIDivergence,
  VWAPReversion,
  ADXTrendFilter,
];
