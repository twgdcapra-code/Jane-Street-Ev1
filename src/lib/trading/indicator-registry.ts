/**
 * Indicator Registry & Presets
 *
 * Central registry of all available indicators with metadata (name, category,
 * default params, description). Used by the UI to dynamically render the
 * indicator library and customization panels.
 *
 * Also handles preset save/load (in-memory; would be localStorage in prod).
 */
import type { Candle } from "./types";
import {
  sma, ema, wma, hma, dema, tema, kama, rsi, macd, bollingerBands, atr, vwap,
  stochastic, adx, aroon, vortex, parabolicSAR, superTrend, ichimoku, keltner,
  donchian, linearRegression, zigZag, cci, williamsR, mfi, trix, roc, momentum,
  cmf, dpo, kst, awesomeOscillator, ttmSqueeze, obv, accumulationDistribution,
  forceIndex, easeOfMovement, volumeOscillator, vwma, stdev, heikinAshi,
  pivotPoints, detectCandlePatterns,
} from "./indicators-advanced";

export type IndicatorCategory = "TREND" | "MOMENTUM" | "VOLATILITY" | "VOLUME" | "PATTERN";

export interface IndicatorParamDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface IndicatorDef {
  id: string;
  name: string;
  category: IndicatorCategory;
  description: string;
  params: IndicatorParamDef[];
  /** Execute the indicator and return plottable series */
  compute: (candles: Candle[], params: Record<string, number>) => { series: { name: string; values: (number | null)[]; color: string }[] };
  /** Returns a single current value for display */
  currentValue: (candles: Candle[], params: Record<string, number>) => { name: string; value: number | null }[];
}

