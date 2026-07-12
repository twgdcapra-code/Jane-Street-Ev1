/**
 * Central Trading Store (Zustand)
 *
 * Holds the canonical state of the trading system:
 *  - Account & cash
 *  - Orders (working, filled, cancelled)
 *  - Fills (audit ledger)
 *  - Positions (real-time P&L)
 *  - Active strategies
 *  - Alerts
 *  - System metrics (latency, throughput)
 *
 * Subscribes to MarketEngine and:
 *  - Updates quotes
 *  - Marks working orders against current quotes (limit fills, stop triggers)
 *  - Recomputes positions & account
 *
 * This single store mirrors TwigCapra's "no silos" risk discipline — every
 * module reads from the same state, so risk always sees the live book.
 */
"use client";

import { create } from "zustand";
import type {
  Account,
  Alert,
  Candle,
  Fill,
  Order,
  OrderStatus,
  Position,
  Quote,
  Strategy,
  StrategyParams,
  SystemMetric,
  LogEntry,
} from "./types";
import { getContract } from "./contracts";
import { getEngine } from "./market-engine";
import { computeAccount, computePosition } from "./analytics";
import { STRATEGIES } from "./strategies";
import {
  type AlgoState,
  type AlgoType,
  type AlgoParams,
  createAlgo,
  stepAlgo,
  recordAlgoFill,
  cancelAlgo as cancelAlgoEngine,
  pauseAlgo as pauseAlgoEngine,
  resumeAlgo as resumeAlgoEngine,
} from "./execution-algos";
import {
  type PriceAlert,
  type Watchlist,
  type AlertCondition,
  createPriceAlert,
  evaluateAlert,
  DEFAULT_WATCHLISTS,
} from "./alerts";
import { type SignalRule, type SignalLogEntry } from "./indicators-intelligence";
import { type IndicatorPreset, DEFAULT_PRESETS } from "./indicator-registry";
import { detectCorrelationBreakdowns, DEFAULT_PAIRS } from "./correlation-arb";

// ActiveIndicator type (defined in IndicatorsLab but needed here for persistence)
interface ActiveIndicator {
  uid: string;
  indicatorId: string;
  params: Record<string, number>;
  enabled: boolean;
  color: string;
}

const INITIAL_CASH = 1_000_000;
const COMMISSION_PER_CONTRACT = 2.25;

interface TradingState {
  // Market data
  quotes: Record<string, Quote>;
  selectedSymbol: string;
  // Account
  cashBalance: number;
  // Orders & fills
  orders: Order[];
  fills: Fill[];
  // Positions
  positions: Record<string, Position>;
  // Strategies
  strategies: Strategy[];
  // Execution algorithms
  algos: AlgoState[];
  // Price alerts & watchlists
  priceAlerts: PriceAlert[];
  watchlists: Watchlist[];
  // Indicators Lab state (persisted across navigation)
  indicatorSignalRules: SignalRule[];
  indicatorSignalLog: SignalLogEntry[];
  indicatorPresets: IndicatorPreset[];
  indicatorActiveIndicators: ActiveIndicator[];
  indicatorTradeNotes: Record<string, string>;
  // Alerts & logs
  alerts: Alert[];
  logs: LogEntry[];
  // System metrics
  metrics: SystemMetric[];
  // Engine state
  connected: boolean;
  lastTickAt: number;
  tickCount: number;
  // Actions
  selectSymbol: (s: string) => void;
  placeOrder: (
    o: Omit<Order, "id" | "clientId" | "status" | "filledQty" | "avgFillPrice" | "createdAt" | "updatedAt">,
  ) => string;
  cancelOrder: (id: string) => void;
  modifyOrder: (id: string, updates: Partial<Order>) => void;
  flattenAll: () => void;
  flattenSymbol: (symbol: string) => void;
  addAlert: (a: Omit<Alert, "id" | "timestamp" | "acknowledged">) => void;
  ackAlert: (id: string) => void;
  clearAlerts: () => void;
  addStrategy: (s: Omit<Strategy, "id" | "createdAt" | "pnl" | "trades" | "sharpe" | "maxDrawdown" | "currentSignal" | "positionQty" | "avgEntryPrice" | "realizedPnL" | "unrealizedPnL" | "pnlHistory" | "peakPnL" | "lastSignalAt" | "lastSignalPrice">) => void;
  updateStrategy: (id: string, updates: Partial<Strategy>) => void;
  removeStrategy: (id: string) => void;
  toggleStrategy: (id: string) => void;
  // Algo actions
  startAlgo: (type: AlgoType, params: AlgoParams) => string;
  cancelAlgo: (id: string) => void;
  pauseAlgo: (id: string) => void;
  resumeAlgo: (id: string) => void;
  // Price alert actions
  addPriceAlert: (symbol: string, condition: AlertCondition, threshold: number, name: string) => void;
  removePriceAlert: (id: string) => void;
  togglePriceAlert: (id: string) => void;
  resetPriceAlert: (id: string) => void;
  // Watchlist actions
  addWatchlist: (name: string) => void;
  removeWatchlist: (id: string) => void;
  addWatchlistEntry: (watchlistId: string, symbol: string, note?: string) => void;
  removeWatchlistEntry: (watchlistId: string, symbol: string) => void;
  // Indicators Lab actions (persisted)
  setIndicatorSignalRules: (rules: SignalRule[]) => void;
  setIndicatorSignalLog: (log: SignalLogEntry[]) => void;
  setIndicatorPresets: (presets: IndicatorPreset[]) => void;
  setIndicatorActiveIndicators: (indicators: ActiveIndicator[]) => void;
  setIndicatorTradeNote: (fillId: string, note: string) => void;
  log: (level: LogEntry["level"], module: string, message: string, metadata?: Record<string, unknown>) => void;
  onQuote: (q: Quote) => void;
  init: () => void;
}

