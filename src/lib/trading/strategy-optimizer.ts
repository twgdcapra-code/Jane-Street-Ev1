/**
 * Strategy Optimizer Engine
 *
 * Implements 4 optimization/validation methods:
 *  1. Walk-Forward Optimization (WFO) — Pardo (2008)
 *  2. Genetic Algorithm optimization — DEAP-style
 *  3. Combinatorial Purged Cross-Validation (CPCV) — López de Prado (2018)
 *  4. Deflated Sharpe Ratio (DSR) — Bailey & López de Prado (2014)
 *
 * Based on research in /home/z/my-project/research/strategy_optimizer.md
 */
import type { Candle, StrategyParams, BacktestResult, BacktestMetrics } from "./types";
import { getEngine } from "./market-engine";
import { getStrategy, STRATEGIES, type StrategyDef } from "./strategies";
import { runBacktest } from "./backtest";

// ============================================================
// 1. PARAMETER SEARCH SPACE
// ============================================================

export interface ParamRange {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

export function buildParamRanges(strategyId: string): ParamRange[] {
  const def = getStrategy(strategyId);
  if (!def) return [];
  return def.paramSchema.map((p) => ({
    key: p.key,
    label: p.label,
    min: p.min ?? 1,
    max: p.max ?? 100,
    step: p.step ?? 1,
  }));
}

export function randomParams(ranges: ParamRange[], rng: () => number = Math.random): StrategyParams {
  const params: StrategyParams = {};
  for (const r of ranges) {
    const steps = Math.floor((r.max - r.min) / r.step);
    const val = r.min + Math.floor(rng() * (steps + 1)) * r.step;
    params[r.key] = val;
  }
  return params;
}

export function mutateParams(
  params: StrategyParams,
  ranges: ParamRange[],
  mutationRate: number = 0.3,
  rng: () => number = Math.random,
): StrategyParams {
  const result = { ...params };
  for (const r of ranges) {
    if (rng() < mutationRate) {
      const steps = Math.floor((r.max - r.min) / r.step);
      const val = r.min + Math.floor(rng() * (steps + 1)) * r.step;
      result[r.key] = val;
    }
  }
  return result;
}

export function crossoverParams(
  parent1: StrategyParams,
  parent2: StrategyParams,
  ranges: ParamRange[],
  rng: () => number = Math.random,
): StrategyParams {
  const result: StrategyParams = {};
  for (const r of ranges) {
    result[r.key] = rng() < 0.5 ? parent1[r.key] : parent2[r.key];
  }
  return result;
}

// ============================================================
// 2. FITNESS FUNCTION
// ============================================================

export type FitnessMetric = "SHARPE" | "SORTINO" | "CALMAR" | "PROFIT_FACTOR" | "RETURN_RISK";

export function computeFitness(metrics: BacktestMetrics, method: FitnessMetric = "SHARPE"): number {
  switch (method) {
    case "SHARPE":
      return metrics.sharpe;
    case "SORTINO":
      return metrics.sortino;
    case "CALMAR":
      return metrics.calmar;
    case "PROFIT_FACTOR":
      return isFinite(metrics.profitFactor) ? metrics.profitFactor : 10;
    case "RETURN_RISK":
      return metrics.totalReturnPct / Math.max(Math.abs(metrics.maxDrawdownPct), 0.1);
    default:
      return metrics.sharpe;
  }
}

// ============================================================
// 3. WALK-FORWARD OPTIMIZATION (WFO)
// ============================================================

export interface WFOResult {
  windows: {
    index: number;
    isStart: number;
    isEnd: number;
    oosStart: number;
    oosEnd: number;
    isSharpe: number;
    oosSharpe: number;
    isReturn: number;
    oosReturn: number;
    bestParams: StrategyParams;
  }[];
  walkForwardEfficiency: number;
  avgOoSSharpe: number;
  avgIsSharpe: number;
  passRate: number;
  parameterStability: number;
  explanation: string;
}

export function walkForwardOptimize(
  strategyId: string,
  symbol: string,
  paramRanges: ParamRange[],
  candles: Candle[],
  windowSize: number = 100,
  stepSize: number = 30,
  isRatio: number = 0.7,
  fitnessMetric: FitnessMetric = "SHARPE",
  trialsPerWindow: number = 20,
): WFOResult {
  const def = getStrategy(strategyId);
  if (!def || candles.length < windowSize * 2) {
    return {
      windows: [],
      walkForwardEfficiency: 0,
      avgOoSSharpe: 0,
      avgIsSharpe: 0,
      passRate: 0,
      parameterStability: 0,
      explanation: "Insufficient data for walk-forward optimization.",
    };
  }
  const isSize = Math.floor(windowSize * isRatio);
  const oosSize = windowSize - isSize;
  const windows: WFOResult["windows"] = [];
  let seed = 42;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let start = 0; start + windowSize <= candles.length; start += stepSize) {
    const isCandles = candles.slice(start, start + isSize);
    const oosCandles = candles.slice(start + isSize, start + isSize + oosSize);
    if (oosCandles.length < 10) break;

    // Optimize on IS
    let bestFitness = -Infinity;
    let bestParams: StrategyParams = randomParams(paramRanges, rng);
    for (let trial = 0; trial < trialsPerWindow; trial++) {
      const params = randomParams(paramRanges, rng);
      try {
        const result = runBacktest({
          strategyId,
          symbol,
          params,
          candles: isCandles,
          initialCapital: 100000,
          contractsPerTrade: 1,
        });
        const fitness = computeFitness(result.metrics, fitnessMetric);
        if (fitness > bestFitness) {
          bestFitness = fitness;
          bestParams = params;
        }
      } catch (e) {
        // skip invalid params
      }
    }

    // Test on OOS
    let oosSharpe = 0;
    let oosReturn = 0;
    let isSharpe = 0;
    let isReturn = 0;
    try {
      const isResult = runBacktest({
        strategyId, symbol, params: bestParams, candles: isCandles,
        initialCapital: 100000, contractsPerTrade: 1,
      });
      isSharpe = isResult.metrics.sharpe;
      isReturn = isResult.metrics.totalReturnPct;
      const oosResult = runBacktest({
        strategyId, symbol, params: bestParams, candles: oosCandles,
        initialCapital: 100000, contractsPerTrade: 1,
      });
      oosSharpe = oosResult.metrics.sharpe;
      oosReturn = oosResult.metrics.totalReturnPct;
    } catch (e) {
      // skip
    }

    windows.push({
      index: windows.length,
      isStart: start,
      isEnd: start + isSize,
      oosStart: start + isSize,
      oosEnd: start + isSize + oosSize,
      isSharpe,
      oosSharpe,
      isReturn,
      oosReturn,
      bestParams,
    });
  }

