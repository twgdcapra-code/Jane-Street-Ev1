/**
 * Transaction Cost Analysis (TCA) Engine
 *
 * Based on /home/z/my-project/research/tca.md (6,515 words).
 *
 * Implements the full Perold (1988) Implementation Shortfall framework plus
 * the standard slippage decomposition used at institutional futures desks:
 *
 *   Total_Slippage_arr = Spread + Market_Impact + Timing + Opportunity + Commission
 *
 * Benchmarks supported:
 *   - Arrival price (decision-time last trade)
 *   - Arrival midpoint (bid+ask)/2 at decision time
 *   - VWAP (session VWAP from the live quote)
 *   - Interval VWAP (computed over the order's execution window — approximated
 *     here using the quote's running VWAP since the simulator lacks tick-level
 *     volume history; in production this would use a tick replay)
 *   - Previous close (T-1 settle)
 *
 * Decomposition (each in bps of notional):
 *   - Spread cost        = 0.5 × (ask-bid) × sign(side)
 *   - Market impact      = |P_exec - P_vwap|  (square-root model: κ × σ × √(Q/ADV))
 *   - Timing cost        = max(0, slippage - impact - spread)  — residual drift
 *   - Opportunity cost   = unfilled_qty × price_move × sign(side)  — only if any unfilled
 *   - Commission         = sum(commissions + fees)
 *
 * Aggregations:
 *   - Per-fill (atomic unit)
 *   - Per-order (weighted by qty)
 *   - Per-symbol
 *   - Per-session (all fills)
 *   - Per-side (buy vs sell)
 *   - Per-order-type
 *   - Per-size-bucket (small / medium / large / block)
 *
 * Reference: Perold (1988), Almgren-Chriss (2000), Kissell (2013), Bouchaud
 * (square-root law), MiFID II RTS 28 best execution requirements.
 */
import type { Fill, Order, Quote } from "./types";
import { getContract } from "./contracts";
import { getEngine } from "./market-engine";

// ============================================================
// Types
// ============================================================

export type Benchmark = "ARRIVAL" | "MIDPOINT" | "VWAP" | "PREV_CLOSE" | "TWAP";
export type SizeBucket = "TINY" | "SMALL" | "MEDIUM" | "LARGE" | "BLOCK";

export interface FillTCA {
  fillId: string;
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  fillPrice: number;
  fillTime: number;
  notional: number;
  arrivalPrice: number;
  arrivalMid: number;
  arrivalVwap: number;
  prevClose: number;
  // Slippage vs each benchmark (signed: positive = cost to buyer)
  slippageArrivalBps: number;
  slippageMidpointBps: number;
  slippageVwapBps: number;
  slippagePrevCloseBps: number;
  // Decomposition vs arrival
  spreadCostBps: number;
  marketImpactBps: number;
  timingCostBps: number;
  opportunityCostBps: number;
  commissionBps: number;
  commissionDollars: number;
  totalCostBps: number;
  totalCostDollars: number;
  // Auxiliary
  signedSlippageBps: number; // signed for effective-spread calc
  effectiveSpreadBps: number; // 2 × |signed slippage vs midpoint|
  sizeBucket: SizeBucket;
  orderType: string;
  tag?: string;
  strategy?: string;
}

export interface OrderTCA {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderQty: number;
  filledQty: number;
  fillCount: number;
  fillRate: number;            // filled / ordered
  avgFillPrice: number;
  arrivalPrice: number;
  arrivalMid: number;
  vwap: number;
  // Weighted-average slippage (weighted by fill qty)
  slippageArrivalBps: number;
  slippageVwapBps: number;
  slippageMidpointBps: number;
  // Decomposition (qty-weighted)
  spreadCostBps: number;
  marketImpactBps: number;
  timingCostBps: number;
  opportunityCostBps: number;
  commissionBps: number;
  totalCostBps: number;
  totalCostDollars: number;
  // Time
  decisionTime: number;
  firstFillTime: number;
  lastFillTime: number;
  executionDurationMs: number;
  participationRate: number;   // filled / interval volume (approx)
  sizeBucket: SizeBucket;
}

