/** Seasonality Engine — based on research/seasonality.md */
import { CONTRACTS, getContract } from "./contracts";
import { getEngine } from "./market-engine";
import { correlation } from "./indicators";

export const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export interface MonthlyStats { month: number; monthName: string; avgReturn: number; medianReturn: number; positiveRate: number; stdDev: number; sampleCount: number; tStat: number; isSignificant: boolean; }
export interface SymbolSeasonality { symbol: string; name: string; assetClass: string; monthlyStats: MonthlyStats[]; bestMonth: { monthName: string; avgReturn: number }; worstMonth: { monthName: string; avgReturn: number }; sellInMay: number; decemberEffect: number; septemberEffect: number; overallStrength: number; }

export function computeMonthlySeasonality(symbol: string): SymbolSeasonality | null {
  const engine = getEngine(); const history = engine.getHistory(symbol); if (history.length < 60) return null;
  const contract = getContract(symbol);
  const monthlyCloses: { year: number; month: number; close: number }[] = [];
  let curY = -1, curM = -1;
  for (const c of history) { const d = new Date(c.time); const y = d.getFullYear(), m = d.getMonth(); if (y !== curY || m !== curM) { if (curY >= 0) monthlyCloses.push({ year: curY, month: curM, close: c.close }); curY = y; curM = m; } }
  if (curY >= 0) monthlyCloses.push({ year: curY, month: curM, close: history[history.length-1].close });
  const returnsByMonth: number[][] = Array.from({length: 12}, () => []);
  for (let i = 1; i < monthlyCloses.length; i++) { const ret = ((monthlyCloses[i].close - monthlyCloses[i-1].close) / monthlyCloses[i-1].close) * 100; returnsByMonth[monthlyCloses[i].month].push(ret); }
  const monthlyStats: MonthlyStats[] = [];
  for (let m = 0; m < 12; m++) { const r = returnsByMonth[m]; if (r.length === 0) { monthlyStats.push({ month: m, monthName: MONTH_NAMES[m], avgReturn: 0, medianReturn: 0, positiveRate: 0, stdDev: 0, sampleCount: 0, tStat: 0, isSignificant: false }); continue; } const avg = r.reduce((s,v) => s+v, 0)/r.length; const sorted = [...r].sort((a,b) => a-b); const med = sorted[Math.floor(sorted.length/2)]; const pos = r.filter(x => x > 0).length; const sd = r.length > 1 ? Math.sqrt(r.reduce((s,v) => s+(v-avg)**2, 0)/(r.length-1)) : 0; const t = sd > 0 && r.length > 1 ? avg / (sd / Math.sqrt(r.length)) : 0; monthlyStats.push({ month: m, monthName: MONTH_NAMES[m], avgReturn: avg, medianReturn: med, positiveRate: pos/r.length, stdDev: sd, sampleCount: r.length, tStat: t, isSignificant: Math.abs(t) > 2 }); }
  const valid = monthlyStats.filter(s => s.sampleCount > 0); const sorted = [...valid].sort((a,b) => b.avgReturn - a.avgReturn);
  const winter = [10,11,0,1,2,3].map(m => monthlyStats[m].avgReturn).reduce((s,v) => s+v, 0) / 6;
  const summer = [4,5,6,7,8,9].map(m => monthlyStats[m].avgReturn).reduce((s,v) => s+v, 0) / 6;
  const allAvgs = valid.map(s => s.avgReturn); const meanAvg = allAvgs.reduce((s,v) => s+v, 0) / Math.max(allAvgs.length, 1); const variance = allAvgs.length > 1 ? allAvgs.reduce((s,v) => s+(v-meanAvg)**2, 0) / (allAvgs.length-1) : 0;
  return { symbol, name: contract.name, assetClass: contract.assetClass, monthlyStats, bestMonth: { monthName: sorted[0]?.monthName ?? "—", avgReturn: sorted[0]?.avgReturn ?? 0 }, worstMonth: { monthName: sorted[sorted.length-1]?.monthName ?? "—", avgReturn: sorted[sorted.length-1]?.avgReturn ?? 0 }, sellInMay: winter - summer, decemberEffect: monthlyStats[11].avgReturn, septemberEffect: monthlyStats[8].avgReturn, overallStrength: Math.min(1, Math.sqrt(variance) / 2) };
}

