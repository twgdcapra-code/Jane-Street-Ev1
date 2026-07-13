/**
 * TWG Terminal — Core Type System
 * Inspired by TwigCapra's strict typing discipline (a la OCaml).
 * All domain entities are modeled as discriminated unions where applicable.
 */

export type Side = "BUY" | "SELL";

export type OrderType =
  | "MARKET"
  | "LIMIT"
  | "STOP"
  | "STOP_LIMIT"
  | "MIT" // Market-if-touched
  | "ICEBERG"
  | "TWAP"
  | "VWAP";

export type OrderStatus =
  | "WORKING"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED"
  | "PENDING";

export type TimeInForce =
  | "DAY"
  | "GTC"
  | "IOC"
  | "FOK"
  | "GTD";

export interface FuturesContract {
  symbol: string;
  name: string;
  exchange: string;
  assetClass: "equity_index" | "rate" | "fx" | "metal" | "energy" | "agri" | "crypto";
  tickSize: number;
  tickValue: number; // USD per tick
  contractSize: number;
  multiplier: number;
  pointValue: number; // USD per 1.0 point move
  marginInitial: number;
  marginMaintenance: number;
  months: string[]; // contract cycle
  settlement: "cash" | "physical";
  currency: string;
  basePrice: number;
  volatility: number; // annualized
  drift: number; // annualized
  session: string;
}

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  last: number;
  prevSettle: number;
  change: number;
  changePct: number;
  volume: number;
  openInterest: number;
  high: number;
  low: number;
  open: number;
  vwap: number;
  timestamp: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DepthLevel {
  price: number;
  size: number;
  orders: number;
}

export interface OrderBook {
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
  timestamp: number;
}

export interface Order {
  id: string;
  clientId: string;
  symbol: string;
  side: Side;
  type: OrderType;
  tif: TimeInForce;
  qty: number;
  filledQty: number;
  price?: number;
  stopPrice?: number;
  status: OrderStatus;
  avgFillPrice: number;
  createdAt: number;
  updatedAt: number;
  strategy?: string;
  tag?: string;
  rejectReason?: string;
  /** TCA: market state at decision time (captured on order creation). */
  arrivalPrice?: number;
  arrivalBid?: number;
  arrivalAsk?: number;
  arrivalMid?: number;
  arrivalVwap?: number;
}

export interface Fill {
  id: string;
  orderId: string;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  timestamp: number;
  commission: number;
  fees: number;
  strategy?: string;
  /** TCA: snapshot of market at order-decision time (denormalised for convenience). */
  arrivalPrice?: number;
  arrivalMid?: number;
  arrivalVwap?: number;
  /** Order type that produced this fill (for per-type TCA grouping). */
  orderType?: string;
  /** Tag copied from order at fill time (e.g. "FLATTEN", "STRATEGY"). */
  tag?: string;
}

export interface Position {
  symbol: string;
  netQty: number; // long positive, short negative
  avgPrice: number;
  realizedPnL: number;
  unrealizedPnL: number;
  marketValue: number;
  costBasis: number;
  lastPrice: number;
  sessionPnL: number;
  sessionPnLPct: number;
  totalPnL: number;
  exposure: number; // gross notional
  beta: number;
}

export interface Account {
  cashBalance: number;
  equity: number;
  buyingPower: number;
  initialMarginUsed: number;
  maintenanceMarginUsed: number;
  availableMargin: number;
  totalPnL: number;
  sessionPnL: number;
  marginCallLevel: number;
  leverage: number;
  grossExposure: number;
  netExposure: number;
  totalUnrealizedPnL: number;
}

export interface StrategyParams {
  [key: string]: number | string | boolean;
}

export interface Strategy {
  id: string;
  name: string;
  type:
    | "MEAN_REVERSION"
    | "MOMENTUM"
    | "PAIRS"
    | "MARKET_MAKING"
    | "BREAKOUT"
    | "VOLATILITY"
    | "STAT_ARB";
  description: string;
  symbols: string[];
  params: StrategyParams;
  enabled: boolean;
  pnl: number;
  trades: number;
  sharpe: number;
  maxDrawdown: number;
  createdAt: number;
  // Live execution state
  currentSignal: number; // -1, 0, +1 (current position signal)
  lastSignalAt?: number;
  lastSignalPrice?: number;
  positionQty: number; // current contracts held by this strategy
  avgEntryPrice: number;
  realizedPnL: number;
  unrealizedPnL: number;
  // P&L history for Sharpe/MDD computation
  pnlHistory: { time: number; pnl: number }[];
  peakPnL: number;
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  side: Side;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  bars: number;
  symbol: string;
}

export interface BacktestResult {
  strategy: string;
  symbol: string;
  trades: BacktestTrade[];
  equityCurve: { time: number; equity: number; drawdown: number }[];
  metrics: BacktestMetrics;
  params: StrategyParams;
  startDate: number;
  endDate: number;
  initialCapital: number;
  finalEquity: number;
}

export interface BacktestMetrics {
  totalReturn: number;
  totalReturnPct: number;
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  avgBars: number;
  volatility: number;
  beta: number;
  alpha: number;
  informationRatio: number;
  calmar: number;
  ulcer: number;
}

export interface RiskMetrics {
  var95: number;
  var99: number;
  cvar95: number;
  cvar99: number;
  portfolioVolatility: number;
  portfolioBeta: number;
  grossExposure: number;
  netExposure: number;
  leverage: number;
  diversificationRatio: number;
  concentrationRisk: number;
  correlationAvg: number;
}

export interface StressScenario {
  name: string;
  description: string;
  shock: { [symbol: string]: number }; // pct shocks
  portfolioImpact: number;
  worstPosition: string;
  worstImpact: number;
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

export interface Alert {
  id: string;
  type: "PRICE" | "RISK" | "ORDER" | "STRATEGY" | "SYSTEM";
  severity: "INFO" | "WARN" | "ERROR" | "CRITICAL";
  message: string;
  symbol?: string;
  timestamp: number;
  acknowledged: boolean;
}

export interface SystemMetric {
  name: string;
  value: number;
  unit: string;
  status: "healthy" | "warning" | "critical";
  target?: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  module: string;
  message: string;
  metadata?: Record<string, unknown>;
}