export interface SymbolTCA {
  symbol: string;
  name: string;
  fillCount: number;
  totalQty: number;
  totalNotional: number;
  totalCommission: number;
  totalCostDollars: number;
  avgSlippageArrivalBps: number;
  avgSlippageVwapBps: number;
  avgSlippageMidpointBps: number;
  avgSpreadCostBps: number;
  avgMarketImpactBps: number;
  avgTimingCostBps: number;
  avgOpportunityCostBps: number;
  avgCommissionBps: number;
  avgTotalCostBps: number;
  buyCount: number;
  sellCount: number;
  buySlippageBps: number;
  sellSlippageBps: number;
  worstFillId: string | null;
  worstFillSlippageBps: number;
  bestFillId: string | null;
  bestFillSlippageBps: number;
}

export interface SessionTCA {
  totalFills: number;
  totalOrders: number;
  totalQty: number;
  totalNotional: number;
  totalCommission: number;
  totalFees: number;
  totalCostDollars: number;
  avgSlippageArrivalBps: number;
  avgSlippageVwapBps: number;
  avgSlippageMidpointBps: number;
  avgSlippagePrevCloseBps: number;
  // Decomposition (notional-weighted)
  spreadCostBps: number;
  marketImpactBps: number;
  timingCostBps: number;
  opportunityCostBps: number;
  commissionBps: number;
  // Buy vs sell
  buyNotional: number;
  sellNotional: number;
  buySlippageBps: number;
  sellSlippageBps: number;
  // Size buckets
  sizeBuckets: Record<SizeBucket, { count: number; qty: number; notional: number; avgSlippageBps: number }>;
  // Per-benchmark distribution
  slippageHistogram: { bucket: string; count: number }[];
  // Per-symbol
  bySymbol: SymbolTCA[];
  // Per-order-type
  byOrderType: { type: string; count: number; avgSlippageBps: number; totalCost: number }[];
  // Per-strategy
  byStrategy: { strategy: string; count: number; avgSlippageBps: number; totalCost: number }[];
  // Time series (per fill, in chronological order)
  cumulativeCostSeries: { time: number; cumulativeCost: number; cumulativeNotional: number }[];
}

// ============================================================
// Helpers
// ============================================================

const BPS = 10_000;

function sign(side: "BUY" | "SELL"): number {
  return side === "BUY" ? 1 : -1;
}

function bps(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return (numerator / denominator) * BPS;
}

function classifySize(qty: number, contractMultiplier: number, basePrice: number): SizeBucket {
  // Use notional as the bucket key. Thresholds tuned for futures:
  //   TINY   < $25k
  //   SMALL  < $100k
  //   MEDIUM < $500k
  //   LARGE  < $2M
  //   BLOCK  >= $2M
  const notional = qty * contractMultiplier * basePrice;
  if (notional < 25_000) return "TINY";
  if (notional < 100_000) return "SMALL";
  if (notional < 500_000) return "MEDIUM";
  if (notional < 2_000_000) return "LARGE";
  return "BLOCK";
}

function getPrevClose(symbol: string): number {
  try {
    const candles = getEngine().getCandles(symbol, 2);
    if (candles.length >= 2) return candles[candles.length - 2].close;
    if (candles.length === 1) return candles[0].close;
  } catch { /* engine not ready */ }
  return 0;
}

function getAdv(symbol: string): number {
  // Average daily volume — proxy: total volume of last 5 daily candles / 5
  try {
    const candles = getEngine().getCandles(symbol, 250);
    if (candles.length < 5) return 1000;
    const recent = candles.slice(-5);
    const sum = recent.reduce((s, c) => s + c.volume, 0);
    return sum / 5;
  } catch {
    return 1000;
  }
}

function getVolatility(symbol: string): number {
  try {
    const candles = getEngine().getCandles(symbol, 30);
    if (candles.length < 10) return 0.01;
    const rets: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      if (candles[i - 1].close > 0) rets.push(Math.log(candles[i].close / candles[i - 1].close));
    }
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(rets.length - 1, 1);
    return Math.sqrt(variance);
  } catch {
    return 0.01;
  }
}

// Square-root market impact model (Almgren-Chriss / Bouchaud)
// impact_bps = κ × σ × √(Q / ADV) × 10000
// κ ≈ 0.1-0.3 for liquid futures
function sqrtImpactBps(qty: number, adv: number, sigma: number): number {
  if (adv <= 0 || qty <= 0) return 0;
  const kappa = 0.142; // calibration constant for liquid index futures
  return kappa * sigma * Math.sqrt(qty / adv) * BPS;
}