let orderCounter = 0;
let fillCounter = 0;
let alertCounter = 0;
let logCounter = 0;
let strategyCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(orderCounter++).toString(36)}`;
}

export const useTradingStore = create<TradingState>((set, get) => ({
  quotes: {},
  selectedSymbol: "ES",
  cashBalance: INITIAL_CASH,
  orders: [],
  fills: [],
  positions: {},
  strategies: [
    {
      id: "strat-1",
      name: "ES Mean Reversion",
      type: "MEAN_REVERSION",
      description: "Z-score based mean reversion on E-mini S&P",
      symbols: ["ES"],
      params: { lookback: 30, entryZ: 2, exitZ: 0, stopZ: 4 } as StrategyParams,
      enabled: false,
      pnl: 0,
      trades: 0,
      sharpe: 0,
      maxDrawdown: 0,
      createdAt: Date.now(),
      currentSignal: 0,
      positionQty: 0,
      avgEntryPrice: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      pnlHistory: [],
      peakPnL: 0,
    },
    {
      id: "strat-2",
      name: "NQ Momentum",
      type: "MOMENTUM",
      description: "EMA cross momentum on E-mini Nasdaq",
      symbols: ["NQ"],
      params: { fast: 9, slow: 21, rsiPeriod: 14, rsiUpper: 70, rsiLower: 30 } as StrategyParams,
      enabled: false,
      pnl: 0,
      trades: 0,
      sharpe: 0,
      maxDrawdown: 0,
      createdAt: Date.now(),
      currentSignal: 0,
      positionQty: 0,
      avgEntryPrice: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      pnlHistory: [],
      peakPnL: 0,
    },
  ],
  alerts: [],
  logs: [],
  algos: [],
  priceAlerts: [],
  watchlists: DEFAULT_WATCHLISTS,
  indicatorSignalRules: [],
  indicatorSignalLog: [],
  indicatorPresets: DEFAULT_PRESETS,
  indicatorActiveIndicators: [],
  indicatorTradeNotes: {},
  metrics: [
    { name: "Tick-to-Trade Latency", value: 0.42, unit: "μs", status: "healthy", target: 5 },
    { name: "Order Ack Latency", value: 1.8, unit: "ms", status: "healthy", target: 10 },
    { name: "Market Data Throughput", value: 0, unit: "msg/s", status: "healthy", target: 10000 },
    { name: "Active Strategies", value: 0, unit: "", status: "healthy" },
    { name: "Open Orders", value: 0, unit: "", status: "healthy" },
    { name: "Memory Usage", value: 312, unit: "MB", status: "healthy", target: 1024 },
    { name: "Order Match Rate", value: 100, unit: "%", status: "healthy", target: 99.9 },
    { name: "Risk Engine Cycle", value: 0.3, unit: "ms", status: "healthy", target: 5 },
  ],
  connected: false,
  lastTickAt: 0,
  tickCount: 0,

  selectSymbol: (s) => set({ selectedSymbol: s }),

  init: () => {
    const engine = getEngine();
    engine.start();
    // Subscribe to quotes
    engine.onQuote((q) => get().onQuote(q));
    // Seed initial quotes
    const initial = engine.getAllQuotes();
    const quotes: Record<string, Quote> = {};
    initial.forEach((q) => (quotes[q.symbol] = q));
    set({ quotes, connected: true, lastTickAt: Date.now() });
    get().log("INFO", "System", "Trading engine initialised", { contracts: initial.length });
    get().log("INFO", "MarketData", "Subscribed to live feed", { symbols: initial.length });
    // Seed some sample orders and positions to make the demo feel alive
    seedDemoData(set, get);
  },

  onQuote: (q) => {
    const state = get();
    const newQuotes = { ...state.quotes, [q.symbol]: q };
    set({
      quotes: newQuotes,
      lastTickAt: Date.now(),
      tickCount: state.tickCount + 1,
    });
    // Mark working orders
    const storeInternal = useTradingStore as unknown as TradingState & {
      markOrders: (q: Quote) => void;
      executeOrder: (id: string, quote?: Quote) => void;
      updatePositions: (q: Quote) => void;
      applyFill: (order: Order, fillQty: number, fillPrice: number) => void;
      stepAlgos: (q: Quote) => void;
      evaluateAlerts: (q: Quote) => void;
      stepStrategies: (q: Quote) => void;
      stepCorrelationAlerts: (q: Quote) => void;
    };
    storeInternal.markOrders(q);
    storeInternal.updatePositions(q);
    // Step active algos
    storeInternal.stepAlgos(q);
    // Evaluate price alerts
    storeInternal.evaluateAlerts(q);
    // Execute enabled strategies
    storeInternal.stepStrategies(q);
    // Detect correlation breakdowns → push to alerts store (throttled)
    storeInternal.stepCorrelationAlerts(q);
  },

  placeOrder: (o) => {
    const id = nextId("ord");
    const now = Date.now();
    const order: Order = {
      ...o,
      id,
      clientId: `cli-${orderCounter}`,
      status: "WORKING",
      filledQty: 0,
      avgFillPrice: 0,
      createdAt: now,
      updatedAt: now,
    };
    // Validate
    const contract = getContract(o.symbol);
    if (!contract) {
      get().addAlert({ type: "ORDER", severity: "ERROR", message: `Unknown symbol: ${o.symbol}` });
      return id;
    }
    // Margin check
    const account = computeAccount(
      Object.values(get().positions),
      get().cashBalance,
      Object.fromEntries(Object.entries(get().quotes).map(([k, v]) => [k, v.last])),
    );
    const requiredMargin = Math.abs(o.qty) * contract.marginInitial;
    if (requiredMargin > account.availableMargin && o.type === "MARKET") {
      // Block market orders beyond margin; allow limit (will be checked on fill)
      set({
        orders: [{ ...order, status: "REJECTED", rejectReason: "Insufficient margin" }, ...get().orders],
      });
      get().addAlert({
        type: "ORDER",
        severity: "ERROR",
        message: `Order rejected: insufficient margin (need $${requiredMargin.toLocaleString()}, have $${account.availableMargin.toLocaleString()})`,
        symbol: o.symbol,
      });
      return id;
    }
    set({ orders: [order, ...get().orders] });
    get().log("INFO", "OMS", `Order placed: ${o.side} ${o.qty} ${o.symbol} @ ${o.type}`, { orderId: id });
    // Attempt immediate fill for market orders
    if (o.type === "MARKET") {
      const storeInternal = useTradingStore as unknown as TradingState & {
        executeOrder: (id: string, quote?: Quote) => void;
      };
      storeInternal.executeOrder(id, get().quotes[o.symbol]);
    }
    return id;
  },

  cancelOrder: (id) => {
    const order = get().orders.find((o) => o.id === id);
    if (!order || order.status !== "WORKING") return;
    set({
      orders: get().orders.map((o) =>
        o.id === id ? { ...o, status: "CANCELLED" as OrderStatus, updatedAt: Date.now() } : o,
      ),
    });
    get().log("INFO", "OMS", `Order cancelled: ${id}`, { symbol: order.symbol });
  },

  modifyOrder: (id, updates) => {
    set({
      orders: get().orders.map((o) => (o.id === id ? { ...o, ...updates, updatedAt: Date.now() } : o)),
    });
    get().log("INFO", "OMS", `Order modified: ${id}`, updates);
  },

  flattenAll: () => {
    const positions = Object.values(get().positions).filter((p) => p.netQty !== 0);
    for (const p of positions) {
      get().flattenSymbol(p.symbol);
    }
    get().log("WARN", "Risk", "FLATTEN ALL triggered", { positions: positions.length });
    get().addAlert({
      type: "RISK",
      severity: "WARN",
      message: `Flatten-all executed: closed ${positions.length} positions`,
    });
  },

  flattenSymbol: (symbol) => {
    const pos = get().positions[symbol];
    if (!pos || pos.netQty === 0) return;
    const quote = get().quotes[symbol];
    if (!quote) return;
    const side = pos.netQty > 0 ? "SELL" : "BUY";
    const qty = Math.abs(pos.netQty);
    get().placeOrder({
      symbol,
      side,
      type: "MARKET",
      tif: "IOC",
      qty,
      tag: "FLATTEN",
    });
  },

  addAlert: (a) => {
    const alert: Alert = {
      ...a,
      id: `alert-${alertCounter++}`,
      timestamp: Date.now(),
      acknowledged: false,
    };
    set({ alerts: [alert, ...get().alerts].slice(0, 100) });
  },

  ackAlert: (id) =>
    set({ alerts: get().alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)) }),

  clearAlerts: () => set({ alerts: [] }),

  addStrategy: (s) => {
    const strategy: Strategy = {
      ...s,
      id: `strat-${strategyCounter++}`,
      createdAt: Date.now(),
      pnl: 0,
      trades: 0,
      sharpe: 0,
      maxDrawdown: 0,
      currentSignal: 0,
      positionQty: 0,
      avgEntryPrice: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
      pnlHistory: [],
      peakPnL: 0,
    };
    set({ strategies: [...get().strategies, strategy] });
    get().log("INFO", "Strategy", `Strategy created: ${s.name}`, { type: s.type });
  },

  updateStrategy: (id, updates) =>
    set({ strategies: get().strategies.map((s) => (s.id === id ? { ...s, ...updates } : s)) }),

  removeStrategy: (id) => set({ strategies: get().strategies.filter((s) => s.id !== id) }),

  toggleStrategy: (id) => {
    const s = get().strategies.find((x) => x.id === id);
    if (!s) return;
    set({
      strategies: get().strategies.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)),
    });
    get().log("INFO", "Strategy", `Strategy ${s.enabled ? "disabled" : "enabled"}: ${s.name}`);
    if (!s.enabled) {
      get().addAlert({
        type: "STRATEGY",
        severity: "INFO",
        message: `Strategy "${s.name}" activated`,
      });
    }
  },

  startAlgo: (type, params) => {
    const algo = createAlgo(type, params);
    set({ algos: [algo, ...get().algos] });
    get().log("INFO", "AlgoEngine", `Algo ${type} started: ${params.side} ${params.totalQty} ${params.symbol}`, { algoId: algo.id });
    get().addAlert({
      type: "ORDER",
      severity: "INFO",
      message: `Algo ${type} started: ${params.side} ${params.totalQty} ${params.symbol}`,
    });
    return algo.id;
  },

  cancelAlgo: (id) => {
    const algo = get().algos.find((a) => a.id === id);
    if (!algo) return;
    cancelAlgoEngine(algo);
    set({ algos: get().algos.map((a) => (a.id === id ? { ...a, ...algo } : a)) });
    get().log("WARN", "AlgoEngine", `Algo ${id} cancelled`, { filled: algo.filledQty, total: algo.params.totalQty });
  },

  pauseAlgo: (id) => {
    const algo = get().algos.find((a) => a.id === id);
    if (!algo) return;
    pauseAlgoEngine(algo);
    set({ algos: get().algos.map((a) => (a.id === id ? { ...a, ...algo } : a)) });
    get().log("INFO", "AlgoEngine", `Algo ${id} paused`);
  },

  resumeAlgo: (id) => {
    const algo = get().algos.find((a) => a.id === id);
    if (!algo) return;
    resumeAlgoEngine(algo);
    set({ algos: get().algos.map((a) => (a.id === id ? { ...a, ...algo } : a)) });
    get().log("INFO", "AlgoEngine", `Algo ${id} resumed`);
  },

  addPriceAlert: (symbol, condition, threshold, name) => {
    const quote = get().quotes[symbol];
    const alert = createPriceAlert(symbol, condition, threshold, name, quote?.last);
    set({ priceAlerts: [alert, ...get().priceAlerts] });
    get().log("INFO", "Alerts", `Price alert created: ${name} (${condition} ${threshold})`, { symbol });
  },

  removePriceAlert: (id) => set({ priceAlerts: get().priceAlerts.filter((a) => a.id !== id) }),

  togglePriceAlert: (id) =>
    set({ priceAlerts: get().priceAlerts.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)) }),

  resetPriceAlert: (id) =>
    set({
      priceAlerts: get().priceAlerts.map((a) =>
        a.id === id ? { ...a, triggered: false, triggeredAt: undefined, triggeredValue: undefined } : a,
      ),
    }),

  addWatchlist: (name) => {
    const wl: Watchlist = {
      id: `wl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      entries: [],
      createdAt: Date.now(),
    };
    set({ watchlists: [...get().watchlists, wl] });
    get().log("INFO", "Watchlist", `Watchlist created: ${name}`);
  },

  removeWatchlist: (id) => set({ watchlists: get().watchlists.filter((w) => w.id !== id) }),

  addWatchlistEntry: (watchlistId, symbol, note) =>
    set({
      watchlists: get().watchlists.map((w) =>
        w.id === watchlistId && !w.entries.some((e) => e.symbol === symbol)
          ? { ...w, entries: [...w.entries, { symbol, note, addedAt: Date.now() }] }
          : w,
      ),
    }),

  removeWatchlistEntry: (watchlistId, symbol) =>
    set({
      watchlists: get().watchlists.map((w) =>
        w.id === watchlistId ? { ...w, entries: w.entries.filter((e) => e.symbol !== symbol) } : w,
      ),
    }),

  // Indicators Lab persisted actions
  setIndicatorSignalRules: (rules) => set({ indicatorSignalRules: rules }),
  setIndicatorSignalLog: (log) => set({ indicatorSignalLog: log }),
  setIndicatorPresets: (presets) => set({ indicatorPresets: presets }),
  setIndicatorActiveIndicators: (indicators) => set({ indicatorActiveIndicators: indicators }),
  setIndicatorTradeNote: (fillId, note) =>
    set({ indicatorTradeNotes: { ...get().indicatorTradeNotes, [fillId]: note } }),

  log: (level, module, message, metadata) => {
    const entry: LogEntry = {
      id: `log-${logCounter++}`,
      timestamp: Date.now(),
      level,
      module,
      message,
      metadata,
    };
    set({ logs: [entry, ...get().logs].slice(0, 500) });
  },
}));

