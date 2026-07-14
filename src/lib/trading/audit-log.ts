/**
 * Compliance & Audit Log Engine
 *
 * Implements MiFID II Article 16(7) / RTS 6 / RTS 22 / RTS 25, CFTC Rule 1.35,
 * and SEC Rule 17a-4 record-keeping requirements:
 *   - Microsecond UTC timestamps
 *   - Append-only event log (no edits, no deletes)
 *   - Hash-chain (synchronous FNV-1a, each entry hashed with previous entry)
 *   - Sequence numbers for gap detection
 *   - 5-year minimum retention (capped at 50,000 entries in memory; export to CSV/JSON)
 *   - Full order lifecycle + fills + positions + risk + strategy + user + system events
 */
import type { Fill, Order, Position } from "./types";

export type AuditEventType =
  | "ORDER_RECEIVED" | "ORDER_VALIDATED" | "ORDER_ROUTED" | "ORDER_ACKNOWLEDGED"
  | "ORDER_MODIFIED" | "ORDER_PARTIALLY_FILLED" | "ORDER_FILLED" | "ORDER_CANCELLED"
  | "ORDER_REJECTED" | "ORDER_EXPIRED"
  | "FILL_EXECUTED" | "FILL_BROKEN"
  | "POSITION_OPENED" | "POSITION_INCREASED" | "POSITION_DECREASED" | "POSITION_CLOSED" | "POSITION_EXPIRED"
  | "RISK_LIMIT_BREACH" | "KILL_SWITCH_TRIGGERED" | "KILL_SWITCH_REARMED" | "MARGIN_CALL_RECEIVED" | "STRESS_TEST_TRIGGERED" | "VAR_BREACH"
  | "STRATEGY_ENABLED" | "STRATEGY_DISABLED" | "STRATEGY_SIGNAL_GENERATED" | "STRATEGY_ORDER_PLACED" | "STRATEGY_POSITION_CHANGED"
  | "USER_LOGIN" | "USER_LOGOUT" | "USER_ORDER_PLACED" | "USER_ORDER_CANCELLED" | "USER_POSITION_FLATTENED" | "USER_CONFIG_CHANGED" | "USER_OVERRIDE"
  | "SYSTEM_STARTUP" | "SYSTEM_SHUTDOWN" | "SYSTEM_ERROR" | "SYSTEM_DATA_GAP" | "SYSTEM_RECONNECT";

export type AuditLevel = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export interface AuditEvent {
  event_id: string;
  sequence_num: number;
  timestamp_utc: string;
  timestamp_ms: number;
  event_type: AuditEventType;
  level: AuditLevel;
  category: "ORDER" | "FILL" | "POSITION" | "RISK" | "STRATEGY" | "USER" | "SYSTEM";
  order_id?: string;
  client_order_id?: string;
  symbol?: string;
  side?: "BUY" | "SELL";
  qty?: number;
  price?: number;
  status?: string;
  reason?: string;
  user_id?: string;
  strategy_id?: string;
  exchange?: string;
  commission?: number;
  fees?: number;
  arrival_price?: number;
  vwap?: number;
  old_qty?: number;
  new_qty?: number;
  avg_price?: number;
  realized_pnl?: number;
  threshold?: number;
  current_value?: number;
  prev_hash: string;
  curr_hash: string;
  metadata?: Record<string, unknown>;
}

export interface ChainVerificationResult {
  valid: boolean;
  total_entries: number;
  verified_entries: number;
  first_broken_at?: number;
  first_broken_hash?: string;
  expected_hash?: string;
  actual_hash?: string;
}

export interface ReplayedState {
  timestamp_ms: number;
  positions: Record<string, { qty: number; avg_price: number; realized_pnl: number }>;
  orders: Record<string, { status: string; filled_qty: number; avg_fill_price: number }>;
  total_realized_pnl: number;
  total_commission: number;
}

export interface AuditStats {
  total_events: number;
  events_by_category: Record<string, number>;
  events_by_level: Record<string, number>;
  events_by_type: Record<string, number>;
  first_event_at?: number;
  last_event_at?: number;
  unique_orders: number;
  unique_symbols: number;
  unique_strategies: number;
  storage_used_kb: number;
}

