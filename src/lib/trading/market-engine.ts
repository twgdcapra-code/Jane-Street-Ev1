/**
 * Market Data Engine
 *
 * Simulates a realistic futures market using:
 *  - Geometric Brownian Motion for price evolution
 *  - Stochastic volatility (Heston-like mean reversion)
 *  - Jump-diffusion for fat tails (Merton model)
 *  - Order-book depth generation around mid
 *
 * Mirrors TwigCapra's "Superstore" tick-data concept on a much smaller scale.
 */
import type { Candle, DepthLevel, FuturesContract, OrderBook, Quote } from "./types";
import { CONTRACT_MAP } from "./contracts";

// ---------- Utilities ----------

/** Mulberry32 — small deterministic PRNG for reproducible streams. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard-normal via Box-Muller. */
export function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Merton-style jump: small prob of large move per step. */
function maybeJump(rng: () => number, lambda: number, jumpSize: number): number {
  if (rng() < lambda) {
    return gaussian(rng) * jumpSize;
  }
  return 0;
}

// ---------- Per-symbol state ----------

interface SymbolState {
  contract: FuturesContract;
  price: number;
  vol: number; // instantaneous vol (annualized)
  prevSettle: number;
  high: number;
  low: number;
  open: number;
  volume: number;
  openInterest: number;
  vwapNumerator: number;
  vwapDenominator: number;
  candles: Candle[];
  lastCandleTime: number;
  rng: () => number;
  tickCount: number;
}

const CANDLE_INTERVAL = 60_000; // 1-minute candles
const MAX_CANDLES = 500;

export class MarketEngine {
  private states = new Map<string, SymbolState>();
  private listeners: Set<(q: Quote) => void> = new Set();
  private bookListeners: Set<(b: OrderBook) => void> = new Set();
  private timer: ReturnType<typeof setInterval> | null = null;
  private intervalMs = 1500; // tick cadence
  private historicalBars = new Map<string, Candle[]>();

  constructor(seed = 42) {
    for (const contract of Object.values(CONTRACT_MAP)) {
      const rng = mulberry32(seed + contract.symbol.charCodeAt(0) * 97);
      const startPrice = contract.basePrice;
      this.states.set(contract.symbol, {
        contract,
        price: startPrice,
        vol: contract.volatility,
        prevSettle: startPrice * (1 + (rng() - 0.5) * 0.005),
        high: startPrice,
        low: startPrice,
        open: startPrice,
        volume: Math.floor(rng() * 50000) + 10000,
        openInterest: Math.floor(rng() * 500000) + 100000,
        vwapNumerator: startPrice * 1000,
        vwapDenominator: 1000,
        candles: [],
        lastCandleTime: Math.floor(Date.now() / CANDLE_INTERVAL) * CANDLE_INTERVAL,
        rng,
        tickCount: 0,
      });
      // seed historical candles
      this.seedHistory(contract.symbol);
    }
  }

