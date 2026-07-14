/**
 * Cross-Asset Performance Heatmap Engine
 * Computes returns for every contract across multiple timeframes and
 * produces a colour-coded matrix for visual performance attribution.
 */
import { CONTRACTS, getContract } from "./contracts";
import { getEngine } from "./market-engine";
import type { Candle } from "./types";

export type Timeframe = "1D" | "1W" | "1M" | "3M" | "YTD" | "1Y";

export interface PerformanceCell {
  symbol: string; name: string; assetClass: string; timeframe: Timeframe;
  returnPct: number; startPrice: number; endPrice: number;
  color: string; textColor: string; rank: number; percentile: number;
}

export interface AssetClassStats {
  assetClass: string; avgReturn: number; medianReturn: number;
  bestSymbol: string; bestReturn: number; worstSymbol: string; worstReturn: number;
  breadth: number; dispersion: number; memberCount: number;
}

export interface TimeframeStats {
  timeframe: Timeframe; avgReturn: number; medianReturn: number;
  bestSymbol: string; bestReturn: number; worstSymbol: string; worstReturn: number;
  breadth: number; dispersion: number; positiveCount: number; negativeCount: number;
  cells: PerformanceCell[];
}

export interface HeatmapResult {
  timeframes: Timeframe[]; symbols: string[]; cells: PerformanceCell[][];
  byTimeframe: TimeframeStats[]; byAssetClass: Record<string, AssetClassStats[]>;
  totalSymbols: number; generatedAt: number;
}

const TIMEFRAME_BARS: Record<Timeframe, number> = {
  "1D": 6, "1W": 30, "1M": 126, "3M": 378, "YTD": 0, "1Y": 1512,
};

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "1D": "1 Day", "1W": "1 Week", "1M": "1 Month", "3M": "3 Months", "YTD": "Year to Date", "1Y": "1 Year",
};

export function getTimeframeLabel(tf: Timeframe): string { return TIMEFRAME_LABELS[tf]; }

export function returnToColor(returnPct: number): { bg: string; text: string } {
  let bg: string;
  if (returnPct >= 3) bg = "#10b981";
  else if (returnPct >= 1.5) bg = "#34d399";
  else if (returnPct >= 0.5) bg = "#6ee7b7";
  else if (returnPct > 0) bg = "#a7f3d0";
  else if (returnPct === 0) bg = "#1f2937";
  else if (returnPct > -0.5) bg = "#fecaca";
  else if (returnPct > -1.5) bg = "#fca5a5";
  else if (returnPct > -3) bg = "#f87171";
  else bg = "#ef4444";
  const text = (Math.abs(returnPct) >= 1.5 || returnPct === 0) ? "#ffffff" : "#1f2937";
  return { bg, text };
}

function computeReturn(candles: Candle[], bars: number): { returnPct: number; startPrice: number; endPrice: number } {
  if (candles.length === 0) return { returnPct: 0, startPrice: 0, endPrice: 0 };
  const endPrice = candles[candles.length - 1].close;
  if (bars <= 0 || bars >= candles.length) {
    const startPrice = candles[0].close;
    return { returnPct: ((endPrice - startPrice) / startPrice) * 100, startPrice, endPrice };
  }
  const startIdx = candles.length - bars - 1;
  if (startIdx < 0) return { returnPct: 0, startPrice: endPrice, endPrice };
  const startPrice = candles[startIdx].close;
  if (startPrice === 0) return { returnPct: 0, startPrice: 0, endPrice };
  return { returnPct: ((endPrice - startPrice) / startPrice) * 100, startPrice, endPrice };
}

function computeYTDReturn(candles: Candle[]): { returnPct: number; startPrice: number; endPrice: number } {
  if (candles.length === 0) return { returnPct: 0, startPrice: 0, endPrice: 0 };
  const endPrice = candles[candles.length - 1].close;
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  let startPrice = endPrice;
  for (const c of candles) { if (c.time >= yearStart) { startPrice = c.open; break; } }
  if (startPrice === endPrice && candles.length > 0) {
    let closest = candles[0];
    let minDiff = Math.abs(closest.time - yearStart);
    for (const c of candles) { const diff = Math.abs(c.time - yearStart); if (diff < minDiff) { minDiff = diff; closest = c; } }
    startPrice = closest.open;
  }
  if (startPrice === 0) return { returnPct: 0, startPrice: 0, endPrice };
  return { returnPct: ((endPrice - startPrice) / startPrice) * 100, startPrice, endPrice };
}

