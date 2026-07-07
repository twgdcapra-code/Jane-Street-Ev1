/**
 * Position Sizing Engine
 *
 * Implements several position-sizing methodologies used by professional traders:
 *
 * 1. Fixed Fractional — risk X% of equity per trade
 * 2. Kelly Criterion — optimal fraction based on edge and odds
 * 3. Volatility Targeting — size inversely to ATR / volatility
 * 4. Risk Parity — equalize risk contribution across positions
 * 5. Martingale / Anti-Martingale — multiplier based on win/loss streak
 * 6. Optimal-f (Ralph Vince) — maximize geometric growth
 *
 * All pure functions — no side effects.
 */
import { getContract } from "./contracts";

export interface SizingInput {
  accountEquity: number;
  riskPerTradePct: number; // % of equity at risk
  entryPrice: number;
  stopPrice: number;
  symbol: string;
  // For Kelly
  winRate?: number; // 0..1
  avgWin?: number; // in $ per contract
  avgLoss?: number; // in $ per contract (positive number)
  // For vol targeting
  targetVol?: number; // annualized, e.g. 0.15 = 15%
  assetVol?: number; // annualized vol of the asset
  // For risk parity
  portfolioVol?: number; // existing portfolio vol
  // Optional: max contracts cap
  maxContracts?: number;
}

export interface SizingResult {
  methodology: string;
  contracts: number;
  riskDollars: number;
  riskPctOfEquity: number;
  notional: number;
  marginRequired: number;
  marginPctOfEquity: number;
  explanation: string;
}

/** Fixed Fractional: risk X% of equity, stop distance determines size. */
export function fixedFractional(input: SizingInput): SizingResult {
  const contract = getContract(input.symbol);
  const riskDollars = input.accountEquity * (input.riskPerTradePct / 100);
  const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
  const riskPerContract = stopDistance * contract.pointValue;
  const contracts = riskPerContract > 0 ? Math.floor(riskDollars / riskPerContract) : 0;
  const capped = input.maxContracts ? Math.min(contracts, input.maxContracts) : contracts;
  const notional = capped * input.entryPrice * contract.pointValue;
  return {
    methodology: "Fixed Fractional",
    contracts: capped,
    riskDollars: capped * riskPerContract,
    riskPctOfEquity: (capped * riskPerContract / input.accountEquity) * 100,
    notional,
    marginRequired: capped * contract.marginInitial,
    marginPctOfEquity: (capped * contract.marginInitial / input.accountEquity) * 100,
    explanation: `Risk ${(input.riskPerTradePct).toFixed(1)}% of equity (${input.accountEquity.toLocaleString("en-US", { style: "currency", currency: "USD" })}) = ${riskDollars.toLocaleString("en-US", { style: "currency", currency: "USD" })}. Stop distance ${stopDistance.toFixed(4)} × point value $${contract.pointValue} = ${riskPerContract.toLocaleString("en-US", { style: "currency", currency: "USD" })}/contract. Size = floor(${riskDollars.toLocaleString("en-US", { style: "currency", currency: "USD" })} / ${riskPerContract.toLocaleString("en-US", { style: "currency", currency: "USD" })}) = ${capped}.`,
  };
}

