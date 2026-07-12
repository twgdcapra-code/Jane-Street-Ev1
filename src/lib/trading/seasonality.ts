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