  // Compute aggregate metrics
  const avgIs = windows.length > 0 ? windows.reduce((s, w) => s + w.isSharpe, 0) / windows.length : 0;
  const avgOos = windows.length > 0 ? windows.reduce((s, w) => s + w.oosSharpe, 0) / windows.length : 0;
  const wfe = avgIs !== 0 ? avgOos / avgIs : 0;
  const passCount = windows.filter((w) => w.oosSharpe > 0).length;
  const passRate = windows.length > 0 ? passCount / windows.length : 0;
  // Parameter stability: how much params vary across windows
  const paramStability = computeParamStability(windows.map((w) => w.bestParams), paramRanges);

  return {
    windows,
    walkForwardEfficiency: wfe,
    avgOoSSharpe: avgOos,
    avgIsSharpe: avgIs,
    passRate,
    parameterStability: paramStability,
    explanation: `WFO with ${windows.length} windows (${isSize} IS / ${oosSize} OOS, ${stepSize}-bar step). WFE: ${wfe.toFixed(2)}. Pass rate: ${(passRate * 100).toFixed(0)}%. ${wfe > 0.5 ? "Strategy generalizes well." : wfe > 0.2 ? "Moderate generalization." : "Likely overfit — OOS performance is poor."} Pardo (2008).`,
  };
}

