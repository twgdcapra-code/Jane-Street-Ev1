/**
 * Strategy Attribution Engine — Brinson-Fachler Model
 *
 * Based on /home/z/my-project/research/brinson_fachler.md (5,700 words).
 *
 * Decomposes active return (portfolio return - benchmark return) into:
 *
 *   Allocation Effect (AA) = Σ (w_p,i - w_b,i) × (R_b,i - R_b)
 *     — Did we overweight outperforming sectors and underweight underperformers?
 *
 *   Selection Effect (SS) = Σ w_b,i × (R_p,i - R_b,i)
 *     — Within each sector, did our picks beat the sector benchmark?
 *
 *   Interaction Effect (II) = Σ (w_p,i - w_b,i) × (R_p,i - R_b,i)
 *     — Did we combine overweighting with outperformance (positive), or
 *       overweight in sectors where we underperformed (negative)?
 *
 *   Total Active Return = AA + SS + II
 *
 * For futures, "sectors" = asset classes (equity_index, rate, energy, metal,
 * fx, crypto). The benchmark is an equal-weight basket of all contracts.
 * The portfolio is the current open positions, weighted by notional.
 *
 * Multi-period linking uses Frongello (2002) inflation method:
 *   linked_AA = Σ_t (AA_t × (1 + R_b,t) / (1 + R_b,total))
 * This preserves the additive identity: linked_AR = linked_AA + linked_SS + linked_II
 */
import { CONTRACTS, getContract } from "./contracts";
import { getEngine } from "./market-engine";
import type { Quote, Position } from "./types";

// ============================================================
// Types
// ============================================================

export interface SectorAttribution {
  sector: string;
  sectorLabel: string;
  // Weights
  portfolioWeight: number;  // w_p,i
  benchmarkWeight: number;  // w_b,i
  weightDifference: number; // w_p,i - w_b,i
  // Returns
  portfolioReturn: number;  // R_p,i (in %)
  benchmarkReturn: number;  // R_b,i (in %)
  returnDifference: number; // R_p,i - R_b,i (in %)
  // Attribution effects (in bps of total portfolio)
  allocationEffect: number;  // AA_i = (w_p,i - w_b,i) × (R_b,i - R_b)
  selectionEffect: number;   // SS_i = w_b,i × (R_p,i - R_b,i)
  interactionEffect: number; // II_i = (w_p,i - w_b,i) × (R_p,i - R_b,i)
  totalEffect: number;       // AA_i + SS_i + II_i
  // Aux
  portfolioNotional: number;
  benchmarkNotional: number;
  contractCount: number;
}

export interface AttributionResult {
  // Total returns
  portfolioReturn: number;   // R_p (in %)
  benchmarkReturn: number;   // R_b (in %)
  activeReturn: number;      // AR = R_p - R_b (in %)
  // Decomposition (in bps)
  allocationEffect: number;  // AA = Σ AA_i
  selectionEffect: number;   // SS = Σ SS_i
  interactionEffect: number; // II = Σ II_i
  // Verification: AA + SS + II should equal AR × 100 (bps)
  reconciliation: number;    // AR_bps - (AA + SS + II)
  // Per-sector breakdown
  sectors: SectorAttribution[];
  // Summary
  benchmarkType: string;
  totalPortfolioNotional: number;
  totalBenchmarkNotional: number;
  generatedAt: number;
}

// ============================================================
// Asset class metadata
// ============================================================

const SECTOR_LABELS: Record<string, string> = {
  equity_index: "Equity Index",
  rate: "Interest Rates",
  energy: "Energy",
  metal: "Metals",
  fx: "FX",
  crypto: "Crypto",
};

// ============================================================
// Return computation helpers
// ============================================================

function computeContractReturn(symbol: string, lookbackBars: number = 30): { returnPct: number; notional: number } {
  try {
    const engine = getEngine();
    const candles = engine.getCandles(symbol, lookbackBars + 5);
    if (candles.length < lookbackBars + 1) return { returnPct: 0, notional: 0 };
    const contract = getContract(symbol);
    const endPrice = candles[candles.length - 1].close;
    const startPrice = candles[candles.length - 1 - lookbackBars].close;
    if (startPrice === 0) return { returnPct: 0, notional: 0 };
    const returnPct = ((endPrice - startPrice) / startPrice) * 100;
    const notional = endPrice * contract.pointValue;
    return { returnPct, notional };
  } catch {
    return { returnPct: 0, notional: 0 };
  }
}

