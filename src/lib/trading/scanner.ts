/**
 * Market Scanner Engine
 *
 * Scans all tradable contracts for technical signals and ranks them by
 * signal strength. Pure read-only — pulls candles from MarketEngine,
 * computes indicators, returns ranked signal list.
 *
 * Signal types:
 *  - RSI_OVERSOLD / RSI_OVERBOUGHT
 *  - SMA_CROSS_UP / SMA_CROSS_DOWN (price vs SMA20)
 *  - BB_UPPER_TOUCH / BB_LOWER_TOUCH
 *  - VOLUME_SPIKE (current vol vs 20-bar avg)
 *  - MOMENTUM_UP / MOMENTUM_DOWN (rate of change)
 *  - ATR_BREAKOUT (range expansion)
 *  - VWAP_DEV (price far from VWAP)
 */
import { CONTRACTS } from "./contracts";
import { getEngine } from "./market-engine";
import { atr, bollingerBands, rsi, sma, vwap } from "./indicators";
import type { Candle } from "./types";

export type SignalType =
  | "RSI_OVERSOLD"
  | "RSI_OVERBOUGHT"
  | "SMA_CROSS_UP"
  | "SMA_CROSS_DOWN"
  | "BB_UPPER_TOUCH"
  | "BB_LOWER_TOUCH"
  | "VOLUME_SPIKE"
  | "MOMENTUM_UP"
  | "MOMENTUM_DOWN"
  | "ATR_BREAKOUT"
  | "VWAP_DEV_HIGH"
  | "VWAP_DEV_LOW";

export interface ScanResult {
  symbol: string;
  name: string;
  assetClass: string;
  lastPrice: number;
  changePct: number;
  signals: { type: SignalType; strength: number; description: string }[];
  // Composite score: sum of signal strengths (0-100)
  compositeScore: number;
  // Bullish (+) / Bearish (-) bias
  bias: number;
}

export interface ScanConfig {
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  smaPeriod: number;
  bbPeriod: number;
  bbStd: number;
  volSpikeMult: number; // x baseline
  momentumPeriod: number;
  momentumThreshold: number; // % change
  atrLookback: number;
  atrMult: number; // current ATR vs avg ATR
  vwapDevThreshold: number; // % from VWAP
}

export const DEFAULT_SCAN_CONFIG: ScanConfig = {
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  smaPeriod: 20,
  bbPeriod: 20,
  bbStd: 2,
  volSpikeMult: 2.5,
  momentumPeriod: 10,
  momentumThreshold: 1.5,
  atrLookback: 14,
  atrMult: 1.5,
  vwapDevThreshold: 1.0,
};

const SIGNAL_BIAS: Record<SignalType, number> = {
  RSI_OVERSOLD: 1, // bullish (mean reversion)
  RSI_OVERBOUGHT: -1, // bearish
  SMA_CROSS_UP: 1,
  SMA_CROSS_DOWN: -1,
  BB_UPPER_TOUCH: -1,
  BB_LOWER_TOUCH: 1,
  VOLUME_SPIKE: 0, // neutral, just attention
  MOMENTUM_UP: 1,
  MOMENTUM_DOWN: -1,
  ATR_BREAKOUT: 0, // direction-agnostic
  VWAP_DEV_HIGH: -1, // mean reversion: overextended up
  VWAP_DEV_LOW: 1,
};

const SIGNAL_LABELS: Record<SignalType, string> = {
  RSI_OVERSOLD: "RSI Oversold",
  RSI_OVERBOUGHT: "RSI Overbought",
  SMA_CROSS_UP: "Above SMA",
  SMA_CROSS_DOWN: "Below SMA",
  BB_UPPER_TOUCH: "BB Upper Touch",
  BB_LOWER_TOUCH: "BB Lower Touch",
  VOLUME_SPIKE: "Volume Spike",
  MOMENTUM_UP: "Momentum Up",
  MOMENTUM_DOWN: "Momentum Down",
  ATR_BREAKOUT: "ATR Breakout",
  VWAP_DEV_HIGH: "Above VWAP",
  VWAP_DEV_LOW: "Below VWAP",
};