// ---- Internal methods attached to the store via the prototype pattern ----
// We monkey-patch the store with the order-matching logic that needs access
// to current state.

function seedDemoData(set: (partial: Partial<TradingState>) => void, get: () => TradingState) {
  // Seed a small starter position in ES and a working limit order in NQ
  const state = get();
  const esQuote = state.quotes["ES"];
  const nqQuote = state.quotes["NQ"];
  const mnqQuote = state.quotes["MNQ"];
  if (esQuote) {
    const pos = computePosition("ES", 2, esQuote.last - 5, 0, esQuote.last);
    set({ positions: { ...get().positions, ES: pos } });
    get().log("INFO", "Position", "Seeded position: LONG 2 ES", { avgPrice: pos.avgPrice });
  }
  if (mnqQuote) {
    // Seed a Micro NQ long position to demonstrate micro contract support
    const pos = computePosition("MNQ", 10, mnqQuote.last - 2, 0, mnqQuote.last);
    set({ positions: { ...get().positions, MNQ: pos } });
    get().log("INFO", "Position", "Seeded position: LONG 10 MNQ (Micro NQ)", { avgPrice: pos.avgPrice });
  }
  if (nqQuote) {
    const order: Order = {
      id: nextId("ord"),
      clientId: `cli-${orderCounter++}`,
      symbol: "NQ",
      side: "BUY",
      type: "LIMIT",
      tif: "GTC",
      qty: 1,
      price: nqQuote.bid - 5,
      filledQty: 0,
      avgFillPrice: 0,
      status: "WORKING",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tag: "seed",
    };
    set({ orders: [order, ...get().orders] });
  }
  get().addAlert({
    type: "SYSTEM",
    severity: "INFO",
    message: "Demo session started with $1,000,000 buying power",
  });
}