export const INDICATOR_REGISTRY: IndicatorDef[] = [
  // ===== TREND =====
  {
    id: "sma",
    name: "Simple Moving Average (SMA)",
    category: "TREND",
    description: "Average of closing prices over N periods. Baseline trend indicator.",
    params: [{ key: "period", label: "Period", default: 20, min: 2, max: 500, step: 1 }],
    compute: (c, p) => ({ series: [{ name: `SMA ${p.period ?? 20}`, values: sma(c.map((x) => x.close), p.period ?? 20), color: "#3b82f6" }] }),
    currentValue: (c, p) => { const v = sma(c.map((x) => x.close), p.period ?? 20); return [{ name: `SMA${p.period ?? 20}`, value: v[v.length - 1] }]; },
  },
  {
    id: "ema",
    name: "Exponential Moving Average (EMA)",
    category: "TREND",
    description: "Weighted average giving more weight to recent prices. Faster than SMA.",
    params: [{ key: "period", label: "Period", default: 20, min: 2, max: 500, step: 1 }],
    compute: (c, p) => ({ series: [{ name: `EMA ${p.period ?? 20}`, values: ema(c.map((x) => x.close), p.period ?? 20), color: "#a855f7" }] }),
    currentValue: (c, p) => { const v = ema(c.map((x) => x.close), p.period ?? 20); return [{ name: `EMA${p.period ?? 20}`, value: v[v.length - 1] }]; },
  },
  {
    id: "wma",
    name: "Weighted Moving Average (WMA)",
    category: "TREND",
    description: "Linearly weighted average. Recent prices have higher weight.",
    params: [{ key: "period", label: "Period", default: 20, min: 2, max: 500, step: 1 }],
    compute: (c, p) => ({ series: [{ name: `WMA ${p.period ?? 20}`, values: wma(c.map((x) => x.close), p.period ?? 20), color: "#06b6d4" }] }),
    currentValue: (c, p) => { const v = wma(c.map((x) => x.close), p.period ?? 20); return [{ name: `WMA${p.period ?? 20}`, value: v[v.length - 1] }]; },
  },
  {
    id: "hma",
    name: "Hull Moving Average (HMA)",
    category: "TREND",
    description: "Reduced lag moving average. Smoother and more responsive than WMA.",
    params: [{ key: "period", label: "Period", default: 20, min: 2, max: 500, step: 1 }],
    compute: (c, p) => ({ series: [{ name: `HMA ${p.period ?? 20}`, values: hma(c.map((x) => x.close), p.period ?? 20), color: "#f59e0b" }] }),
    currentValue: (c, p) => { const v = hma(c.map((x) => x.close), p.period ?? 20); return [{ name: `HMA${p.period ?? 20}`, value: v[v.length - 1] }]; },
  },
  {
    id: "dema",
    name: "Double EMA (DEMA)",
    category: "TREND",
    description: "2×EMA - EMA(EMA). Reduces lag compared to single EMA.",
    params: [{ key: "period", label: "Period", default: 20, min: 2, max: 500, step: 1 }],
    compute: (c, p) => ({ series: [{ name: `DEMA ${p.period ?? 20}`, values: dema(c.map((x) => x.close), p.period ?? 20), color: "#ec4899" }] }),
    currentValue: (c, p) => { const v = dema(c.map((x) => x.close), p.period ?? 20); return [{ name: `DEMA${p.period ?? 20}`, value: v[v.length - 1] }]; },
  },
  {
    id: "tema",
    name: "Triple EMA (TEMA)",
    category: "TREND",
    description: "3×EMA - 3×EMA(EMA) + EMA(EMA(EMA)). Even lower lag than DEMA.",
    params: [{ key: "period", label: "Period", default: 20, min: 2, max: 500, step: 1 }],
    compute: (c, p) => ({ series: [{ name: `TEMA ${p.period ?? 20}`, values: tema(c.map((x) => x.close), p.period ?? 20), color: "#84cc16" }] }),
    currentValue: (c, p) => { const v = tema(c.map((x) => x.close), p.period ?? 20); return [{ name: `TEMA${p.period ?? 20}`, value: v[v.length - 1] }]; },
  },
  {
    id: "kama",
    name: "Kaufman Adaptive MA (KAMA)",
    category: "TREND",
    description: "Adapts smoothing to market noise. Fast in trends, slow in ranges.",
    params: [
      { key: "period", label: "Period", default: 10, min: 2, max: 100, step: 1 },
      { key: "fast", label: "Fast SC", default: 2, min: 2, max: 20, step: 1 },
      { key: "slow", label: "Slow SC", default: 30, min: 5, max: 100, step: 1 },
    ],
    compute: (c, p) => ({ series: [{ name: "KAMA", values: kama(c.map((x) => x.close), p.period ?? 10, p.fast ?? 2, p.slow ?? 30), color: "#f43f5e" }] }),
    currentValue: (c, p) => { const v = kama(c.map((x) => x.close), p.period ?? 10, p.fast ?? 2, p.slow ?? 30); return [{ name: "KAMA", value: v[v.length - 1] }]; },
  },
  {
    id: "supertrend",
    name: "SuperTrend",
    category: "TREND",
    description: "ATR-based trend following overlay. Green = uptrend, Red = downtrend.",
    params: [
      { key: "period", label: "ATR Period", default: 10, min: 2, max: 100, step: 1 },
      { key: "mult", label: "Multiplier", default: 3, min: 1, max: 10, step: 0.1 },
    ],
    compute: (c, p) => {
      const st = superTrend(c, p.period ?? 10, p.mult ?? 3);
      return { series: [{ name: "SuperTrend", values: st.superTrend, color: "#10b981" }] };
    },
    currentValue: (c, p) => { const st = superTrend(c, p.period ?? 10, p.mult ?? 3); const d = st.direction[st.direction.length - 1]; return [{ name: "SuperTrend", value: st.superTrend[st.superTrend.length - 1] }, { name: "Direction", value: d }]; },
  },
  {
    id: "psar",
    name: "Parabolic SAR",
    category: "TREND",
    description: "Stop-and-reverse. Dots above price = downtrend, below = uptrend.",
    params: [
      { key: "step", label: "Step", default: 0.02, min: 0.001, max: 0.1, step: 0.001 },
      { key: "maxStep", label: "Max Step", default: 0.2, min: 0.01, max: 1, step: 0.01 },
    ],
    compute: (c, p) => ({ series: [{ name: "PSAR", values: parabolicSAR(c, p.step ?? 0.02, p.maxStep ?? 0.2), color: "#fbbf24" }] }),
    currentValue: (c, p) => { const v = parabolicSAR(c, p.step ?? 0.02, p.maxStep ?? 0.2); return [{ name: "PSAR", value: v[v.length - 1] }]; },
  },
  {
    id: "ichimoku",
    name: "Ichimoku Cloud",
    category: "TREND",
    description: "5-line system: Tenkan, Kijun, Senkou A/B (cloud), Chikou span.",
    params: [
      { key: "conversion", label: "Conversion", default: 9, min: 2, max: 100, step: 1 },
      { key: "base", label: "Base", default: 26, min: 2, max: 200, step: 1 },
      { key: "spanB", label: "Span B", default: 52, min: 10, max: 400, step: 1 },
    ],
    compute: (c, p) => {
      const ic = ichimoku(c, p.conversion ?? 9, p.base ?? 26, p.spanB ?? 52);
      return {
        series: [
          { name: "Tenkan", values: ic.tenkan, color: "#3b82f6" },
          { name: "Kijun", values: ic.kijun, color: "#ef4444" },
          { name: "Senkou A", values: ic.senkouA, color: "#10b981" },
          { name: "Senkou B", values: ic.senkouB, color: "#f43f5e" },
        ],
      };
    },
    currentValue: (c, p) => { const ic = ichimoku(c, p.conversion ?? 9, p.base ?? 26, p.spanB ?? 52); return [{ name: "Tenkan", value: ic.tenkan[ic.tenkan.length - 1] }, { name: "Kijun", value: ic.kijun[ic.kijun.length - 1] }]; },
  },
  {
    id: "linearreg",
    name: "Linear Regression",
    category: "TREND",
    description: "Least-squares fitted line over N periods. Shows statistical trend.",
    params: [{ key: "period", label: "Period", default: 20, min: 5, max: 200, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "LinReg", values: linearRegression(c.map((x) => x.close), p.period ?? 20), color: "#8b5cf6" }] }),
    currentValue: (c, p) => { const v = linearRegression(c.map((x) => x.close), p.period ?? 20); return [{ name: "LinReg", value: v[v.length - 1] }]; },
  },
  {
    id: "zigzag",
    name: "ZigZag",
    category: "TREND",
    description: "Filters out small moves, shows significant reversals only.",
    params: [{ key: "threshold", label: "Threshold %", default: 0.05, min: 0.01, max: 0.5, step: 0.01 }],
    compute: (c, p) => ({ series: [{ name: "ZigZag", values: zigZag(c, p.threshold ?? 0.05), color: "#facc15" }] }),
    currentValue: (c, p) => { const v = zigZag(c, p.threshold ?? 0.05); return [{ name: "ZigZag", value: v[v.length - 1] }]; },
  },
  {
    id: "adx",
    name: "ADX / +DI / -DI",
    category: "TREND",
    description: "ADX measures trend strength (not direction). +DI/-DI show direction. >25 = strong trend.",
    params: [{ key: "period", label: "Period", default: 14, min: 2, max: 100, step: 1 }],
    compute: (c, p) => {
      const a = adx(c, p.period ?? 14);
      return {
        series: [
          { name: "ADX", values: a.adx, color: "#fbbf24" },
          { name: "+DI", values: a.plusDI, color: "#10b981" },
          { name: "-DI", values: a.minusDI, color: "#ef4444" },
        ],
      };
    },
    currentValue: (c, p) => { const a = adx(c, p.period ?? 14); return [{ name: "ADX", value: a.adx[a.adx.length - 1] }, { name: "+DI", value: a.plusDI[a.plusDI.length - 1] }, { name: "-DI", value: a.minusDI[a.minusDI.length - 1] }]; },
  },
  {
    id: "aroon",
    name: "Aroon Up/Down",
    category: "TREND",
    description: "Identifies trend changes. Aroon Up > 70 = strong uptrend.",
    params: [{ key: "period", label: "Period", default: 25, min: 5, max: 100, step: 1 }],
    compute: (c, p) => { const a = aroon(c, p.period ?? 25); return { series: [{ name: "Aroon Up", values: a.up, color: "#10b981" }, { name: "Aroon Down", values: a.down, color: "#ef4444" }] }; },
    currentValue: (c, p) => { const a = aroon(c, p.period ?? 25); return [{ name: "Aroon Up", value: a.up[a.up.length - 1] }, { name: "Aroon Down", value: a.down[a.down.length - 1] }]; },
  },
  {
    id: "vortex",
    name: "Vortex Indicator",
    category: "TREND",
    description: "+VI crossing above -VI = bullish, below = bearish.",
    params: [{ key: "period", label: "Period", default: 14, min: 5, max: 100, step: 1 }],
    compute: (c, p) => { const v = vortex(c, p.period ?? 14); return { series: [{ name: "+VI", values: v.plusVI, color: "#10b981" }, { name: "-VI", values: v.minusVI, color: "#ef4444" }] }; },
    currentValue: (c, p) => { const v = vortex(c, p.period ?? 14); return [{ name: "+VI", value: v.plusVI[v.plusVI.length - 1] }, { name: "-VI", value: v.minusVI[v.minusVI.length - 1] }]; },
  },
  // ===== MOMENTUM =====
  {
    id: "rsi",
    name: "Relative Strength Index (RSI)",
    category: "MOMENTUM",
    description: "0-100 oscillator. >70 overbought, <30 oversold. Mean-reversion classic.",
    params: [{ key: "period", label: "Period", default: 14, min: 2, max: 100, step: 1 }],
    compute: (c, p) => ({ series: [{ name: `RSI ${p.period ?? 14}`, values: rsi(c.map((x) => x.close), p.period ?? 14), color: "#8b5cf6" }] }),
    currentValue: (c, p) => { const v = rsi(c.map((x) => x.close), p.period ?? 14); return [{ name: "RSI", value: v[v.length - 1] }]; },
  },
  {
    id: "macd",
    name: "MACD",
    category: "MOMENTUM",
    description: "Fast EMA - Slow EMA, with signal line. Histogram shows momentum.",
    params: [
      { key: "fast", label: "Fast", default: 12, min: 2, max: 50, step: 1 },
      { key: "slow", label: "Slow", default: 26, min: 5, max: 100, step: 1 },
      { key: "signal", label: "Signal", default: 9, min: 2, max: 50, step: 1 },
    ],
    compute: (c, p) => {
      const m = macd(c.map((x) => x.close), p.fast ?? 12, p.slow ?? 26, p.signal ?? 9);
      return { series: [{ name: "MACD", values: m.macd, color: "#3b82f6" }, { name: "Signal", values: m.signal, color: "#f59e0b" }, { name: "Histogram", values: m.histogram, color: "#10b981" }] };
    },
    currentValue: (c, p) => { const m = macd(c.map((x) => x.close), p.fast ?? 12, p.slow ?? 26, p.signal ?? 9); return [{ name: "MACD", value: m.macd[m.macd.length - 1] }, { name: "Signal", value: m.signal[m.signal.length - 1] }, { name: "Hist", value: m.histogram[m.histogram.length - 1] }]; },
  },
  {
    id: "stochastic",
    name: "Stochastic Oscillator",
    category: "MOMENTUM",
    description: "%K and %D. >80 overbought, <20 oversold. Crossovers signal reversals.",
    params: [
      { key: "kPeriod", label: "%K Period", default: 14, min: 2, max: 100, step: 1 },
      { key: "dPeriod", label: "%D Period", default: 3, min: 1, max: 50, step: 1 },
      { key: "smooth", label: "Smooth", default: 1, min: 1, max: 20, step: 1 },
    ],
    compute: (c, p) => { const s = stochastic(c, p.kPeriod ?? 14, p.dPeriod ?? 3, p.smooth ?? 1); return { series: [{ name: "%K", values: s.k, color: "#3b82f6" }, { name: "%D", values: s.d, color: "#f59e0b" }] }; },
    currentValue: (c, p) => { const s = stochastic(c, p.kPeriod ?? 14, p.dPeriod ?? 3, p.smooth ?? 1); return [{ name: "%K", value: s.k[s.k.length - 1] }, { name: "%D", value: s.d[s.d.length - 1] }]; },
  },
  {
    id: "cci",
    name: "Commodity Channel Index (CCI)",
    category: "MOMENTUM",
    description: "Oscillator around 0. >100 overbought, <-100 oversold. Cyclical.",
    params: [{ key: "period", label: "Period", default: 20, min: 5, max: 100, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "CCI", values: cci(c, p.period ?? 20), color: "#06b6d4" }] }),
    currentValue: (c, p) => { const v = cci(c, p.period ?? 20); return [{ name: "CCI", value: v[v.length - 1] }]; },
  },
  {
    id: "williamsr",
    name: "Williams %R",
    category: "MOMENTUM",
    description: "0 to -100 scale. >-20 overbought, <-80 oversold.",
    params: [{ key: "period", label: "Period", default: 14, min: 2, max: 100, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "Williams %R", values: williamsR(c, p.period ?? 14), color: "#84cc16" }] }),
    currentValue: (c, p) => { const v = williamsR(c, p.period ?? 14); return [{ name: "Williams %R", value: v[v.length - 1] }]; },
  },
  {
    id: "mfi",
    name: "Money Flow Index (MFI)",
    category: "MOMENTUM",
    description: "Volume-weighted RSI. >80 overbought, <20 oversold.",
    params: [{ key: "period", label: "Period", default: 14, min: 2, max: 100, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "MFI", values: mfi(c, p.period ?? 14), color: "#ec4899" }] }),
    currentValue: (c, p) => { const v = mfi(c, p.period ?? 14); return [{ name: "MFI", value: v[v.length - 1] }]; },
  },
  {
    id: "trix",
    name: "TRIX",
    category: "MOMENTUM",
    description: "Triple-smoothed EMA rate of change. Filters noise, shows trend momentum.",
    params: [{ key: "period", label: "Period", default: 15, min: 2, max: 100, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "TRIX", values: trix(c.map((x) => x.close), p.period ?? 15), color: "#f43f5e" }] }),
    currentValue: (c, p) => { const v = trix(c.map((x) => x.close), p.period ?? 15); return [{ name: "TRIX", value: v[v.length - 1] }]; },
  },
  {
    id: "roc",
    name: "Rate of Change (ROC)",
    category: "MOMENTUM",
    description: "Percentage change over N periods. Pure momentum.",
    params: [{ key: "period", label: "Period", default: 12, min: 1, max: 200, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "ROC", values: roc(c.map((x) => x.close), p.period ?? 12), color: "#a855f7" }] }),
    currentValue: (c, p) => { const v = roc(c.map((x) => x.close), p.period ?? 12); return [{ name: "ROC", value: v[v.length - 1] }]; },
  },
  {
    id: "momentum",
    name: "Momentum (Raw)",
    category: "MOMENTUM",
    description: "Close - Close(N periods ago). Absolute momentum.",
    params: [{ key: "period", label: "Period", default: 10, min: 1, max: 200, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "Momentum", values: momentum(c.map((x) => x.close), p.period ?? 10), color: "#facc15" }] }),
    currentValue: (c, p) => { const v = momentum(c.map((x) => x.close), p.period ?? 10); return [{ name: "Momentum", value: v[v.length - 1] }]; },
  },
  {
    id: "dpo",
    name: "Detrended Price Oscillator (DPO)",
    category: "MOMENTUM",
    description: "Removes trend to highlight cycles and overbought/oversold.",
    params: [{ key: "period", label: "Period", default: 20, min: 5, max: 100, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "DPO", values: dpo(c, p.period ?? 20), color: "#10b981" }] }),
    currentValue: (c, p) => { const v = dpo(c, p.period ?? 20); return [{ name: "DPO", value: v[v.length - 1] }]; },
  },
  {
    id: "kst",
    name: "Know Sure Thing (KST)",
    category: "MOMENTUM",
    description: "Weighted sum of 4 ROC SMAs. Long-term momentum oscillator.",
    params: [],
    compute: (c) => { const k = kst(c.map((x) => x.close)); return { series: [{ name: "KST", values: k.kst, color: "#3b82f6" }, { name: "Signal", values: k.signal, color: "#f59e0b" }] }; },
    currentValue: (c) => { const k = kst(c.map((x) => x.close)); return [{ name: "KST", value: k.kst[k.kst.length - 1] }, { name: "Signal", value: k.signal[k.signal.length - 1] }]; },
  },
  {
    id: "awesome",
    name: "Awesome Oscillator",
    category: "MOMENTUM",
    description: "SMA5(HL2) - SMA34(HL2). Twin-peaks = reversal signal.",
    params: [],
    compute: (c) => ({ series: [{ name: "AO", values: awesomeOscillator(c), color: "#06b6d4" }] }),
    currentValue: (c) => { const v = awesomeOscillator(c); return [{ name: "AO", value: v[v.length - 1] }]; },
  },
  {
    id: "cmf",
    name: "Chaikin Money Flow (CMF)",
    category: "MOMENTUM",
    description: "Volume-weighted accumulation/distribution. >0 = buying pressure.",
    params: [{ key: "period", label: "Period", default: 20, min: 5, max: 100, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "CMF", values: cmf(c, p.period ?? 20), color: "#84cc16" }] }),
    currentValue: (c, p) => { const v = cmf(c, p.period ?? 20); return [{ name: "CMF", value: v[v.length - 1] }]; },
  },
  // ===== VOLATILITY =====
  {
    id: "bollinger",
    name: "Bollinger Bands",
    category: "VOLATILITY",
    description: "SMA ± N×StdDev. Band touch = mean reversion, squeeze = pending breakout.",
    params: [
      { key: "period", label: "Period", default: 20, min: 5, max: 200, step: 1 },
      { key: "std", label: "Std Dev", default: 2, min: 0.5, max: 4, step: 0.25 },
    ],
    compute: (c, p) => { const b = bollingerBands(c.map((x) => x.close), p.period ?? 20, p.std ?? 2); return { series: [{ name: "BB Upper", values: b.upper, color: "#f59e0b" }, { name: "BB Middle", values: b.middle, color: "#3b82f6" }, { name: "BB Lower", values: b.lower, color: "#f59e0b" }] }; },
    currentValue: (c, p) => { const b = bollingerBands(c.map((x) => x.close), p.period ?? 20, p.std ?? 2); return [{ name: "Upper", value: b.upper[b.upper.length - 1] }, { name: "Middle", value: b.middle[b.middle.length - 1] }, { name: "Lower", value: b.lower[b.lower.length - 1] }]; },
  },
  {
    id: "atr",
    name: "Average True Range (ATR)",
    category: "VOLATILITY",
    description: "Average price range. Used for stops and position sizing.",
    params: [{ key: "period", label: "Period", default: 14, min: 2, max: 100, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "ATR", values: atr(c, p.period ?? 14), color: "#ef4444" }] }),
    currentValue: (c, p) => { const v = atr(c, p.period ?? 14); return [{ name: "ATR", value: v[v.length - 1] }]; },
  },
  {
    id: "keltner",
    name: "Keltner Channels",
    category: "VOLATILITY",
    description: "EMA ± N×ATR. Less noisy than Bollinger — better for trends.",
    params: [
      { key: "period", label: "EMA Period", default: 20, min: 5, max: 200, step: 1 },
      { key: "mult", label: "ATR Mult", default: 2, min: 0.5, max: 5, step: 0.25 },
    ],
    compute: (c, p) => { const k = keltner(c, p.period ?? 20, p.mult ?? 2); return { series: [{ name: "Keltner Upper", values: k.upper, color: "#a855f7" }, { name: "Keltner Mid", values: k.middle, color: "#3b82f6" }, { name: "Keltner Lower", values: k.lower, color: "#a855f7" }] }; },
    currentValue: (c, p) => { const k = keltner(c, p.period ?? 20, p.mult ?? 2); return [{ name: "Upper", value: k.upper[k.upper.length - 1] }, { name: "Lower", value: k.lower[k.lower.length - 1] }]; },
  },
  {
    id: "donchian",
    name: "Donchian Channels",
    category: "VOLATILITY",
    description: "Highest high / lowest low over N periods. Turtle trader breakout.",
    params: [{ key: "period", label: "Period", default: 20, min: 5, max: 200, step: 1 }],
    compute: (c, p) => { const d = donchian(c, p.period ?? 20); return { series: [{ name: "DC Upper", values: d.upper, color: "#10b981" }, { name: "DC Mid", values: d.middle, color: "#666" }, { name: "DC Lower", values: d.lower, color: "#10b981" }] }; },
    currentValue: (c, p) => { const d = donchian(c, p.period ?? 20); return [{ name: "Upper", value: d.upper[d.upper.length - 1] }, { name: "Lower", value: d.lower[d.lower.length - 1] }]; },
  },
  {
    id: "stdev",
    name: "Standard Deviation",
    category: "VOLATILITY",
    description: "Rolling standard deviation of closes. Raw volatility measure.",
    params: [{ key: "period", label: "Period", default: 20, min: 5, max: 200, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "StdDev", values: stdev(c.map((x) => x.close), p.period ?? 20), color: "#f43f5e" }] }),
    currentValue: (c, p) => { const v = stdev(c.map((x) => x.close), p.period ?? 20); return [{ name: "StdDev", value: v[v.length - 1] }]; },
  },
  {
    id: "ttmsqueeze",
    name: "TTM Squeeze",
    category: "VOLATILITY",
    description: "Bollinger inside Keltner = volatility squeeze. Pending breakout.",
    params: [
      { key: "bbPeriod", label: "BB Period", default: 20, min: 5, max: 100, step: 1 },
      { key: "bbStd", label: "BB Std", default: 2, min: 0.5, max: 4, step: 0.25 },
      { key: "kcMult", label: "KC Mult", default: 1.5, min: 0.5, max: 5, step: 0.25 },
    ],
    compute: (c, p) => { const t = ttmSqueeze(c, p.bbPeriod ?? 20, p.bbStd ?? 2, p.bbPeriod ?? 20, p.kcMult ?? 1.5); return { series: [{ name: "Momentum", values: t.momentum, color: "#fbbf24" }] }; },
    currentValue: (c, p) => { const t = ttmSqueeze(c, p.bbPeriod ?? 20, p.bbStd ?? 2, p.bbPeriod ?? 20, p.kcMult ?? 1.5); const sq = t.squeeze[t.squeeze.length - 1]; return [{ name: "Squeeze", value: sq ? 1 : 0 }, { name: "Momentum", value: t.momentum[t.momentum.length - 1] }]; },
  },
  // ===== VOLUME =====
  {
    id: "vwap",
    name: "VWAP",
    category: "VOLUME",
    description: "Volume-weighted average price. Institutional benchmark.",
    params: [],
    compute: (c) => ({ series: [{ name: "VWAP", values: vwap(c), color: "#facc15" }] }),
    currentValue: (c) => { const v = vwap(c); return [{ name: "VWAP", value: v[v.length - 1] }]; },
  },
  {
    id: "obv",
    name: "On Balance Volume (OBV)",
    category: "VOLUME",
    description: "Cumulative volume signed by price direction. Divergence = reversal.",
    params: [],
    compute: (c) => ({ series: [{ name: "OBV", values: obv(c), color: "#3b82f6" }] }),
    currentValue: (c) => { const v = obv(c); return [{ name: "OBV", value: v[v.length - 1] }]; },
  },
  {
    id: "ad",
    name: "Accumulation/Distribution",
    category: "VOLUME",
    description: "Cumulative money flow. Rising with flat price = accumulation.",
    params: [],
    compute: (c) => ({ series: [{ name: "A/D", values: accumulationDistribution(c), color: "#10b981" }] }),
    currentValue: (c) => { const v = accumulationDistribution(c); return [{ name: "A/D", value: v[v.length - 1] }]; },
  },
  {
    id: "force",
    name: "Force Index",
    category: "VOLUME",
    description: "EMA of (Δclose × volume). Measures force behind moves.",
    params: [{ key: "period", label: "Period", default: 13, min: 2, max: 100, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "Force", values: forceIndex(c, p.period ?? 13), color: "#ef4444" }] }),
    currentValue: (c, p) => { const v = forceIndex(c, p.period ?? 13); return [{ name: "Force", value: v[v.length - 1] }]; },
  },
  {
    id: "emv",
    name: "Ease of Movement",
    category: "VOLUME",
    description: "Price movement per unit of volume. High = easy (low resistance).",
    params: [{ key: "period", label: "Period", default: 14, min: 5, max: 100, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "EMV", values: easeOfMovement(c, p.period ?? 14), color: "#84cc16" }] }),
    currentValue: (c, p) => { const v = easeOfMovement(c, p.period ?? 14); return [{ name: "EMV", value: v[v.length - 1] }]; },
  },
  {
    id: "volosc",
    name: "Volume Oscillator",
    category: "VOLUME",
    description: "Fast vol SMA - Slow vol SMA. Positive = volume increasing.",
    params: [
      { key: "fast", label: "Fast", default: 5, min: 2, max: 50, step: 1 },
      { key: "slow", label: "Slow", default: 10, min: 5, max: 100, step: 1 },
    ],
    compute: (c, p) => ({ series: [{ name: "VolOsc", values: volumeOscillator(c, p.fast ?? 5, p.slow ?? 10), color: "#a855f7" }] }),
    currentValue: (c, p) => { const v = volumeOscillator(c, p.fast ?? 5, p.slow ?? 10); return [{ name: "VolOsc", value: v[v.length - 1] }]; },
  },
  {
    id: "vwma",
    name: "VWMA (Volume WMA)",
    category: "VOLUME",
    description: "Weighted by volume. Confirms price moves with volume.",
    params: [{ key: "period", label: "Period", default: 20, min: 5, max: 200, step: 1 }],
    compute: (c, p) => ({ series: [{ name: "VWMA", values: vwma(c, p.period ?? 20), color: "#06b6d4" }] }),
    currentValue: (c, p) => { const v = vwma(c, p.period ?? 20); return [{ name: "VWMA", value: v[v.length - 1] }]; },
  },
];

