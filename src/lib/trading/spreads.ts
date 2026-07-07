/**
 * Spread Trading Engine
 *
 * Implements three spread families:
 *  - Calendar (intra-commodity): long front month, short back month of same underlying
 *  - Inter-commodity: long one product, short correlated one (e.g. ES vs NQ, CL vs HO)
 *  - Crack/crush/process: refining margin spreads (CL→HO+RB, soybeans→oil+meal)
 *
 * Spreads are priced as the difference (long leg price − short leg price), and
 * our simulator tracks a synthetic "spread quote" that updates whenever either
 * leg's quote updates.
 */
import { CONTRACTS, getContract, MICRO_TO_FULL } from "./contracts";
import type { Quote, Side } from "./types";

export interface SpreadLeg {
  symbol: string;
  side: Side; // BUY = long leg, SELL = short leg
  ratio: number; // multiplier for ratio spreads (e.g. crack spread 3:2:1)
}

export interface SpreadDef {
  id: string;
  name: string;
  type: "CALENDAR" | "INTER_COMMODITY" | "CRACK" | "CRUSH" | "BUTTERFLY" | "RATIO";
  description: string;
  legs: SpreadLeg[];
  // For calendar spreads: month codes per leg (front vs back)
  // For others: the underlying symbols are taken from legs
  category: string;
}

/** Pre-defined spread templates users can one-click load. */
export const SPREAD_TEMPLATES: SpreadDef[] = [
  {
    id: "cal-es",
    name: "ES Calendar (H/U)",
    type: "CALENDAR",
    description: "Long ES March, short ES September — calendar spread betting on near-term outperformance.",
    category: "Calendar",
    legs: [
      { symbol: "ES", side: "BUY", ratio: 1 },
      { symbol: "ES", side: "SELL", ratio: 1 },
    ],
  },
  {
    id: "cal-nq",
    name: "NQ Calendar (H/M)",
    type: "CALENDAR",
    description: "Long NQ March, short NQ June — capturing roll premium on the tech index.",
    category: "Calendar",
    legs: [
      { symbol: "NQ", side: "BUY", ratio: 1 },
      { symbol: "NQ", side: "SELL", ratio: 1 },
    ],
  },
  {
    id: "cal-cl",
    name: "WTI Calendar (F/G)",
    type: "CALENDAR",
    description: "Long Feb WTI, short Mar WTI — contango/backwardation bet.",
    category: "Calendar",
    legs: [
      { symbol: "CL", side: "BUY", ratio: 1 },
      { symbol: "CL", side: "SELL", ratio: 1 },
    ],
  },
  {
    id: "ic-es-nq",
    name: "ES vs NQ (Long ES / Short NQ)",
    type: "INTER_COMMODITY",
    description: "Long S&P 500, short Nasdaq-100 — pair trade on relative value (NQ has higher beta).",
    category: "Inter-Commodity",
    legs: [
      { symbol: "ES", side: "BUY", ratio: 1 },
      { symbol: "NQ", side: "SELL", ratio: 1 },
    ],
  },
  {
    id: "ic-nq-es",
    name: "NQ vs ES (Long NQ / Short ES)",
    type: "INTER_COMMODITY",
    description: "Inverse: long tech, short broader market — bets on tech leadership.",
    category: "Inter-Commodity",
    legs: [
      { symbol: "NQ", side: "BUY", ratio: 1 },
      { symbol: "ES", side: "SELL", ratio: 1 },
    ],
  },
  {
    id: "ic-es-rty",
    name: "ES vs RTY (Large vs Small Cap)",
    type: "INTER_COMMODITY",
    description: "Long S&P 500, short Russell 2000 — large-cap rotation trade.",
    category: "Inter-Commodity",
    legs: [
      { symbol: "ES", side: "BUY", ratio: 1 },
      { symbol: "RTY", side: "SELL", ratio: 1 },
    ],
  },
  {
    id: "ic-gc-si",
    name: "Gold vs Silver (Gold/Silver Ratio)",
    type: "INTER_COMMODITY",
    description: "Long Gold, short Silver — bets on the gold/silver ratio reverting.",
    category: "Inter-Commodity",
    legs: [
      { symbol: "GC", side: "BUY", ratio: 1 },
      { symbol: "SI", side: "SELL", ratio: 1 },
    ],
  },
  {
    id: "ic-zn-zb",
    name: "2s10s (ZN vs ZB)",
    type: "INTER_COMMODITY",
    description: "Short 10-yr, long 30-yr — curve steepener/flattener bet.",
    category: "Inter-Commodity",
    legs: [
      { symbol: "ZN", side: "SELL", ratio: 1 },
      { symbol: "ZB", side: "BUY", ratio: 1 },
    ],
  },
  {
    id: "ic-cl-ng",
    name: "Crude vs Natural Gas (BTU spread)",
    type: "INTER_COMMODITY",
    description: "Long WTI, short Nat Gas — energy source substitution bet.",
    category: "Inter-Commodity",
    legs: [
      { symbol: "CL", side: "BUY", ratio: 1 },
      { symbol: "NG", side: "SELL", ratio: 1 },
    ],
  },
  {
    id: "ic-mnq-nq",
    name: "Micro vs Full (MNQ vs NQ)",
    type: "INTER_COMMODITY",
    description: "Long 10 MNQ, short 1 NQ — equivalent notional, neutralizes delta.",
    category: "Micro Hedge",
    legs: [
      { symbol: "MNQ", side: "BUY", ratio: 10 },
      { symbol: "NQ", side: "SELL", ratio: 1 },
    ],
  },
  {
    id: "bf-es",
    name: "ES Butterfly (H/M/U)",
    type: "BUTTERFLY",
    description: "Long 1 ES H, short 2 ES M, long 1 ES U — bets on term-structure curvature.",
    category: "Butterfly",
    legs: [
      { symbol: "ES", side: "BUY", ratio: 1 },
      { symbol: "ES", side: "SELL", ratio: 2 },
      { symbol: "ES", side: "BUY", ratio: 1 },
    ],
  },
];