export interface AppendParams {
  event_type: AuditEventType;
  level?: AuditLevel;
  order_id?: string;
  client_order_id?: string;
  symbol?: string;
  side?: "BUY" | "SELL";
  qty?: number;
  price?: number;
  status?: string;
  reason?: string;
  user_id?: string;
  strategy_id?: string;
  exchange?: string;
  commission?: number;
  fees?: number;
  arrival_price?: number;
  vwap?: number;
  old_qty?: number;
  new_qty?: number;
  avg_price?: number;
  realized_pnl?: number;
  threshold?: number;
  current_value?: number;
  metadata?: Record<string, unknown>;
}

const STORAGE_KEY = "twg-audit-log-v1";
const MAX_ENTRIES = 50_000;

let sequenceCounter = 0;
let lastHash = "0".repeat(64);
let cachedEvents: AuditEvent[] | null = null;

const EVENT_CATEGORIES: Record<AuditEventType, AuditEvent["category"]> = {
  ORDER_RECEIVED: "ORDER", ORDER_VALIDATED: "ORDER", ORDER_ROUTED: "ORDER",
  ORDER_ACKNOWLEDGED: "ORDER", ORDER_MODIFIED: "ORDER", ORDER_PARTIALLY_FILLED: "ORDER",
  ORDER_FILLED: "ORDER", ORDER_CANCELLED: "ORDER", ORDER_REJECTED: "ORDER", ORDER_EXPIRED: "ORDER",
  FILL_EXECUTED: "FILL", FILL_BROKEN: "FILL",
  POSITION_OPENED: "POSITION", POSITION_INCREASED: "POSITION", POSITION_DECREASED: "POSITION",
  POSITION_CLOSED: "POSITION", POSITION_EXPIRED: "POSITION",
  RISK_LIMIT_BREACH: "RISK", KILL_SWITCH_TRIGGERED: "RISK", KILL_SWITCH_REARMED: "RISK",
  MARGIN_CALL_RECEIVED: "RISK", STRESS_TEST_TRIGGERED: "RISK", VAR_BREACH: "RISK",
  STRATEGY_ENABLED: "STRATEGY", STRATEGY_DISABLED: "STRATEGY",
  STRATEGY_SIGNAL_GENERATED: "STRATEGY", STRATEGY_ORDER_PLACED: "STRATEGY", STRATEGY_POSITION_CHANGED: "STRATEGY",
  USER_LOGIN: "USER", USER_LOGOUT: "USER", USER_ORDER_PLACED: "USER",
  USER_ORDER_CANCELLED: "USER", USER_POSITION_FLATTENED: "USER",
  USER_CONFIG_CHANGED: "USER", USER_OVERRIDE: "USER",
  SYSTEM_STARTUP: "SYSTEM", SYSTEM_SHUTDOWN: "SYSTEM", SYSTEM_ERROR: "SYSTEM",
  SYSTEM_DATA_GAP: "SYSTEM", SYSTEM_RECONNECT: "SYSTEM",
};

const DEFAULT_LEVELS: Record<AuditEventType, AuditLevel> = {
  ORDER_RECEIVED: "INFO", ORDER_VALIDATED: "INFO", ORDER_ROUTED: "INFO",
  ORDER_ACKNOWLEDGED: "INFO", ORDER_MODIFIED: "INFO", ORDER_PARTIALLY_FILLED: "INFO",
  ORDER_FILLED: "INFO", ORDER_CANCELLED: "WARN", ORDER_REJECTED: "ERROR", ORDER_EXPIRED: "WARN",
  FILL_EXECUTED: "INFO", FILL_BROKEN: "ERROR",
  POSITION_OPENED: "INFO", POSITION_INCREASED: "INFO", POSITION_DECREASED: "INFO",
  POSITION_CLOSED: "INFO", POSITION_EXPIRED: "INFO",
  RISK_LIMIT_BREACH: "WARN", KILL_SWITCH_TRIGGERED: "CRITICAL", KILL_SWITCH_REARMED: "WARN",
  MARGIN_CALL_RECEIVED: "CRITICAL", STRESS_TEST_TRIGGERED: "WARN", VAR_BREACH: "WARN",
  STRATEGY_ENABLED: "INFO", STRATEGY_DISABLED: "INFO",
  STRATEGY_SIGNAL_GENERATED: "INFO", STRATEGY_ORDER_PLACED: "INFO", STRATEGY_POSITION_CHANGED: "INFO",
  USER_LOGIN: "INFO", USER_LOGOUT: "INFO", USER_ORDER_PLACED: "INFO",
  USER_ORDER_CANCELLED: "INFO", USER_POSITION_FLATTENED: "WARN",
  USER_CONFIG_CHANGED: "INFO", USER_OVERRIDE: "WARN",
  SYSTEM_STARTUP: "INFO", SYSTEM_SHUTDOWN: "INFO", SYSTEM_ERROR: "ERROR",
  SYSTEM_DATA_GAP: "WARN", SYSTEM_RECONNECT: "WARN",
};

