/**
 * Execution Plugin System
 *
 * Extensible adapter pattern for connecting to real broker APIs.
 * Currently supports a "SIMULATION" adapter (the built-in market engine).
 * Future adapters can be added (Tradovate, Interactive Brokers, NinjaTrader,
 * TradingView, CME Direct, etc.) by implementing the ExecutionAdapter interface.
 *
 * Architecture:
 *  - ExecutionAdapter: the interface all adapters must implement
 *  - ExecutionPlugin: wraps an adapter with metadata, config, and state
 *  - ExecutionManager: orchestrates multiple plugins, routes orders
 *
 * Each adapter receives orders from the ExecutionManager and reports fills back.
 * This separation allows the UI to work identically whether trading simulated
 * or live — just swap the active adapter.
 */

import type { Order, Fill, Side, OrderType, TimeInForce } from "./types";

export type AdapterStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";

export interface AdapterConfig {
  apiKey?: string;
  apiSecret?: string;
  accountId?: string;
  endpoint?: string;
  paperTrading?: boolean;
  [key: string]: string | boolean | number | undefined;
}

export interface AdapterMetadata {
  id: string;
  name: string;
  description: string;
  supportedOrderTypes: OrderType[];
  supportedTifs: TimeInForce[];
  configSchema: { key: string; label: string; type: "string" | "password" | "boolean" | "number"; required: boolean; default?: string | boolean | number }[];
  isLive: boolean; // true = real money, false = simulation/paper
  logoColor: string;
}

export interface ExecutionAdapter {
  metadata: AdapterMetadata;
  status: AdapterStatus;
  connect(config: AdapterConfig): Promise<boolean>;
  disconnect(): Promise<void>;
  placeOrder(order: SubmitOrder): Promise<string>; // returns broker order ID
  cancelOrder(brokerOrderId: string): Promise<boolean>;
  modifyOrder(brokerOrderId: string, updates: Partial<SubmitOrder>): Promise<boolean>;
  getPositions(): Promise<BrokerPosition[]>;
  getAccountBalance(): Promise<BrokerAccount>;
  subscribeToFills(callback: (fill: Fill) => void): void;
}

export interface SubmitOrder {
  symbol: string;
  side: Side;
  type: OrderType;
  tif: TimeInForce;
  qty: number;
  price?: number;
  stopPrice?: number;
  tag?: string;
}

export interface BrokerPosition {
  symbol: string;
  qty: number;
  avgPrice: number;
  marketValue: number;
  unrealizedPnL: number;
}

export interface BrokerAccount {
  cashBalance: number;
  equity: number;
  buyingPower: number;
  marginUsed: number;
}

// ============================================================
// SIMULATION ADAPTER (built-in, uses the existing market engine)
// ============================================================

export const SimulationAdapter: AdapterMetadata = {
  id: "simulation",
  name: "TWG Simulation",
  description: "Built-in simulation engine with stochastic market data. No real money. Use for testing and development.",
  supportedOrderTypes: ["MARKET", "LIMIT", "STOP", "STOP_LIMIT", "MIT"],
  supportedTifs: ["DAY", "GTC", "IOC", "FOK"],
  configSchema: [
    { key: "startingCapital", label: "Starting Capital", type: "number", required: false, default: 1000000 },
    { key: "paperTrading", label: "Paper Trading", type: "boolean", required: false, default: true },
  ],
  isLive: false,
  logoColor: "#3b82f6",
};

// ============================================================
// FUTURE ADAPTERS (stubs for documentation — not yet implemented)
// ============================================================

export const TradovateAdapter: AdapterMetadata = {
  id: "tradovate",
  name: "Tradovate",
  description: "Connect to Tradovate broker for live futures trading. Supports CME, ICE, EUREX. REST + WebSocket API.",
  supportedOrderTypes: ["MARKET", "LIMIT", "STOP", "STOP_LIMIT", "MIT"],
  supportedTifs: ["DAY", "GTC", "IOC", "FOK"],
  configSchema: [
    { key: "username", label: "Username", type: "string", required: true },
    { key: "password", label: "Password", type: "password", required: true },
    { key: "deviceId", label: "Device ID", type: "string", required: true },
    { key: "appId", label: "App ID", type: "string", required: true, default: "TWG Terminal" },
    { key: "paperTrading", label: "Paper Trading (Demo)", type: "boolean", required: false, default: true },
  ],
  isLive: true,
  logoColor: "#10b981",
};