// ---- Order matching logic (mutates store via get/set) ----
const store = useTradingStore as unknown as TradingState & {
  markOrders: (q: Quote) => void;
  executeOrder: (id: string, quote?: Quote) => void;
  updatePositions: (q: Quote) => void;
  applyFill: (order: Order, fillQty: number, fillPrice: number) => void;
  stepAlgos: (q: Quote) => void;
  evaluateAlerts: (q: Quote) => void;
  stepStrategies: (q: Quote) => void;
  stepCorrelationAlerts: (q: Quote) => void;
};

store.markOrders = (q: Quote) => {
  const state = useTradingStore.getState();
  const working = state.orders.filter((o) => o.status === "WORKING" && o.symbol === q.symbol);
  for (const o of working) {
    let shouldFill = false;
    let fillPrice = 0;
    if (o.type === "LIMIT") {
      if (o.side === "BUY" && q.ask <= (o.price ?? Infinity)) {
        shouldFill = true;
        fillPrice = o.price ?? q.ask;
      } else if (o.side === "SELL" && q.bid >= (o.price ?? 0)) {
        shouldFill = true;
        fillPrice = o.price ?? q.bid;
      }
    } else if (o.type === "STOP") {
      if (o.side === "BUY" && q.last >= (o.stopPrice ?? Infinity)) {
        shouldFill = true;
        fillPrice = q.ask;
      } else if (o.side === "SELL" && q.last <= (o.stopPrice ?? 0)) {
        shouldFill = true;
        fillPrice = q.bid;
      }
    } else if (o.type === "STOP_LIMIT") {
      if (o.side === "BUY" && q.last >= (o.stopPrice ?? Infinity)) {
        // Convert to limit at o.price
        o.type = "LIMIT" as const;
        useTradingStore.setState({
          orders: useTradingStore.getState().orders.map((x) => (x.id === o.id ? { ...x, type: "LIMIT" } : x)),
        });
      } else if (o.side === "SELL" && q.last <= (o.stopPrice ?? 0)) {
        o.type = "LIMIT" as const;
        useTradingStore.setState({
          orders: useTradingStore.getState().orders.map((x) => (x.id === o.id ? { ...x, type: "LIMIT" } : x)),
        });
      }
    } else if (o.type === "MIT") {
      if (o.side === "BUY" && q.last <= (o.price ?? Infinity)) {
        shouldFill = true;
        fillPrice = q.ask;
      } else if (o.side === "SELL" && q.last >= (o.price ?? 0)) {
        shouldFill = true;
        fillPrice = q.bid;
      }
    }
    if (shouldFill) {
      store.executeOrder(o.id, q);
    }
  }
};

