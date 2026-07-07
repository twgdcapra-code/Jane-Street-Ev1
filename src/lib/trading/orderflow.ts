/**
 * Order Flow Engine
 *
 * Simulates a high-resolution trade tape and computes:
 *  - Buy vs Sell volume (delta) per price level
 *  - Volume profile (POC, value area high/low)
 *  - Cumulative delta (order flow imbalance)
 *  - Footprint-style bid/ask trade distribution
 *
 * Pure simulation — generates realistic trade prints from the order book
 * and quote activity.
 */
import { getContract } from "./contracts";
import { getEngine } from "./market-engine";
import type { Quote } from "./types";

export interface TradePrint {
  id: string;
  timestamp: number;
  price: number;
  size: number;
  aggressor: "BUY" | "SELL"; // market buy = buyer paid ask, market sell = seller hit bid
}

export interface PriceLevel {
  price: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  delta: number; // buy - sell
  tradeCount: number;
}

export interface OrderFlowSnapshot {
  symbol: string;
  trades: TradePrint[];
  priceLevels: PriceLevel[];
  pocPrice: number; // point of control (highest volume)
  vah: number; // value area high (70% of volume)
  val: number; // value area low
  cumulativeDelta: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  deltaPerMin: { time: number; delta: number }[];
  timestamp: number;
}

let tradeCounter = 0;
function nextTradeId(): string {
  return `print-${Date.now().toString(36)}-${tradeCounter++}`;
}

/** Generate simulated trade prints from a quote — call on each tick. */
export function generateTradePrints(symbol: string, quote: Quote, count: number = 20): TradePrint[] {
  const contract = getContract(symbol);
  const prints: TradePrint[] = [];
  const baseTime = Date.now();
  // Bias aggressor by quote change direction
  const bullBias = quote.changePct > 0 ? 0.55 : quote.changePct < 0 ? 0.45 : 0.5;
  for (let i = 0; i < count; i++) {
    const isBuy = Math.random() < bullBias;
    // Price: mostly at ask (buy) or bid (sell), occasionally inside spread
    let price: number;
    if (Math.random() < 0.85) {
      price = isBuy ? quote.ask : quote.bid;
    } else {
      price = quote.bid + (quote.ask - quote.bid) * Math.random();
    }
    price = Math.round(price / contract.tickSize) * contract.tickSize;
    // Size: log-normal distribution, occasionally a block
    const isBlock = Math.random() < 0.05;
    const size = isBlock
      ? Math.floor(50 + Math.random() * 200)
      : Math.max(1, Math.floor(Math.exp(Math.random() * 3)));
    prints.push({
      id: nextTradeId(),
      timestamp: baseTime - (count - i) * (1000 / count) + Math.random() * 50,
      price,
      size,
      aggressor: isBuy ? "BUY" : "SELL",
    });
  }
  return prints.sort((a, b) => b.timestamp - a.timestamp);
}

/** Build volume profile from a list of trade prints. */
export function buildVolumeProfile(symbol: string, trades: TradePrint[]): PriceLevel[] {
  if (trades.length === 0) return [];
  const contract = getContract(symbol);
  const levels = new Map<number, PriceLevel>();
  for (const t of trades) {
    const key = t.price;
    if (!levels.has(key)) {
      levels.set(key, {
        price: key,
        buyVolume: 0,
        sellVolume: 0,
        totalVolume: 0,
        delta: 0,
        tradeCount: 0,
      });
    }
    const lvl = levels.get(key)!;
    if (t.aggressor === "BUY") lvl.buyVolume += t.size;
    else lvl.sellVolume += t.size;
    lvl.totalVolume = lvl.buyVolume + lvl.sellVolume;
    lvl.delta = lvl.buyVolume - lvl.sellVolume;
    lvl.tradeCount++;
  }
  // Sort by price descending (high to low for DOM display)
  return Array.from(levels.values()).sort((a, b) => b.price - a.price);
}

/** Compute POC, VAH, VAL from volume profile. */
export function computeValueArea(levels: PriceLevel[]): { poc: number; vah: number; val: number } {
  if (levels.length === 0) return { poc: 0, vah: 0, val: 0 };
  // POC = level with highest volume
  const pocLevel = levels.reduce((max, l) => (l.totalVolume > max.totalVolume ? l : max), levels[0]);
  const poc = pocLevel.price;
  const totalVol = levels.reduce((s, l) => s + l.totalVolume, 0);
  const targetVol = totalVol * 0.7; // 70% value area
  // Expand outward from POC until we capture 70% of volume
  const sortedByPrice = [...levels].sort((a, b) => b.price - a.price);
  const pocIdx = sortedByPrice.findIndex((l) => l.price === poc);
  let captured = pocLevel.totalVolume;
  let vah = poc;
  let val = poc;
  let upIdx = pocIdx + 1;
  let downIdx = pocIdx - 1;
  while (captured < targetVol && (upIdx < sortedByPrice.length || downIdx >= 0)) {
    const upVol = upIdx < sortedByPrice.length ? sortedByPrice[upIdx].totalVolume : 0;
    const downVol = downIdx >= 0 ? sortedByPrice[downIdx].totalVolume : 0;
    if (upVol >= downVol && upIdx < sortedByPrice.length) {
      vah = sortedByPrice[upIdx].price;
      captured += upVol;
      upIdx++;
    } else if (downIdx >= 0) {
      val = sortedByPrice[downIdx].price;
      captured += downVol;
      downIdx--;
    } else {
      break;
    }
  }
  return { poc, vah, val };
}

/** Build a complete order flow snapshot for a symbol. */
export function buildOrderFlowSnapshot(symbol: string, lookbackPrints: number = 500): OrderFlowSnapshot {
  const engine = getEngine();
  const quote = engine.getQuote(symbol);
  if (!quote) {
    return {
      symbol,
      trades: [],
      priceLevels: [],
      pocPrice: 0,
      vah: 0,
      val: 0,
      cumulativeDelta: 0,
      buyVolume: 0,
      sellVolume: 0,
      totalVolume: 0,
      deltaPerMin: [],
      timestamp: Date.now(),
    };
  }
  // Generate a fresh batch of prints
  const newPrints = generateTradePrints(symbol, quote, 30);
  const trades = newPrints.slice(0, lookbackPrints);
  const priceLevels = buildVolumeProfile(symbol, trades);
  const { poc, vah, val } = computeValueArea(priceLevels);
  const buyVolume = trades.filter((t) => t.aggressor === "BUY").reduce((s, t) => s + t.size, 0);
  const sellVolume = trades.filter((t) => t.aggressor === "SELL").reduce((s, t) => s + t.size, 0);
  const cumulativeDelta = buyVolume - sellVolume;
  // Delta per minute (last 10 minutes)
  const now = Date.now();
  const deltaPerMin: { time: number; delta: number }[] = [];
  for (let m = 9; m >= 0; m--) {
    const start = now - (m + 1) * 60000;
    const end = now - m * 60000;
    const slice = trades.filter((t) => t.timestamp >= start && t.timestamp < end);
    const bVol = slice.filter((t) => t.aggressor === "BUY").reduce((s, t) => s + t.size, 0);
    const sVol = slice.filter((t) => t.aggressor === "SELL").reduce((s, t) => s + t.size, 0);
    deltaPerMin.push({ time: end, delta: bVol - sVol });
  }
  return {
    symbol,
    trades,
    priceLevels,
    pocPrice: poc,
    vah,
    val,
    cumulativeDelta,
    buyVolume,
    sellVolume,
    totalVolume: buyVolume + sellVolume,
    deltaPerMin,
    timestamp: now,
  };
}