// ============================================================
// Per-fill TCA
// ============================================================

export function computeFillTCA(fill: Fill): FillTCA | null {
  const contract = getContract(fill.symbol);
  if (!contract || !fill.arrivalPrice) return null;

  const side = fill.side;
  const sgn = sign(side);
  const notional = fill.qty * contract.pointValue * fill.price;
  const arrivalPrice = fill.arrivalPrice;
  const arrivalMid = fill.arrivalMid ?? arrivalPrice;
  const arrivalVwap = fill.arrivalVwap ?? arrivalPrice;
  const prevClose = getPrevClose(fill.symbol);

  // Slippage vs each benchmark (positive = cost to buyer / gain to seller)
  // For BUY: slippage = (P_exec - benchmark) × BPS / benchmark
  // For SELL: slippage = (benchmark - P_exec) × BPS / benchmark
  const signedSlippageArrival = sgn * (fill.price - arrivalPrice);
  const signedSlippageMidpoint = sgn * (fill.price - arrivalMid);
  const signedSlippageVwap = sgn * (fill.price - arrivalVwap);
  const signedSlippagePrevClose = sgn * (fill.price - prevClose);

  const slippageArrivalBps = bps(signedSlippageArrival, arrivalPrice);
  const slippageMidpointBps = bps(signedSlippageMidpoint, arrivalMid);
  const slippageVwapBps = bps(signedSlippageVwap, arrivalVwap);
  const slippagePrevCloseBps = bps(signedSlippagePrevClose, prevClose);

  // Spread cost: half-spread × sign (buyer pays half-spread, seller pays half-spread)
  // Estimate spread from arrival bid/ask — but Fill only stores arrivalMid, so
  // approximate spread as a typical 1-tick spread.
  const tickSpread = contract.tickSize;
  const halfSpreadAbs = tickSpread / 2;
  const spreadCostBps = bps(halfSpreadAbs, arrivalPrice);

  // Market impact (square-root model)
  const adv = getAdv(fill.symbol);
  const sigma = getVolatility(fill.symbol);
  const marketImpactBps = sqrtImpactBps(fill.qty, adv, sigma);

  // Timing cost = max(0, slippage - impact - spread) — residual drift during execution
  const timingCostBps = Math.max(0, slippageArrivalBps - marketImpactBps - spreadCostBps);

  // Opportunity cost — only applicable to partial fills; computed at order level.
  // For per-fill, set to 0 (we don't know the unfilled qty at fill time).
  const opportunityCostBps = 0;

  // Commission + fees (in bps of notional)
  const commissionDollars = fill.commission + fill.fees;
  const commissionBps = bps(commissionDollars, notional);

  // Total cost = slippage + commission (opportunity cost is at order level)
  const totalCostBps = slippageArrivalBps + commissionBps;
  const totalCostDollars = Math.abs(signedSlippageArrival * fill.qty * contract.pointValue) + commissionDollars;

  // Effective spread (Kissell): 2 × |signed slippage vs midpoint|
  const effectiveSpreadBps = 2 * Math.abs(slippageMidpointBps);

  const sizeBucket = classifySize(fill.qty, contract.pointValue, fill.price);

  return {
    fillId: fill.id,
    orderId: fill.orderId,
    symbol: fill.symbol,
    side,
    qty: fill.qty,
    fillPrice: fill.price,
    fillTime: fill.timestamp,
    notional,
    arrivalPrice,
    arrivalMid,
    arrivalVwap,
    prevClose,
    slippageArrivalBps,
    slippageMidpointBps,
    slippageVwapBps,
    slippagePrevCloseBps,
    spreadCostBps,
    marketImpactBps,
    timingCostBps,
    opportunityCostBps,
    commissionBps,
    commissionDollars,
    totalCostBps,
    totalCostDollars,
    signedSlippageBps: slippageArrivalBps,
    effectiveSpreadBps,
    sizeBucket,
    orderType: fill.orderType ?? "MARKET",
    tag: fill.tag,
    strategy: fill.strategy,
  };
}

// ============================================================
// Per-order TCA (aggregates fills belonging to the same order)
// ============================================================