store.executeOrder = (id: string, quote?: Quote) => {
  const state = useTradingStore.getState();
  const order = state.orders.find((o) => o.id === id);
  if (!order || order.status !== "WORKING") return;
  const q = quote ?? state.quotes[order.symbol];
  if (!q) return;
  let fillPrice = order.type === "LIMIT" ? order.price ?? q.last : q.last;
  if (order.type === "MARKET") {
    fillPrice = order.side === "BUY" ? q.ask : q.bid;
  } else if (order.type === "STOP") {
    fillPrice = order.side === "BUY" ? q.ask : q.bid;
  } else if (order.type === "MIT") {
    fillPrice = order.side === "BUY" ? q.ask : q.bid;
  }
  store.applyFill(order, order.qty - order.filledQty, fillPrice);
};

store.applyFill = (order: Order, fillQty: number, fillPrice: number) => {
  const state = useTradingStore.getState();
  const contract = getContract(order.symbol);
  const commission = fillQty * COMMISSION_PER_CONTRACT;
  const fill: Fill = {
    id: `fill-${fillCounter++}`,
    orderId: order.id,
    symbol: order.symbol,
    side: order.side,
    qty: fillQty,
    price: fillPrice,
    timestamp: Date.now(),
    commission,
    fees: fillQty * 0.05,
    strategy: order.strategy,
  };
  // Update order
  const updatedOrders = state.orders.map((o) => {
    if (o.id !== order.id) return o;
    const newFilled = o.filledQty + fillQty;
    const newAvg =
      o.avgFillPrice === 0
        ? fillPrice
        : (o.avgFillPrice * o.filledQty + fillPrice * fillQty) / newFilled;
    return {
      ...o,
      filledQty: newFilled,
      avgFillPrice: newAvg,
      status:
        newFilled >= o.qty
          ? ("FILLED" as OrderStatus)
          : ("PARTIALLY_FILLED" as OrderStatus),
      updatedAt: Date.now(),
    };
  });
  // Update position
  const oldPos = state.positions[order.symbol] ?? computePosition(order.symbol, 0, 0, 0, fillPrice);
  const signedQty = order.side === "BUY" ? fillQty : -fillQty;
  const newNetQty = oldPos.netQty + signedQty;
  let newAvgPrice = oldPos.avgPrice;
  let newRealized = oldPos.realizedPnL - commission;
  // If reducing position, realise P&L on the closed portion
  if (Math.sign(signedQty) !== Math.sign(oldPos.netQty) && oldPos.netQty !== 0) {
    const closedQty = Math.min(Math.abs(signedQty), Math.abs(oldPos.netQty));
    const pnlPerUnit = (fillPrice - oldPos.avgPrice) * (oldPos.netQty > 0 ? 1 : -1);
    newRealized += closedQty * pnlPerUnit * contract.pointValue;
  }
  // Compute new avg price (only when adding to position in same direction)
  if (Math.sign(signedQty) === Math.sign(oldPos.netQty) || oldPos.netQty === 0) {
    const totalCost =
      Math.abs(oldPos.netQty) * oldPos.avgPrice + Math.abs(signedQty) * fillPrice;
    const totalQty = Math.abs(oldPos.netQty) + Math.abs(signedQty);
    newAvgPrice = totalQty > 0 ? totalCost / totalQty : 0;
  } else if (Math.abs(newNetQty) === 0) {
    newAvgPrice = 0;
  }
  const newPos = computePosition(order.symbol, newNetQty, newAvgPrice, newRealized, fillPrice);
  const cashImpact = (newRealized - oldPos.realizedPnL); // realized includes commission deduction
  const finalCash = state.cashBalance + cashImpact;
  // Record fill
  useTradingStore.setState({
    orders: updatedOrders,
    fills: [fill, ...state.fills].slice(0, 200),
    positions: { ...state.positions, [order.symbol]: newPos },
    cashBalance: finalCash,
  });
  useTradingStore.getState().log("INFO", "Execution", `Fill: ${fill.side} ${fill.qty} ${fill.symbol} @ ${fillPrice.toFixed(4)}`, {
    orderId: order.id,
  });
  if (order.tag === "FLATTEN") {
    useTradingStore.getState().addAlert({
      type: "ORDER",
      severity: "INFO",
      message: `Flatten ${order.symbol}: ${fill.side} ${fill.qty} @ ${fillPrice.toFixed(2)}`,
      symbol: order.symbol,
    });
  }
};

