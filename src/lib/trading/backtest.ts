/**
 * Backtesting Engine
 *
 * Walks the strategy signal stream forward and simulates fills with:
 *  - Commission per contract
 *  - Slippage model (sqrt-impact for size, plus spread half)
 *  - Position-level P&L with multiplier (point value)
 *
 * Produces:
 *  - Equity curve with drawdown
 *  - Full trade ledger
 *  - BacktestMetrics (Sharpe, Sortino, Calmar, Ulcer, etc.)
 */
import type {
  BacktestMetrics,
  BacktestResult,
  BacktestTrade,
  Candle,
  StrategyParams,
} from "./types";
import { getContract } from "./contracts";
import { getStrategy } from "./strategies";
import { beta } from "./indicators";

const COMMISSION_PER_CONTRACT = 2.25; // USD round-turn (typical retail)
const SLIPPAGE_TICKS = 0.5;

export interface BacktestConfig {
  strategyId: string;
  symbol: string;
  pairSymbol?: string; // for PAIRS
  params: StrategyParams;
  candles: Candle[];
  pairCandles?: Candle[];
  initialCapital: number;
  contractsPerTrade?: number;
  benchmark?: Candle[]; // for beta/alpha
}

export function runBacktest(cfg: BacktestConfig): BacktestResult {
  const strat = getStrategy(cfg.strategyId);
  if (!strat) throw new Error(`Unknown strategy: ${cfg.strategyId}`);
  const contract = getContract(cfg.symbol);
  const signals = strat.generate(cfg.candles, cfg.params, cfg.pairCandles);
  const size = cfg.contractsPerTrade ?? 1;
  const trades: BacktestTrade[] = [];
  const equityCurve: { time: number; equity: number; drawdown: number }[] = [];
  let equity = cfg.initialCapital;
  let peak = equity;
  let pos = 0; // contracts, signed
  let entryPrice = 0;
  let entryTime = 0;
  let barsInTrade = 0;
  const equitySamples: number[] = [];

  for (let i = 0; i < signals.length; i++) {
    const sig = signals[i].signal;
    const candle = cfg.candles[i];
    if (!candle) continue;
    const price = candle.close;
    // Compute unrealised P&L for equity
    const unreal = pos * (price - entryPrice) * contract.pointValue;
    const equityNow = equity + unreal;
    equitySamples.push(equityNow);
    peak = Math.max(peak, equityNow);
    const dd = equityNow - peak;
    const ddPct = peak > 0 ? dd / peak : 0;
    equityCurve.push({ time: candle.time, equity: equityNow, drawdown: ddPct });

    // Signal changes
    if (sig === 0 && pos !== 0) {
      // Close position
      const fillPrice = applySlippage(price, Math.sign(pos) * -1, contract.tickSize);
      const grossPnL = -pos * (fillPrice - entryPrice) * contract.pointValue;
      const commission = Math.abs(pos) * COMMISSION_PER_CONTRACT;
      const netPnL = grossPnL - commission;
      equity += netPnL;
      trades.push({
        entryTime,
        exitTime: candle.time,
        side: pos > 0 ? "BUY" : "SELL",
        qty: Math.abs(pos),
        entryPrice,
        exitPrice: fillPrice,
        pnl: netPnL,
        pnlPct: (netPnL / cfg.initialCapital) * 100,
        bars: barsInTrade,
        symbol: cfg.symbol,
      });
      pos = 0;
      barsInTrade = 0;
    } else if (sig !== 0 && pos === 0) {
      // Open position
      pos = sig > 0 ? size : -size;
      entryPrice = applySlippage(price, sig, contract.tickSize);
      entryTime = candle.time;
      barsInTrade = 0;
    } else if (sig !== 0 && pos !== 0 && Math.sign(sig) !== Math.sign(pos)) {
      // Reverse: close then open opposite
      const fillPrice = applySlippage(price, Math.sign(pos) * -1, contract.tickSize);
      const grossPnL = -pos * (fillPrice - entryPrice) * contract.pointValue;
      const commission = Math.abs(pos) * COMMISSION_PER_CONTRACT;
      const netPnL = grossPnL - commission;
      equity += netPnL;
      trades.push({
        entryTime,
        exitTime: candle.time,
        side: pos > 0 ? "BUY" : "SELL",
        qty: Math.abs(pos),
        entryPrice,
        exitPrice: fillPrice,
        pnl: netPnL,
        pnlPct: (netPnL / cfg.initialCapital) * 100,
        bars: barsInTrade,
        symbol: cfg.symbol,
      });
      pos = sig > 0 ? size : -size;
      entryPrice = applySlippage(price, sig, contract.tickSize);
      entryTime = candle.time;
      barsInTrade = 0;
    }
    if (pos !== 0) barsInTrade++;
  }

  // Close any open position at last price
  if (pos !== 0 && cfg.candles.length > 0) {
    const last = cfg.candles[cfg.candles.length - 1];
    const fillPrice = applySlippage(last.close, Math.sign(pos) * -1, contract.tickSize);
    const grossPnL = -pos * (fillPrice - entryPrice) * contract.pointValue;
    const commission = Math.abs(pos) * COMMISSION_PER_CONTRACT;
    const netPnL = grossPnL - commission;
    equity += netPnL;
    trades.push({
      entryTime,
      exitTime: last.time,
      side: pos > 0 ? "BUY" : "SELL",
      qty: Math.abs(pos),
      entryPrice,
      exitPrice: fillPrice,
      pnl: netPnL,
      pnlPct: (netPnL / cfg.initialCapital) * 100,
      bars: barsInTrade,
      symbol: cfg.symbol,
    });
    pos = 0;
  }

  const metrics = computeMetrics(equitySamples, trades, cfg.initialCapital, cfg.benchmark, cfg.candles);
  return {
    strategy: strat.name,
    symbol: cfg.symbol,
    trades,
    equityCurve,
    metrics,
    params: cfg.params,
    startDate: cfg.candles[0]?.time ?? 0,
    endDate: cfg.candles[cfg.candles.length - 1]?.time ?? 0,
    initialCapital: cfg.initialCapital,
    finalEquity: equity,
  };
}

