/**
 * Options on Futures Engine
 *
 * Prices European options on futures using Black's 1976 model (the standard
 * for options on futures — same as Black-Scholes but with the forward price
 * instead of spot, and no dividend yield).
 *
 * Also implements:
 *  - Implied volatility solver (Newton-Raphson with bisection fallback)
 *  - Volatility surface construction (smile + term structure)
 *  - Greeks aggregation across multi-leg option strategies
 *  - Common strategy templates (straddle, strangle, iron condor, butterfly,
 *    covered call, protective put, risk reversal, calendar)
 */
import { blackScholes } from "./indicators";
import type { Greeks } from "./types";

export interface OptionSpec {
  underlying: string; // futures symbol (e.g. "ES")
  strike: number;
  expiryDays: number; // days to expiry
  isCall: boolean;
}

export interface OptionQuote extends OptionSpec {
  price: number;
  greeks: Greeks;
  impliedVol: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  // "Moneyness" classification
  moneyness: "ITM" | "ATM" | "OTM";
  intrinsic: number;
  timeValue: number;
}

const RISK_FREE_RATE = 0.045; // 4.5%

/** Price a single option on a futures contract using Black's model. */
export function priceOption(
  spec: OptionSpec,
  forwardPrice: number,
  impliedVol: number,
): OptionQuote {
  const T = Math.max(1 / 365, spec.expiryDays / 365); // avoid div-by-zero
  const bs = blackScholes(forwardPrice, spec.strike, T, RISK_FREE_RATE, impliedVol, spec.isCall);
  const intrinsic = spec.isCall
    ? Math.max(0, forwardPrice - spec.strike)
    : Math.max(0, spec.strike - forwardPrice);
  const timeValue = Math.max(0, bs.price - intrinsic);
  // Moneyness: within 1% of forward = ATM
  const moneynessPct = Math.abs(spec.strike - forwardPrice) / forwardPrice;
  const moneyness: OptionQuote["moneyness"] =
    moneynessPct < 0.01 ? "ATM" : (spec.isCall ? (spec.strike < forwardPrice ? "ITM" : "OTM") : (spec.strike > forwardPrice ? "ITM" : "OTM"));
  return {
    ...spec,
    price: bs.price,
    greeks: bs,
    impliedVol,
    delta: bs.delta,
    gamma: bs.gamma,
    theta: bs.theta,
    vega: bs.vega,
    rho: bs.rho,
    moneyness,
    intrinsic,
    timeValue,
  };
}