store.updatePositions = (q: Quote) => {
  const state = useTradingStore.getState();
  const old = state.positions[q.symbol];
  if (!old || old.netQty === 0) {
    // Still update lastPrice for display even with zero position
    if (old) {
      useTradingStore.setState({
        positions: { ...state.positions, [q.symbol]: { ...old, lastPrice: q.last } },
      });
    }
    return;
  }
  const newPos = computePosition(q.symbol, old.netQty, old.avgPrice, old.realizedPnL, q.last);
  useTradingStore.setState({
    positions: { ...state.positions, [q.symbol]: newPos },
  });
};

// Step all running algos on each tick — generates child orders as needed
store.stepAlgos = (q: Quote) => {
  const state = useTradingStore.getState();
  const activeAlgos = state.algos.filter(
    (a) => (a.status === "RUNNING" || a.status === "QUEUED") && a.params.symbol === q.symbol,
  );
  if (activeAlgos.length === 0) return;
  const storeInternal = useTradingStore as unknown as TradingState & {
    applyFill: (order: Order, fillQty: number, fillPrice: number) => void;
  };
  for (const algo of activeAlgos) {
    // Make a working copy
    const working: AlgoState = { ...algo, log: [...algo.log], schedule: algo.schedule ? [...algo.schedule] : undefined };
    const childOrders = stepAlgo(working, q);
    // Place each child order (immediate fill simulation)
    for (const child of childOrders) {
      const fillPrice = child.orderType === "MARKET"
        ? (working.params.side === "BUY" ? q.ask : q.bid)
        : (child.price ?? q.last);
      // Directly apply the fill to algo and to the position
      recordAlgoFill(working, child.qty, fillPrice);
      // Apply as a synthetic fill via the OMS so positions update
      const fakeOrder: Order = {
        id: `algo-${algo.id}-slice-${working.childOrdersPlaced}`,
        clientId: `algo-${algo.id}`,
        symbol: working.params.symbol,
        side: working.params.side,
        type: child.orderType,
        tif: "DAY",
        qty: child.qty,
        filledQty: 0,
        avgFillPrice: 0,
        price: child.price,
        status: "WORKING",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tag: `algo:${algo.type}`,
        strategy: algo.id,
      };
      storeInternal.applyFill(fakeOrder, child.qty, fillPrice);
    }
    // Persist algo state
    useTradingStore.setState({
      algos: useTradingStore.getState().algos.map((a) => (a.id === algo.id ? { ...working } : a)),
    });
  }
};

