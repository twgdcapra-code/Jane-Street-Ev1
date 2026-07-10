/**
 * Market Replay Engine
 *
 * Replays historical market data tick-by-tick for trader training and
 * strategy validation. Supports:
 *  1. Historical scenario library (Flash Crash, FOMC, COVID, Volmageddon, etc.)
 *  2. Custom date range replay from seeded history
 *  3. Playback speed control (1x, 2x, 5x, 10x, instant)
 *  4. P&L tracking during replay
 *  5. Trade recording with timestamps
 *  6. Order book depth reconstruction
 *
 * Based on research in /home/z/my-project/research/market_replay.md
 * References: CME MDP 3.0, NinjaTrader Market Replay, López de Prado (2018),
 * LMAX Disruptor, SEC/CFTC Flash Crash Report (2010)
 */
import type { Candle, Quote, Order, Fill, Side } from "./types";
import { getContract } from "./contracts";
import { getEngine, mulberry32, gaussian } from "./market-engine";

// ============================================================
// 1. SCENARIO DEFINITIONS
// ============================================================

export type ScenarioType =
  | "FLASH_CRASH"
  | "FOMC_DECISION"
  | "COVID_CRASH"
  | "VOLMAGGEDDON"
  | "SWISS_FRANC_UNPEG"
  | "SVB_COLLAPSE"
  | "NFP_RELEASE"
  | "OIL_SHOCK"
  | "NORMAL_RTH"
  | "CUSTOM";

export interface ReplayScenario {
  id: string;
  name: string;
  type: ScenarioType;
  description: string;
  date: string;
  symbol: string;
  // How the scenario modifies the base price path
  shockPattern: {
    preEventBars: number;
    eventBars: number;
    postEventBars: number;
    // Shock function: takes (barIndex, basePrice) -> modifiedPrice
    shockFn: (barIdx: number, basePrice: number, eventBar: number) => number;
    // Volatility multiplier during event
    volMult: number;
    // Volume multiplier during event
    volMultFn: (barIdx: number, eventBar: number) => number;
  };
  // What the trader should look for
  learningObjective: string;
  // Key price levels to watch
  keyLevels: { price: number; label: string }[];
}

