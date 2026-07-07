/**
 * Portfolio Analytics
 *
 * Performance attribution and risk-adjusted return metrics.
 */
import type { Candle, Position } from "./types";
import { getContract } from "./contracts";
import { BETAS } from "./contracts";
import { beta, correlation, logReturns, returns } from "./indicators";

export interface PortfolioMetrics {
  totalReturn: number;
  totalReturnPct: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  volatility: number;
  beta: number;
  alpha: number;
  informationRatio: number;
  calmar: number;
  ulcer: number;
  upCapture: number;
  downCapture: number;
  positiveMonths: number;
  negativeMonths: number;
  skewness: number;
  kurtosis: number;
}

export function computePortfolioMetrics(
  equityCurve: number[],
  benchmarkEquity: number[],
  riskFreeRate = 0.045,
): PortfolioMetrics {
  const n = equityCurve.length;
  if (n < 2) {
    return emptyPortfolioMetrics();
  }
  const rets = returns(equityCurve);
  const benchRets = returns(benchmarkEquity);
  const meanRet = rets.reduce((s, v) => s + v, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, v) => s + (v - meanRet) ** 2, 0) / (rets.length - 1));
  const downside = rets.filter((r) => r < 0);
  const ds = downside.length > 0 ? Math.sqrt(downside.reduce((s, v) => s + v * v, 0) / downside.length) : 0;
  const annual = Math.sqrt(252);
  const rfDaily = riskFreeRate / 252;
  const sharpe = sd === 0 ? 0 : ((meanRet - rfDaily) / sd) * annual;
  const sortino = ds === 0 ? 0 : ((meanRet - rfDaily) / ds) * annual;
  let peak = -Infinity;
  let maxDD = 0;
  let maxDDPct = 0;
  let ulcerSum = 0;
  for (const e of equityCurve) {
    peak = Math.max(peak, e);
    const dd = e - peak;
    const ddPct = peak > 0 ? dd / peak : 0;
    if (dd < maxDD) maxDD = dd;
    if (ddPct < maxDDPct) maxDDPct = ddPct;
    ulcerSum += ddPct * ddPct;
  }
  const ulcer = Math.sqrt(ulcerSum / n) * 100;
  const finalEq = equityCurve[n - 1];
  const initial = equityCurve[0];
  const totalReturn = finalEq - initial;
  const totalReturnPct = (totalReturn / initial) * 100;
  const years = n / 252;
  const cagr = years > 0 ? (Math.pow(finalEq / initial, 1 / years) - 1) * 100 : 0;
  // Beta & alpha
  let b = 0;
  let alpha = 0;
  let infoRatio = 0;
  if (benchRets.length === rets.length) {
    b = beta(rets, benchRets);
    const benchMean = benchRets.reduce((s, v) => s + v, 0) / benchRets.length;
    alpha = (meanRet - rfDaily - b * (benchMean - rfDaily)) * 252 * 100;
    const excess = rets.map((r, i) => r - (benchRets[i] ?? 0));
    const exMean = excess.reduce((s, v) => s + v, 0) / excess.length;
    const exStd = Math.sqrt(excess.reduce((s, v) => s + (v - exMean) ** 2, 0) / (excess.length - 1));
    infoRatio = exStd === 0 ? 0 : (exMean / exStd) * annual;
  }
  // Up/Down capture
  const upMonths = benchRets.filter((r) => r > 0);
  const downMonths = benchRets.filter((r) => r < 0);
  const upCapture =
    upMonths.length > 0
      ? (rets.filter((_, i) => (benchRets[i] ?? 0) > 0).reduce((s, v) => s + v, 0) / upMonths.length /
          (upMonths.reduce((s, v) => s + v, 0) / upMonths.length)) *
        100
      : 0;
  const downCapture =
    downMonths.length > 0
      ? (rets.filter((_, i) => (benchRets[i] ?? 0) < 0).reduce((s, v) => s + v, 0) / downMonths.length /
          (downMonths.reduce((s, v) => s + v, 0) / downMonths.length)) *
        100
      : 0;
  const posDays = rets.filter((r) => r > 0).length;
  const negDays = rets.filter((r) => r < 0).length;
  const calmar = maxDDPct !== 0 ? cagr / -maxDDPct / 100 * 100 : 0;
  // Skewness & Kurtosis
  const skew = computeSkewness(rets);
  const kurt = computeKurtosis(rets);
  return {
    totalReturn,
    totalReturnPct,
    cagr,
    sharpe,
    sortino,
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct * 100,
    volatility: sd * annual * 100,
    beta: b,
    alpha,
    informationRatio: infoRatio,
    calmar,
    ulcer,
    upCapture,
    downCapture,
    positiveMonths: posDays,
    negativeMonths: negDays,
    skewness: skew,
    kurtosis: kurt,
  };
}