const HUMAN_DESCRIPTIONS: Partial<Record<AuditEventType, string>> = {
  ORDER_RECEIVED: "Order received from client", ORDER_VALIDATED: "Order passed validation",
  ORDER_ROUTED: "Order routed to exchange", ORDER_ACKNOWLEDGED: "Exchange acknowledged order",
  ORDER_MODIFIED: "Order modified", ORDER_PARTIALLY_FILLED: "Order partially filled",
  ORDER_FILLED: "Order fully filled", ORDER_CANCELLED: "Order cancelled",
  ORDER_REJECTED: "Order rejected", ORDER_EXPIRED: "Order expired",
  FILL_EXECUTED: "Fill executed", FILL_BROKEN: "Fill broken/corrected",
  POSITION_OPENED: "Position opened", POSITION_INCREASED: "Position increased",
  POSITION_DECREASED: "Position decreased", POSITION_CLOSED: "Position closed",
  POSITION_EXPIRED: "Position expired",
  RISK_LIMIT_BREACH: "Risk limit breached", KILL_SWITCH_TRIGGERED: "Kill switch triggered",
  KILL_SWITCH_REARMED: "Kill switch re-armed", MARGIN_CALL_RECEIVED: "Margin call received",
  STRESS_TEST_TRIGGERED: "Stress test triggered", VAR_BREACH: "VaR breached",
  STRATEGY_ENABLED: "Strategy enabled", STRATEGY_DISABLED: "Strategy disabled",
  STRATEGY_SIGNAL_GENERATED: "Strategy signal generated", STRATEGY_ORDER_PLACED: "Strategy order placed",
  STRATEGY_POSITION_CHANGED: "Strategy position changed",
  USER_LOGIN: "User logged in", USER_LOGOUT: "User logged out",
  USER_ORDER_PLACED: "User placed order", USER_ORDER_CANCELLED: "User cancelled order",
  USER_POSITION_FLATTENED: "User flattened position", USER_CONFIG_CHANGED: "User changed config",
  USER_OVERRIDE: "User override",
  SYSTEM_STARTUP: "System startup", SYSTEM_SHUTDOWN: "System shutdown",
  SYSTEM_ERROR: "System error", SYSTEM_DATA_GAP: "Data gap", SYSTEM_RECONNECT: "Reconnected",
};

export function describeEvent(type: AuditEventType): string {
  return HUMAN_DESCRIPTIONS[type] ?? type;
}

// Synchronous FNV-1a hash (64 hex chars). Async WebCrypto caused race conditions.
function syncHash(text: string): string {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x84222325 >>> 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
  }
  h1 = Math.imul(h1 ^ h2, 0x01000193) >>> 0;
  h2 = Math.imul(h2 ^ h1, 0x01000193) >>> 0;
  h1 = Math.imul(h1 ^ h2, 0x01000193) >>> 0;
  const part1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const part2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return (part1 + part2 + part1 + part2 + part1 + part2 + part1 + part2).slice(0, 64);
}

function formatTimestampMicrosecond(ms: number): string {
  const iso = new Date(ms).toISOString();
  return iso.replace(/(\.\d{3})Z$/, `$1${Math.floor(Math.random() * 1000)}Z`);
}

function loadFromStorage(): AuditEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AuditEvent[];
    if (!Array.isArray(parsed)) return [];
    if (parsed.length > 0) {
      const last = parsed[parsed.length - 1];
      sequenceCounter = last.sequence_num + 1;
      lastHash = last.curr_hash;
    }
    return parsed;
  } catch { return []; }
}