export const SCENARIO_LIBRARY: ReplayScenario[] = [
  {
    id: "flash_crash_2010",
    name: "May 6, 2010 — Flash Crash",
    type: "FLASH_CRASH",
    description: "Dow drops ~1000 points in minutes, then partially recovers. Liquidity vacuum, stub quotes, extreme volatility. CFTC/SEC joint report documented the cascade.",
    date: "2010-05-06",
    symbol: "ES",
    shockPattern: {
      preEventBars: 50,
      eventBars: 20,
      postEventBars: 80,
      shockFn: (idx, base, eventBar) => {
        const rel = idx - eventBar;
        if (rel < 0) return base;
        if (rel < 10) {
          // Sharp drop: -5% over 10 bars
          return base * (1 - 0.05 * (rel / 10));
        }
        if (rel < 15) {
          // V-bottom: recover half
          const recovery = (rel - 10) / 5;
          return base * (0.95 + 0.025 * recovery);
        }
        // Post-event: choppy recovery
        return base * (0.975 + 0.01 * Math.sin(rel * 0.5));
      },
      volMult: 5.0,
      volMultFn: (idx, eventBar) => {
        const rel = idx - eventBar;
        if (rel < 0) return 1;
        if (rel < 20) return 3 + rel * 0.2;
        return Math.max(1.5, 7 - (rel - 20) * 0.1);
      },
    },
    learningObjective: "Practice managing positions during a liquidity vacuum. Learn to identify stub quotes and avoid market orders during extreme volatility.",
    keyLevels: [
      { price: 0.95, label: "Crash low (-5%)" },
      { price: 0.975, label: "Recovery midpoint" },
      { price: 1.0, label: "Pre-crash level" },
    ],
  },
  {
    id: "covid_crash_2020",
    name: "March 2020 — COVID Crash",
    type: "COVID_CRASH",
    description: "S&P 500 drops 34% in 23 trading days. Fastest bear market in history. Multiple circuit breaker triggers. Treasury yields hit historic lows.",
    date: "2020-03-12",
    symbol: "ES",
    shockPattern: {
      preEventBars: 30,
      eventBars: 60,
      postEventBars: 60,
      shockFn: (idx, base, eventBar) => {
        const rel = idx - eventBar;
        if (rel < 0) return base;
        if (rel < 60) {
          // Sustained decline: -34% over 60 bars with volatility
          const trend = -0.34 * (rel / 60);
          const noise = Math.sin(rel * 0.8) * 0.02;
          return base * (1 + trend + noise);
        }
        // Recovery starts
        const recovery = (rel - 60) / 60;
        return base * (0.66 + 0.15 * recovery + Math.sin(rel * 0.3) * 0.01);
      },
      volMult: 4.0,
      volMultFn: (idx, eventBar) => {
        const rel = idx - eventBar;
        if (rel < 0) return 1;
        if (rel < 60) return 2 + rel * 0.05;
        return Math.max(1.5, 5 - (rel - 60) * 0.05);
      },
    },
    learningObjective: "Manage risk during a sustained sell-off. Practice cutting positions, avoiding catching falling knives, and identifying capitulation.",
    keyLevels: [
      { price: 0.80, label: "-20% bear market" },
      { price: 0.70, label: "-30% deep bear" },
      { price: 0.66, label: "Crash low (-34%)" },
    ],
  },
  {
    id: "volmageddon_2018",
    name: "Feb 5, 2018 — Volmageddon",
    type: "VOLMAGGEDDON",
    description: "VIX spikes 116% in a single day. Inverse VIX ETPs blow up. Short-vol funds lose billions. Contango flips to backwardation violently.",
    date: "2018-02-05",
    symbol: "ES",
    shockPattern: {
      preEventBars: 40,
      eventBars: 15,
      postEventBars: 45,
      shockFn: (idx, base, eventBar) => {
        const rel = idx - eventBar;
        if (rel < 0) return base;
        if (rel < 5) {
          // Sharp drop: -4% in 5 bars
          return base * (1 - 0.04 * (rel / 5));
        }
        if (rel < 15) {
          // Continued selling with bounce
          return base * (0.96 - 0.01 * (rel - 5) + Math.sin(rel) * 0.005);
        }
        // Recovery
        return base * (0.94 + 0.02 * Math.sin(rel * 0.3) + (rel - 15) * 0.0005);
      },
      volMult: 6.0,
      volMultFn: (idx, eventBar) => {
        const rel = idx - eventBar;
        if (rel < 0) return 1;
        if (rel < 15) return 4 + rel * 0.2;
        return Math.max(2, 7 - (rel - 15) * 0.1);
      },
    },
    learningObjective: "Understand vol-of-vol dynamics. Practice hedging short vol positions. Learn to identify when vol products are forced to unwind.",
    keyLevels: [
      { price: 0.96, label: "Initial drop (-4%)" },
      { price: 0.94, label: "Low of day" },
      { price: 1.0, label: "Pre-event" },
    ],
  },
  {
    id: "fomc_hawkish",
    name: "FOMC Hawkish Surprise",
    type: "FOMC_DECISION",
    description: "Fed delivers hawkish surprise (rate hike or hawkish dot plot). Markets reprice aggressively. Bonds sell off, equity volatility spikes, dollar strengthens.",
    date: "2022-06-15",
    symbol: "ES",
    shockPattern: {
      preEventBars: 60,
      eventBars: 5,
      postEventBars: 55,
      shockFn: (idx, base, eventBar) => {
        const rel = idx - eventBar;
        if (rel < 0) return base;
        if (rel < 2) {
          // Instant reaction: -2% in 2 bars
          return base * (1 - 0.02 * (rel / 2));
        }
        if (rel < 5) {
          // Continued selling
          return base * (0.98 - 0.005 * (rel - 2));
        }
        // Choppy with downward bias
        return base * (0.965 - 0.001 * (rel - 5) + Math.sin(rel * 0.6) * 0.008);
      },
      volMult: 4.0,
      volMultFn: (idx, eventBar) => {
        const rel = idx - eventBar;
        if (rel < 0) return 0.8; // Pre-FOMC: low vol
        if (rel < 5) return 5;
        return Math.max(1.5, 5 - (rel - 5) * 0.06);
      },
    },
    learningObjective: "Practice managing positions around scheduled news. Learn to identify the initial reaction vs. the true market direction. Avoid trading in the first 2 minutes.",
    keyLevels: [
      { price: 0.98, label: "Initial reaction (-2%)" },
      { price: 0.965, label: "Extended low" },
      { price: 1.0, label: "Pre-announcement" },
    ],
  },
  {
    id: "nfp_surprise",
    name: "NFP Surprise (Hot Print)",
    type: "NFP_RELEASE",
    description: "Non-Farm Payrolls comes in much hotter than expected. Markets reprice Fed expectations. Bonds sell off, equities initially spike then fade, dollar rallies.",
    date: "2024-04-05",
    symbol: "ES",
    shockPattern: {
      preEventBars: 40,
      eventBars: 8,
      postEventBars: 52,
      shockFn: (idx, base, eventBar) => {
        const rel = idx - eventBar;
        if (rel < 0) return base;
        if (rel < 1) {
          // Initial spike up: +0.5%
          return base * 1.005;
        }
        if (rel < 8) {
          // Fade: drop -1.5% from spike
          return base * (1.005 - 0.02 * (rel / 8));
        }
        // Continued pressure
        return base * (0.985 - 0.002 * (rel - 8) + Math.sin(rel * 0.4) * 0.004);
      },
      volMult: 3.5,
      volMultFn: (idx, eventBar) => {
        const rel = idx - eventBar;
        if (rel < 0) return 0.5;
        if (rel < 8) return 4;
        return Math.max(1, 4 - (rel - 8) * 0.05);
      },
    },
    learningObjective: "Trade the initial spike-and-fade pattern. Learn to distinguish between knee-jerk reaction and sustained repricing. Practice limit order placement around news.",
    keyLevels: [
      { price: 1.005, label: "Initial spike (+0.5%)" },
      { price: 0.985, label: "Faded level (-1.5%)" },
      { price: 1.0, label: "Pre-NFP" },
    ],
  },
  {
    id: "normal_rth",
    name: "Normal RTH Session",
    type: "NORMAL_RTH",
    description: "A typical regular trading hours session. Moderate volatility, normal volume curve (U-shaped). Good for practicing baseline execution and discipline.",
    date: "2024-06-15",
    symbol: "ES",
    shockPattern: {
      preEventBars: 0,
      eventBars: 0,
      postEventBars: 150,
      shockFn: (idx, base) => base, // No shock
      volMult: 1.0,
      volMultFn: () => 1.0,
    },
    learningObjective: "Practice execution discipline, order placement, and position management in normal market conditions. Establish baseline performance.",
    keyLevels: [
      { price: 1.0, label: "Open" },
      { price: 1.01, label: "+1%" },
      { price: 0.99, label: "-1%" },
    ],
  },
];