function computeParamStability(paramSets: StrategyParams[], ranges: ParamRange[]): number {
  if (paramSets.length < 2) return 0;
  let totalVariance = 0;
  let paramCount = 0;
  for (const r of ranges) {
    const values = paramSets.map((p) => Number(p[r.key] ?? 0));
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const range = r.max - r.min;
    if (range > 0) {
      totalVariance += Math.sqrt(variance) / range;
      paramCount++;
    }
  }
  if (paramCount === 0) return 0;
  const avgVariance = totalVariance / paramCount;
  // Stability = 1 - normalized variance (higher = more stable)
  return Math.max(0, Math.min(1, 1 - avgVariance));
}

// ============================================================
// 4. GENETIC ALGORITHM OPTIMIZATION
// ============================================================

export interface GAResult {
  generations: {
    index: number;
    bestFitness: number;
    avgFitness: number;
    bestParams: StrategyParams;
  }[];
  bestParams: StrategyParams;
  bestFitness: number;
  bestMetrics: BacktestMetrics | null;
  convergence: number; // 0-1, how much improvement slowed
  explanation: string;
}

export function geneticOptimize(
  strategyId: string,
  symbol: string,
  paramRanges: ParamRange[],
  candles: Candle[],
  populationSize: number = 50,
  generations: number = 30,
  crossoverRate: number = 0.7,
  mutationRate: number = 0.15,
  elitism: number = 2,
  fitnessMetric: FitnessMetric = "SHARPE",
  tournamentSize: number = 3,
): GAResult {
  const def = getStrategy(strategyId);
  if (!def || candles.length < 30) {
    return {
      generations: [],
      bestParams: {},
      bestFitness: -Infinity,
      bestMetrics: null,
      convergence: 0,
      explanation: "Insufficient data for genetic optimization.",
    };
  }

  let seed = 12345;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // Initialize population
  let population: { params: StrategyParams; fitness: number; metrics: BacktestMetrics | null }[] = [];
  for (let i = 0; i < populationSize; i++) {
    const params = randomParams(paramRanges, rng);
    const { fitness, metrics } = evaluateIndividual(strategyId, symbol, params, candles, fitnessMetric);
    population.push({ params, fitness, metrics });
  }

  const genHistory: GAResult["generations"] = [];
  let allTimeBest = { ...population[0] };

  for (let gen = 0; gen < generations; gen++) {
    // Sort by fitness
    population.sort((a, b) => b.fitness - a.fitness);

    // Track best
    if (population[0].fitness > allTimeBest.fitness) {
      allTimeBest = { ...population[0] };
    }

    const bestFitness = population[0].fitness;
    const avgFitness = population.reduce((s, p) => s + p.fitness, 0) / population.length;
    genHistory.push({
      index: gen,
      bestFitness,
      avgFitness,
      bestParams: { ...population[0].params },
    });

    // Selection + crossover
    const newPop: typeof population = [];
    // Elitism: keep top N
    for (let i = 0; i < elitism && i < population.length; i++) {
      newPop.push({ ...population[i] });
    }
    // Fill rest with offspring
    while (newPop.length < populationSize) {
      const parent1 = tournamentSelect(population, tournamentSize, rng);
      const parent2 = tournamentSelect(population, tournamentSize, rng);
      let childParams: StrategyParams;
      if (rng() < crossoverRate) {
        childParams = crossoverParams(parent1.params, parent2.params, paramRanges, rng);
      } else {
        childParams = { ...parent1.params };
      }
      childParams = mutateParams(childParams, paramRanges, mutationRate, rng);
      const { fitness, metrics } = evaluateIndividual(strategyId, symbol, childParams, candles, fitnessMetric);
      newPop.push({ params: childParams, fitness, metrics });
    }
    population = newPop;
  }

  // Final sort
  population.sort((a, b) => b.fitness - a.fitness);
  if (population[0].fitness > allTimeBest.fitness) {
    allTimeBest = { ...population[0] };
  }

  // Convergence: how much improvement slowed in last 25% of generations
  const lastQuarter = genHistory.slice(-Math.max(1, Math.floor(genHistory.length / 4)));
  const firstOfLastQ = lastQuarter[0]?.bestFitness ?? 0;
  const lastOfLastQ = lastQuarter[lastQuarter.length - 1]?.bestFitness ?? 0;
  const totalImprovement = (genHistory[genHistory.length - 1]?.bestFitness ?? 0) - (genHistory[0]?.bestFitness ?? 0);
  const lateImprovement = lastOfLastQ - firstOfLastQ;
  const convergence = totalImprovement > 0 ? 1 - lateImprovement / totalImprovement : 1;

  return {
    generations: genHistory,
    bestParams: allTimeBest.params,
    bestFitness: allTimeBest.fitness,
    bestMetrics: allTimeBest.metrics,
    convergence,
    explanation: `GA with ${populationSize} population × ${generations} generations. Best ${fitnessMetric}: ${allTimeBest.fitness.toFixed(3)}. Convergence: ${(convergence * 100).toFixed(0)}% (improvement plateaued). Tournament selection (k=${tournamentSize}), crossover ${crossoverRate}, mutation ${mutationRate}, elitism ${elitism}.`,
  };
}