// Evaluate all enabled, non-triggered price alerts against current quote + candle history
store.evaluateAlerts = (q: Quote) => {
  const state = useTradingStore.getState();
  const alertsForSymbol = state.priceAlerts.filter(
    (a) => a.symbol === q.symbol && a.enabled && !a.triggered,
  );
  if (alertsForSymbol.length === 0) return;
  const candles = getEngine().getCandles(q.symbol, 100);
  let changed = false;
  for (const alert of alertsForSymbol) {
    // Make a working copy
    const working: PriceAlert = { ...alert };
    const fired = evaluateAlert(working, q, candles);
    if (fired) {
      changed = true;
      // Notify via app alert system
      useTradingStore.getState().addAlert({
        type: "PRICE",
        severity: "WARN",
        message: `Alert triggered: ${alert.name} — ${alert.condition.replace(/_/g, " ")} ${alert.threshold} (${q.symbol} @ ${q.last.toFixed(4)})`,
        symbol: q.symbol,
      });
      useTradingStore.getState().log("WARN", "Alerts", `Price alert fired: ${alert.name}`, {
        symbol: q.symbol,
        condition: alert.condition,
        threshold: alert.threshold,
        triggeredValue: working.triggeredValue,
      });
      // Persist the triggered state
      useTradingStore.setState({
        priceAlerts: useTradingStore.getState().priceAlerts.map((a) =>
          a.id === alert.id ? { ...working } : a,
        ),
      });
    }
  }
};

// ============================================================
// STRATEGY EXECUTION ENGINE
// Runs on every tick. For each enabled strategy:
//   1. Get candles for strategy's symbol
//   2. Call strategy.generate() to get current signal (-1, 0, +1)
//   3. If signal changed, place orders to adjust position
//   4. Track P&L, update strategy stats (Sharpe, MDD)
// Throttled to ~once per 3 seconds per strategy to avoid overtrading.
// ============================================================
store.stepStrategies = (q: Quote) => {
  const state = useTradingStore.getState();
  const enabledStrategies = state.strategies.filter((s) => s.enabled);
  if (enabledStrategies.length === 0) return;
  const now = Date.now();
  let changed = false;
  const updatedStrategies = state.strategies.map((s) => {
    if (!s.enabled) return s;
    // Throttle: only evaluate each strategy every 3 seconds
    if (s.lastSignalAt && now - s.lastSignalAt < 3000) {
      // Still update unrealized P&L
      if (s.positionQty !== 0 && s.lastSignalPrice) {
        const currentPrice = q.symbol === s.symbols[0] ? q.last : (state.quotes[s.symbols[0]]?.last ?? s.lastSignalPrice);
        const unreal = s.positionQty * (currentPrice - s.avgEntryPrice) * getContract(s.symbols[0]).pointValue;
        return { ...s, unrealizedPnL: unreal, pnl: s.realizedPnL + unreal };
      }
      return s;
    }
    const symbol = s.symbols[0];
    if (!symbol) return s;
    const quote = state.quotes[symbol];
    if (!quote) return s;
    // Get candles
    const candles = getEngine().getCandles(symbol, 200);
    if (candles.length < 30) return s;
    // Get pair candles for PAIRS strategy
    let pairCandles: Candle[] | undefined;
    if (s.type === "PAIRS" && s.symbols.length > 1) {
      pairCandles = getEngine().getCandles(s.symbols[1], 200);
    }
    // Find the strategy definition
    const def = STRATEGIES.find((d) => d.type === s.type);
    if (!def) return s;
    // Generate signals
    let signals: { signal: number; reason: string }[];
    try {
      signals = def.generate(candles, s.params, pairCandles);
    } catch (e) {
      return s;
    }
    if (signals.length === 0) return s;
    const currentSignal = signals[signals.length - 1].signal;
    const currentPrice = quote.last;
    const contract = getContract(symbol);
    const qtyPerTrade = 1; // 1 contract per signal change
    let newStrategy = { ...s };
    // Check if signal changed
    if (currentSignal !== s.currentSignal) {
      // Close existing position if any
      if (s.positionQty !== 0) {
        const closeSide = s.positionQty > 0 ? "SELL" : "BUY";
        const closeQty = Math.abs(s.positionQty);
        const fillPrice = closeSide === "BUY" ? quote.ask : quote.bid;
        // Realize P&L
        const pnlPerUnit = (fillPrice - s.avgEntryPrice) * (s.positionQty > 0 ? 1 : -1);
        const realized = closeQty * pnlPerUnit * contract.pointValue - closeQty * COMMISSION_PER_CONTRACT;
        newStrategy.realizedPnL += realized;
        newStrategy.positionQty = 0;
        newStrategy.avgEntryPrice = 0;
        newStrategy.trades += 1;
        // Place the order
        useTradingStore.getState().placeOrder({
          symbol,
          side: closeSide,
          type: "MARKET",
          tif: "DAY",
          qty: closeQty,
          tag: `strat:${s.name}:close`,
          strategy: s.id,
        });
        useTradingStore.getState().log("INFO", "Strategy", `[${s.name}] Close ${closeQty} ${symbol} @ ${fillPrice.toFixed(2)} realized=${realized.toFixed(2)}`, { strategyId: s.id });
      }
      // Open new position if signal is non-zero
      if (currentSignal !== 0) {
        const openSide = currentSignal > 0 ? "BUY" : "SELL";
        const fillPrice = openSide === "BUY" ? quote.ask : quote.bid;
        newStrategy.positionQty = currentSignal > 0 ? qtyPerTrade : -qtyPerTrade;
        newStrategy.avgEntryPrice = fillPrice;
        useTradingStore.getState().placeOrder({
          symbol,
          side: openSide,
          type: "MARKET",
          tif: "DAY",
          qty: qtyPerTrade,
          tag: `strat:${s.name}:open`,
          strategy: s.id,
        });
        useTradingStore.getState().log("INFO", "Strategy", `[${s.name}] Open ${openSide} ${qtyPerTrade} ${symbol} @ ${fillPrice.toFixed(2)} signal=${currentSignal}`, { strategyId: s.id });
        useTradingStore.getState().addAlert({
          type: "STRATEGY",
          severity: "INFO",
          message: `[${s.name}] ${openSide} ${qtyPerTrade} ${symbol} @ ${fillPrice.toFixed(2)} — ${signals[signals.length - 1].reason}`,
          symbol,
        });
      }
      newStrategy.currentSignal = currentSignal;
      newStrategy.lastSignalAt = now;
      newStrategy.lastSignalPrice = currentPrice;
      changed = true;
    }
    // Update unrealized P&L
    if (newStrategy.positionQty !== 0) {
      const unreal = newStrategy.positionQty * (currentPrice - newStrategy.avgEntryPrice) * contract.pointValue;
      newStrategy.unrealizedPnL = unreal;
      newStrategy.pnl = newStrategy.realizedPnL + unreal;
    } else {
      newStrategy.unrealizedPnL = 0;
      newStrategy.pnl = newStrategy.realizedPnL;
    }
    // Track P&L history for Sharpe/MDD
    newStrategy.pnlHistory = [...s.pnlHistory, { time: now, pnl: newStrategy.pnl }].slice(-200);
    newStrategy.peakPnL = Math.max(s.peakPnL, newStrategy.pnl);
    // Compute Sharpe (annualized) from recent P&L history
    if (newStrategy.pnlHistory.length > 10) {
      const returns: number[] = [];
      for (let i = 1; i < newStrategy.pnlHistory.length; i++) {
        const prev = newStrategy.pnlHistory[i - 1].pnl;
        const curr = newStrategy.pnlHistory[i].pnl;
        if (prev !== 0) returns.push((curr - prev) / Math.abs(prev));
      }
      if (returns.length > 5) {
        const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
        const sd = Math.sqrt(variance);
        newStrategy.sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
      }
    }
    // Compute max drawdown
    let peak = -Infinity;
    let maxDD = 0;
    for (const ph of newStrategy.pnlHistory) {
      peak = Math.max(peak, ph.pnl);
      const dd = ph.pnl - peak;
      if (dd < maxDD) maxDD = dd;
    }
    newStrategy.maxDrawdown = maxDD;
    return newStrategy;
  });
  if (changed) {
    useTradingStore.setState({ strategies: updatedStrategies });
  } else {
    // Still update unrealized P&L even if no signal change
    useTradingStore.setState({ strategies: updatedStrategies });
  }
};