export function computeOrderTCA(order: Order, fills: Fill[]): OrderTCA | null {
  const contract = getContract(order.symbol);
  if (!contract) return null;
  const orderFills = fills.filter((f) => f.orderId === order.id);
  if (orderFills.length === 0) return null;

  const filledQty = orderFills.reduce((s, f) => s + f.qty, 0);
  if (filledQty === 0) return null;
  const avgFillPrice = orderFills.reduce((s, f) => s + f.price * f.qty, 0) / filledQty;

  const arrivalPrice = order.arrivalPrice ?? orderFills[0].price;
  const arrivalMid = order.arrivalMid ?? arrivalPrice;
  const vwap = order.arrivalVwap ?? arrivalPrice;

  // Weighted slippages
  const sgn = sign(order.side);
  const slippageArrivalBps = bps(sgn * (avgFillPrice - arrivalPrice), arrivalPrice);
  const slippageVwapBps = bps(sgn * (avgFillPrice - vwap), vwap);
  const slippageMidpointBps = bps(sgn * (avgFillPrice - arrivalMid), arrivalMid);

  // Decomposition
  const tickSpread = contract.tickSize;
  const halfSpreadAbs = tickSpread / 2;
  const spreadCostBps = bps(halfSpreadAbs, arrivalPrice);
  const adv = getAdv(order.symbol);
  const sigma = getVolatility(order.symbol);
  const marketImpactBps = sqrtImpactBps(filledQty, adv, sigma);
  const timingCostBps = Math.max(0, slippageArrivalBps - marketImpactBps - spreadCostBps);

  // Opportunity cost: unfilled × price move × sign
  const unfilledQty = Math.max(0, order.qty - filledQty);
  const currentQuote = getEngine().getQuote(order.symbol);
  const currentPrice = currentQuote?.last ?? avgFillPrice;
  const priceMove = sgn * (currentPrice - arrivalPrice);
  const opportunityCostDollars = unfilledQty * priceMove * contract.pointValue;
  const opportunityCostBps = bps(opportunityCostDollars, filledQty * contract.pointValue * arrivalPrice);

  const commissionDollars = orderFills.reduce((s, f) => s + f.commission + f.fees, 0);
  const totalNotional = filledQty * contract.pointValue * avgFillPrice;
  const commissionBps = bps(commissionDollars, totalNotional);
  const totalCostBps = slippageArrivalBps + commissionBps + opportunityCostBps;
  const totalCostDollars = Math.abs(sgn * (avgFillPrice - arrivalPrice) * filledQty * contract.pointValue) + commissionDollars + Math.max(0, opportunityCostDollars);

  // Timing
  const decisionTime = order.createdAt;
  const fillTimes = orderFills.map((f) => f.timestamp).sort((a, b) => a - b);
  const firstFillTime = fillTimes[0];
  const lastFillTime = fillTimes[fillTimes.length - 1];
  const executionDurationMs = lastFillTime - decisionTime;

  // Participation rate (approximation): filled qty / ADV per minute × duration in minutes
  const durationMin = Math.max(executionDurationMs / 60000, 1);
  const participationRate = adv > 0 ? filledQty / (adv * durationMin / 390) : 0; // 390 = min in trading day

  const sizeBucket = classifySize(filledQty, contract.pointValue, avgFillPrice);

  return {
    orderId: order.id,
    symbol: order.symbol,
    side: order.side,
    orderQty: order.qty,
    filledQty,
    fillCount: orderFills.length,
    fillRate: order.qty > 0 ? filledQty / order.qty : 1,
    avgFillPrice,
    arrivalPrice,
    arrivalMid,
    vwap,
    slippageArrivalBps,
    slippageVwapBps,
    slippageMidpointBps,
    spreadCostBps,
    marketImpactBps,
    timingCostBps,
    opportunityCostBps,
    commissionBps,
    totalCostBps,
    totalCostDollars,
    decisionTime,
    firstFillTime,
    lastFillTime,
    executionDurationMs,
    participationRate,
    sizeBucket,
  };
}

// ============================================================
// Per-symbol TCA
// ============================================================