export interface SeasonalWindow { name: string; symbol: string; startMonth: number; startDay: number; endMonth: number; endDay: number; description: string; avgReturn: number; hitRate: number; direction: "LONG" | "SHORT"; significance: "HIGH" | "MEDIUM" | "LOW"; }

export const SEASONAL_WINDOWS: SeasonalWindow[] = [
  { name: "Crude Oil Driving Season", symbol: "CL", startMonth: 4, startDay: 15, endMonth: 8, endDay: 15, description: "Memorial Day to Labor Day: peak gasoline demand.", avgReturn: 4.2, hitRate: 0.65, direction: "LONG", significance: "MEDIUM" },
  { name: "Natural Gas Hurricane Season", symbol: "NG", startMonth: 7, startDay: 15, endMonth: 10, endDay: 30, description: "Aug 15 – Nov 30: hurricane risk. Historical avg +7.8%.", avgReturn: 7.8, hitRate: 0.70, direction: "LONG", significance: "HIGH" },
  { name: "Gold Autumn Rally", symbol: "GC", startMonth: 8, startDay: 1, endMonth: 10, endDay: 30, description: "Sep-Nov: Indian wedding season + Diwali demand.", avgReturn: 2.2, hitRate: 0.62, direction: "LONG", significance: "MEDIUM" },
  { name: "Equity Santa Rally", symbol: "ES", startMonth: 11, startDay: 25, endMonth: 0, endDay: 5, description: "Last 5 days Dec + first 2 Jan. +1.3% avg, 78% hit rate.", avgReturn: 1.3, hitRate: 0.78, direction: "LONG", significance: "HIGH" },
  { name: "Sell in May (Equity)", symbol: "ES", startMonth: 4, startDay: 1, endMonth: 9, endDay: 30, description: "May-Oct underperforms Nov-Apr by ~4.5%.", avgReturn: -1.5, hitRate: 0.55, direction: "SHORT", significance: "HIGH" },
  { name: "September Effect", symbol: "ES", startMonth: 8, startDay: 1, endMonth: 8, endDay: 30, description: "September historically worst month (-0.7% to -1.2%).", avgReturn: -0.9, hitRate: 0.55, direction: "SHORT", significance: "MEDIUM" },
  { name: "Pre-FOMC Equity Drift", symbol: "ES", startMonth: -1, startDay: -1, endMonth: -1, endDay: -1, description: "24hrs before FOMC: equities drift up. >80% of equity premium (Lucca-Moench 2015).", avgReturn: 0.5, hitRate: 0.75, direction: "LONG", significance: "HIGH" },
];

export function getActiveSeasonalWindows(symbol: string): SeasonalWindow[] {
  const now = new Date(); const cm = now.getMonth(); const cd = now.getDate();
  return SEASONAL_WINDOWS.filter(w => { if (w.symbol !== symbol && w.symbol !== "ES") return false; if (w.startMonth === -1) return false; if (w.startMonth <= w.endMonth) return (cm > w.startMonth || (cm === w.startMonth && cd >= w.startDay)) && (cm < w.endMonth || (cm === w.endMonth && cd <= w.endDay)); return cm >= w.startMonth || cm <= w.endMonth; });
}

export interface SeasonalityRanking { symbol: string; name: string; strength: number; bestMonth: string; bestMonthReturn: number; worstMonth: string; worstMonthReturn: number; sellInMay: number; currentMonthAvg: number; currentMonthRank: number; }

export function computeAllSeasonality(): SeasonalityRanking[] {
  const results: SeasonalityRanking[] = []; const cm = new Date().getMonth();
  for (const c of CONTRACTS) { const s = computeMonthlySeasonality(c.symbol); if (!s) continue; const sorted = [...s.monthlyStats].filter(m => m.sampleCount > 0).sort((a,b) => b.avgReturn - a.avgReturn); const rank = sorted.findIndex(m => m.month === cm) + 1; results.push({ symbol: c.symbol, name: c.name, strength: s.overallStrength, bestMonth: s.bestMonth.monthName, bestMonthReturn: s.bestMonth.avgReturn, worstMonth: s.worstMonth.monthName, worstMonthReturn: s.worstMonth.avgReturn, sellInMay: s.sellInMay, currentMonthAvg: s.monthlyStats[cm]?.avgReturn ?? 0, currentMonthRank: rank }); }
  return results.sort((a,b) => b.strength - a.strength);
}

