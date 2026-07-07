/**
 * Strategy Engine
 *
 * Implements six quant strategies drawn from TwigCapra's known playbook:
 *  - Mean Reversion (Ornstein-Uhlenbeck)
 *  - Momentum (cross-sectional + time-series)
 *  - Pairs / Cointegration trading
 *  - Market Making (Avellaneda-Stoikov reservation price)
 *  - Breakout (Donchian / Bollinger)
 *  - Volatility (VRP harvesting via straddle proxy)
 *
 * Each strategy exposes:
 *   - config() — the parameter schema
 *   - generate(candles, params) — produces a signal stream { time, signal: -1..1 }
 *
 * Signals are continuous; the backtester converts them to discrete trades.
 */
import type { Candle, StrategyParams } from "./types";
import {
  atr,
  bollingerBands,
  cointegration,
  ema,
  rsi,
  sma,
  vwap,
} from "./indicators";

export type Signal = {
  time: number;
  signal: number; // -1 (strong sell) .. +1 (strong buy)
  reason: string;
};

export interface StrategyDef {
  id: string;
  name: string;
  type:
    | "MEAN_REVERSION"
    | "MOMENTUM"
    | "PAIRS"
    | "MARKET_MAKING"
    | "BREAKOUT"
    | "VOLATILITY";
  description: string;
  paramSchema: {
    key: string;
    label: string;
    type: "number" | "boolean" | "select";
    default: number | string | boolean;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
  }[];
  /** Generates signal stream from a single series (or pair via metadata). */
  generate: (
    candles: Candle[],
    params: StrategyParams,
    pairCandles?: Candle[],
  ) => Signal[];
}