export const InteractiveBrokersAdapter: AdapterMetadata = {
  id: "ibkr",
  name: "Interactive Brokers",
  description: "Connect to IBKR TWS or Gateway via the IB API. Supports all futures products worldwide.",
  supportedOrderTypes: ["MARKET", "LIMIT", "STOP", "STOP_LIMIT", "MIT"],
  supportedTifs: ["DAY", "GTC", "IOC", "FOK"],
  configSchema: [
    { key: "host", label: "TWS Host", type: "string", required: false, default: "127.0.0.1" },
    { key: "port", label: "TWS Port", type: "number", required: true, default: 7497 },
    { key: "clientId", label: "Client ID", type: "number", required: true, default: 1 },
    { key: "paperTrading", label: "Paper Trading", type: "boolean", required: false, default: true },
  ],
  isLive: true,
  logoColor: "#ef4444",
};

export const NinjaTraderAdapter: AdapterMetadata = {
  id: "ninjatrader",
  name: "NinjaTrader",
  description: "Connect to NinjaTrader broker via the NinjaTrader API. Popular for futures day trading.",
  supportedOrderTypes: ["MARKET", "LIMIT", "STOP", "STOP_LIMIT", "MIT"],
  supportedTifs: ["DAY", "GTC", "IOC", "FOK"],
  configSchema: [
    { key: "username", label: "Username", type: "string", required: true },
    { key: "password", label: "Password", type: "password", required: true },
    { key: "paperTrading", label: "Simulation", type: "boolean", required: false, default: true },
  ],
  isLive: true,
  logoColor: "#f59e0b",
};

export const TradingViewAdapter: AdapterMetadata = {
  id: "tradingview",
  name: "TradingView",
  description: "Connect via TradingView webhook alerts. Send signals from TradingView charts to TWG Terminal for execution.",
  supportedOrderTypes: ["MARKET", "LIMIT"],
  supportedTifs: ["DAY", "GTC"],
  configSchema: [
    { key: "webhookUrl", label: "Webhook URL", type: "string", required: true },
    { key: "secret", label: "Webhook Secret", type: "password", required: true },
  ],
  isLive: true,
  logoColor: "#a855f7",
};

export const AVAILABLE_ADAPTERS: AdapterMetadata[] = [
  SimulationAdapter,
  TradovateAdapter,
  InteractiveBrokersAdapter,
  NinjaTraderAdapter,
  TradingViewAdapter,
];

// ============================================================
// EXECUTION PLUGIN (wraps adapter with config and state)
// ============================================================

export interface ExecutionPlugin {
  metadata: AdapterMetadata;
  config: AdapterConfig;
  status: AdapterStatus;
  isPrimary: boolean; // is this the currently active adapter?
  lastError?: string;
  connectedAt?: number;
  orderCount: number;
  fillCount: number;
}

export const DEFAULT_PLUGINS: ExecutionPlugin[] = [
  {
    metadata: SimulationAdapter,
    config: { paperTrading: true, startingCapital: 1000000 },
    status: "CONNECTED",
    isPrimary: true,
    connectedAt: Date.now(),
    orderCount: 0,
    fillCount: 0,
  },
];

// ============================================================
// SMART ORDER ROUTING LOGIC
// ============================================================

export type SORBenchmark = "VWAP" | "TWAP" | "IS" | "POV" | "ARRIVAL";

export interface SORResult {
  benchmark: SORBenchmark;
  expectedSlippageBps: number;
  childOrders: { qty: number; delayMs: number; type: OrderType }[];
  estimatedTimeSec: number;
  explanation: string;
}

/**
 * Smart Order Router: given an order, recommend execution strategy.
 * Uses square-root impact model: slippage = k * sigma * sqrt(qty / ADV)
 */