/** Implied vol solver — Newton-Raphson with bisection fallback. */
export function impliedVol(
  spec: OptionSpec,
  forwardPrice: number,
  marketPrice: number,
): number {
  const T = Math.max(1 / 365, spec.expiryDays / 365);
  let sigma = 0.3; // initial guess
  for (let i = 0; i < 50; i++) {
    const bs = blackScholes(forwardPrice, spec.strike, T, RISK_FREE_RATE, sigma, spec.isCall);
    const diff = bs.price - marketPrice;
    if (Math.abs(diff) < 1e-6) return sigma;
    // Vega-based step
    if (Math.abs(bs.vega) < 1e-8) break;
    const step = diff / bs.vega;
    sigma -= step;
    if (sigma <= 0.001) sigma = 0.001;
    if (sigma > 5) sigma = 5;
  }
  // Bisection fallback
  let lo = 0.01;
  let hi = 5;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const bs = blackScholes(forwardPrice, spec.strike, T, RISK_FREE_RATE, mid, spec.isCall);
    if (Math.abs(bs.price - marketPrice) < 1e-6) return mid;
    if (bs.price < marketPrice) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Generate an option chain around the current forward price. */
export function generateOptionChain(
  underlying: string,
  forwardPrice: number,
  baseVol: number,
  expiryDays: number,
  strikeCount = 11,
  strikeSpacing?: number,
): { calls: OptionQuote[]; puts: OptionQuote[] } {
  // Default strike spacing: ~0.5% of forward for index futures
  const spacing = strikeSpacing ?? forwardPrice * 0.005;
  const half = Math.floor(strikeCount / 2);
  const atmStrike = Math.round(forwardPrice / spacing) * spacing;
  const calls: OptionQuote[] = [];
  const puts: OptionQuote[] = [];
  for (let i = -half; i <= half; i++) {
    const strike = atmStrike + i * spacing;
    // Volatility smile: OTM calls/puts have slightly higher IV (typical equity index smile)
    const moneyness = (strike - forwardPrice) / forwardPrice;
    const smileAdjust = 0.02 * moneyness * moneyness; // 2% extra vol per 100% moneyness²
    const skewAdjust = -0.01 * moneyness; // slight put skew
    const iv = Math.max(0.05, baseVol + smileAdjust + skewAdjust);
    calls.push(priceOption({ underlying, strike, expiryDays, isCall: true }, forwardPrice, iv));
    puts.push(priceOption({ underlying, strike, expiryDays, isCall: false }, forwardPrice, iv));
  }
  return { calls, puts };
}

// ============================================================
// Multi-leg option strategies
// ============================================================

export interface OptionLeg {
  spec: OptionSpec;
  qty: number; // positive = long, negative = short
  quote: OptionQuote;
}

export interface OptionStrategyDef {
  id: string;
  name: string;
  category: "VOLATILITY" | "DIRECTIONAL" | "INCOME" | "HEDGE" | "ARBITRAGE";
  description: string;
  // Builder function takes (underlying, forwardPrice, baseVol, expiryDays) and returns legs
  build: (underlying: string, forwardPrice: number, baseVol: number, expiryDays: number) => OptionLeg[];
}

export const OPTION_STRATEGIES: OptionStrategyDef[] = [
  {
    id: "long-straddle",
    name: "Long Straddle",
    category: "VOLATILITY",
    description: "Long ATM call + long ATM put. Profits from large moves in either direction. Long volatility, delta-neutral.",
    build: (u, F, vol, T) => {
      const atm = Math.round(F);
      const call = priceOption({ underlying: u, strike: atm, expiryDays: T, isCall: true }, F, vol);
      const put = priceOption({ underlying: u, strike: atm, expiryDays: T, isCall: false }, F, vol);
      return [
        { spec: call, qty: 1, quote: call },
        { spec: put, qty: 1, quote: put },
      ];
    },
  },
  {
    id: "long-strangle",
    name: "Long Strangle",
    category: "VOLATILITY",
    description: "Long OTM call + long OTM put. Cheaper than straddle, needs bigger move to profit. Long vol.",
    build: (u, F, vol, T) => {
      const spacing = F * 0.025;
      const call = priceOption({ underlying: u, strike: Math.round(F + spacing), expiryDays: T, isCall: true }, F, vol);
      const put = priceOption({ underlying: u, strike: Math.round(F - spacing), expiryDays: T, isCall: false }, F, vol);
      return [
        { spec: call, qty: 1, quote: call },
        { spec: put, qty: 1, quote: put },
      ];
    },
  },
  {
    id: "iron-condor",
    name: "Iron Condor",
    category: "INCOME",
    description: "Sell OTM call spread + sell OTM put spread. Profits if price stays range-bound. Short vol, defined risk.",
    build: (u, F, vol, T) => {
      const w = F * 0.02;
      const cw = F * 0.04;
      const pw = F * 0.04;
      const c1 = priceOption({ underlying: u, strike: Math.round(F + w), expiryDays: T, isCall: true }, F, vol);
      const c2 = priceOption({ underlying: u, strike: Math.round(F + cw), expiryDays: T, isCall: true }, F, vol);
      const p1 = priceOption({ underlying: u, strike: Math.round(F - w), expiryDays: T, isCall: false }, F, vol);
      const p2 = priceOption({ underlying: u, strike: Math.round(F - pw), expiryDays: T, isCall: false }, F, vol);
      return [
        { spec: c1, qty: -1, quote: c1 }, // short
        { spec: c2, qty: 1, quote: c2 }, // long
        { spec: p1, qty: -1, quote: p1 }, // short
        { spec: p2, qty: 1, quote: p2 }, // long
      ];
    },
  },
  {
    id: "butterfly",
    name: "Long Butterfly (Call)",
    category: "VOLATILITY",
    description: "Long 1 ITM/ATM call, short 2 ATM calls, long 1 OTM call. Max profit if expires at middle strike. Short vol.",
    build: (u, F, vol, T) => {
      const w = F * 0.025;
      const c1 = priceOption({ underlying: u, strike: Math.round(F - w), expiryDays: T, isCall: true }, F, vol);
      const c2 = priceOption({ underlying: u, strike: Math.round(F), expiryDays: T, isCall: true }, F, vol);
      const c3 = priceOption({ underlying: u, strike: Math.round(F + w), expiryDays: T, isCall: true }, F, vol);
      return [
        { spec: c1, qty: 1, quote: c1 },
        { spec: c2, qty: -2, quote: c2 },
        { spec: c3, qty: 1, quote: c3 },
      ];
    },
  },
  {
    id: "covered-call",
    name: "Covered Call",
    category: "INCOME",
    description: "Long futures + short OTM call. Generates income, caps upside. Delta-positive, vol-negative.",
    build: (u, F, vol, T) => {
      const w = F * 0.025;
      const call = priceOption({ underlying: u, strike: Math.round(F + w), expiryDays: T, isCall: true }, F, vol);
      // Note: the futures leg is conceptual here; only the option shows up
      return [
        { spec: call, qty: -1, quote: call },
      ];
    },
  },
  {
    id: "protective-put",
    name: "Protective Put",
    category: "HEDGE",
    description: "Long futures + long OTM put. Insurance against downside. Delta-positive, vol-positive.",
    build: (u, F, vol, T) => {
      const w = F * 0.025;
      const put = priceOption({ underlying: u, strike: Math.round(F - w), expiryDays: T, isCall: false }, F, vol);
      return [{ spec: put, qty: 1, quote: put }];
    },
  },
  {
    id: "risk-reversal",
    name: "Risk Reversal",
    category: "DIRECTIONAL",
    description: "Long OTM call + short OTM put. Bullish, finance call with put premium. Vol near-neutral.",
    build: (u, F, vol, T) => {
      const w = F * 0.025;
      const call = priceOption({ underlying: u, strike: Math.round(F + w), expiryDays: T, isCall: true }, F, vol);
      const put = priceOption({ underlying: u, strike: Math.round(F - w), expiryDays: T, isCall: false }, F, vol);
      return [
        { spec: call, qty: 1, quote: call },
        { spec: put, qty: -1, quote: put },
      ];
    },
  },
  {
    id: "call-spread",
    name: "Bull Call Spread",
    category: "DIRECTIONAL",
    description: "Long lower-strike call + short higher-strike call. Bullish with defined risk and capped reward.",
    build: (u, F, vol, T) => {
      const w = F * 0.015;
      const c1 = priceOption({ underlying: u, strike: Math.round(F), expiryDays: T, isCall: true }, F, vol);
      const c2 = priceOption({ underlying: u, strike: Math.round(F + 2 * w), expiryDays: T, isCall: true }, F, vol);
      return [
        { spec: c1, qty: 1, quote: c1 },
        { spec: c2, qty: -1, quote: c2 },
      ];
    },
  },
];

/** Aggregate Greeks for a multi-leg strategy. */
export function aggregateGreeks(legs: OptionLeg[]): {
  netPrice: number;
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  netRho: number;
  maxLoss: number;
  maxGain: number;
  breakevenLow: number;
  breakevenHigh: number;
} {
  let netPrice = 0;
  let netDelta = 0;
  let netGamma = 0;
  let netTheta = 0;
  let netVega = 0;
  let netRho = 0;
  for (const leg of legs) {
    const sign = leg.qty >= 0 ? 1 : -1;
    netPrice += leg.qty * leg.quote.price;
    netDelta += leg.qty * leg.quote.delta;
    netGamma += leg.qty * leg.quote.gamma;
    netTheta += leg.qty * leg.quote.theta;
    netVega += leg.qty * leg.quote.vega;
    netRho += leg.qty * leg.quote.rho;
  }
  // Max loss / gain and breakevens: approximate by scanning price at expiry
  // Payoff at expiry = sum(qty * max(0, sign * (S - K))) - netPrice
  const strikes = legs.map((l) => l.spec.strike).sort((a, b) => a - b);
  const minS = strikes[0] * 0.8;
  const maxS = strikes[strikes.length - 1] * 1.2;
  let maxLoss = Infinity;
  let maxGain = -Infinity;
  let beLow = NaN;
  let beHigh = NaN;
  let prev = NaN;
  let prevPayoff = NaN;
  for (let i = 0; i <= 200; i++) {
    const S = minS + (maxS - minS) * (i / 200);
    let payoff = -netPrice; // we paid netPrice (could be negative if credit)
    for (const leg of legs) {
      const intrinsic = leg.spec.isCall ? Math.max(0, S - leg.spec.strike) : Math.max(0, leg.spec.strike - S);
      payoff += leg.qty * intrinsic;
    }
    if (payoff < maxLoss) maxLoss = payoff;
    if (payoff > maxGain) maxGain = payoff;
    // Detect zero crossings
    if (!isNaN(prevPayoff) && !isNaN(prev)) {
      if (prevPayoff < 0 && payoff >= 0 && isNaN(beLow)) beLow = S;
      if (prevPayoff > 0 && payoff <= 0 && isNaN(beHigh)) beHigh = S;
    }
    prev = S;
    prevPayoff = payoff;
  }
  return {
    netPrice,
    netDelta,
    netGamma,
    netTheta,
    netVega,
    netRho,
    maxLoss: isFinite(maxLoss) ? maxLoss : 0,
    maxGain: isFinite(maxGain) ? maxGain : 0,
    breakevenLow: beLow,
    breakevenHigh: beHigh,
  };
}

/** Build a volatility surface grid (expiry × moneyness). */
export function volSurface(
  underlying: string,
  forwardPrice: number,
  baseVol: number,
  expiries: number[],
  moneyness: number[],
): { expiry: number; moneyness: number; iv: number }[] {
  const out: { expiry: number; moneyness: number; iv: number }[] = [];
  for (const T of expiries) {
    for (const m of moneyness) {
      // Term structure: short-dated OTM has higher smile curvature
      const smileWeight = Math.exp(-T / 90) * 0.04;
      const skew = -0.015 * m;
      const smile = smileWeight * m * m;
      const iv = Math.max(0.05, baseVol + skew + smile);
      out.push({ expiry: T, moneyness: m, iv });
    }
  }
  return out;
}