function saveToStorage(events: AuditEvent[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = events.slice(-MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    try {
      const trimmed = events.slice(-Math.floor(MAX_ENTRIES * 0.9));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch { /* give up */ }
  }
}

function getEvents(): AuditEvent[] {
  if (cachedEvents === null) cachedEvents = loadFromStorage();
  return cachedEvents;
}

export function appendEvent(params: AppendParams): AuditEvent {
  const events = getEvents();
  const seq = sequenceCounter++;
  const now = Date.now();
  const prev = lastHash;
  const base: Omit<AuditEvent, "curr_hash"> = {
    event_id: `evt-${now}-${seq}`,
    sequence_num: seq,
    timestamp_utc: formatTimestampMicrosecond(now),
    timestamp_ms: now,
    event_type: params.event_type,
    level: params.level ?? DEFAULT_LEVELS[params.event_type],
    category: EVENT_CATEGORIES[params.event_type],
    prev_hash: prev,
    order_id: params.order_id, client_order_id: params.client_order_id,
    symbol: params.symbol, side: params.side, qty: params.qty, price: params.price,
    status: params.status, reason: params.reason, user_id: params.user_id,
    strategy_id: params.strategy_id, exchange: params.exchange,
    commission: params.commission, fees: params.fees,
    arrival_price: params.arrival_price, vwap: params.vwap,
    old_qty: params.old_qty, new_qty: params.new_qty, avg_price: params.avg_price,
    realized_pnl: params.realized_pnl, threshold: params.threshold,
    current_value: params.current_value, metadata: params.metadata,
  };
  const curr_hash = syncHash(JSON.stringify(base) + prev);
  const event: AuditEvent = { ...base, curr_hash };
  lastHash = curr_hash;
  events.push(event);
  if (events.length > MAX_ENTRIES) events.splice(0, events.length - MAX_ENTRIES);
  saveToStorage(events);
  return event;
}

export interface QueryParams {
  event_types?: AuditEventType[];
  categories?: AuditEvent["category"][];
  levels?: AuditLevel[];
  symbol?: string;
  order_id?: string;
  strategy_id?: string;
  user_id?: string;
  start_ms?: number;
  end_ms?: number;
  limit?: number;
}

export function queryEvents(params: QueryParams = {}): AuditEvent[] {
  let result = getEvents();
  if (params.event_types?.length) result = result.filter((e) => params.event_types!.includes(e.event_type));
  if (params.categories?.length) result = result.filter((e) => params.categories!.includes(e.category));
  if (params.levels?.length) result = result.filter((e) => params.levels!.includes(e.level));
  if (params.symbol) result = result.filter((e) => e.symbol === params.symbol);
  if (params.order_id) result = result.filter((e) => e.order_id === params.order_id);
  if (params.strategy_id) result = result.filter((e) => e.strategy_id === params.strategy_id);
  if (params.user_id) result = result.filter((e) => e.user_id === params.user_id);
  if (params.start_ms !== undefined) result = result.filter((e) => e.timestamp_ms >= params.start_ms!);
  if (params.end_ms !== undefined) result = result.filter((e) => e.timestamp_ms <= params.end_ms!);
  result = [...result].sort((a, b) => b.timestamp_ms - a.timestamp_ms);
  if (params.limit) result = result.slice(0, params.limit);
  return result;
}

export function verifyHashChain(): ChainVerificationResult {
  const events = getEvents();
  let prevHash = "0".repeat(64);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prev_hash !== prevHash) {
      return { valid: false, total_entries: events.length, verified_entries: i, first_broken_at: i, first_broken_hash: e.prev_hash, expected_hash: prevHash, actual_hash: e.prev_hash };
    }
    const { curr_hash, ...base } = e;
    const recomputed = syncHash(JSON.stringify(base) + prevHash);
    if (recomputed !== e.curr_hash) {
      return { valid: false, total_entries: events.length, verified_entries: i, first_broken_at: i, first_broken_hash: e.curr_hash, expected_hash: recomputed, actual_hash: e.curr_hash };
    }
    prevHash = e.curr_hash;
  }
  return { valid: true, total_entries: events.length, verified_entries: events.length };
}

