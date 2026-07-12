/** Correlation Arbitrage Engine — based on research/correlation_arb.md */
import { CONTRACTS } from "./contracts";
import { getEngine } from "./market-engine";
import { correlation, logReturns } from "./indicators";

export interface RollingCorrResult { time: number; corr: number; zScore: number; }

export function computeRollingCorrelation(symbolA: string, symbolB: string, window: number = 50, lookback: number = 200): RollingCorrResult[] {
  const engine = getEngine(); const histA = engine.getHistory(symbolA); const histB = engine.getHistory(symbolB);
  const candlesA = histA.length > lookback ? histA.slice(-lookback) : engine.getCandles(symbolA, lookback);
  const candlesB = histB.length > lookback ? histB.slice(-lookback) : engine.getCandles(symbolB, lookback);
  if (candlesA.length < window + 10 || candlesB.length < window + 10) return [];
  const n = Math.min(candlesA.length, candlesB.length); const closesA = candlesA.slice(-n).map(c => c.close); const closesB = candlesB.slice(-n).map(c => c.close);
  const results: RollingCorrResult[] = []; const corrs: number[] = []; const times: number[] = [];
  for (let i = window; i < n; i++) { const c = correlation(closesA.slice(i-window, i+1), closesB.slice(i-window, i+1)); corrs.push(c); times.push(candlesA[candlesA.length - n + i].time); }
  for (let i = 0; i < corrs.length; i++) { const hist = corrs.slice(0, i+1); const mean = hist.reduce((s,v) => s+v, 0) / hist.length; const sd = hist.length > 1 ? Math.sqrt(hist.reduce((s,v) => s+(v-mean)**2, 0) / (hist.length-1)) : 0; results.push({ time: times[i], corr: corrs[i], zScore: sd > 0 ? (corrs[i] - mean) / sd : 0 }); }
  return results;
}

export interface CorrBreakdown { pair: string; symbolA: string; symbolB: string; currentCorr: number; historicalMean: number; zScore: number; deviation: number; severity: "NORMAL" | "ELEVATED" | "EXTREME"; signal: "BREAKDOWN" | "STRENGTHENING" | "STABLE"; description: string; }

export function detectCorrelationBreakdowns(pairs: [string,string][], window: number = 50, lookback: number = 200): CorrBreakdown[] {
  const breakdowns: CorrBreakdown[] = [];
  for (const [a, b] of pairs) {
    const rolling = computeRollingCorrelation(a, b, window, lookback); if (rolling.length < 20) continue;
    const current = rolling[rolling.length - 1]; const allCorrs = rolling.map(r => r.corr);
    const mean = allCorrs.reduce((s,v) => s+v, 0) / allCorrs.length; const sd = allCorrs.length > 1 ? Math.sqrt(allCorrs.reduce((s,v) => s+(v-mean)**2, 0) / (allCorrs.length-1)) : 0;
    const z = current.zScore; const dev = current.corr - mean;
    let severity: CorrBreakdown["severity"] = "NORMAL"; let signal: CorrBreakdown["signal"] = "STABLE"; let desc = "Correlation within normal range.";
    if (Math.abs(z) > 2) { severity = "EXTREME"; if (dev < 0) { signal = "BREAKDOWN"; desc = `Correlation broke down: ${current.corr.toFixed(2)} vs ${mean.toFixed(2)} (z=${z.toFixed(1)}). Potential arbitrage if relationship reverts.`; } else { signal = "STRENGTHENING"; desc = `Correlation surged: ${current.corr.toFixed(2)} vs ${mean.toFixed(2)} (z=${z.toFixed(1)}). Assets moving in lockstep.`; } }
    else if (Math.abs(z) > 1) { severity = "ELEVATED"; signal = dev < 0 ? "BREAKDOWN" : "STRENGTHENING"; desc = `Correlation ${dev < 0 ? "below" : "above"} average: ${current.corr.toFixed(2)} vs ${mean.toFixed(2)} (z=${z.toFixed(1)}).`; }
    breakdowns.push({ pair: `${a}/${b}`, symbolA: a, symbolB: b, currentCorr: current.corr, historicalMean: mean, zScore: z, deviation: dev, severity, signal, description: desc });
  }
  return breakdowns.sort((x, y) => Math.abs(y.zScore) - Math.abs(x.zScore));
}