export interface SpreadQuote {
  def: SpreadDef;
  spreadPrice: number; // long leg price - short leg price (weighted by ratio)
  legQuotes: { leg: SpreadLeg; quote: Quote }[];
  // Theoretical margin: usually much lower than outright (typically 50-75% offset)
  spreadMargin: number;
  // Risk: notional equivalent
  notionalLong: number;
  notionalShort: number;
  netDelta: number; // in dollars per point of underlying
}

/** Compute live spread quote from individual leg quotes. */
export function computeSpreadQuote(def: SpreadDef, quotes: Record<string, Quote>): SpreadQuote | null {
  const legQuotes: { leg: SpreadLeg; quote: Quote }[] = [];
  for (const leg of def.legs) {
    const q = quotes[leg.symbol];
    if (!q) return null;
    legQuotes.push({ leg, quote: q });
  }
  // Spread price = sum of (side_sign * ratio * leg_price)
  let spreadPrice = 0;
  let notionalLong = 0;
  let notionalShort = 0;
  let netDelta = 0;
  let spreadMargin = 0;
  for (const { leg, quote } of legQuotes) {
    const contract = getContract(leg.symbol);
    const sign = leg.side === "BUY" ? 1 : -1;
    const px = leg.side === "BUY" ? quote.ask : quote.bid; // we pay ask to buy, receive bid to sell
    spreadPrice += sign * leg.ratio * px;
    if (sign > 0) notionalLong += leg.ratio * px * contract.pointValue;
    else notionalShort += leg.ratio * px * contract.pointValue;
    netDelta += sign * leg.ratio * contract.pointValue;
    spreadMargin += leg.ratio * contract.marginInitial;
  }
  // Spread margin gets ~50% offset between legs of same underlying
  const uniqueSymbols = new Set(def.legs.map((l) => l.symbol));
  if (uniqueSymbols.size < def.legs.length && def.type !== "INTER_COMMODITY") {
    spreadMargin *= 0.5;
  } else if (def.type === "INTER_COMMODITY") {
    spreadMargin *= 0.65; // 35% offset for correlated inter-commodity
  } else if (def.type === "BUTTERFLY") {
    spreadMargin *= 0.3; // 70% offset for flys
  }
  return { def, spreadPrice, legQuotes, spreadMargin, notionalLong, notionalShort, netDelta };
}

/** Generate a list of spread templates that include the given symbol. */
export function spreadsForSymbol(symbol: string): SpreadDef[] {
  return SPREAD_TEMPLATES.filter((s) => s.legs.some((l) => l.symbol === symbol));
}

/** Compute ratio for spreading two contracts based on point values. */
export function hedgeRatio(symbolA: string, symbolB: string): number {
  const a = getContract(symbolA);
  const b = getContract(symbolB);
  return b.pointValue / a.pointValue;
}

/**
 * Returns: list of [template, computed-quote] pairs for the spread table.
 */
export function buildAllSpreadQuotes(quotes: Record<string, Quote>): { def: SpreadDef; quote: SpreadQuote | null }[] {
  return SPREAD_TEMPLATES.map((def) => ({ def, quote: computeSpreadQuote(def, quotes) }));
}

/**
 * Build spread history (synthetic) by combining leg histories.
 */
export function buildSpreadHistory(
  def: SpreadDef,
  history: Record<string, { time: number; close: number }[]>,
  lookback = 100,
): { time: number; spreadPrice: number }[] {
  // Use the shortest common history
  const lengths = def.legs.map((l) => history[l.symbol]?.length ?? 0);
  const n = Math.min(...lengths, lookback);
  if (n === 0) return [];
  const out: { time: number; spreadPrice: number }[] = [];
  for (let i = 0; i < n; i++) {
    let price = 0;
    let time = 0;
    for (const leg of def.legs) {
      const h = history[leg.symbol];
      const idx = h.length - n + i;
      if (idx < 0 || !h[idx]) continue;
      const sign = leg.side === "BUY" ? 1 : -1;
      price += sign * leg.ratio * h[idx].close;
      time = h[idx].time;
    }
    out.push({ time, spreadPrice: price });
  }
  return out;
}