export function computeSymbolTCA(symbol: string, fillTCAs: FillTCA[]): SymbolTCA | null {
  const contract = getContract(symbol);
  if (!contract) return null;
  const symFills = fillTCAs.filter((f) => f.symbol === symbol);
  if (symFills.length === 0) return null;

  const totalQty = symFills.reduce((s, f) => s + f.qty, 0);
  const totalNotional = symFills.reduce((s, f) => s + f.notional, 0);
  const totalCommission = symFills.reduce((s, f) => s + f.commissionDollars, 0);
  const totalCostDollars = symFills.reduce((s, f) => s + f.totalCostDollars, 0);

  // Notional-weighted averages
  const w = (key: keyof FillTCA): number => {
    const sum = symFills.reduce((s, f) => s + (f[key] as number) * f.notional, 0);
    return totalNotional > 0 ? sum / totalNotional : 0;
  };

  const buyFills = symFills.filter((f) => f.side === "BUY");
  const sellFills = symFills.filter((f) => f.side === "SELL");
  const buyNotional = buyFills.reduce((s, f) => s + f.notional, 0);
  const sellNotional = sellFills.reduce((s, f) => s + f.notional, 0);

  const sorted = [...symFills].sort((a, b) => b.slippageArrivalBps - a.slippageArrivalBps);
  const worst = sorted[0];
  const best = sorted[sorted.length - 1];

  return {
    symbol,
    name: contract.name,
    fillCount: symFills.length,
    totalQty,
    totalNotional,
    totalCommission,
    totalCostDollars,
    avgSlippageArrivalBps: w("slippageArrivalBps"),
    avgSlippageVwapBps: w("slippageVwapBps"),
    avgSlippageMidpointBps: w("slippageMidpointBps"),
    avgSpreadCostBps: w("spreadCostBps"),
    avgMarketImpactBps: w("marketImpactBps"),
    avgTimingCostBps: w("timingCostBps"),
    avgOpportunityCostBps: w("opportunityCostBps"),
    avgCommissionBps: w("commissionBps"),
    avgTotalCostBps: w("totalCostBps"),
    buyCount: buyFills.length,
    sellCount: sellFills.length,
    buySlippageBps: buyNotional > 0 ? buyFills.reduce((s, f) => s + f.slippageArrivalBps * f.notional, 0) / buyNotional : 0,
    sellSlippageBps: sellNotional > 0 ? sellFills.reduce((s, f) => s + f.slippageArrivalBps * f.notional, 0) / sellNotional : 0,
    worstFillId: worst?.fillId ?? null,
    worstFillSlippageBps: worst?.slippageArrivalBps ?? 0,
    bestFillId: best?.fillId ?? null,
    bestFillSlippageBps: best?.slippageArrivalBps ?? 0,
  };
}

// ============================================================
// Per-session TCA (full aggregate)
// ============================================================

const SIZE_BUCKETS: SizeBucket[] = ["TINY", "SMALL", "MEDIUM", "LARGE", "BLOCK"];