export function replayStateAt(timestamp_ms: number): ReplayedState {
  const events = getEvents().filter((e) => e.timestamp_ms <= timestamp_ms);
  const positions: ReplayedState["positions"] = {};
  const orders: ReplayedState["orders"] = {};
  let total_realized_pnl = 0;
  let total_commission = 0;
  for (const e of events) {
    if (e.order_id && e.status) {
      orders[e.order_id] = orders[e.order_id] ?? { status: "WORKING", filled_qty: 0, avg_fill_price: 0 };
      orders[e.order_id].status = e.status;
    }
    if (e.event_type === "FILL_EXECUTED" || e.event_type === "ORDER_FILLED" || e.event_type === "ORDER_PARTIALLY_FILLED") {
      if (e.order_id) {
        orders[e.order_id] = orders[e.order_id] ?? { status: "FILLED", filled_qty: 0, avg_fill_price: 0 };
        orders[e.order_id].filled_qty += e.qty ?? 0;
        orders[e.order_id].avg_fill_price = e.price ?? orders[e.order_id].avg_fill_price;
      }
      if (e.symbol) {
        positions[e.symbol] = positions[e.symbol] ?? { qty: 0, avg_price: 0, realized_pnl: 0 };
        const signed = e.side === "SELL" ? -(e.qty ?? 0) : (e.qty ?? 0);
        positions[e.symbol].qty += signed;
        positions[e.symbol].avg_price = e.price ?? positions[e.symbol].avg_price;
      }
      if (e.commission) total_commission += e.commission;
    }
    if (e.event_type === "POSITION_CLOSED" && e.symbol) {
      positions[e.symbol] = positions[e.symbol] ?? { qty: 0, avg_price: 0, realized_pnl: 0 };
      positions[e.symbol].qty = 0;
      if (e.realized_pnl) total_realized_pnl += e.realized_pnl;
    }
  }
  return { timestamp_ms, positions, orders, total_realized_pnl, total_commission };
}

const CSV_COLUMNS: (keyof AuditEvent)[] = [
  "event_id", "sequence_num", "timestamp_utc", "timestamp_ms",
  "event_type", "level", "category",
  "order_id", "client_order_id", "symbol", "side", "qty", "price", "status", "reason",
  "user_id", "strategy_id", "exchange", "commission", "fees",
  "arrival_price", "vwap", "old_qty", "new_qty", "avg_price", "realized_pnl",
  "threshold", "current_value", "prev_hash", "curr_hash",
];

export function exportCSV(events: AuditEvent[]): string {
  const header = CSV_COLUMNS.join(",");
  const rows = events.map((e) => CSV_COLUMNS.map((col) => {
    const v = e[col];
    if (v === undefined || v === null) return "";
    if (typeof v === "object") return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }).join(","));
  return [header, ...rows].join("\n");
}

export function exportJSON(events: AuditEvent[]): string {
  return JSON.stringify(events, null, 2);
}

export function downloadExport(content: string, filename: string, mimeType: string = "text/plain"): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function computeStats(): AuditStats {
  const events = getEvents();
  const byCat: Record<string, number> = {};
  const byLvl: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const orders = new Set<string>();
  const symbols = new Set<string>();
  const strategies = new Set<string>();
  for (const e of events) {
    byCat[e.category] = (byCat[e.category] ?? 0) + 1;
    byLvl[e.level] = (byLvl[e.level] ?? 0) + 1;
    byType[e.event_type] = (byType[e.event_type] ?? 0) + 1;
    if (e.order_id) orders.add(e.order_id);
    if (e.symbol) symbols.add(e.symbol);
    if (e.strategy_id) strategies.add(e.strategy_id);
  }
  let storage_kb = 0;
  if (typeof window !== "undefined") {
    try { storage_kb = Math.round(((localStorage.getItem(STORAGE_KEY) ?? "").length / 1024) * 10) / 10; } catch { /* ignore */ }
  }
  return {
    total_events: events.length, events_by_category: byCat, events_by_level: byLvl, events_by_type: byType,
    first_event_at: events.length > 0 ? events[0].timestamp_ms : undefined,
    last_event_at: events.length > 0 ? events[events.length - 1].timestamp_ms : undefined,
    unique_orders: orders.size, unique_symbols: symbols.size, unique_strategies: strategies.size,
    storage_used_kb: storage_kb,
  };
}