// ============================================================
// Benchmark: equal-weight basket of all contracts
// ============================================================

export interface BenchmarkConfig {
  type: "EQUAL_WEIGHT" | "VOL_WEIGHT" | "OI_WEIGHT";
  symbols?: string[]; // if not specified, use all CONTRACTS
  lookbackBars?: number;
}

const DEFAULT_BENCHMARK: BenchmarkConfig = {
  type: "EQUAL_WEIGHT",
  lookbackBars: 30,
};

function computeBenchmarkReturns(config: BenchmarkConfig): {
  sectorReturns: Record<string, { returnPct: number; totalNotional: number; contractCount: number }>;
  totalReturn: number;
  sectorWeights: Record<string, number>;
} {
  const symbols = config.symbols ?? CONTRACTS.map((c) => c.symbol);
  const lookback = config.lookbackBars ?? 30;

  // Compute returns per contract
  const contractData = symbols.map((sym) => {
    const { returnPct, notional } = computeContractReturn(sym, lookback);
    const contract = getContract(sym);
    return { symbol: sym, sector: contract.assetClass, returnPct, notional };
  });

  // Aggregate by sector
  const sectorAgg: Record<string, { totalReturn: number; totalNotional: number; count: number }> = {};
  for (const cd of contractData) {
    if (!sectorAgg[cd.sector]) sectorAgg[cd.sector] = { totalReturn: 0, totalNotional: 0, count: 0 };
    sectorAgg[cd.sector].totalReturn += cd.returnPct;
    sectorAgg[cd.sector].totalNotional += cd.notional;
    sectorAgg[cd.sector].count += 1;
  }

  // Compute sector returns (average of contracts in sector)
  const sectorReturns: Record<string, { returnPct: number; totalNotional: number; contractCount: number }> = {};
  for (const [sector, agg] of Object.entries(sectorAgg)) {
    sectorReturns[sector] = {
      returnPct: agg.totalReturn / agg.count,
      totalNotional: agg.totalNotional,
      contractCount: agg.count,
    };
  }

  // Compute total benchmark return (equal-weight across all contracts)
  const totalReturn = contractData.length > 0
    ? contractData.reduce((s, cd) => s + cd.returnPct, 0) / contractData.length
    : 0;

  // Compute sector weights (equal-weight = by contract count)
  const totalContracts = contractData.length;
  const sectorWeights: Record<string, number> = {};
  for (const [sector, agg] of Object.entries(sectorAgg)) {
    sectorWeights[sector] = agg.count / totalContracts;
  }

  return { sectorReturns, totalReturn, sectorWeights };
}

// ============================================================
// Portfolio: current open positions
// ============================================================