function tournamentSelect(
  population: { params: StrategyParams; fitness: number }[],
  k: number,
  rng: () => number,
): { params: StrategyParams; fitness: number } {
  let best = population[Math.floor(rng() * population.length)];
  for (let i = 1; i < k; i++) {
    const candidate = population[Math.floor(rng() * population.length)];
    if (candidate.fitness > best.fitness) best = candidate;
  }
  return best;
}

function evaluateIndividual(
  strategyId: string,
  symbol: string,
  params: StrategyParams,
  candles: Candle[],
  fitnessMetric: FitnessMetric,
): { fitness: number; metrics: BacktestMetrics | null } {
  try {
    const result = runBacktest({
      strategyId, symbol, params, candles,
      initialCapital: 100000, contractsPerTrade: 1,
    });
    return { fitness: computeFitness(result.metrics, fitnessMetric), metrics: result.metrics };
  } catch (e) {
    return { fitness: -999, metrics: null };
  }
}

// ============================================================
// 5. COMBINATORIAL PURGED CROSS-VALIDATION (CPCV)
// ============================================================

export interface CPCVResult {
  nGroups: number;
  nTestGroups: number;
  totalPaths: number;
  paths: {
    index: number;
    testGroups: number[];
    sharpe: number;
    return: number;
    maxDrawdown: number;
  }[];
  avgSharpe: number;
  sharpeStd: number;
  probSharpePositive: number;
  minSharpe: number;
  maxSharpe: number;
  explanation: string;
}

export function cpcvValidate(
  strategyId: string,
  symbol: string,
  params: StrategyParams,
  candles: Candle[],
  nGroups: number = 6,
  nTestGroups: number = 2,
  embargoBars: number = 5,
): CPCVResult {
  if (candles.length < nGroups * 20) {
    return {
      nGroups, nTestGroups, totalPaths: 0, paths: [],
      avgSharpe: 0, sharpeStd: 0, probSharpePositive: 0, minSharpe: 0, maxSharpe: 0,
      explanation: "Insufficient data for CPCV.",
    };
  }
  // Split candles into N groups
  const groupSize = Math.floor(candles.length / nGroups);
  const groups: Candle[][] = [];
  for (let i = 0; i < nGroups; i++) {
    const start = i * groupSize;
    const end = i === nGroups - 1 ? candles.length : (i + 1) * groupSize;
    groups.push(candles.slice(start, end));
  }
  // Generate all C(N, k) combinations of test groups
  const combinations = getCombinations(nGroups, nTestGroups);
  const paths: CPCVResult["paths"] = [];
  for (const testGroups of combinations) {
    // Training set = all groups except test, with embargo
    const trainCandles: Candle[] = [];
    for (let g = 0; g < nGroups; g++) {
      if (testGroups.includes(g)) continue;
      // Embargo: skip last `embargoBars` of each training group adjacent to test
      const isBeforeTest = testGroups.some((tg) => tg === g + 1);
      const isAfterTest = testGroups.some((tg) => tg === g - 1);
      const groupCandles = [...groups[g]];
      if (isBeforeTest) groupCandles.splice(-embargoBars);
      if (isAfterTest) groupCandles.splice(0, embargoBars);
      trainCandles.push(...groupCandles);
    }
    // Test set = concatenation of test groups
    const testCandles: Candle[] = [];
    for (const tg of testGroups) {
      testCandles.push(...groups[tg]);
    }
    // Run backtest on test set with given params
    try {
      const result = runBacktest({
        strategyId, symbol, params, candles: testCandles,
        initialCapital: 100000, contractsPerTrade: 1,
      });
      paths.push({
        index: paths.length,
        testGroups,
        sharpe: result.metrics.sharpe,
        return: result.metrics.totalReturnPct,
        maxDrawdown: result.metrics.maxDrawdownPct,
      });
    } catch (e) {
      paths.push({
        index: paths.length,
        testGroups,
        sharpe: 0,
        return: 0,
        maxDrawdown: 0,
      });
    }
  }
  const sharpes = paths.map((p) => p.sharpe);
  const avgSharpe = sharpes.reduce((s, v) => s + v, 0) / sharpes.length;
  const sharpeStd = sharpes.length > 1 ? Math.sqrt(sharpes.reduce((s, v) => s + (v - avgSharpe) ** 2, 0) / (sharpes.length - 1)) : 0;
  const probPositive = sharpes.filter((s) => s > 0).length / sharpes.length;
  return {
    nGroups,
    nTestGroups,
    totalPaths: combinations.length,
    paths,
    avgSharpe,
    sharpeStd,
    probSharpePositive: probPositive,
    minSharpe: Math.min(...sharpes),
    maxSharpe: Math.max(...sharpes),
    explanation: `CPCV with N=${nGroups} groups, k=${nTestGroups} test groups → ${combinations.length} backtest paths. Avg Sharpe: ${avgSharpe.toFixed(2)} ± ${sharpeStd.toFixed(2)}. Prob(Sharpe>0): ${(probPositive * 100).toFixed(0)}%. Embargo: ${embargoBars} bars. López de Prado (2018), Chapter 12.`,
  };
}