function computeSkewness(r: number[]): number {
  if (r.length < 3) return 0;
  const m = r.reduce((s, v) => s + v, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1));
  if (sd === 0) return 0;
  return r.reduce((s, v) => s + ((v - m) / sd) ** 3, 0) / r.length;
}

function computeKurtosis(r: number[]): number {
  if (r.length < 4) return 0;
  const m = r.reduce((s, v) => s + v, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1));
  if (sd === 0) return 0;
  return r.reduce((s, v) => s + ((v - m) / sd) ** 4, 0) / r.length - 3;
}

function emptyPortfolioMetrics(): PortfolioMetrics {
  return {
    totalReturn: 0,
    totalReturnPct: 0,
    cagr: 0,
    sharpe: 0,
    sortino: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    volatility: 0,
    beta: 0,
    alpha: 0,
    informationRatio: 0,
    calmar: 0,
    ulcer: 0,
    upCapture: 0,
    downCapture: 0,
    positiveMonths: 0,
    negativeMonths: 0,
    skewness: 0,
    kurtosis: 0,
  };
}

// ============================================================
// Correlation Matrix
// ============================================================
export interface CorrelationMatrix {
  symbols: string[];
  matrix: number[][];
}

export function computeCorrelationMatrix(
  symbols: string[],
  history: Record<string, Candle[]>,
  lookback = 100,
): CorrelationMatrix {
  const rets: Record<string, number[]> = {};
  for (const sym of symbols) {
    const candles = (history[sym] ?? []).slice(-lookback);
    rets[sym] = logReturns(candles.map((c) => c.close));
  }
  const matrix: number[][] = [];
  for (let i = 0; i < symbols.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < symbols.length; j++) {
      if (i === j) row.push(1);
      else row.push(correlation(rets[symbols[i]] ?? [], rets[symbols[j]] ?? []));
    }
    matrix.push(row);
  }
  return { symbols, matrix };
}

// ============================================================
// Position-level exposure & P&L helpers
// ============================================================
export function computePosition(
  symbol: string,
  netQty: number,
  avgPrice: number,
  realizedPnL: number,
  lastPrice: number,
): Position {
  const contract = getContract(symbol);
  const costBasis = netQty * avgPrice * contract.pointValue;
  const marketValue = netQty * lastPrice * contract.pointValue;
  const unrealizedPnL = netQty * (lastPrice - avgPrice) * contract.pointValue;
  const sessionPnL = netQty * (lastPrice - avgPrice) * contract.pointValue * 0.1; // simplified
  const sessionPnLPct = costBasis !== 0 ? (sessionPnL / Math.abs(costBasis)) * 100 : 0;
  const totalPnL = realizedPnL + unrealizedPnL;
  return {
    symbol,
    netQty,
    avgPrice,
    realizedPnL,
    unrealizedPnL,
    marketValue,
    costBasis,
    lastPrice,
    sessionPnL,
    sessionPnLPct,
    totalPnL,
    exposure: Math.abs(marketValue),
    beta: BETAS[symbol] ?? 1,
  };
}

export function computeAccount(
  positions: Position[],
  cashBalance: number,
  lastPrices: Record<string, number>,
): {
  cashBalance: number;
  equity: number;
  buyingPower: number;
  initialMarginUsed: number;
  maintenanceMarginUsed: number;
  availableMargin: number;
  totalPnL: number;
  sessionPnL: number;
  marginCallLevel: number;
  leverage: number;
} {
  let totalUnreal = 0;
  let totalSession = 0;
  let totalPnL = 0;
  let initMargin = 0;
  let maintMargin = 0;
  let grossExposure = 0;
  for (const p of positions) {
    if (p.netQty === 0) continue;
    const contract = getContract(p.symbol);
    totalUnreal += p.unrealizedPnL;
    totalSession += p.sessionPnL;
    totalPnL += p.totalPnL;
    initMargin += Math.abs(p.netQty) * contract.marginInitial;
    maintMargin += Math.abs(p.netQty) * contract.marginMaintenance;
    grossExposure += p.exposure;
  }
  const equity = cashBalance + totalUnreal;
  const buyingPower = Math.max(0, equity * 4 - initMargin); // 4x daytrading BP
  const availableMargin = Math.max(0, equity - initMargin);
  const marginCallLevel = equity > 0 ? maintMargin / equity : 0;
  const leverage = equity > 0 ? grossExposure / equity : 0;
  return {
    cashBalance,
    equity,
    buyingPower,
    initialMarginUsed: initMargin,
    maintenanceMarginUsed: maintMargin,
    availableMargin,
    totalPnL,
    sessionPnL: totalSession,
    marginCallLevel,
    leverage,
  };
}