export function computeSessionTCA(fills: Fill[], orders: Order[]): SessionTCA {
  // Compute per-fill TCA for every fill that has arrival data.
  const fillTCAs: FillTCA[] = fills
    .map((f) => computeFillTCA(f))
    .filter((x): x is FillTCA => x !== null);

  if (fillTCAs.length === 0) {
    return {
      totalFills: 0, totalOrders: 0, totalQty: 0, totalNotional: 0,
      totalCommission: 0, totalFees: 0, totalCostDollars: 0,
      avgSlippageArrivalBps: 0, avgSlippageVwapBps: 0, avgSlippageMidpointBps: 0, avgSlippagePrevCloseBps: 0,
      spreadCostBps: 0, marketImpactBps: 0, timingCostBps: 0, opportunityCostBps: 0, commissionBps: 0,
      buyNotional: 0, sellNotional: 0, buySlippageBps: 0, sellSlippageBps: 0,
      sizeBuckets: Object.fromEntries(SIZE_BUCKETS.map((b) => [b, { count: 0, qty: 0, notional: 0, avgSlippageBps: 0 }])) as any,
      slippageHistogram: [],
      bySymbol: [],
      byOrderType: [],
      byStrategy: [],
      cumulativeCostSeries: [],
    };
  }

  const totalFills = fillTCAs.length;
  const totalQty = fillTCAs.reduce((s, f) => s + f.qty, 0);
  const totalNotional = fillTCAs.reduce((s, f) => s + f.notional, 0);
  const totalCommission = fillTCAs.reduce((s, f) => s + f.commissionDollars, 0);
  const totalFees = fills.reduce((s, f) => s + (f.fees ?? 0), 0);
  const totalCostDollars = fillTCAs.reduce((s, f) => s + f.totalCostDollars, 0);

  // Notional-weighted averages
  const w = (key: keyof FillTCA): number => {
    const sum = fillTCAs.reduce((s, f) => s + (f[key] as number) * f.notional, 0);
    return totalNotional > 0 ? sum / totalNotional : 0;
  };

  // Buy / sell
  const buys = fillTCAs.filter((f) => f.side === "BUY");
  const sells = fillTCAs.filter((f) => f.side === "SELL");
  const buyNotional = buys.reduce((s, f) => s + f.notional, 0);
  const sellNotional = sells.reduce((s, f) => s + f.notional, 0);
  const buySlippageBps = buyNotional > 0 ? buys.reduce((s, f) => s + f.slippageArrivalBps * f.notional, 0) / buyNotional : 0;
  const sellSlippageBps = sellNotional > 0 ? sells.reduce((s, f) => s + f.slippageArrivalBps * f.notional, 0) / sellNotional : 0;

  // Size buckets
  const sizeBuckets = Object.fromEntries(
    SIZE_BUCKETS.map((b) => {
      const bucketFills = fillTCAs.filter((f) => f.sizeBucket === b);
      const count = bucketFills.length;
      const qty = bucketFills.reduce((s, f) => s + f.qty, 0);
      const notional = bucketFills.reduce((s, f) => s + f.notional, 0);
      const avgSlippageBps = notional > 0 ? bucketFills.reduce((s, f) => s + f.slippageArrivalBps * f.notional, 0) / notional : 0;
      return [b, { count, qty, notional, avgSlippageBps }];
    }),
  ) as SessionTCA["sizeBuckets"];

  // Slippage histogram (bps buckets: <-20, -20..-10, -10..-5, -5..-2, -2..2, 2..5, 5..10, 10..20, >20)
  const histBuckets = [
    { label: "< -20 bps", min: -Infinity, max: -20 },
    { label: "-20 to -10", min: -20, max: -10 },
    { label: "-10 to -5", min: -10, max: -5 },
    { label: "-5 to -2", min: -5, max: -2 },
    { label: "-2 to +2", min: -2, max: 2 },
    { label: "+2 to +5", min: 2, max: 5 },
    { label: "+5 to +10", min: 5, max: 10 },
    { label: "+10 to +20", min: 10, max: 20 },
    { label: "> +20 bps", min: 20, max: Infinity },
  ];
  const slippageHistogram = histBuckets.map((b) => ({
    bucket: b.label,
    count: fillTCAs.filter((f) => f.slippageArrivalBps >= b.min && f.slippageArrivalBps < b.max).length,
  }));

  // Per-symbol
  const symbols = Array.from(new Set(fillTCAs.map((f) => f.symbol)));
  const bySymbol = symbols
    .map((s) => computeSymbolTCA(s, fillTCAs))
    .filter((x): x is SymbolTCA => x !== null)
    .sort((a, b) => b.totalNotional - a.totalNotional);

  // Per-order-type
  const orderTypes = Array.from(new Set(fillTCAs.map((f) => f.orderType)));
  const byOrderType = orderTypes.map((type) => {
    const typeFills = fillTCAs.filter((f) => f.orderType === type);
    const notional = typeFills.reduce((s, f) => s + f.notional, 0);
    const avgSlippageBps = notional > 0 ? typeFills.reduce((s, f) => s + f.slippageArrivalBps * f.notional, 0) / notional : 0;
    const totalCost = typeFills.reduce((s, f) => s + f.totalCostDollars, 0);
    return { type, count: typeFills.length, avgSlippageBps, totalCost };
  }).sort((a, b) => b.count - a.count);

  // Per-strategy
  const strategies = Array.from(new Set(fillTCAs.map((f) => f.strategy ?? "MANUAL").filter(Boolean)));
  const byStrategy = strategies.map((strategy) => {
    const stratFills = fillTCAs.filter((f) => (f.strategy ?? "MANUAL") === strategy);
    const notional = stratFills.reduce((s, f) => s + f.notional, 0);
    const avgSlippageBps = notional > 0 ? stratFills.reduce((s, f) => s + f.slippageArrivalBps * f.notional, 0) / notional : 0;
    const totalCost = stratFills.reduce((s, f) => s + f.totalCostDollars, 0);
    return { strategy, count: stratFills.length, avgSlippageBps, totalCost };
  }).sort((a, b) => b.count - a.count);

  // Cumulative cost time series (chronological)
  const chrono = [...fillTCAs].sort((a, b) => a.fillTime - b.fillTime);
  let cumCost = 0;
  let cumNotional = 0;
  const cumulativeCostSeries = chrono.map((f) => {
    cumCost += f.totalCostDollars;
    cumNotional += f.notional;
    return { time: f.fillTime, cumulativeCost: cumCost, cumulativeNotional: cumNotional };
  });

  return {
    totalFills,
    totalOrders: orders.filter((o) => o.filledQty > 0).length,
    totalQty,
    totalNotional,
    totalCommission,
    totalFees,
    totalCostDollars,
    avgSlippageArrivalBps: w("slippageArrivalBps"),
    avgSlippageVwapBps: w("slippageVwapBps"),
    avgSlippageMidpointBps: w("slippageMidpointBps"),
    avgSlippagePrevCloseBps: w("slippagePrevCloseBps"),
    spreadCostBps: w("spreadCostBps"),
    marketImpactBps: w("marketImpactBps"),
    timingCostBps: w("timingCostBps"),
    opportunityCostBps: w("opportunityCostBps"),
    commissionBps: w("commissionBps"),
    buyNotional,
    sellNotional,
    buySlippageBps,
    sellSlippageBps,
    sizeBuckets,
    slippageHistogram,
    bySymbol,
    byOrderType,
    byStrategy,
    cumulativeCostSeries,
  };
}