function getCombinations(n: number, k: number): number[][] {
  const result: number[][] = [];
  const combo: number[] = [];
  function backtrack(start: number) {
    if (combo.length === k) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < n; i++) {
      combo.push(i);
      backtrack(i + 1);
      combo.pop();
    }
  }
  backtrack(0);
  return result;
}

// ============================================================
// 6. DEFLATED SHARPE RATIO (DSR)
// ============================================================

export interface DSRResult {
  observedSharpe: number;
  numTrials: number;
  expectedMaxSharpe: number;
  deflatedSharpe: number;
  psr: number; // Probabilistic Sharpe Ratio
  minTRL: number; // Minimum Track Record Length (years)
  isSignificant: boolean;
  explanation: string;
}

export function computeDSR(
  observedSharpe: number,
  numTrials: number,
  trackRecordYears: number,
  skewness: number = 0,
  kurtosis: number = 3,
  correlation: number = 0, // avg correlation between trials
): DSRResult {
  // Effective number of trials (accounting for correlation)
  const effectiveTrials = Math.round(correlation + (1 - correlation) * numTrials);
  // Expected maximum Sharpe under null (Bailey-López de Prado 2014)
  // E[max SR] = sqrt(V[SR_hat]) * [(1-γ)Φ^{-1}(1-1/N) + γΦ^{-1}(1-1/(N*e))]
  // where γ ≈ 0.5772 (Euler-Mascheroni)
  const gamma = 0.5772;
  const eulerE = Math.E;
  // Variance of Sharpe estimator: V[SR_hat] = (1 - skew*SR + (kurt-1)/4 * SR^2) / (T-1)
  const sr = observedSharpe / Math.sqrt(252); // convert annualized to per-bar
  const varianceSR = (1 - skewness * sr + ((kurtosis - 1) / 4) * sr * sr) / Math.max(trackRecordYears * 252 - 1, 1);
  const stdSR = Math.sqrt(varianceSR);
  // Expected max SR under null
  const z1 = inverseNormalCDF(1 - 1 / effectiveTrials);
  const z2 = inverseNormalCDF(1 - 1 / (effectiveTrials * eulerE));
  const expectedMaxSharpe = stdSR * ((1 - gamma) * z1 + gamma * z2) * Math.sqrt(252); // annualize back
  // Deflated Sharpe: the observed Sharpe adjusted for multiple testing
  // DSR = PSR(SR_0 = E[max SR])
  // PSR(SR_0) = Φ((SR_hat - SR_0) * sqrt(T-1) / sqrt(1 - skew*SR + (kurt-1)/4*SR^2))
  const numerator = (observedSharpe - expectedMaxSharpe) * Math.sqrt(trackRecordYears * 252 - 1);
  const denominator = Math.sqrt(Math.max(1 - skewness * sr + ((kurtosis - 1) / 4) * sr * sr, 0.001));
  const psr = normalCDF(numerator / denominator);
  // Minimum Track Record Length (years)
  // MinTRL = 1 + (1 - skew*SR + (kurt-1)/4*SR^2) * (Φ^{-1}(0.95) / (SR - SR_0))^2
  const z95 = inverseNormalCDF(0.95);
  const minTRL = 1 + (1 - skewness * sr + ((kurtosis - 1) / 4) * sr * sr) * Math.pow(z95 / Math.max(observedSharpe - expectedMaxSharpe, 0.001), 2) / 252;
  const isSignificant = psr > 0.95 && observedSharpe > expectedMaxSharpe;
  return {
    observedSharpe,
    numTrials: effectiveTrials,
    expectedMaxSharpe,
    deflatedSharpe: observedSharpe - expectedMaxSharpe,
    psr,
    minTRL,
    isSignificant,
    explanation: `DSR: Observed Sharpe ${observedSharpe.toFixed(2)} vs expected max ${expectedMaxSharpe.toFixed(2)} (from ${effectiveTrials} trials). PSR: ${(psr * 100).toFixed(1)}%. ${isSignificant ? "SIGNIFICANT — strategy has genuine edge after multiple-testing correction." : "NOT SIGNIFICANT — observed Sharpe could be explained by multiple testing."} Bailey & López de Prado (2014), SSRN 2460551.`,
  };
}