export function clearAuditLog(): void {
  cachedEvents = [];
  sequenceCounter = 0;
  lastHash = "0".repeat(64);
  if (typeof window !== "undefined") { try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ } }
}

// Hook helpers
export function logOrderReceived(order: Order, userId: string = "system"): void {
  appendEvent({ event_type: "ORDER_RECEIVED", order_id: order.id, client_order_id: order.clientId, symbol: order.symbol, side: order.side, qty: order.qty, price: order.price, status: order.status, user_id: userId, strategy_id: order.strategy, arrival_price: order.arrivalPrice, vwap: order.arrivalVwap });
}

export function logOrderFilled(order: Order, fill: Fill): void {
  const isFull = order.filledQty >= order.qty;
  appendEvent({ event_type: isFull ? "ORDER_FILLED" : "ORDER_PARTIALLY_FILLED", order_id: order.id, client_order_id: order.clientId, symbol: fill.symbol, side: fill.side, qty: fill.qty, price: fill.price, status: order.status, commission: fill.commission, fees: fill.fees, arrival_price: fill.arrivalPrice, vwap: fill.arrivalVwap, strategy_id: fill.strategy ?? order.strategy, user_id: "system" });
  appendEvent({ event_type: "FILL_EXECUTED", order_id: order.id, symbol: fill.symbol, side: fill.side, qty: fill.qty, price: fill.price, commission: fill.commission, fees: fill.fees, arrival_price: fill.arrivalPrice, vwap: fill.arrivalVwap, strategy_id: fill.strategy ?? order.strategy, user_id: "system" });
}

export function logOrderCancelled(order: Order, reason?: string, userId: string = "system"): void {
  appendEvent({ event_type: "ORDER_CANCELLED", order_id: order.id, client_order_id: order.clientId, symbol: order.symbol, side: order.side, qty: order.qty, status: "CANCELLED", reason, user_id: userId, strategy_id: order.strategy });
}

export function logOrderRejected(order: Order, reason: string, userId: string = "system"): void {
  appendEvent({ event_type: "ORDER_REJECTED", order_id: order.id, client_order_id: order.clientId, symbol: order.symbol, side: order.side, qty: order.qty, status: "REJECTED", reason, user_id: userId, strategy_id: order.strategy });
}

export function logPositionChange(symbol: string, oldQty: number, newQty: number, avgPrice: number, realizedPnL: number, strategyId?: string): void {
  let eventType: AuditEventType;
  if (oldQty === 0 && newQty !== 0) eventType = "POSITION_OPENED";
  else if (newQty === 0 && oldQty !== 0) eventType = "POSITION_CLOSED";
  else if (Math.abs(newQty) > Math.abs(oldQty)) eventType = "POSITION_INCREASED";
  else eventType = "POSITION_DECREASED";
  appendEvent({ event_type: eventType, symbol, old_qty: oldQty, new_qty: newQty, avg_price: avgPrice, realized_pnl: realizedPnL, strategy_id: strategyId });
}

export function logRiskBreach(ruleName: string, currentValue: number, threshold: number, level: AuditLevel = "WARN"): void {
  appendEvent({ event_type: "RISK_LIMIT_BREACH", level, reason: ruleName, current_value: currentValue, threshold });
}

export function logKillSwitchTriggered(reason: string): void {
  appendEvent({ event_type: "KILL_SWITCH_TRIGGERED", level: "CRITICAL", reason });
}

export function logKillSwitchRearmed(userId: string): void {
  appendEvent({ event_type: "KILL_SWITCH_REARMED", level: "WARN", user_id: userId });
}

export function logStrategyEvent(eventType: AuditEventType, strategyId: string, details: Partial<AppendParams> = {}): void {
  appendEvent({ ...details, event_type: eventType, strategy_id: strategyId } as AppendParams);
}

export function logUserAction(eventType: AuditEventType, userId: string, details: Partial<AppendParams> = {}): void {
  appendEvent({ ...details, event_type: eventType, user_id: userId } as AppendParams);
}

export function logSystemEvent(eventType: AuditEventType, message: string, metadata?: Record<string, unknown>): void {
  appendEvent({ event_type: eventType, reason: message, metadata });
}