  /** Generate ~250 days of daily history + intraday for charts. */
  private seedHistory(symbol: string) {
    const st = this.states.get(symbol)!;
    const c = st.contract;
    const rng = mulberry32(st.rng() * 1e9);
    let p = c.basePrice * 0.85;
    const daily: Candle[] = [];
    const now = Date.now();
    const dayMs = 86_400_000;
    for (let i = 250; i >= 0; i--) {
      const time = now - i * dayMs;
      const open = p;
      const dailyVol = c.volatility / Math.sqrt(252);
      const drift = (c.drift / 252);
      // 6 intraday hours per day sampled
      let high = open;
      let low = open;
      let close = open;
      let vol = 0;
      for (let h = 0; h < 6; h++) {
        const ret = drift / 6 + dailyVol * gaussian(rng) / Math.sqrt(6);
        close = close * (1 + ret);
        high = Math.max(high, close);
        low = Math.min(low, close);
        vol += Math.floor(rng() * 50000) + 5000;
      }
      p = close;
      daily.push({ time, open, high, low, close, volume: vol });
    }
    this.historicalBars.set(symbol, daily);
    // Seed intraday candles too (last day's bars)
    st.candles = [];
    const today = daily[daily.length - 1];
    let cp = today.open;
    for (let m = 0; m < 390; m++) {
      // 6.5h RTH = 390 minutes
      const t = now - (390 - m) * 60_000;
      const o = cp;
      const r = (c.volatility / Math.sqrt(252 * 390)) * gaussian(rng);
      const cl = o * (1 + r);
      const hi = Math.max(o, cl) * (1 + Math.abs(gaussian(rng)) * 0.0005);
      const lo = Math.min(o, cl) * (1 - Math.abs(gaussian(rng)) * 0.0005);
      st.candles.push({
        time: t,
        open: o,
        high: hi,
        low: lo,
        close: cl,
        volume: Math.floor(rng() * 1500) + 200,
      });
      cp = cl;
    }
    st.price = cp;
    st.high = Math.max(...st.candles.slice(-50).map((c) => c.high));
    st.low = Math.min(...st.candles.slice(-50).map((c) => c.low));
    st.open = st.candles[Math.max(0, st.candles.length - 390)].open;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setInterval(ms: number) {
    this.intervalMs = ms;
    if (this.timer) {
      this.stop();
      this.start();
    }
  }

  onQuote(cb: (q: Quote) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onBook(cb: (b: OrderBook) => void) {
    this.bookListeners.add(cb);
    return () => this.bookListeners.delete(cb);
  }

  getQuote(symbol: string): Quote | null {
    const st = this.states.get(symbol);
    if (!st) return null;
    return this.buildQuote(st);
  }

  getAllQuotes(): Quote[] {
    return Array.from(this.states.values()).map((s) => this.buildQuote(s));
  }

  getCandles(symbol: string, lookback = 200): Candle[] {
    const st = this.states.get(symbol);
    if (!st) return [];
    return st.candles.slice(-lookback);
  }

  getHistory(symbol: string): Candle[] {
    return this.historicalBars.get(symbol) ?? [];
  }

  getOrderBook(symbol: string, levels = 10): OrderBook {
    const st = this.states.get(symbol);
    if (!st) throw new Error(`Unknown symbol: ${symbol}`);
    const c = st.contract;
    const mid = st.price;
    const spread = Math.max(c.tickSize, mid * 0.0001);
    const bids: DepthLevel[] = [];
    const asks: DepthLevel[] = [];
    for (let i = 0; i < levels; i++) {
      const bidPrice = roundTick(mid - spread / 2 - i * c.tickSize, c.tickSize);
      const askPrice = roundTick(mid + spread / 2 + i * c.tickSize, c.tickSize);
      const sizeDecay = Math.exp(-i * 0.18);
      bids.push({
        price: bidPrice,
        size: Math.max(1, Math.round((st.rng() * 50 + 5) * sizeDecay)),
        orders: Math.floor(st.rng() * 4) + 1,
      });
      asks.push({
        price: askPrice,
        size: Math.max(1, Math.round((st.rng() * 50 + 5) * sizeDecay)),
        orders: Math.floor(st.rng() * 4) + 1,
      });
    }
    return { symbol, bids, asks, timestamp: Date.now() };
  }

  /** Apply an external fill (used by execution engine). */
  recordFill(symbol: string, qty: number, price: number) {
    const st = this.states.get(symbol);
    if (!st) return;
    st.volume += Math.abs(qty);
    st.vwapNumerator += price * Math.abs(qty);
    st.vwapDenominator += Math.abs(qty);
  }

  private tick() {
    for (const st of this.states.values()) {
      this.evolve(st);
      const q = this.buildQuote(st);
      this.listeners.forEach((cb) => cb(q));
      // Update or push new candle
      this.updateCandle(st);
    }
  }

  private evolve(st: SymbolState) {
    const c = st.contract;
    const dt = this.intervalMs / (1000 * 60 * 60 * 24 * 252);
    // Heston-like vol mean reversion
    const volMeanReversion = 5.0;
    const volOfVol = 0.3;
    const volShock = gaussian(st.rng) * volOfVol * Math.sqrt(dt);
    st.vol = Math.max(0.02, st.vol + volMeanReversion * (c.volatility - st.vol) * dt + st.vol * volShock);
    // GBM
    const drift = (c.drift - 0.5 * st.vol * st.vol) * dt;
    const diffusion = st.vol * Math.sqrt(dt) * gaussian(st.rng);
    const jump = maybeJump(st.rng, 0.005, st.vol * 0.5);
    const ret = drift + diffusion + jump;
    const newPrice = Math.max(c.tickSize, st.price * (1 + ret));
    st.price = roundTick(newPrice, c.tickSize);
    st.tickCount++;
    st.high = Math.max(st.high, st.price);
    st.low = Math.min(st.low, st.price);
    const tradeSize = Math.floor(st.rng() * 50) + 1;
    st.volume += tradeSize;
    st.vwapNumerator += st.price * tradeSize;
    st.vwapDenominator += tradeSize;
  }

  private updateCandle(st: SymbolState) {
    const now = Date.now();
    const bucket = Math.floor(now / CANDLE_INTERVAL) * CANDLE_INTERVAL;
    const last = st.candles[st.candles.length - 1];
    if (!last || last.time < bucket) {
      st.candles.push({
        time: bucket,
        open: st.price,
        high: st.price,
        low: st.price,
        close: st.price,
        volume: 0,
      });
      if (st.candles.length > MAX_CANDLES) st.candles.shift();
    } else {
      last.high = Math.max(last.high, st.price);
      last.low = Math.min(last.low, st.price);
      last.close = st.price;
      last.volume += Math.floor(st.rng() * 25) + 1;
    }
  }

  private buildQuote(st: SymbolState): Quote {
    const c = st.contract;
    const spread = Math.max(c.tickSize, st.price * 0.0001);
    const bid = roundTick(st.price - spread / 2, c.tickSize);
    const ask = roundTick(st.price + spread / 2, c.tickSize);
    const change = st.price - st.prevSettle;
    return {
      symbol: st.contract.symbol,
      bid,
      ask,
      bidSize: Math.floor(st.rng() * 80) + 10,
      askSize: Math.floor(st.rng() * 80) + 10,
      last: st.price,
      prevSettle: st.prevSettle,
      change,
      changePct: (change / st.prevSettle) * 100,
      volume: st.volume,
      openInterest: st.openInterest,
      high: st.high,
      low: st.low,
      open: st.open,
      vwap: st.vwapNumerator / st.vwapDenominator,
      timestamp: Date.now(),
    };
  }
}

function roundTick(p: number, tick: number): number {
  return Math.round(p / tick) * tick;
}

// Singleton engine for the app
let engineSingleton: MarketEngine | null = null;
export function getEngine(): MarketEngine {
  if (!engineSingleton) engineSingleton = new MarketEngine();
  return engineSingleton;
}