// ============================================================
// 1. MEAN REVERSION (Ornstein-Uhlenbeck)
// ============================================================
export const MeanReversion: StrategyDef = {
  id: "mean_reversion",
  name: "Mean Reversion (OU)",
  type: "MEAN_REVERSION",
  description:
    "Bets on price reverting to its short-horizon mean. Uses a z-score of (price - SMA) / stdev; enters short when z > entry, exits at z = 0. The half-life of mean reversion is estimated from the series itself (Ornstein-Uhlenbeck).",
  paramSchema: [
    { key: "lookback", label: "Lookback (bars)", type: "number", default: 30, min: 5, max: 200, step: 1 },
    { key: "entryZ", label: "Entry Z-score", type: "number", default: 2.0, min: 0.5, max: 4, step: 0.1 },
    { key: "exitZ", label: "Exit Z-score", type: "number", default: 0.0, min: -1, max: 1, step: 0.1 },
    { key: "stopZ", label: "Stop Z-score", type: "number", default: 4.0, min: 2, max: 8, step: 0.25 },
  ],
  generate: (candles, params) => {
    const lookback = Number(params.lookback ?? 30);
    const entryZ = Number(params.entryZ ?? 2.0);
    const exitZ = Number(params.exitZ ?? 0);
    const stopZ = Number(params.stopZ ?? 4);
    const closes = candles.map((c) => c.close);
    const ma = sma(closes, lookback);
    const out: Signal[] = [];
    let pos = 0; // -1, 0, +1
    for (let i = 0; i < closes.length; i++) {
      if (i < lookback) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      const slice = closes.slice(i - lookback + 1, i + 1);
      const mean = ma[i] as number;
      const sd = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / lookback);
      const z = sd === 0 ? 0 : (closes[i] - mean) / sd;
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (z > entryZ) {
          sig = -1;
          reason = `short @ z=${z.toFixed(2)}`;
        } else if (z < -entryZ) {
          sig = 1;
          reason = `long @ z=${z.toFixed(2)}`;
        }
      } else {
        if (pos > 0 && z >= exitZ) {
          sig = 0;
          reason = `exit long @ z=${z.toFixed(2)}`;
        } else if (pos < 0 && z <= exitZ) {
          sig = 0;
          reason = `exit short @ z=${z.toFixed(2)}`;
        }
        if (pos > 0 && z < -stopZ) {
          sig = 0;
          reason = `stop long @ z=${z.toFixed(2)}`;
        }
        if (pos < 0 && z > stopZ) {
          sig = 0;
          reason = `stop short @ z=${z.toFixed(2)}`;
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 2. MOMENTUM (EMA crossover + RSI filter)
// ============================================================
export const Momentum: StrategyDef = {
  id: "momentum",
  name: "Momentum (EMA + RSI)",
  type: "MOMENTUM",
  description:
    "Time-series momentum: long when fast EMA > slow EMA and RSI in [40,70]; short on mirror. Exits when EMAs cross back or RSI hits exhaustion. Aligns with TwigCapra's documented medium-horizon stat-arb momentum.",
  paramSchema: [
    { key: "fast", label: "Fast EMA", type: "number", default: 9, min: 2, max: 50, step: 1 },
    { key: "slow", label: "Slow EMA", type: "number", default: 21, min: 5, max: 200, step: 1 },
    { key: "rsiPeriod", label: "RSI Period", type: "number", default: 14, min: 2, max: 50, step: 1 },
    { key: "rsiUpper", label: "RSI Upper", type: "number", default: 70, min: 55, max: 95, step: 1 },
    { key: "rsiLower", label: "RSI Lower", type: "number", default: 30, min: 5, max: 45, step: 1 },
  ],
  generate: (candles, params) => {
    const fast = Number(params.fast ?? 9);
    const slow = Number(params.slow ?? 21);
    const rsiPeriod = Number(params.rsiPeriod ?? 14);
    const rsiUpper = Number(params.rsiUpper ?? 70);
    const rsiLower = Number(params.rsiLower ?? 30);
    const closes = candles.map((c) => c.close);
    const emaFast = ema(closes, fast);
    const emaSlow = ema(closes, slow);
    const rsiArr = rsi(closes, rsiPeriod);
    const out: Signal[] = [];
    let pos = 0;
    for (let i = 0; i < closes.length; i++) {
      if (emaFast[i] == null || emaSlow[i] == null || rsiArr[i] == null) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      const f = emaFast[i] as number;
      const s = emaSlow[i] as number;
      const r = rsiArr[i] as number;
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (f > s && r > 40 && r < rsiUpper) {
          sig = 1;
          reason = `long EMA cross + RSI=${r.toFixed(0)}`;
        } else if (f < s && r < 60 && r > rsiLower) {
          sig = -1;
          reason = `short EMA cross + RSI=${r.toFixed(0)}`;
        }
      } else {
        if (pos > 0 && (f < s || r >= rsiUpper)) {
          sig = 0;
          reason = `exit long (EMA cross or RSI=${r.toFixed(0)})`;
        }
        if (pos < 0 && (f > s || r <= rsiLower)) {
          sig = 0;
          reason = `exit short (EMA cross or RSI=${r.toFixed(0)})`;
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 3. PAIRS / COINTEGRATION
// ============================================================
export const Pairs: StrategyDef = {
  id: "pairs",
  name: "Pairs (Cointegration)",
  type: "PAIRS",
  description:
    "Stat-arb pair trade: estimates hedge ratio via OLS, computes residual z-score, enters when |z| > threshold. Half-life from OU calibration tunes entry/exit. Mirrors TwigCapra's documented stat-arb approach.",
  paramSchema: [
    { key: "lookback", label: "Calibration Lookback", type: "number", default: 200, min: 50, max: 1000, step: 10 },
    { key: "entryZ", label: "Entry Z-score", type: "number", default: 2.0, min: 1, max: 4, step: 0.1 },
    { key: "exitZ", label: "Exit Z-score", type: "number", default: 0.5, min: 0, max: 1.5, step: 0.1 },
    { key: "stopZ", label: "Stop Z-score", type: "number", default: 4.0, min: 3, max: 6, step: 0.25 },
  ],
  generate: (candles, params, pairCandles) => {
    const lookback = Number(params.lookback ?? 200);
    const entryZ = Number(params.entryZ ?? 2.0);
    const exitZ = Number(params.exitZ ?? 0.5);
    const stopZ = Number(params.stopZ ?? 4);
    if (!pairCandles || pairCandles.length === 0) return [];
    const n = Math.min(candles.length, pairCandles.length);
    const a = candles.slice(0, n).map((c) => c.close);
    const b = pairCandles.slice(0, n).map((c) => c.close);
    const out: Signal[] = [];
    let pos = 0;
    for (let i = 0; i < n; i++) {
      if (i < lookback) {
        out.push({ time: candles[i].time, signal: 0, reason: "calibrating" });
        continue;
      }
      const aSlice = a.slice(i - lookback + 1, i + 1);
      const bSlice = b.slice(i - lookback + 1, i + 1);
      const { zScore } = cointegration(aSlice, bSlice);
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (zScore > entryZ) {
          sig = -1; // short A, long B
          reason = `short pair @ z=${zScore.toFixed(2)}`;
        } else if (zScore < -entryZ) {
          sig = 1; // long A, short B
          reason = `long pair @ z=${zScore.toFixed(2)}`;
        }
      } else {
        if (pos > 0 && zScore > -exitZ) {
          sig = 0;
          reason = `exit long pair @ z=${zScore.toFixed(2)}`;
        }
        if (pos < 0 && zScore < exitZ) {
          sig = 0;
          reason = `exit short pair @ z=${zScore.toFixed(2)}`;
        }
        if (Math.abs(zScore) > stopZ) {
          sig = 0;
          reason = `stop pair @ z=${zScore.toFixed(2)}`;
        }
      }
      pos = sig;
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 4. MARKET MAKING (Avellaneda-Stoikov reservation price)
// ============================================================
export const MarketMaking: StrategyDef = {
  id: "market_making",
  name: "Market Making (A-S)",
  type: "MARKET_MAKING",
  description:
    "Avellaneda-Stoikov reservation-price market maker. Skews quotes based on inventory: mid shifted by gamma*sigma^2*(q+1). Captures spread when range-bound; loses in trends (controlled by inventory cap).",
  paramSchema: [
    { key: "gamma", label: "Risk Aversion (γ)", type: "number", default: 0.1, min: 0.01, max: 1, step: 0.01 },
    { key: "k", label: "Order Arrival Intensity (κ)", type: "number", default: 1.5, min: 0.1, max: 5, step: 0.1 },
    { key: "maxInventory", label: "Max Inventory (contracts)", type: "number", default: 5, min: 1, max: 50, step: 1 },
    { key: "spread", label: "Quote Spread (σ units)", type: "number", default: 1.5, min: 0.5, max: 5, step: 0.1 },
  ],
  generate: (candles, params) => {
    const gamma = Number(params.gamma ?? 0.1);
    const k = Number(params.k ?? 1.5);
    const maxInv = Number(params.maxInventory ?? 5);
    const spreadSigma = Number(params.spread ?? 1.5);
    const closes = candles.map((c) => c.close);
    const lookback = 30;
    const ma = sma(closes, lookback);
    const out: Signal[] = [];
    let inventory = 0;
    for (let i = 0; i < closes.length; i++) {
      if (i < lookback) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      const slice = closes.slice(i - lookback + 1, i + 1);
      const mean = ma[i] as number;
      const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / lookback;
      const sigma = Math.sqrt(variance);
      const dt = 1 / 252;
      const reservation =
        closes[i] - inventory * gamma * sigma * sigma * dt;
      const halfSpread = spreadSigma * sigma / Math.sqrt(k);
      const bid = reservation - halfSpread;
      const ask = reservation + halfSpread;
      // Decide if we'd be hit & how that updates inventory
      let sig = 0;
      let reason = "post quotes";
      if (closes[i] <= bid && inventory < maxInv) {
        inventory++;
        sig = 1;
        reason = `bid hit @ ${bid.toFixed(2)} inv=${inventory}`;
      } else if (closes[i] >= ask && inventory > -maxInv) {
        inventory--;
        sig = -1;
        reason = `ask hit @ ${ask.toFixed(2)} inv=${inventory}`;
      } else {
        reason = `quotes ${bid.toFixed(2)}/${ask.toFixed(2)} inv=${inventory}`;
        sig = 0;
      }
      out.push({ time: candles[i].time, signal: sig, reason });
    }
    return out;
  },
};

// ============================================================
// 5. BREAKOUT (Donchian + Bollinger)
// ============================================================
export const Breakout: StrategyDef = {
  id: "breakout",
  name: "Breakout (Donchian+Bollinger)",
  type: "BREAKOUT",
  description:
    "Enters long on close > N-day high AND upper Bollinger; short on mirror. Exits on touch of opposite band or ATR-based trailing stop. The classic turtle-trader pattern, modernized with volatility confirmation.",
  paramSchema: [
    { key: "lookback", label: "Donchian Lookback", type: "number", default: 20, min: 5, max: 100, step: 1 },
    { key: "bbPeriod", label: "Bollinger Period", type: "number", default: 20, min: 5, max: 100, step: 1 },
    { key: "bbStd", label: "Bollinger Std", type: "number", default: 2, min: 1, max: 3, step: 0.25 },
    { key: "atrMult", label: "ATR Stop Mult", type: "number", default: 2.5, min: 1, max: 6, step: 0.25 },
  ],
  generate: (candles, params) => {
    const lookback = Number(params.lookback ?? 20);
    const bbPeriod = Number(params.bbPeriod ?? 20);
    const bbStd = Number(params.bbStd ?? 2);
    const atrMult = Number(params.atrMult ?? 2.5);
    const closes = candles.map((c) => c.close);
    const bb = bollingerBands(closes, bbPeriod, bbStd);
    const atrArr = atr(candles, 14);
    const out: Signal[] = [];
    let pos = 0;
    let entryPrice = 0;
    let stopPrice = 0;
    for (let i = 1; i < candles.length; i++) {
      if (i < Math.max(lookback, bbPeriod) || bb.upper[i] == null || atrArr[i] == null) {
        out.push({ time: candles[i].time, signal: 0, reason: "warmup" });
        continue;
      }
      let hh = -Infinity;
      let ll = Infinity;
      for (let j = i - lookback; j < i; j++) {
        hh = Math.max(hh, candles[j].high);
        ll = Math.min(ll, candles[j].low);
      }
      const upper = bb.upper[i] as number;
      const lower = bb.lower[i] as number;
      const a = atrArr[i] as number;
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (candles[i].close > hh && candles[i].close > upper) {
          sig = 1;
          entryPrice = candles[i].close;
          stopPrice = entryPrice - atrMult * a;
          reason = `long breakout ${candles[i].close.toFixed(2)} > ${hh.toFixed(2)}`;
        } else if (candles[i].close < ll && candles[i].close < lower) {
          sig = -1;
          entryPrice = candles[i].close;
          stopPrice = entryPrice + atrMult * a;
          reason = `short breakout ${candles[i].close.toFixed(2)} < ${ll.toFixed(2)}`;
        }
      } else {
        if (pos > 0) {
          const newStop = Math.max(stopPrice, candles[i].close - atrMult * a);
          stopPrice = newStop;
          if (candles[i].close < stopPrice || candles[i].close < lower) {
            sig = 0;
            reason = `exit long @ ${candles[i].close.toFixed(2)} stop=${stopPrice.toFixed(2)}`;
          }
        } else if (pos < 0) {
          const newStop = Math.min(stopPrice, candles[i].close + atrMult * a);
          stopPrice = newStop;
          if (candles[i].close > stopPrice || candles[i].close > upper) {
            sig = 0;
            reason = `exit short @ ${candles[i].close.toFixed(2)} stop=${stopPrice.toFixed(2)}`;
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
// 6. VOLATILITY (Vol-Risk Premium harvesting proxy)
// ============================================================
export const Volatility: StrategyDef = {
  id: "volatility",
  name: "Volatility (VRP Harvest)",
  type: "VOLATILITY",
  description:
    "Harvests the variance risk premium: compares realised vol (recent stdev of returns) to a longer-horizon realised. Shorts vol when realised > recent (mean reversion of vol), longs when vol depressed. A simplified proxy for VRP harvesting done via straddles at TwigCapra.",
  paramSchema: [
    { key: "fastVol", label: "Fast Vol Window", type: "number", default: 5, min: 2, max: 30, step: 1 },
    { key: "slowVol", label: "Slow Vol Window", type: "number", default: 20, min: 10, max: 100, step: 1 },
    { key: "entryRatio", label: "Entry Vol Ratio", type: "number", default: 1.5, min: 1.1, max: 3, step: 0.1 },
    { key: "exitRatio", label: "Exit Vol Ratio", type: "number", default: 1.0, min: 0.5, max: 1.2, step: 0.05 },
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
      const ratio = fastVol / slowVol;
      let sig = pos;
      let reason = "hold";
      if (pos === 0) {
        if (ratio > entryR) {
          sig = -1; // short vol: expect mean reversion
          reason = `short vol ratio=${ratio.toFixed(2)}`;
        } else if (ratio < 1 / entryR) {
          sig = 1; // long vol: expect expansion
          reason = `long vol ratio=${ratio.toFixed(2)}`;
        }
      } else {
        if (pos < 0 && ratio < exitR) {
          sig = 0;
          reason = `exit short vol ratio=${ratio.toFixed(2)}`;
        }
        if (pos > 0 && ratio > 1 / exitR) {
          sig = 0;
          reason = `exit long vol ratio=${ratio.toFixed(2)}`;
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

export const STRATEGIES: StrategyDef[] = [
  MeanReversion,
  Momentum,
  Pairs,
  MarketMaking,
  Breakout,
  Volatility,
];

export const STRATEGY_MAP: Record<string, StrategyDef> = STRATEGIES.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<string, StrategyDef>,
);

export function getStrategy(id: string): StrategyDef | undefined {
  return STRATEGY_MAP[id];
}