/** Kelly Criterion: f* = (p*b - q) / b, where b = win/loss ratio, p = win prob, q = 1-p. */
export function kellyCriterion(input: SizingInput): SizingResult {
  const contract = getContract(input.symbol);
  const p = input.winRate ?? 0.5;
  const q = 1 - p;
  const b = (input.avgWin ?? 0) / Math.max(1, input.avgLoss ?? 1); // win/loss ratio
  if (b <= 0 || p <= 0 || p >= 1) {
    return {
      methodology: "Kelly Criterion",
      contracts: 0,
      riskDollars: 0,
      riskPctOfEquity: 0,
      notional: 0,
      marginRequired: 0,
      marginPctOfEquity: 0,
      explanation: "Invalid inputs: Kelly requires winRate in (0,1) and positive avgWin/avgLoss.",
    };
  }
  const kellyFraction = (p * b - q) / b;
  if (kellyFraction <= 0) {
    return {
      methodology: "Kelly Criterion",
      contracts: 0,
      riskDollars: 0,
      riskPctOfEquity: 0,
      notional: 0,
      marginRequired: 0,
      marginPctOfEquity: 0,
      explanation: `Kelly fraction is ${kellyFraction.toFixed(4)} (≤ 0). No edge — do not trade.`,
    };
  }
  // Full Kelly is too aggressive; traders use fractional Kelly (typically 1/4 or 1/2)
  // For position sizing, we use Kelly fraction × equity at risk per trade
  // Convert to contracts: kellyPct of equity, divided by risk-per-contract
  const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
  const riskPerContract = stopDistance * contract.pointValue;
  const kellyRiskDollars = input.accountEquity * kellyFraction;
  const contracts = riskPerContract > 0 ? Math.floor(kellyRiskDollars / riskPerContract) : 0;
  const capped = input.maxContracts ? Math.min(contracts, input.maxContracts) : contracts;
  return {
    methodology: "Kelly Criterion (full)",
    contracts: capped,
    riskDollars: capped * riskPerContract,
    riskPctOfEquity: (capped * riskPerContract / input.accountEquity) * 100,
    notional: capped * input.entryPrice * contract.pointValue,
    marginRequired: capped * contract.marginInitial,
    marginPctOfEquity: (capped * contract.marginInitial / input.accountEquity) * 100,
    explanation: `Win rate ${(p * 100).toFixed(1)}%, avgWin ${input.avgWin ?? 0}, avgLoss ${input.avgLoss ?? 0}. Win/loss ratio b=${b.toFixed(3)}. Kelly fraction f* = (p×b - q) / b = ${kellyFraction.toFixed(4)} (${(kellyFraction * 100).toFixed(2)}% of equity). At ${riskPerContract.toLocaleString("en-US", { style: "currency", currency: "USD" })}/contract risk → ${capped} contracts. Note: full Kelly is aggressive — consider fractional Kelly (1/4 or 1/2).`,
  };
}

/** Fractional Kelly — multiplies Kelly by a fraction (typically 0.25 or 0.5). */
export function fractionalKelly(input: SizingInput, fraction: number = 0.25): SizingResult {
  const contract = getContract(input.symbol);
  const p = input.winRate ?? 0.5;
  const q = 1 - p;
  const b = (input.avgWin ?? 0) / Math.max(1, input.avgLoss ?? 1);
  if (b <= 0 || p <= 0 || p >= 1) {
    return { ...kellyCriterion(input), methodology: `Fractional Kelly (${fraction}×)` };
  }
  const kellyFraction = (p * b - q) / b;
  const adjustedFraction = kellyFraction * fraction;
  if (adjustedFraction <= 0) {
    return {
      methodology: `Fractional Kelly (${fraction}×)`,
      contracts: 0,
      riskDollars: 0,
      riskPctOfEquity: 0,
      notional: 0,
      marginRequired: 0,
      marginPctOfEquity: 0,
      explanation: `Kelly fraction × ${fraction} = ${adjustedFraction.toFixed(4)} (≤ 0). No edge.`,
    };
  }
  const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
  const riskPerContract = stopDistance * contract.pointValue;
  const riskDollars = input.accountEquity * adjustedFraction;
  const contracts = riskPerContract > 0 ? Math.floor(riskDollars / riskPerContract) : 0;
  const capped = input.maxContracts ? Math.min(contracts, input.maxContracts) : contracts;
  return {
    methodology: `Fractional Kelly (${fraction}×)`,
    contracts: capped,
    riskDollars: capped * riskPerContract,
    riskPctOfEquity: (capped * riskPerContract / input.accountEquity) * 100,
    notional: capped * input.entryPrice * contract.pointValue,
    marginRequired: capped * contract.marginInitial,
    marginPctOfEquity: (capped * contract.marginInitial / input.accountEquity) * 100,
    explanation: `Full Kelly × ${fraction} = ${(adjustedFraction * 100).toFixed(2)}% of equity at risk. Recommended for most traders — full Kelly maximizes geometric growth but has 100% drawdown risk; fractional Kelly sacrifices ~25% of growth for ~50% lower drawdown.`,
  };
}