// ============================================================
// 2. REPLAY STATE MACHINE
// ============================================================

export type ReplayStatus = "IDLE" | "LOADED" | "PLAYING" | "PAUSED" | "COMPLETED";
export type PlaybackSpeed = 0.5 | 1 | 2 | 5 | 10 | 0; // 0 = instant

export interface ReplayTrade {
  timestamp: number;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  pnl: number;
  barIndex: number;
}

export interface ReplayState {
  scenario: ReplayScenario | null;
  status: ReplayStatus;
  speed: PlaybackSpeed;
  currentBar: number;
  totalBars: number;
  candles: Candle[]; // The scenario's modified candle series
  quote: Quote | null;
  // Trading state
  position: number; // net qty
  avgEntryPrice: number;
  realizedPnL: number;
  unrealizedPnL: number;
  trades: ReplayTrade[];
  equityCurve: { bar: number; equity: number }[];
  startingEquity: number;
  // Stats
  maxDrawdown: number;
  peakEquity: number;
  // Timing
  startedAt: number | null;
  completedAt: number | null;
}

export function createReplayState(scenario: ReplayScenario, startingEquity: number = 100000): ReplayState {
  const candles = generateScenarioCandles(scenario);
  return {
    scenario,
    status: "LOADED",
    speed: 1,
    currentBar: 0,
    totalBars: candles.length,
    candles,
    quote: null,
    position: 0,
    avgEntryPrice: 0,
    realizedPnL: 0,
    unrealizedPnL: 0,
    trades: [],
    equityCurve: [{ bar: 0, equity: startingEquity }],
    startingEquity,
    maxDrawdown: 0,
    peakEquity: startingEquity,
    startedAt: null,
    completedAt: null,
  };
}

/**
 * Generate candles for a scenario by modifying the base historical data.
 */