export function getSignalLabel(t: SignalType): string {
  return SIGNAL_LABELS[t];
}

/**
 * Scan all contracts and return ranked results.
 */
export function scanMarket(config: ScanConfig = DEFAULT_SCAN_CONFIG): ScanResult[] {
  const engine = getEngine();
  const results: ScanResult[] = [];
  for (const contract of CONTRACTS) {
    const candles = engine.getCandles(contract.symbol, 100);
    if (candles.length < 30) continue;
    const quote = engine.getQuote(contract.symbol);
    if (!quote) continue;
    const result = scanSymbol(contract.symbol, contract.name, contract.assetClass, candles, quote.last, quote.changePct, config);
    if (result.signals.length > 0) results.push(result);
  }
  // Sort by composite score (strongest first)
  results.sort((a, b) => Math.abs(b.compositeScore) - Math.abs(a.compositeScore));
  return results;
}

export function scanSymbol(
  symbol: string,
  name: string,
  assetClass: string,
  candles: Candle[],
  lastPrice: number,
  changePct: number,
  config: ScanConfig,
): ScanResult {
  const closes = candles.map((c) => c.close);
  const signals: ScanResult["signals"] = [];
  // RSI
  const rsiArr = rsi(closes, config.rsiPeriod);
  const lastRsi = rsiArr[rsiArr.length - 1];
  if (lastRsi != null) {
    if (lastRsi <= config.rsiOversold) {
      signals.push({
        type: "RSI_OVERSOLD",
        strength: Math.min(100, ((config.rsiOversold - lastRsi) / config.rsiOversold) * 100 + 30),
        description: `RSI ${lastRsi.toFixed(1)} ≤ ${config.rsiOversold}`,
      });
    } else if (lastRsi >= config.rsiOverbought) {
      signals.push({
        type: "RSI_OVERBOUGHT",
        strength: Math.min(100, ((lastRsi - config.rsiOverbought) / (100 - config.rsiOverbought)) * 100 + 30),
        description: `RSI ${lastRsi.toFixed(1)} ≥ ${config.rsiOverbought}`,
      });
    }
  }
  // SMA cross
  const smaArr = sma(closes, config.smaPeriod);
  const lastSma = smaArr[smaArr.length - 1];
  const prevSma = smaArr[smaArr.length - 2];
  if (lastSma != null && prevSma != null) {
    const prevAbove = closes[closes.length - 2] > (prevSma as number);
    const nowAbove = lastPrice > (lastSma as number);
    if (!prevAbove && nowAbove) {
      signals.push({
        type: "SMA_CROSS_UP",
        strength: 60,
        description: `Crossed above SMA${config.smaPeriod} (${(lastSma as number).toFixed(2)})`,
      });
    } else if (prevAbove && !nowAbove) {
      signals.push({
        type: "SMA_CROSS_DOWN",
        strength: 60,
        description: `Crossed below SMA${config.smaPeriod} (${(lastSma as number).toFixed(2)})`,
      });
    }
  }
  // Bollinger
  const bb = bollingerBands(closes, config.bbPeriod, config.bbStd);
  const bbUpper = bb.upper[bb.upper.length - 1];
  const bbLower = bb.lower[bb.lower.length - 1];
  if (bbUpper != null && lastPrice >= (bbUpper as number)) {
    signals.push({
      type: "BB_UPPER_TOUCH",
      strength: Math.min(100, ((lastPrice - (bbUpper as number)) / (bbUpper as number)) * 1000 + 50),
      description: `Price ${lastPrice.toFixed(2)} ≥ BB upper ${(bbUpper as number).toFixed(2)}`,
    });
  }
  if (bbLower != null && lastPrice <= (bbLower as number)) {
    signals.push({
      type: "BB_LOWER_TOUCH",
      strength: Math.min(100, (((bbLower as number) - lastPrice) / (bbLower as number)) * 1000 + 50),
      description: `Price ${lastPrice.toFixed(2)} ≤ BB lower ${(bbLower as number).toFixed(2)}`,
    });
  }
  // Volume spike
  if (candles.length >= 25) {
    const baseline = candles.slice(-25, -5).reduce((s, c) => s + c.volume, 0) / 20;
    const recent = candles[candles.length - 1].volume;
    if (recent > baseline * config.volSpikeMult) {
      signals.push({
        type: "VOLUME_SPIKE",
        strength: Math.min(100, ((recent / baseline - 1) * 50)),
        description: `Vol ${recent.toLocaleString()} vs avg ${baseline.toFixed(0)} (${(recent / baseline).toFixed(1)}x)`,
      });
    }
  }
  // Momentum
  if (candles.length >= config.momentumPeriod + 1) {
    const past = closes[closes.length - 1 - config.momentumPeriod];
    const roc = ((lastPrice - past) / past) * 100;
    if (roc >= config.momentumThreshold) {
      signals.push({
        type: "MOMENTUM_UP",
        strength: Math.min(100, (roc / config.momentumThreshold) * 40),
        description: `${config.momentumPeriod}-bar ROC: +${roc.toFixed(2)}%`,
      });
    } else if (roc <= -config.momentumThreshold) {
      signals.push({
        type: "MOMENTUM_DOWN",
        strength: Math.min(100, (-roc / config.momentumThreshold) * 40),
        description: `${config.momentumPeriod}-bar ROC: ${roc.toFixed(2)}%`,
      });
    }
  }
  // ATR breakout (range expansion)
  const atrArr = atr(candles, config.atrLookback);
  const lastAtr = atrArr[atrArr.length - 1];
  const avgAtr = atrArr.slice(-20).filter((a) => a != null).reduce((s, a) => s + (a as number), 0) / Math.max(1, atrArr.slice(-20).filter((a) => a != null).length);
  if (lastAtr != null && avgAtr > 0 && (lastAtr as number) > avgAtr * config.atrMult) {
    signals.push({
      type: "ATR_BREAKOUT",
      strength: Math.min(100, ((lastAtr as number) / avgAtr - 1) * 100),
      description: `ATR ${(lastAtr as number).toFixed(2)} vs avg ${avgAtr.toFixed(2)} (${((lastAtr as number) / avgAtr).toFixed(1)}x)`,
    });
  }
  // VWAP deviation
  const vwapArr = vwap(candles);
  const lastVwap = vwapArr[vwapArr.length - 1];
  if (lastVwap != null) {
    const dev = ((lastPrice - (lastVwap as number)) / (lastVwap as number)) * 100;
    if (dev >= config.vwapDevThreshold) {
      signals.push({
        type: "VWAP_DEV_HIGH",
        strength: Math.min(100, (dev / config.vwapDevThreshold) * 30),
        description: `${dev.toFixed(2)}% above VWAP (${(lastVwap as number).toFixed(2)})`,
      });
    } else if (dev <= -config.vwapDevThreshold) {
      signals.push({
        type: "VWAP_DEV_LOW",
        strength: Math.min(100, (-dev / config.vwapDevThreshold) * 30),
        description: `${dev.toFixed(2)}% below VWAP (${(lastVwap as number).toFixed(2)})`,
      });
    }
  }
  // Compute composite score & bias
  const compositeScore = signals.reduce((s, sig) => s + sig.strength, 0);
  const bias = signals.reduce((s, sig) => s + sig.strength * SIGNAL_BIAS[sig.type], 0);
  return {
    symbol,
    name,
    assetClass,
    lastPrice,
    changePct,
    signals,
    compositeScore,
    bias,
  };
}