export function computeHeatmap(timeframes: Timeframe[] = ["1D", "1W", "1M", "3M", "YTD", "1Y"]): HeatmapResult {
  const engine = getEngine();
  const cells: PerformanceCell[][] = [];
  const symbols: string[] = [];

  for (const contract of CONTRACTS) {
    const candles = engine.getCandles(contract.symbol, 1512);
    if (candles.length < 5) continue;
    symbols.push(contract.symbol);
    const row: PerformanceCell[] = [];
    for (const tf of timeframes) {
      let ret: { returnPct: number; startPrice: number; endPrice: number };
      if (tf === "YTD") ret = computeYTDReturn(candles);
      else ret = computeReturn(candles, TIMEFRAME_BARS[tf]);
      const { bg, text } = returnToColor(ret.returnPct);
      row.push({
        symbol: contract.symbol, name: contract.name, assetClass: contract.assetClass,
        timeframe: tf, returnPct: ret.returnPct, startPrice: ret.startPrice, endPrice: ret.endPrice,
        color: bg, textColor: text, rank: 0, percentile: 0,
      });
    }
    cells.push(row);
  }

  const byTimeframe: TimeframeStats[] = [];
  for (let ti = 0; ti < timeframes.length; ti++) {
    const tf = timeframes[ti];
    const tfCells = cells.map((row) => row[ti]).filter((c) => c !== undefined);
    const sorted = [...tfCells].sort((a, b) => b.returnPct - a.returnPct);
    for (let i = 0; i < sorted.length; i++) {
      const cell = sorted[i];
      cell.rank = i + 1;
      cell.percentile = ((sorted.length - i) / sorted.length) * 100;
    }
    const returns = tfCells.map((c) => c.returnPct);
    const n = returns.length;
    if (n === 0) {
      byTimeframe.push({ timeframe: tf, avgReturn: 0, medianReturn: 0, bestSymbol: "—", bestReturn: 0, worstSymbol: "—", worstReturn: 0, breadth: 0, dispersion: 0, positiveCount: 0, negativeCount: 0, cells: tfCells });
      continue;
    }
    const avgReturn = returns.reduce((s, v) => s + v, 0) / n;
    const sorted2 = [...returns].sort((a, b) => a - b);
    const medianReturn = n % 2 === 0 ? (sorted2[n / 2 - 1] + sorted2[n / 2]) / 2 : sorted2[Math.floor(n / 2)];
    const variance = returns.reduce((s, v) => s + (v - avgReturn) ** 2, 0) / Math.max(n - 1, 1);
    const dispersion = Math.sqrt(variance);
    const positiveCount = returns.filter((r) => r > 0).length;
    const negativeCount = returns.filter((r) => r < 0).length;
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    byTimeframe.push({ timeframe: tf, avgReturn, medianReturn, bestSymbol: best?.symbol ?? "—", bestReturn: best?.returnPct ?? 0, worstSymbol: worst?.symbol ?? "—", worstReturn: worst?.returnPct ?? 0, breadth: positiveCount / n, dispersion, positiveCount, negativeCount, cells: tfCells });
  }

  const byAssetClass: Record<string, AssetClassStats[]> = {};
  const assetGroups: Record<string, PerformanceCell[]> = {};
  const repIdx = timeframes.indexOf("1M");
  if (repIdx >= 0) {
    for (const row of cells) {
      const cell = row[repIdx];
      if (!cell) continue;
      if (!assetGroups[cell.assetClass]) assetGroups[cell.assetClass] = [];
      assetGroups[cell.assetClass].push(cell);
    }
    for (const [ac, group] of Object.entries(assetGroups)) {
      const returns = group.map((c) => c.returnPct);
      const n = returns.length;
      if (n === 0) continue;
      const avg = returns.reduce((s, v) => s + v, 0) / n;
      const sortedR = [...returns].sort((a, b) => a - b);
      const median = n % 2 === 0 ? (sortedR[n / 2 - 1] + sortedR[n / 2]) / 2 : sortedR[Math.floor(n / 2)];
      const variance = returns.reduce((s, v) => s + (v - avg) ** 2, 0) / Math.max(n - 1, 1);
      const best = group.reduce((a, b) => a.returnPct > b.returnPct ? a : b);
      const worst = group.reduce((a, b) => a.returnPct < b.returnPct ? a : b);
      byAssetClass[ac] = [{ assetClass: ac, avgReturn: avg, medianReturn: median, bestSymbol: best.symbol, bestReturn: best.returnPct, worstSymbol: worst.symbol, worstReturn: worst.returnPct, breadth: returns.filter((r) => r > 0).length / n, dispersion: Math.sqrt(variance), memberCount: n }];
    }
  }

  return { timeframes, symbols, cells, byTimeframe, byAssetClass, totalSymbols: symbols.length, generatedAt: Date.now() };
}

export const ASSET_CLASS_INFO: Record<string, { label: string; color: string; icon: string }> = {
  equity_index: { label: "Equity Index", color: "#3b82f6", icon: "📈" },
  rate: { label: "Interest Rates", color: "#a855f7", icon: "🏛️" },
  energy: { label: "Energy", color: "#f59e0b", icon: "🛢️" },
  metal: { label: "Metals", color: "#eab308", icon: "🥇" },
  fx: { label: "FX", color: "#10b981", icon: "💱" },
  crypto: { label: "Crypto", color: "#ec4899", icon: "₿" },
};

export function getAssetClassInfo(ac: string): { label: string; color: string; icon: string } {
  return ASSET_CLASS_INFO[ac] ?? { label: ac, color: "#6b7280", icon: "•" };
}