export const INDICATOR_MAP: Record<string, IndicatorDef> = INDICATOR_REGISTRY.reduce(
  (acc, ind) => { acc[ind.id] = ind; return acc; },
  {} as Record<string, IndicatorDef>,
);

export function getIndicator(id: string): IndicatorDef | undefined {
  return INDICATOR_MAP[id];
}

export const INDICATOR_CATEGORIES: { value: IndicatorCategory; label: string }[] = [
  { value: "TREND", label: "Trend" },
  { value: "MOMENTUM", label: "Momentum" },
  { value: "VOLATILITY", label: "Volatility" },
  { value: "VOLUME", label: "Volume" },
];

// ============================================================
// PRESETS
// ============================================================

export interface IndicatorPreset {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  timeframe: string;
  indicators: { id: string; params: Record<string, number>; enabled: boolean }[];
  // For signal rules
  rules?: any[];
}

let presetCounter = 0;
export function makePresetId(): string {
  return `preset-${Date.now().toString(36)}-${presetCounter++}`;
}

export const DEFAULT_PRESETS: IndicatorPreset[] = [
  {
    id: makePresetId(),
    name: "Classic Trend Following",
    description: "EMA 9/21/50 + SuperTrend + ADX for trend confirmation",
    createdAt: Date.now(),
    timeframe: "5m",
    indicators: [
      { id: "ema", params: { period: 9 }, enabled: true },
      { id: "ema", params: { period: 21 }, enabled: true },
      { id: "ema", params: { period: 50 }, enabled: true },
      { id: "supertrend", params: { period: 10, mult: 3 }, enabled: true },
      { id: "adx", params: { period: 14 }, enabled: true },
    ],
  },
  {
    id: makePresetId(),
    name: "Mean Reversion Scalper",
    description: "RSI + Bollinger + Stochastic for range-bound scalping",
    createdAt: Date.now(),
    timeframe: "1m",
    indicators: [
      { id: "rsi", params: { period: 14 }, enabled: true },
      { id: "bollinger", params: { period: 20, std: 2 }, enabled: true },
      { id: "stochastic", params: { kPeriod: 14, dPeriod: 3, smooth: 1 }, enabled: true },
      { id: "vwap", params: {}, enabled: true },
    ],
  },
  {
    id: makePresetId(),
    name: "Volatility Squeeze",
    description: "TTM Squeeze + Bollinger + Keltner to detect pending breakouts",
    createdAt: Date.now(),
    timeframe: "15m",
    indicators: [
      { id: "ttmsqueeze", params: { bbPeriod: 20, bbStd: 2, kcMult: 1.5 }, enabled: true },
      { id: "bollinger", params: { period: 20, std: 2 }, enabled: true },
      { id: "keltner", params: { period: 20, mult: 2 }, enabled: true },
      { id: "atr", params: { period: 14 }, enabled: true },
    ],
  },
  {
    id: makePresetId(),
    name: "Ichimoku System",
    description: "Full Ichimoku cloud system for trend and support/resistance",
    createdAt: Date.now(),
    timeframe: "1h",
    indicators: [
      { id: "ichimoku", params: { conversion: 9, base: 26, spanB: 52 }, enabled: true },
      { id: "ema", params: { period: 200 }, enabled: true },
    ],
  },
  {
    id: makePresetId(),
    name: "Volume Profile Analysis",
    description: "OBV + A/D + CMF + Force Index for volume-based signals",
    createdAt: Date.now(),
    timeframe: "5m",
    indicators: [
      { id: "obv", params: {}, enabled: true },
      { id: "ad", params: {}, enabled: true },
      { id: "cmf", params: { period: 20 }, enabled: true },
      { id: "force", params: { period: 13 }, enabled: true },
      { id: "vwap", params: {}, enabled: true },
    ],
  },
  {
    id: makePresetId(),
    name: "Momentum Divergence",
    description: "RSI + MACD + MFI + CCI for momentum divergence detection",
    createdAt: Date.now(),
    timeframe: "15m",
    indicators: [
      { id: "rsi", params: { period: 14 }, enabled: true },
      { id: "macd", params: { fast: 12, slow: 26, signal: 9 }, enabled: true },
      { id: "mfi", params: { period: 14 }, enabled: true },
      { id: "cci", params: { period: 20 }, enabled: true },
    ],
  },
];