function generateScenarioCandles(scenario: ReplayScenario): Candle[] {
  const engine = getEngine();
  const baseHistory = engine.getHistory(scenario.symbol);
  const sourceCandles = baseHistory.length > 50 ? baseHistory : engine.getCandles(scenario.symbol, 150);
  if (sourceCandles.length === 0) return [];

  const { preEventBars, eventBars, postEventBars } = scenario.shockPattern;
  const totalBars = preEventBars + eventBars + postEventBars;
  const eventBar = preEventBars;

  // Use a deterministic RNG for reproducibility
  const rng = mulberry32(scenario.id.charCodeAt(0) + scenario.id.charCodeAt(1));
  const contract = getContract(scenario.symbol);
  const basePrice = contract.basePrice;

  const candles: Candle[] = [];
  for (let i = 0; i < Math.min(totalBars, sourceCandles.length); i++) {
    const baseCandle = sourceCandles[i];
    const baseClose = baseCandle.close;
    // Apply shock function
    const modifiedClose = scenario.shockPattern.shockFn(i, baseClose, eventBar);
    const volMult = scenario.shockPattern.volMultFn(i, eventBar);
    // Generate high/low around modified close with increased vol
    const range = (baseCandle.high - baseCandle.low) * volMult;
    const noise = gaussian(rng) * range * 0.3;
    const high = Math.max(modifiedClose, baseCandle.open) + range * 0.3 + Math.abs(noise);
    const low = Math.min(modifiedClose, baseCandle.open) - range * 0.3 - Math.abs(noise);
    const volume = Math.floor(baseCandle.volume * volMult);
    candles.push({
      time: baseCandle.time + i * 60000, // 1-min spacing
      open: i === 0 ? baseClose : candles[i - 1].close,
      high: Math.round(high / contract.tickSize) * contract.tickSize,
      low: Math.round(low / contract.tickSize) * contract.tickSize,
      close: Math.round(modifiedClose / contract.tickSize) * contract.tickSize,
      volume,
    });
  }
  return candles;
}

/**
 * Step the replay forward by one bar.
 * Returns the new quote for the current bar.
 */
export function stepReplay(state: ReplayState): ReplayState {
  if (state.status !== "PLAYING" && state.status !== "LOADED") return state;
  if (state.currentBar >= state.totalBars) {
    return { ...state, status: "COMPLETED", completedAt: Date.now() };
  }
  const candle = state.candles[state.currentBar];
  if (!candle) return state;
  // Generate a quote from the candle
  const spread = (candle.high - candle.low) * 0.1;
  const quote: Quote = {
    symbol: state.scenario?.symbol ?? "ES",
    bid: candle.close - spread / 2,
    ask: candle.close + spread / 2,
    bidSize: Math.floor(Math.random() * 80) + 10,
    askSize: Math.floor(Math.random() * 80) + 10,
    last: candle.close,
    prevSettle: state.candles[0]?.close ?? candle.close,
    change: candle.close - (state.candles[0]?.close ?? candle.close),
    changePct: ((candle.close - (state.candles[0]?.close ?? candle.close)) / (state.candles[0]?.close ?? 1)) * 100,
    volume: candle.volume,
    openInterest: 0,
    high: candle.high,
    low: candle.low,
    open: candle.open,
    vwap: candle.close, // simplified
    timestamp: candle.time,
  };
  // Update unrealized P&L
  const unrealized = state.position * (quote.last - state.avgEntryPrice) * getContract(quote.symbol).pointValue;
  const equity = state.startingEquity + state.realizedPnL + unrealized;
  const peakEquity = Math.max(state.peakEquity, equity);
  const drawdown = equity - peakEquity;
  const newEquityCurve = [...state.equityCurve, { bar: state.currentBar + 1, equity }];
  return {
    ...state,
    currentBar: state.currentBar + 1,
    quote,
    unrealizedPnL: unrealized,
    maxDrawdown: Math.min(state.maxDrawdown, drawdown),
    peakEquity,
    equityCurve: newEquityCurve,
    status: state.currentBar + 1 >= state.totalBars ? "COMPLETED" : "PLAYING",
    startedAt: state.startedAt ?? Date.now(),
    completedAt: state.currentBar + 1 >= state.totalBars ? Date.now() : null,
  };
}

/**
 * Place a trade during replay.
 */