function computePortfolioReturns(positions: Position[], quotes: Record<string, Quote>, lookbackBars: number = 30): {
  sectorReturns: Record<string, { returnPct: number; totalNotional: number; contractCount: number }>;
  totalReturn: number;
  sectorWeights: Record<string, number>;
  totalNotional: number;
} {
  const openPositions = positions.filter((p) => p.netQty !== 0);
  if (openPositions.length === 0) {
    return { sectorReturns: {}, totalReturn: 0, sectorWeights: {}, totalNotional: 0 };
  }

  // For each position, compute the return over the lookback period
  // weighted by the position's notional
  const positionData = openPositions.map((p) => {
    const { returnPct } = computeContractReturn(p.symbol, lookbackBars);
    const contract = getContract(p.symbol);
    const quote = quotes[p.symbol];
    const price = quote?.last ?? 0;
    const notional = Math.abs(p.netQty) * price * contract.pointValue;
    // For short positions, the return is inverted
    const signedReturn = p.netQty > 0 ? returnPct : -returnPct;
    return { symbol: p.symbol, sector: contract.assetClass, returnPct: signedReturn, notional, qty: p.netQty };
  });

  // Aggregate by sector (notional-weighted)
  const sectorAgg: Record<string, { weightedReturn: number; totalNotional: number; count: number }> = {};
  let totalPortfolioNotional = 0;
  for (const pd of positionData) {
    if (!sectorAgg[pd.sector]) sectorAgg[pd.sector] = { weightedReturn: 0, totalNotional: 0, count: 0 };
    sectorAgg[pd.sector].weightedReturn += pd.returnPct * pd.notional;
    sectorAgg[pd.sector].totalNotional += pd.notional;
    sectorAgg[pd.sector].count += 1;
    totalPortfolioNotional += pd.notional;
  }

  const sectorReturns: Record<string, { returnPct: number; totalNotional: number; contractCount: number }> = {};
  const sectorWeights: Record<string, number> = {};
  for (const [sector, agg] of Object.entries(sectorAgg)) {
    sectorReturns[sector] = {
      returnPct: agg.totalNotional > 0 ? agg.weightedReturn / agg.totalNotional : 0,
      totalNotional: agg.totalNotional,
      contractCount: agg.count,
    };
    sectorWeights[sector] = totalPortfolioNotional > 0 ? agg.totalNotional / totalPortfolioNotional : 0;
  }

  // Total portfolio return (notional-weighted)
  const totalReturn = totalPortfolioNotional > 0
    ? positionData.reduce((s, pd) => s + pd.returnPct * pd.notional, 0) / totalPortfolioNotional
    : 0;

  return { sectorReturns, totalReturn, sectorWeights, totalNotional: totalPortfolioNotional };
}

// ============================================================
// Main: compute Brinson-Fachler attribution
// ============================================================

export function computeAttribution(
  positions: Position[],
  quotes: Record<string, Quote>,
  benchmarkConfig: BenchmarkConfig = DEFAULT_BENCHMARK,
): AttributionResult {
  const lookback = benchmarkConfig.lookbackBars ?? 30;

  // Compute portfolio + benchmark returns by sector
  const portfolio = computePortfolioReturns(positions, quotes, lookback);
  const benchmark = computeBenchmarkReturns(benchmarkConfig);

  const R_p = portfolio.totalReturn;
  const R_b = benchmark.totalReturn;
  const AR = R_p - R_b;

  // Get all sectors (union of portfolio + benchmark)
  const allSectors = new Set([
    ...Object.keys(portfolio.sectorReturns),
    ...Object.keys(benchmark.sectorReturns),
  ]);

  const sectors: SectorAttribution[] = [];
  let totalAA = 0;
  let totalSS = 0;
  let totalII = 0;

  for (const sector of allSectors) {
    const w_p = portfolio.sectorWeights[sector] ?? 0;
    const w_b = benchmark.sectorWeights[sector] ?? 0;
    const R_p_i = portfolio.sectorReturns[sector]?.returnPct ?? 0;
    const R_b_i = benchmark.sectorReturns[sector]?.returnPct ?? 0;

    // Brinson-Fachler formulas
    const allocationEffect = (w_p - w_b) * (R_b_i - R_b);    // in % × weight = %
    const selectionEffect = w_b * (R_p_i - R_b_i);           // in %
    const interactionEffect = (w_p - w_b) * (R_p_i - R_b_i); // in %
    const totalEffect = allocationEffect + selectionEffect + interactionEffect;

    totalAA += allocationEffect;
    totalSS += selectionEffect;
    totalII += interactionEffect;

    sectors.push({
      sector,
      sectorLabel: SECTOR_LABELS[sector] ?? sector,
      portfolioWeight: w_p,
      benchmarkWeight: w_b,
      weightDifference: w_p - w_b,
      portfolioReturn: R_p_i,
      benchmarkReturn: R_b_i,
      returnDifference: R_p_i - R_b_i,
      allocationEffect: allocationEffect * 100, // convert to bps
      selectionEffect: selectionEffect * 100,
      interactionEffect: interactionEffect * 100,
      totalEffect: totalEffect * 100,
      portfolioNotional: portfolio.sectorReturns[sector]?.totalNotional ?? 0,
      benchmarkNotional: benchmark.sectorReturns[sector]?.totalNotional ?? 0,
      contractCount: portfolio.sectorReturns[sector]?.contractCount ?? 0,
    });
  }

  // Sort sectors by absolute total effect (biggest contributors first)
  sectors.sort((a, b) => Math.abs(b.totalEffect) - Math.abs(a.totalEffect));

  const reconciliation = AR * 100 - (totalAA + totalSS + totalII) * 100;

  return {
    portfolioReturn: R_p,
    benchmarkReturn: R_b,
    activeReturn: AR,
    allocationEffect: totalAA * 100,  // bps
    selectionEffect: totalSS * 100,
    interactionEffect: totalII * 100,
    reconciliation,
    sectors,
    benchmarkType: benchmarkConfig.type,
    totalPortfolioNotional: portfolio.totalNotional,
    totalBenchmarkNotional: Object.values(benchmark.sectorReturns).reduce((s, r) => s + r.totalNotional, 0),
    generatedAt: Date.now(),
  };
}