export function smartRouteOrder(
  qty: number,
  adv: number,
  volatility: number,
  spreadBps: number,
  urgency: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM",
): SORResult {
  const k = 0.5; // impact coefficient
  const participationRate = urgency === "HIGH" ? 0.15 : urgency === "MEDIUM" ? 0.08 : 0.03;
  const impact = k * volatility * Math.sqrt(qty / Math.max(adv, 1));
  const impactBps = impact * 10000;
  const totalSlippage = impactBps + spreadBps / 2;
  // Determine child order count and timing
  const maxSliceSize = Math.max(1, Math.floor(adv * participationRate));
  const nSlices = Math.ceil(qty / maxSliceSize);
  const totalDurationSec = urgency === "HIGH" ? 30 : urgency === "MEDIUM" ? 120 : 600;
  const sliceInterval = totalDurationSec * 1000 / nSlices;
  const childOrders: { qty: number; delayMs: number; type: OrderType }[] = [];
  let remaining = qty;
  for (let i = 0; i < nSlices; i++) {
    const sliceQty = Math.min(remaining, maxSliceSize);
    childOrders.push({
      qty: sliceQty,
      delayMs: i * sliceInterval,
      type: "LIMIT" as OrderType,
    });
    remaining -= sliceQty;
  }
  let benchmark: SORBenchmark;
  let explanation: string;
  if (urgency === "HIGH" && qty < adv * 0.01) {
    benchmark = "ARRIVAL";
    explanation = `High urgency + small order (${qty} < 1% ADV). Execute immediately at arrival price. Expected slippage: ${totalSlippage.toFixed(1)} bps.`;
  } else if (urgency === "HIGH") {
    benchmark = "IS";
    explanation = `High urgency + larger order. Implementation Shortfall: front-load execution to minimize timing risk. ${nSlices} child orders over ${totalDurationSec}s. Expected slippage: ${totalSlippage.toFixed(1)} bps.`;
  } else if (urgency === "MEDIUM") {
    benchmark = "VWAP";
    explanation = `Medium urgency. VWAP execution: ${nSlices} child orders distributed over ${totalDurationSec}s to match volume curve. Expected slippage: ${totalSlippage.toFixed(1)} bps.`;
  } else {
    benchmark = "POV";
    explanation = `Low urgency. Percentage of Volume (POV) at ${(participationRate * 100).toFixed(0)}%: ${nSlices} child orders over ~${totalDurationSec}s. Minimizes market impact. Expected slippage: ${totalSlippage.toFixed(1)} bps.`;
  }
  return {
    benchmark,
    expectedSlippageBps: totalSlippage,
    childOrders,
    estimatedTimeSec: totalDurationSec,
    explanation,
  };
}

// ============================================================
// TRANSACTION COST ANALYSIS (TCA)
// ============================================================

export interface TCAResult {
  arrivalPrice: number;
  executionPrice: number;
  benchmark: "VWAP" | "TWAP" | "ARRIVAL";
  implementationShortfallBps: number;
  slippageBps: number;
  marketImpactBps: number;
  timingCostBps: number;
  commission: number;
  totalCost: number;
}

export function computeTCA(
  fills: { price: number; qty: number; timestamp: number }[],
  arrivalPrice: number,
  vwap: number,
  commissionPerContract: number = 2.25,
): TCAResult {
  if (fills.length === 0) {
    return {
      arrivalPrice,
      executionPrice: arrivalPrice,
      benchmark: "ARRIVAL",
      implementationShortfallBps: 0,
      slippageBps: 0,
      marketImpactBps: 0,
      timingCostBps: 0,
      commission: 0,
      totalCost: 0,
    };
  }
  const totalQty = fills.reduce((s, f) => s + f.qty, 0);
  const notional = fills.reduce((s, f) => s + f.price * f.qty, 0);
  const execPrice = notional / totalQty;
  const isBuy = fills[0].qty > 0; // simplified
  const slippage = isBuy ? execPrice - arrivalPrice : arrivalPrice - execPrice;
  const slippageBps = (slippage / arrivalPrice) * 10000;
  const vwapSlippage = isBuy ? execPrice - vwap : vwap - execPrice;
  const marketImpactBps = Math.abs((vwapSlippage / vwap) * 10000);
  const timingCostBps = Math.max(0, slippageBps - marketImpactBps);
  const commission = totalQty * commissionPerContract;
  const totalCost = Math.abs(slippage * totalQty) + commission;
  return {
    arrivalPrice,
    executionPrice: execPrice,
    benchmark: "VWAP",
    implementationShortfallBps: slippageBps,
    slippageBps,
    marketImpactBps,
    timingCostBps,
    commission,
    totalCost,
  };
}