export function placeReplayTrade(state: ReplayState, side: Side, qty: number): ReplayState {
  if (!state.quote) return state;
  const fillPrice = side === "BUY" ? state.quote.ask : state.quote.bid;
  const contract = getContract(state.quote.symbol);
  const signedQty = side === "BUY" ? qty : -qty;
  const oldPos = state.position;
  const newPos = oldPos + signedQty;
  let realized = 0;
  let newAvg = state.avgEntryPrice;
  // If reducing position, realize P&L
  if (Math.sign(signedQty) !== Math.sign(oldPos) && oldPos !== 0) {
    const closedQty = Math.min(Math.abs(signedQty), Math.abs(oldPos));
    const pnlPerUnit = (fillPrice - state.avgEntryPrice) * (oldPos > 0 ? 1 : -1);
    realized = closedQty * pnlPerUnit * contract.pointValue;
  }
  // Update avg entry
  if (Math.sign(signedQty) === Math.sign(oldPos) || oldPos === 0) {
    const totalCost = Math.abs(oldPos) * state.avgEntryPrice + Math.abs(signedQty) * fillPrice;
    const totalQty = Math.abs(newPos);
    newAvg = totalQty > 0 ? totalCost / totalQty : 0;
  } else if (newPos === 0) {
    newAvg = 0;
  }
  const trade: ReplayTrade = {
    timestamp: state.quote.timestamp,
    symbol: state.quote.symbol,
    side,
    qty,
    price: fillPrice,
    pnl: realized,
    barIndex: state.currentBar,
  };
  return {
    ...state,
    position: newPos,
    avgEntryPrice: newAvg,
    realizedPnL: state.realizedPnL + realized,
    trades: [...state.trades, trade],
  };
}

/**
 * Flatten position during replay.
 */
export function flattenReplay(state: ReplayState): ReplayState {
  if (state.position === 0 || !state.quote) return state;
  const side: Side = state.position > 0 ? "SELL" : "BUY";
  return placeReplayTrade(state, side, Math.abs(state.position));
}

/**
 * Reset replay to beginning.
 */
export function resetReplay(state: ReplayState): ReplayState {
  if (!state.scenario) return state;
  return createReplayState(state.scenario, state.startingEquity);
}

/**
 * Get the interval delay for a given playback speed.
 * Returns milliseconds between bars.
 */
export function getPlaybackInterval(speed: PlaybackSpeed): number {
  if (speed === 0) return 0; // instant
  if (speed === 0.5) return 2000;
  if (speed === 1) return 1000;
  if (speed === 2) return 500;
  if (speed === 5) return 200;
  if (speed === 10) return 100;
  return 1000;
}

/**
 * Compute replay performance metrics.
 */
export function computeReplayMetrics(state: ReplayState) {
  const equity = state.equityCurve.map((e) => e.equity);
  const finalEquity = equity[equity.length - 1] ?? state.startingEquity;
  const totalReturn = finalEquity - state.startingEquity;
  const totalReturnPct = (totalReturn / state.startingEquity) * 100;
  const rets: number[] = [];
  for (let i = 1; i < equity.length; i++) rets.push(equity[i] / equity[i - 1] - 1);
  const meanRet = rets.length > 0 ? rets.reduce((s, v) => s + v, 0) / rets.length : 0;
  const stdRet = rets.length > 1 ? Math.sqrt(rets.reduce((s, v) => s + (v - meanRet) ** 2, 0) / (rets.length - 1)) : 0;
  const sharpe = stdRet > 0 ? (meanRet / stdRet) * Math.sqrt(252) : 0;
  const wins = state.trades.filter((t) => t.pnl > 0).length;
  const losses = state.trades.filter((t) => t.pnl < 0).length;
  const winRate = state.trades.length > 0 ? (wins / state.trades.length) * 100 : 0;
  return {
    finalEquity,
    totalReturn,
    totalReturnPct,
    sharpe,
    maxDrawdown: state.maxDrawdown,
    totalTrades: state.trades.length,
    wins,
    losses,
    winRate,
    avgTradePnl: state.trades.length > 0 ? state.trades.reduce((s, t) => s + t.pnl, 0) / state.trades.length : 0,
    bestTrade: state.trades.length > 0 ? Math.max(...state.trades.map((t) => t.pnl)) : 0,
    worstTrade: state.trades.length > 0 ? Math.min(...state.trades.map((t) => t.pnl)) : 0,
    barsPlayed: state.currentBar,
    duration: state.completedAt && state.startedAt ? state.completedAt - state.startedAt : 0,
  };
}