export function computeLiveCorrelationMatrix(symbols: string[], window: number = 50) {
  const engine = getEngine(); const closes: Record<string, number[]> = {};
  for (const sym of symbols) { const hist = engine.getHistory(sym); const candles = hist.length > window ? hist.slice(-window) : engine.getCandles(sym, window); closes[sym] = candles.map(c => c.close); }
  const n = symbols.length; const matrix: number[][] = Array.from({length: n}, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { if (i === j) matrix[i][j] = 1; else { const a = closes[symbols[i]] ?? [], b = closes[symbols[j]] ?? []; const ml = Math.min(a.length, b.length); matrix[i][j] = ml > 5 ? correlation(a.slice(-ml), b.slice(-ml)) : 0; } }
  return { symbols, matrix };
}

export interface LeadLagResult { pair: string; leader: string; lagger: string; lagBars: number; correlation: number; significance: number; description: string; }

export function computeLeadLag(symbolA: string, symbolB: string, maxLag: number = 10, lookback: number = 200): LeadLagResult | null {
  const engine = getEngine(); const histA = engine.getHistory(symbolA); const histB = engine.getHistory(symbolB);
  const candlesA = histA.length > lookback ? histA.slice(-lookback) : engine.getCandles(symbolA, lookback);
  const candlesB = histB.length > lookback ? histB.slice(-lookback) : engine.getCandles(symbolB, lookback);
  if (candlesA.length < 30 || candlesB.length < 30) return null;
  const n = Math.min(candlesA.length, candlesB.length); const retsA = logReturns(candlesA.slice(-n).map(c => c.close)); const retsB = logReturns(candlesB.slice(-n).map(c => c.close));
  if (retsA.length < 20 || retsB.length < 20) return null;
  let bestCorr = -1, bestLag = 0, aLeads = true;
  for (let lag = 1; lag <= maxLag; lag++) { const aSlice = retsA.slice(0, retsA.length - lag); const bSlice = retsB.slice(lag); if (aSlice.length < 10) continue; const corr = Math.abs(correlation(aSlice, bSlice)); if (corr > bestCorr) { bestCorr = corr; bestLag = lag; aLeads = true; } }
  for (let lag = 1; lag <= maxLag; lag++) { const bSlice = retsB.slice(0, retsB.length - lag); const aSlice = retsA.slice(lag); if (bSlice.length < 10) continue; const corr = Math.abs(correlation(bSlice, aSlice)); if (corr > bestCorr) { bestCorr = corr; bestLag = lag; aLeads = false; } }
  if (bestCorr < 0.05) return { pair: `${symbolA}/${symbolB}`, leader: "NONE", lagger: "NONE", lagBars: 0, correlation: bestCorr, significance: 0, description: "No significant lead-lag relationship." };
  const leader = aLeads ? symbolA : symbolB; const lagger = aLeads ? symbolB : symbolA;
  return { pair: `${symbolA}/${symbolB}`, leader, lagger, lagBars: bestLag, correlation: bestCorr, significance: Math.min(1, bestCorr * 2), description: `${leader} leads ${lagger} by ${bestLag} bar(s). Cross-corr: ${bestCorr.toFixed(3)}. Hasbrouck (1995).` };
}

export function computeAllLeadLags(pairs: [string,string][]): LeadLagResult[] { return pairs.map(([a,b]) => computeLeadLag(a,b)).filter((x): x is LeadLagResult => x !== null).sort((x,y) => y.significance - x.significance); }

export function classifyRiskRegime() {
  const engine = getEngine(); const esQ = engine.getQuote("ES"); const gcQ = engine.getQuote("GC"); const znQ = engine.getQuote("ZN");
  const indicators: { name: string; value: number; signal: string }[] = [];
  const esChg = esQ?.changePct ?? 0; indicators.push({ name: "ES Daily", value: esChg, signal: esChg > 0.3 ? "RISK_ON" : esChg < -0.3 ? "RISK_OFF" : "NEUTRAL" });
  const gcChg = gcQ?.changePct ?? 0; indicators.push({ name: "Gold", value: gcChg, signal: gcChg > 0.3 ? "RISK_OFF" : gcChg < -0.3 ? "RISK_ON" : "NEUTRAL" });
  const znChg = znQ?.changePct ?? 0; indicators.push({ name: "Treasuries", value: znChg, signal: znChg > 0.1 ? "RISK_OFF" : znChg < -0.1 ? "RISK_ON" : "NEUTRAL" });
  const onCount = indicators.filter(i => i.signal === "RISK_ON").length; const offCount = indicators.filter(i => i.signal === "RISK_OFF").length;
  let regime = "NEUTRAL"; let confidence = 0.33;
  if (onCount > offCount) { regime = "RISK_ON"; confidence = onCount / indicators.length; } else if (offCount > onCount) { regime = "RISK_OFF"; confidence = offCount / indicators.length; }
  return { regime, confidence, indicators, description: regime === "RISK_ON" ? "Risk-on: equities rallying, safe havens pressured." : regime === "RISK_OFF" ? "Risk-off: flight to safety, equities selling." : "Neutral: mixed signals." };
}

export const DEFAULT_PAIRS: [string,string][] = [["ES","NQ"],["ES","ZN"],["ES","GC"],["ES","CL"],["NQ","RTY"],["GC","SI"],["CL","NG"],["ZN","ZB"],["6E","ES"],["BRR","NQ"],["ES","MES"],["NQ","MNQ"]];
export const MONITOR_SYMBOLS = ["ES","NQ","RTY","YM","ZN","ZB","CL","NG","GC","SI","6E","BRR","MNQ","MES"];
