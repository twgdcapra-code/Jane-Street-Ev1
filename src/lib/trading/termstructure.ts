/**
 * Futures Term Structure Engine
 *
 * Simulates a multi-month futures curve for each underlying. Real CME futures
 * have quarterly contracts (H/M/U/Z) plus weekly options, but for visualization
 * we model the curve at fixed offsets: front, +1M, +2M, +3M, +6M, +9M, +12M.
 *
 * Curve shape tells you market expectations:
 *  - Contango: back months > front (cost of carry, normal for storable commodities)
 *  - Backwardation: front > back (scarcity, normal for tight physical markets)
 *  - Humped: mid-curve premium (supply squeeze expectations)
 *
 * We compute curve slope, annualized roll yield, and detect regime.
 */
import { CONTRACTS, getContract } from "./contracts";

export interface CurvePoint {
  monthOffset: number; // 0 = front, 1 = +1M, etc.
  label: string; // "Front", "+1M", "+2M", etc.
  price: number;
  volume: number;
  openInterest: number;
  // Annualized roll yield (positive = backwardation, you earn rolling short)
  rollYield: number;
}

export interface CurveSnapshot {
  symbol: string;
  name: string;
  assetClass: string;
  spotPrice: number; // front month
  points: CurvePoint[];
  // Curve analytics
  slope: number; // (12M - Front) / Front, as percentage
  annualRollYield: number; // % per year from rolling short
  contango: boolean; // true if back > front
  backwardation: boolean;
  regime: "CONTANGO" | "BACKWARDATION" | "FLAT" | "HUMPED";
  // Front-back spread (most liquid calendar)
  frontBackSpread: number;
  frontBackSpreadPct: number;
  // Max/min point on curve
  maxPrice: number;
  minPrice: number;
  maxLabel: string;
  minLabel: string;
}

const MONTH_OFFSETS = [0, 1, 2, 3, 6, 9, 12];
const MONTH_LABELS = ["Front", "+1M", "+2M", "+3M", "+6M", "+9M", "+12M"];

/** Generate a realistic curve for the given underlying. */
export function buildCurve(symbol: string, spotPrice?: number): CurveSnapshot {
  const contract = getContract(symbol);
  const front = spotPrice ?? contract.basePrice;
  // Each asset class has a typical curve shape parameterized by cost-of-carry
  // and convenience yield. We use a simple model:
  //   F(T) = S * exp((r - q + c) * T)
  // where r = risk-free, q = convenience yield, c = storage cost
  let carryRate: number; // r - q + c, annualized
  let noiseLevel: number;
  switch (contract.assetClass) {
    case "equity_index":
      carryRate = 0.045 - 0.015; // r - dividend yield ≈ 3%
      noiseLevel = 0.001;
      break;
    case "rate":
      carryRate = 0.005; // very low carry
      noiseLevel = 0.0005;
      break;
    case "metal":
      carryRate = 0.045 + 0.005; // r + storage
      noiseLevel = 0.002;
      break;
    case "energy":
      // Energy curves can flip — simulate backwardation with negative carry
      carryRate = -0.08 + (Math.random() - 0.5) * 0.15;
      noiseLevel = 0.005;
      break;
    case "agri":
      carryRate = 0.045 + 0.02;
      noiseLevel = 0.003;
      break;
    case "fx":
      carryRate = 0.02 - 0.025; // rate differential
      noiseLevel = 0.0008;
      break;
    case "crypto":
      carryRate = 0.045 + 0.0; // no storage but high funding
      noiseLevel = 0.01;
      break;
    default:
      carryRate = 0.03;
      noiseLevel = 0.002;
  }
  const points: CurvePoint[] = MONTH_OFFSETS.map((months, i) => {
    const T = months / 12;
    // Add some deterministic noise per month offset (seeded by symbol)
    const seed = symbol.charCodeAt(0) + i * 17;
    const noise = (Math.sin(seed) * 0.5 + Math.sin(seed * 1.7) * 0.3) * noiseLevel;
    const price = front * Math.exp((carryRate + noise) * T);
    const rollYield = -carryRate * 100; // annualized % (negative carry = backwardation = positive roll yield)
    // Volume and OI decay with maturity
    const volDecay = Math.exp(-i * 0.3);
    return {
      monthOffset: months,
      label: MONTH_LABELS[i],
      price,
      volume: Math.floor(50000 * volDecay * (0.5 + Math.random() * 0.5)),
      openInterest: Math.floor(200000 * volDecay * (0.6 + Math.random() * 0.4)),
      rollYield,
    };
  });
  const front12 = points[0].price;
  const back12 = points[points.length - 1].price;
  const slope = ((back12 - front12) / front12) * 100;
  const annualRollYield = -slope; // if back > front (positive slope), rolling short loses money
  const contango = slope > 0.5;
  const backwardation = slope < -0.5;
  const flat = Math.abs(slope) <= 0.5;
  // Humped: mid-curve price > both ends
  const midMax = Math.max(...points.slice(1, -1).map((p) => p.price));
  const humped = midMax > front12 && midMax > back12 && !flat;
  let regime: CurveSnapshot["regime"];
  if (humped) regime = "HUMPED";
  else if (contango) regime = "CONTANGO";
  else if (backwardation) regime = "BACKWARDATION";
  else regime = "FLAT";
  const maxPoint = points.reduce((max, p) => (p.price > max.price ? p : max), points[0]);
  const minPoint = points.reduce((min, p) => (p.price < min.price ? p : min), points[0]);
  const frontBackSpread = back12 - front12;
  const frontBackSpreadPct = slope;
  return {
    symbol,
    name: contract.name,
    assetClass: contract.assetClass,
    spotPrice: front,
    points,
    slope,
    annualRollYield,
    contango,
    backwardation,
    regime,
    frontBackSpread,
    frontBackSpreadPct,
    maxPrice: maxPoint.price,
    minPrice: minPoint.price,
    maxLabel: maxPoint.label,
    minLabel: minPoint.label,
  };
}

/** Build curves for all tradable contracts. */
export function buildAllCurves(spotPrices?: Record<string, number>): CurveSnapshot[] {
  return CONTRACTS.map((c) => buildCurve(c.symbol, spotPrices?.[c.symbol] ?? c.basePrice));
}

/** Detect curve shifts over time (compare current vs previous snapshot). */
export interface CurveShift {
  symbol: string;
  prevSlope: number;
  currSlope: number;
  slopeChange: number;
  // Did regime change?
  regimeChange: boolean;
  prevRegime: CurveSnapshot["regime"];
  currRegime: CurveSnapshot["regime"];
}

export function detectCurveShifts(prev: CurveSnapshot[], curr: CurveSnapshot[]): CurveShift[] {
  const shifts: CurveShift[] = [];
  for (const c of curr) {
    const p = prev.find((x) => x.symbol === c.symbol);
    if (!p) continue;
    if (Math.abs(c.slope - p.slope) > 0.1 || c.regime !== p.regime) {
      shifts.push({
        symbol: c.symbol,
        prevSlope: p.slope,
        currSlope: c.slope,
        slopeChange: c.slope - p.slope,
        regimeChange: c.regime !== p.regime,
        prevRegime: p.regime,
        currRegime: c.regime,
      });
    }
  }
  return shifts;
}