export interface CalendarEvent { date: string; name: string; type: string; description: string; affectedSymbols: string[]; expectedImpact: "HIGH" | "MEDIUM" | "LOW"; daysAway: number; }

export function getUpcomingCalendarEvents(): CalendarEvent[] {
  const now = new Date(); const events: CalendarEvent[] = [];
  for (let i = 0; i < 4; i++) { const d = new Date(now); d.setDate(d.getDate() + i * 42 + 14); const days = Math.ceil((d.getTime() - now.getTime()) / 86400000); if (days > 0) events.push({ date: d.toISOString().split("T")[0], name: "FOMC Rate Decision", type: "FOMC", description: "Federal Reserve interest rate decision and press conference.", affectedSymbols: ["ES","NQ","ZN","ZB","SR3"], expectedImpact: "HIGH", daysAway: days }); }
  for (let i = 0; i < 4; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); const dow = d.getDay(); const ff = new Date(d); ff.setDate(1 + ((5 - dow + 7) % 7)); const days = Math.ceil((ff.getTime() - now.getTime()) / 86400000); if (days >= 0) events.push({ date: ff.toISOString().split("T")[0], name: "Non-Farm Payrolls", type: "NFP", description: "Monthly employment report. Major volatility event.", affectedSymbols: ["ES","NQ","ZN"], expectedImpact: "HIGH", daysAway: days }); }
  for (let i = 0; i < 3; i++) { const d = new Date(now.getFullYear(), now.getMonth() + i, 1); const dow = d.getDay(); const tf = new Date(d); tf.setDate(1 + ((5 - dow + 7) % 7) + 14); const days = Math.ceil((tf.getTime() - now.getTime()) / 86400000); if (days >= 0) events.push({ date: tf.toISOString().split("T")[0], name: "Options Expiration", type: "EXPIRATION", description: "Monthly options expiration. Increased volume and gamma hedging.", affectedSymbols: ["ES","NQ","CL","GC"], expectedImpact: "MEDIUM", daysAway: days }); }
  return events.sort((a,b) => a.daysAway - b.daysAway);
}

export function computeDayOfWeekStats(symbol: string) {
  const engine = getEngine(); const candles = engine.getCandles(symbol, 250); if (candles.length < 20) return [];
  const byDay: number[][] = Array.from({length: 7}, () => []);
  for (let i = 1; i < candles.length; i++) { const d = new Date(candles[i].time); const ret = ((candles[i].close - candles[i-1].close) / candles[i-1].close) * 100; byDay[d.getDay()].push(ret); }
  const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return byDay.map((r, day) => r.length === 0 ? null : ({ day, dayName: names[day], avgReturn: r.reduce((s,v) => s+v, 0)/r.length, positiveRate: r.filter(x => x > 0).length / r.length, sampleCount: r.length })).filter(Boolean);
}

// ============================================================
// Seasonal Window Backtester
//
// Runs each entry in SEASONAL_WINDOWS across ALL 14 contracts (treating
// the window's primary symbol as a template — every contract gets tested
// against the same calendar window to find which contracts the seasonal
// actually works on).
//
// For each (window, symbol) pair:
//   1. Walk the historical daily candles (250 bars = ~1 year).
//   2. On the window's start date each year, enter LONG (or SHORT).
//   3. On the window's end date, exit.
//   4. Record the trade's P&L (with contract multiplier + commission).
//   5. Compute hit rate, avg return, t-stat, Sharpe, total P&L.
//
// Returns one row per (window, symbol) plus an aggregate per window.
// ============================================================

export interface SeasonalWindowTrade {
  year: number;
  entryDate: number;
  exitDate: number;
  entryPrice: number;
  exitPrice: number;
  contractsHeld: number;
  pctReturn: number;
  dollarPnL: number;
  winner: boolean;
}