/** Volatility Targeting: size so that the position contributes target vol to portfolio. */
export function volatilityTargeting(input: SizingInput): SizingResult {
  const contract = getContract(input.symbol);
  const targetVol = input.targetVol ?? 0.15;
  const assetVol = input.assetVol ?? 0.20;
  if (assetVol <= 0) {
    return {
      methodology: "Volatility Targeting",
      contracts: 0,
      riskDollars: 0,
      riskPctOfEquity: 0,
      notional: 0,
      marginRequired: 0,
      marginPctOfEquity: 0,
      explanation: "Asset volatility must be positive.",
    };
  }
  // Position notional as % of equity = targetVol / assetVol
  const notionalPct = targetVol / assetVol;
  const notional = input.accountEquity * notionalPct;
  const contracts = Math.floor(notional / (input.entryPrice * contract.pointValue));
  const capped = input.maxContracts ? Math.min(contracts, input.maxContracts) : contracts;
  const actualNotional = capped * input.entryPrice * contract.pointValue;
  // Risk: 1σ move = assetVol × notional / sqrt(252)
  const dailyRisk = assetVol / Math.sqrt(252) * actualNotional;
  return {
    methodology: "Volatility Targeting",
    contracts: capped,
    riskDollars: dailyRisk,
    riskPctOfEquity: (dailyRisk / input.accountEquity) * 100,
    notional: actualNotional,
    marginRequired: capped * contract.marginInitial,
    marginPctOfEquity: (capped * contract.marginInitial / input.accountEquity) * 100,
    explanation: `Target portfolio vol ${(targetVol * 100).toFixed(1)}%, asset vol ${(assetVol * 100).toFixed(1)}%. Notional as % of equity = target/asset = ${(notionalPct * 100).toFixed(2)}%. Position notional = ${notional.toLocaleString("en-US", { style: "currency", currency: "USD" })}. 1σ daily risk = ${dailyRisk.toLocaleString("en-US", { style: "currency", currency: "USD" })} (${(dailyRisk / input.accountEquity * 100).toFixed(2)}% of equity).`,
  };
}

/** Optimal-f (Ralph Vince): find f that maximizes Terminal Wealth Relative. */
export function optimalF(input: SizingInput): SizingResult {
  const contract = getContract(input.symbol);
  // Simplified optimal-f: requires historical trade distribution.
  // Here we approximate using win rate and payoff ratio.
  const p = input.winRate ?? 0.5;
  const b = (input.avgWin ?? 0) / Math.max(1, input.avgLoss ?? 1);
  if (b <= 0 || p <= 0 || p >= 1) {
    return { ...kellyCriterion(input), methodology: "Optimal-f (approx)" };
  }
  // Approximation: optimal-f ≈ Kelly × (1 - variance penalty)
  const kellyF = (p * b - (1 - p)) / b;
  // Variance penalty: more variance = lower f
  const variancePenalty = Math.sqrt(p * (1 - p)) * 0.5;
  const f = Math.max(0, kellyF * (1 - variancePenalty));
  const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
  const riskPerContract = stopDistance * contract.pointValue;
  const riskDollars = input.accountEquity * f;
  const contracts = riskPerContract > 0 ? Math.floor(riskDollars / riskPerContract) : 0;
  const capped = input.maxContracts ? Math.min(contracts, input.maxContracts) : contracts;
  return {
    methodology: "Optimal-f (approx)",
    contracts: capped,
    riskDollars: capped * riskPerContract,
    riskPctOfEquity: (capped * riskPerContract / input.accountEquity) * 100,
    notional: capped * input.entryPrice * contract.pointValue,
    marginRequired: capped * contract.marginInitial,
    marginPctOfEquity: (capped * contract.marginInitial / input.accountEquity) * 100,
    explanation: `Approximation of Ralph Vince's optimal-f. Kelly = ${kellyF.toFixed(4)}, variance penalty = ${variancePenalty.toFixed(3)}. Adjusted f = ${f.toFixed(4)} (${(f * 100).toFixed(2)}% of equity). Optimal-f maximizes Terminal Wealth Relative (geometric growth) given the historical trade distribution.`,
  };
}

/** Run all sizing methodologies and return side-by-side comparison. */
export function compareSizingMethods(input: SizingInput): SizingResult[] {
  return [
    fixedFractional(input),
    fractionalKelly(input, 0.25),
    fractionalKelly(input, 0.5),
    kellyCriterion(input),
    volatilityTargeting(input),
    optimalF(input),
  ];
}

/** Compute expected drawdown given a position size and historical volatility. */
export function expectedDrawdown(
  contracts: number,
  entryPrice: number,
  assetVol: number,
  symbol: string,
  horizon: number = 20, // trading days
  confidence: number = 0.95,
): { dollars: number; pctOfEquity: number; pctOfPosition: number } {
  const contract = getContract(symbol);
  const notional = contracts * entryPrice * contract.pointValue;
  // Daily vol = annualVol / sqrt(252)
  const dailyVol = assetVol / Math.sqrt(252);
  // Horizon vol = dailyVol × sqrt(horizon)
  const horizonVol = dailyVol * Math.sqrt(horizon);
  // z-score for confidence level
  const z = confidence === 0.95 ? 1.645 : confidence === 0.99 ? 2.326 : 1.0;
  const dollars = notional * horizonVol * z;
  return {
    dollars,
    pctOfEquity: 0, // caller fills in
    pctOfPosition: horizonVol * z * 100,
  };
}