// ============================================================
// CORRELATION BREAKDOWN ALERTS
//
// Runs on every tick but throttled to ~once per 30 seconds (cheaply:
// we cache the last run timestamp + the set of pairs we've already
// alerted on, so each unique breakdown only fires ONE alert).
//
// Detects EXTREME correlation breakdowns across the same 12 default
// pairs used by the Correlation Arbitrage module, and pushes them
// into the alerts store so they appear in the bell icon dropdown.
// ============================================================
const CORR_ALERT_THROTTLE_MS = 30_000; // re-scan at most every 30s
const CORR_ALERT_REARM_MS = 5 * 60_000; // re-arm a pair's alert after 5 min
let lastCorrScanAt = 0;
const alertedPairs = new Map<string, number>(); // pairKey → last alert timestamp

store.stepCorrelationAlerts = (q: Quote) => {
  const now = Date.now();
  if (now - lastCorrScanAt < CORR_ALERT_THROTTLE_MS) return;
  lastCorrScanAt = now;
  try {
    const breakdowns = detectCorrelationBreakdowns(DEFAULT_PAIRS, 50, 200);
    // Filter to EXTREME severity only — those are the ones worth interrupting the user for
    const extreme = breakdowns.filter((b) => b.severity === "EXTREME");
    for (const b of extreme) {
      const key = `${b.symbolA}/${b.symbolB}:${b.signal}`;
      const lastAlert = alertedPairs.get(key);
      if (lastAlert && now - lastAlert < CORR_ALERT_REARM_MS) continue; // already alerted recently
      alertedPairs.set(key, now);
      const direction = b.signal === "BREAKDOWN" ? "broke down" : b.signal === "STRENGTHENING" ? "spiked" : "shifted";
      const msg = `Correlation ${direction}: ${b.pair} ${b.currentCorr.toFixed(2)} vs ${b.historicalMean.toFixed(2)} (z=${b.zScore.toFixed(1)})`;
      useTradingStore.getState().addAlert({
        type: "RISK",
        severity: "CRITICAL",
        message: msg,
        symbol: b.symbolA,
      });
      useTradingStore.getState().log("WARN", "CorrelationMonitor", msg, {
        pair: b.pair, current: b.currentCorr, mean: b.historicalMean, z: b.zScore,
      });
    }
    // Garbage-collect old entries from alertedPairs so the map doesn't grow forever
    if (alertedPairs.size > 100) {
      for (const [k, t] of alertedPairs.entries()) {
        if (now - t > CORR_ALERT_REARM_MS * 2) alertedPairs.delete(k);
      }
    }
  } catch {
    // Engine not yet initialised (e.g. during SSR) — silently skip; will run on next tick.
  }
};