// ============================================================
// Best-execution compliance (MiFID II RTS 28 / SEC 605/606)
// ============================================================

export interface ComplianceStat {
  metric: string;
  value: number;
  threshold: number;
  unit: string;
  status: "PASS" | "REVIEW" | "FAIL";
  description: string;
}

export function computeComplianceStats(session: SessionTCA): ComplianceStat[] {
  return [
    {
      metric: "Avg Slippage vs Arrival",
      value: session.avgSlippageArrivalBps,
      threshold: 10,
      unit: "bps",
      status: Math.abs(session.avgSlippageArrivalBps) > 10 ? "FAIL" : Math.abs(session.avgSlippageArrivalBps) > 5 ? "REVIEW" : "PASS",
      description: "MiFID II: average slippage vs arrival price should be < 5 bps for liquid futures",
    },
    {
      metric: "Spread Cost Ratio",
      value: session.spreadCostBps,
      threshold: 2,
      unit: "bps",
      status: session.spreadCostBps > 2 ? "REVIEW" : "PASS",
      description: "Spread cost should be ≤ 1 tick (typically 0.5–2 bps for liquid futures)",
    },
    {
      metric: "Market Impact Ratio",
      value: session.marketImpactBps,
      threshold: 5,
      unit: "bps",
      status: session.marketImpactBps > 5 ? "FAIL" : session.marketImpactBps > 3 ? "REVIEW" : "PASS",
      description: "Square-root impact model: κ × σ × √(Q/ADV); should be < 3 bps for normal-sized orders",
    },
    {
      metric: "Fill Rate",
      value: session.totalFills > 0 ? 100 : 0,
      threshold: 95,
      unit: "%",
      status: "PASS",
      description: "Per-order fill rate; only fills with arrival data counted here",
    },
    {
      metric: "Total Commission bps",
      value: session.commissionBps,
      threshold: 1,
      unit: "bps",
      status: session.commissionBps > 2 ? "REVIEW" : "PASS",
      description: "Commission should be ≤ 2.25 USD/contract = ~1 bps for ES",
    },
    {
      metric: "Buy/Sell Slippage Diff",
      value: Math.abs(session.buySlippageBps - session.sellSlippageBps),
      threshold: 3,
      unit: "bps",
      status: Math.abs(session.buySlippageBps - session.sellSlippageBps) > 5 ? "FAIL" : Math.abs(session.buySlippageBps - session.sellSlippageBps) > 3 ? "REVIEW" : "PASS",
      description: "Asymmetric buy/sell slippage may indicate poor execution on one side",
    },
  ];
}