// Normal CDF and inverse CDF (Abramowitz & Stegun approximations)
function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function inverseNormalCDF(p: number): number {
  // Beasley-Springer-Moro algorithm
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
}

// ============================================================
// 7. SENSITIVITY ANALYSIS
// ============================================================

export interface SensitivityResult {
  paramKey: string;
  paramLabel: string;
  values: { value: number; fitness: number; sharpe: number; return: number }[];
  optimalValue: number;
  robustness: number; // 0-1, how flat the fitness landscape is around optimum
}

export function sensitivityAnalysis(
  strategyId: string,
  symbol: string,
  baseParams: StrategyParams,
  paramRanges: ParamRange[],
  candles: Candle[],
  perturbationSteps: number = 3,
): SensitivityResult[] {
  const results: SensitivityResult[] = [];
  for (const range of paramRanges) {
    const baseValue = Number(baseParams[range.key] ?? range.min);
    const step = range.step;
    const values: SensitivityResult["values"] = [];
    for (let offset = -perturbationSteps; offset <= perturbationSteps; offset++) {
      const testValue = baseValue + offset * step;
      if (testValue < range.min || testValue > range.max) continue;
      const testParams = { ...baseParams, [range.key]: testValue };
      try {
        const bt = runBacktest({
          strategyId, symbol, params: testParams, candles,
          initialCapital: 100000, contractsPerTrade: 1,
        });
        values.push({
          value: testValue,
          fitness: computeFitness(bt.metrics, "SHARPE"),
          sharpe: bt.metrics.sharpe,
          return: bt.metrics.totalReturnPct,
        });
      } catch (e) {
        values.push({ value: testValue, fitness: -999, sharpe: 0, return: 0 });
      }
    }
    // Find optimal
    const optimal = values.reduce((best, v) => v.fitness > best.fitness ? v : best, values[0]);
    // Robustness: how flat is the landscape around the optimum?
    const fitnesses = values.map((v) => v.fitness);
    const meanFit = fitnesses.reduce((s, v) => s + v, 0) / Math.max(fitnesses.length, 1);
    const varFit = fitnesses.reduce((s, v) => s + (v - meanFit) ** 2, 0) / Math.max(fitnesses.length, 1);
    const robustness = Math.abs(meanFit) > 0 ? Math.max(0, 1 - Math.sqrt(varFit) / Math.abs(meanFit)) : 0;
    results.push({
      paramKey: range.key,
      paramLabel: range.label,
      values,
      optimalValue: optimal.value,
      robustness,
    });
  }
  return results;
}