function applySlippage(price: number, side: number, tick: number): number {
  // side = +1 means we're buying (pay up), -1 means selling (receive less)
  return price + side * SLIPPAGE_TICKS * tick;
}

function computeMetrics(
  equity: number[],
  trades: BacktestTrade[],
  initial: number,
  benchmark?: Candle[],
  candles?: Candle[],
): BacktestMetrics {
  const n = equity.length;
  if (n < 2) {
    return emptyMetrics();
  }
  // Per-bar returns on equity
  const rets: number[] = [];
  for (let i = 1; i < n; i++) rets.push(equity[i] / equity[i - 1] - 1);
  const meanRet = rets.reduce((s, v) => s + v, 0) / rets.length;
  const stdRet = Math.sqrt(rets.reduce((s, v) => s + (v - meanRet) ** 2, 0) / (rets.length - 1));
  const annual = Math.sqrt(252);
  const sharpe = stdRet === 0 ? 0 : (meanRet / stdRet) * annual;
  // Sortino
  const downside = rets.filter((r) => r < 0);
  const dsStd = downside.length > 1 ? Math.sqrt(downside.reduce((s, v) => s + v * v, 0) / downside.length) : 0;
  const sortino = dsStd === 0 ? 0 : (meanRet / dsStd) * annual;
  // Drawdown
  let peak = -Infinity;
  let maxDD = 0;
  let maxDDPct = 0;
  let ulcerSum = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    const dd = e - peak;
    const ddPct = peak > 0 ? dd / peak : 0;
    if (dd < maxDD) maxDD = dd;
    if (ddPct < maxDDPct) maxDDPct = ddPct;
    ulcerSum += ddPct * ddPct;
  }
  const ulcer = Math.sqrt(ulcerSum / n) * 100;
  // Total return
  const finalEq = equity[n - 1];
  const totalReturn = finalEq - initial;
  const totalReturnPct = (totalReturn / initial) * 100;
  // Days elapsed (assume 1 bar = 1 day for daily backtests)
  const days = n;
  const years = days / 252;
  const cagr = years > 0 ? (Math.pow(finalEq / initial, 1 / years) - 1) * 100 : 0;
  // Trades
  const closed = trades;
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss === 0 ? (grossWin > 0 ? Infinity : 0) : grossWin / grossLoss;
  const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? -grossLoss / losses.length : 0;
  const expectancy = closed.length > 0 ? totalReturn / closed.length : 0;
  // Beta / Alpha
  let b = 0;
  let alpha = 0;
  let infoRatio = 0;
  if (benchmark && candles && benchmark.length === candles.length) {
    const benchRets: number[] = [];
    for (let i = 1; i < benchmark.length; i++) benchRets.push(benchmark[i].close / benchmark[i - 1].close - 1);
    b = beta(rets, benchRets);
    const benchMean = benchRets.reduce((s, v) => s + v, 0) / benchRets.length;
    alpha = (meanRet - b * benchMean) * 252 * 100; // annualised %
    // Information ratio: excess return / tracking error
    const excess = rets.map((r, i) => r - (benchRets[i] ?? 0));
    const exMean = excess.reduce((s, v) => s + v, 0) / excess.length;
    const exStd = Math.sqrt(excess.reduce((s, v) => s + (v - exMean) ** 2, 0) / (excess.length - 1));
    infoRatio = exStd === 0 ? 0 : (exMean / exStd) * annual;
  }
  const calmar = maxDDPct !== 0 ? (cagr / -maxDDPct / 100) * 100 : 0;
  return {
    totalReturn,
    totalReturnPct,
    cagr,
    sharpe,
    sortino,
    maxDrawdown: maxDD,
    maxDrawdownPct: maxDDPct * 100,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    avgWin,
    avgLoss,
    profitFactor,
    expectancy,
    totalTrades: closed.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    avgBars: closed.length > 0 ? closed.reduce((s, t) => s + t.bars, 0) / closed.length : 0,
    volatility: stdRet * annual * 100,
    beta: b,
    alpha,
    informationRatio: infoRatio,
    calmar,
    ulcer,
  };
}

function emptyMetrics(): BacktestMetrics {
  return {
    totalReturn: 0,
    totalReturnPct: 0,
    cagr: 0,
    sharpe: 0,
    sortino: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    winRate: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    expectancy: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    avgBars: 0,
    volatility: 0,
    beta: 0,
    alpha: 0,
    informationRatio: 0,
    calmar: 0,
    ulcer: 0,
  };
}