export interface SeasonalWindowBacktestResult {
  window: SeasonalWindow;
  symbol: string;
  trades: SeasonalWindowTrade[];
  tradeCount: number;
  hitRate: number;       // fraction of winners
  avgReturn: number;     // average pct return per trade
  totalReturn: number;   // sum of pct returns
  totalDollarPnL: number;
  stdDev: number;
  tStat: number;
  sharpe: number;
  bestTrade: number;     // best pct return
  worstTrade: number;    // worst pct return
  avgHoldDays: number;
  isSignificant: boolean;
}

export interface SeasonalWindowAggregate {
  window: SeasonalWindow;
  symbolResults: SeasonalWindowBacktestResult[];
  aggregateTradeCount: number;
  aggregateHitRate: number;
  aggregateAvgReturn: number;
  aggregateTotalPnL: number;
  bestSymbol: string | null;
  bestSymbolHitRate: number;
  bestSymbolReturn: number;
  worstSymbol: string | null;
  worstSymbolReturn: number;
  significantCount: number;
  totalSymbols: number;
}

const COMMISSION_PER_TRADE = 2.25;
const CONTRACTS_PER_TRADE = 1;

function inWindow(date: Date, startMonth: number, startDay: number, endMonth: number, endDay: number): boolean {
  if (startMonth < 0 || endMonth < 0) return false;
  const m = date.getMonth();
  const d = date.getDate();
  if (startMonth <= endMonth) {
    // Same-year window e.g. Apr 1 → Oct 31
    if (m < startMonth || m > endMonth) return false;
    if (m === startMonth && d < startDay) return false;
    if (m === endMonth && d > endDay) return false;
    return true;
  } else {
    // Cross-year window e.g. Nov 25 → Jan 5
    if (m > endMonth && m < startMonth) return false;
    if (m === endMonth && d > endDay && m < startMonth) return false;
    if (m === startMonth && d < startDay && m > endMonth) return false;
    return true;
  }
}

function backtestWindowForSymbol(window: SeasonalWindow, symbol: string): SeasonalWindowBacktestResult | null {
  const engine = getEngine();
  const candles = engine.getCandles(symbol, 500);
  if (candles.length < 60) return null;
  const contract = getContract(symbol);
  const trades: SeasonalWindowTrade[] = [];
  let inPosition = false;
  let entryPrice = 0;
  let entryDate = 0;
  let entryYear = -1;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const dt = new Date(c.time);
    const inside = inWindow(dt, window.startMonth, window.startDay, window.endMonth, window.endDay);
    if (!inPosition && inside && dt.getFullYear() !== entryYear) {
      // Enter
      inPosition = true;
      entryPrice = c.close;
      entryDate = c.time;
      entryYear = dt.getFullYear();
    } else if (inPosition && !inside) {
      // Exit
      const pctReturn = ((c.close - entryPrice) / entryPrice) * 100 * (window.direction === "LONG" ? 1 : -1);
      const dollarPnL = (c.close - entryPrice) * contract.contractSize * CONTRACTS_PER_TRADE * (window.direction === "LONG" ? 1 : -1) - COMMISSION_PER_TRADE;
      const holdDays = Math.max(1, Math.round((c.time - entryDate) / 86400000));
      trades.push({
        year: entryYear,
        entryDate,
        exitDate: c.time,
        entryPrice,
        exitPrice: c.close,
        contractsHeld: CONTRACTS_PER_TRADE,
        pctReturn,
        dollarPnL,
        winner: pctReturn > 0,
      });
      inPosition = false;
    }
  }
  // Close any open position at the last candle
  if (inPosition && trades.length === 0) {
    const last = candles[candles.length - 1];
    const pctReturn = ((last.close - entryPrice) / entryPrice) * 100 * (window.direction === "LONG" ? 1 : -1);
    const dollarPnL = (last.close - entryPrice) * contract.contractSize * CONTRACTS_PER_TRADE * (window.direction === "LONG" ? 1 : -1) - COMMISSION_PER_TRADE;
    trades.push({
      year: entryYear,
      entryDate,
      exitDate: last.time,
      entryPrice,
      exitPrice: last.close,
      contractsHeld: CONTRACTS_PER_TRADE,
      pctReturn,
      dollarPnL,
      winner: pctReturn > 0,
    });
  }
  if (trades.length === 0) {
    return {
      window, symbol, trades: [], tradeCount: 0,
      hitRate: 0, avgReturn: 0, totalReturn: 0, totalDollarPnL: 0,
      stdDev: 0, tStat: 0, sharpe: 0,
      bestTrade: 0, worstTrade: 0, avgHoldDays: 0,
      isSignificant: false,
    };
  }
  const returns = trades.map(t => t.pctReturn);
  const hitRate = trades.filter(t => t.winner).length / trades.length;
  const avgReturn = returns.reduce((s,v) => s+v, 0) / returns.length;
  const totalReturn = returns.reduce((s,v) => s+v, 0);
  const totalDollarPnL = trades.reduce((s,t) => s+t.dollarPnL, 0);
  const variance = returns.length > 1 ? returns.reduce((s,v) => s+(v-avgReturn)**2, 0) / (returns.length-1) : 0;
  const stdDev = Math.sqrt(variance);
  const tStat = stdDev > 0 && returns.length > 1 ? avgReturn / (stdDev / Math.sqrt(returns.length)) : 0;
  const sharpe = stdDev > 0 ? avgReturn / stdDev : 0;
  const bestTrade = Math.max(...returns);
  const worstTrade = Math.min(...returns);
  const avgHoldDays = trades.reduce((s,t) => s + Math.max(1, Math.round((t.exitDate - t.entryDate) / 86400000)), 0) / trades.length;
  return {
    window, symbol, trades, tradeCount: trades.length,
    hitRate, avgReturn, totalReturn, totalDollarPnL,
    stdDev, tStat, sharpe,
    bestTrade, worstTrade, avgHoldDays,
    isSignificant: Math.abs(tStat) > 2,
  };
}

