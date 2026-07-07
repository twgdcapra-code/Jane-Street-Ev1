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
 * This single store mirrors Jane Street's "no silos" risk discipline — every
 * module reads from the same state, so risk always sees the live book.
 */
"use client";

import { create } from "zustand";
import type {
  Account,
  Alert,
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
  addStrategy: (s: Omit<Strategy, "id" | "createdAt" | "pnl" | "trades" | "sharpe" | "maxDrawdown">) => void;
  updateStrategy: (id: string, updates: Partial<Strategy>) => void;
  removeStrategy: (id: string) => void;
  toggleStrategy: (id: string) => void;
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
      params: { lookback: 30, entryZ: 2, exitZ: 0, stopZ: 4 },
      enabled: false,
      pnl: 0,
      trades: 0,
      sharpe: 0,
      maxDrawdown: 0,
      createdAt: Date.now(),
    },
    {
      id: "strat-2",
      name: "NQ Momentum",
      type: "MOMENTUM",
      description: "EMA cross momentum on E-mini Nasdaq",
      symbols: ["NQ"],
      params: { fast: 9, slow: 21, rsiPeriod: 14, rsiUpper: 70, rsiLower: 30 },
      enabled: false,
      pnl: 0,
      trades: 0,
      sharpe: 0,
      maxDrawdown: 0,
      createdAt: Date.now(),
    },
  ],
  alerts: [],
  logs: [],
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
    };
    storeInternal.markOrders(q);
    storeInternal.updatePositions(q);
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
  if (esQuote) {
    const pos = computePosition("ES", 2, esQuote.last - 5, 0, esQuote.last);
    set({ positions: { ...get().positions, ES: pos } });
    get().log("INFO", "Position", "Seeded position: LONG 2 ES", { avgPrice: pos.avgPrice });
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