// ============================================================
// Multi-period linking (Frongello 2002)
// ============================================================

export interface LinkedAttribution {
  totalActiveReturn: number;
  linkedAllocation: number;
  linkedSelection: number;
  linkedInteraction: number;
  periodCount: number;
}

export function linkAttributionFrongello(periods: AttributionResult[]): LinkedAttribution {
  if (periods.length === 0) {
    return { totalActiveReturn: 0, linkedAllocation: 0, linkedSelection: 0, linkedInteraction: 0, periodCount: 0 };
  }
  // Frongello linking: linked_effect = Σ_t (effect_t × (1 + R_b,t) / (1 + R_b,total))
  // where R_b,total is the cumulative benchmark return across all periods
  const cumulativeBenchmarkReturn = periods.reduce((s, p) => s + p.benchmarkReturn, 0);
  const scaleFactor = 1 + cumulativeBenchmarkReturn / 100;

  let linkedAllocation = 0;
  let linkedSelection = 0;
  let linkedInteraction = 0;
  let totalActive = 0;

  for (const period of periods) {
    const inflationFactor = (1 + period.benchmarkReturn / 100) / scaleFactor;
    linkedAllocation += period.allocationEffect * inflationFactor;
    linkedSelection += period.selectionEffect * inflationFactor;
    linkedInteraction += period.interactionEffect * inflationFactor;
    totalActive += period.activeReturn * 100;
  }

  return {
    totalActiveReturn: totalActive,
    linkedAllocation,
    linkedSelection,
    linkedInteraction,
    periodCount: periods.length,
  };
}

// ============================================================
// Summary stats
// ============================================================

export interface AttributionSummary {
  bestSector: SectorAttribution | null;
  worstSector: SectorAttribution | null;
  bestAllocationSector: SectorAttribution | null;
  worstAllocationSector: SectorAttribution | null;
  bestSelectionSector: SectorAttribution | null;
  worstSelectionSector: SectorAttribution | null;
  positiveSectors: number;
  negativeSectors: number;
  totalSectors: number;
}

export function computeSummary(result: AttributionResult): AttributionSummary {
  if (result.sectors.length === 0) {
    return {
      bestSector: null, worstSector: null,
      bestAllocationSector: null, worstAllocationSector: null,
      bestSelectionSector: null, worstSelectionSector: null,
      positiveSectors: 0, negativeSectors: 0, totalSectors: 0,
    };
  }
  const sorted = [...result.sectors];
  return {
    bestSector: sorted.reduce((a, b) => a.totalEffect > b.totalEffect ? a : b),
    worstSector: sorted.reduce((a, b) => a.totalEffect < b.totalEffect ? a : b),
    bestAllocationSector: sorted.reduce((a, b) => a.allocationEffect > b.allocationEffect ? a : b),
    worstAllocationSector: sorted.reduce((a, b) => a.allocationEffect < b.allocationEffect ? a : b),
    bestSelectionSector: sorted.reduce((a, b) => a.selectionEffect > b.selectionEffect ? a : b),
    worstSelectionSector: sorted.reduce((a, b) => a.selectionEffect < b.selectionEffect ? a : b),
    positiveSectors: sorted.filter((s) => s.totalEffect > 0).length,
    negativeSectors: sorted.filter((s) => s.totalEffect < 0).length,
    totalSectors: sorted.length,
  };
}