/**
 * Backtest all 7 SEASONAL_WINDOWS across all 14 contracts.
 * Returns one aggregate per window.
 */
export function backtestAllSeasonalWindows(): SeasonalWindowAggregate[] {
  const aggregates: SeasonalWindowAggregate[] = [];
  for (const window of SEASONAL_WINDOWS) {
    const symbolResults: SeasonalWindowBacktestResult[] = [];
    for (const contract of CONTRACTS) {
      const r = backtestWindowForSymbol(window, contract.symbol);
      if (r) symbolResults.push(r);
    }
    if (symbolResults.length === 0) continue;
    const allTrades = symbolResults.flatMap(r => r.trades);
    const aggregateTradeCount = allTrades.length;
    const aggregateHitRate = aggregateTradeCount > 0 ? allTrades.filter(t => t.winner).length / aggregateTradeCount : 0;
    const aggregateAvgReturn = aggregateTradeCount > 0 ? allTrades.reduce((s,t) => s+t.pctReturn, 0) / aggregateTradeCount : 0;
    const aggregateTotalPnL = symbolResults.reduce((s,r) => s+r.totalDollarPnL, 0);
    // Best symbol by Sharpe (or hit rate if no Sharpe)
    const sorted = [...symbolResults].filter(r => r.tradeCount > 0).sort((a,b) => b.sharpe - a.sharpe || b.hitRate - a.hitRate);
    const best = sorted[0] ?? null;
    const worst = sorted[sorted.length - 1] ?? null;
    aggregates.push({
      window,
      symbolResults,
      aggregateTradeCount,
      aggregateHitRate,
      aggregateAvgReturn,
      aggregateTotalPnL,
      bestSymbol: best?.symbol ?? null,
      bestSymbolHitRate: best?.hitRate ?? 0,
      bestSymbolReturn: best?.avgReturn ?? 0,
      worstSymbol: worst?.symbol ?? null,
      worstSymbolReturn: worst?.avgReturn ?? 0,
      significantCount: symbolResults.filter(r => r.isSignificant).length,
      totalSymbols: symbolResults.length,
    });
  }
  return aggregates;
}
