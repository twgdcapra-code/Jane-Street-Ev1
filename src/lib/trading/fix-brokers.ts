/**
 * FIX Broker Profile Manager
 *
 * Manages connection profiles for FIX 4.4 brokers (Tradovate sandbox, IBKR
 * paper, TastyTrade, NinjaTrader, MetroTrade) plus the built-in Simulator.
 *
 * Profiles are persisted to localStorage so the user can save credentials,
 * pick a default broker, and have the FIX session auto-resume on next load.
 *
 * Each profile captures:
 *   - Broker identity (which FIX variant, SenderCompID, TargetCompID)
 *   - Network endpoint (host, port, TLS)
 *   - Auth (username, password, API key for brokers that use a side-channel)
 *   - Session settings (HeartBtInt, ResetSeqNumFlag, EncryptMethod)
 *   - Paper vs live toggle (so the user can flip without re-entering creds)
 *
 * The actual TCP socket is NOT opened from the browser — browsers can't do
 * raw TCP. Instead, the FIX session is simulated in the engine: every
 * buildLogon / buildNewOrderSingle / buildExecutionReport produces a real
 * FIX wire-format message that the user can audit, and execution reports
 * come back through the simulator (or, when wired via a server-side relay,
 * from the real broker). The profile is ready to plug into a Node-side
 * relay (e.g. /api/fix/relay) that opens the TCP socket server-side.
 */
import {
  createSession,
  buildLogon,
  buildLogout,
  buildHeartbeat,
  buildNewOrderSingle,
  buildOrderCancel,
  buildExecutionReport,
  buildMarketDataRequest,
  sendSessionMessage,
  receiveMessage,
  type FixSession,
  type FixMessage,
} from "./fix-protocol";

export type BrokerKind =
  | "SIMULATOR"
  | "TRADOVATE"
  | "IBKR"
  | "TASTYTRADE"
  | "NINJATRADER"
  | "METROTRADE"
  | "CUSTOM";

export type Environment = "PAPER" | "LIVE";

export interface BrokerProfile {
  id: string;
  name: string;
  kind: BrokerKind;
  environment: Environment;
  // FIX session identity
  senderCompId: string;
  targetCompId: string;
  // Network
  host: string;
  port: number;
  useTls: boolean;
  // Auth
  username?: string;
  password?: string;
  apiKey?: string;
  accountId?: string;
  // Session settings
  heartBtInt: number;
  resetSeqNumFlag: boolean;
  encryptMethod: "0" | "1" | "2" | "3" | "4"; // 0=none, 1..4=various
  // Misc
  enabled: boolean;
  isDefault: boolean;
  custom?: boolean;
  createdAt: number;
  lastConnectedAt?: number;
  lastError?: string;
}

export interface FixConnectionState {
  profileId: string;
  session: FixSession;
  state: "DISCONNECTED" | "CONNECTING" | "LOGGED_IN" | "LOGGING_OUT" | "ERROR";
  connectedAt?: number;
  heartbeatCount: number;
  lastHeartbeatAt?: number;
  error?: string;
}

const PROFILES_KEY = "twg-fix-profiles-v1";
const ACTIVE_KEY = "twg-fix-active-v1";

// ============================================================
// Default broker templates
// ============================================================
export const DEFAULT_PROFILES: BrokerProfile[] = [
  {
    id: "sim-default",
    name: "TWG Simulator",
    kind: "SIMULATOR",
    environment: "PAPER",
    senderCompId: "TWG-TRADER",
    targetCompId: "TWG-SIM",
    host: "internal",
    port: 0,
    useTls: false,
    heartBtInt: 30,
    resetSeqNumFlag: true,
    encryptMethod: "0",
    enabled: true,
    isDefault: true,
    createdAt: Date.now(),
  },
  {
    id: "tradovate-paper",
    name: "Tradovate (Paper)",
    kind: "TRADOVATE",
    environment: "PAPER",
    senderCompId: "TWG-TRADER",
    targetCompId: "TRADOVATE-PAPER",
    host: "fix-demo.tradovate.com",
    port: 443,
    useTls: true,
    heartBtInt: 30,
    resetSeqNumFlag: true,
    encryptMethod: "0",
    enabled: true,
    isDefault: false,
    createdAt: Date.now(),
  },
  {
    id: "tradovate-live",
    name: "Tradovate (Live)",
    kind: "TRADOVATE",
    environment: "LIVE",
    senderCompId: "TWG-TRADER",
    targetCompId: "TRADOVATE-LIVE",
    host: "fix.tradovate.com",
    port: 443,
    useTls: true,
    heartBtInt: 30,
    resetSeqNumFlag: true,
    encryptMethod: "0",
    enabled: false,
    isDefault: false,
    createdAt: Date.now(),
  },
  {
    id: "ibkr-paper",
    name: "Interactive Brokers (Paper)",
    kind: "IBKR",
    environment: "PAPER",
    senderCompId: "twgtrader",
    targetCompId: "ibpaper",
    host: "127.0.0.1",
    port: 7496,
    useTls: false,
    heartBtInt: 30,
    resetSeqNumFlag: false,
    encryptMethod: "0",
    enabled: true,
    isDefault: false,
    createdAt: Date.now(),
  },
  {
    id: "ibkr-live",
    name: "Interactive Brokers (Live)",
    kind: "IBKR",
    environment: "LIVE",
    senderCompId: "twgtrader",
    targetCompId: "iblive",
    host: "127.0.0.1",
    port: 7496,
    useTls: false,
    heartBtInt: 30,
    resetSeqNumFlag: false,
    encryptMethod: "0",
    enabled: false,
    isDefault: false,
    createdAt: Date.now(),
  },
  {
    id: "tastytrade-paper",
    name: "TastyTrade (Paper)",
    kind: "TASTYTRADE",
    environment: "PAPER",
    senderCompId: "TWG-TRADER",
    targetCompId: "TT-PAPER",
    host: "fix.cert.tastytrade.com",
    port: 443,
    useTls: true,
    heartBtInt: 30,
    resetSeqNumFlag: true,
    encryptMethod: "0",
    enabled: true,
    isDefault: false,
    createdAt: Date.now(),
  },
  {
    id: "tastytrade-live",
    name: "TastyTrade (Live)",
    kind: "TASTYTRADE",
    environment: "LIVE",
    senderCompId: "TWG-TRADER",
    targetCompId: "TT-LIVE",
    host: "fix.live.tastytrade.com",
    port: 443,
    useTls: true,
    heartBtInt: 30,
    resetSeqNumFlag: true,
    encryptMethod: "0",
    enabled: false,
    isDefault: false,
    createdAt: Date.now(),
  },
  {
    id: "ninjatrader-paper",
    name: "NinjaTrader (Paper)",
    kind: "NINJATRADER",
    environment: "PAPER",
    senderCompId: "TWG-TRADER",
    targetCompId: "NT-SIM",
    host: "sim.ninjatrader.com",
    port: 443,
    useTls: true,
    heartBtInt: 30,
    resetSeqNumFlag: true,
    encryptMethod: "0",
    enabled: true,
    isDefault: false,
    createdAt: Date.now(),
  },
  {
    id: "ninjatrader-live",
    name: "NinjaTrader (Live)",
    kind: "NINJATRADER",
    environment: "LIVE",
    senderCompId: "TWG-TRADER",
    targetCompId: "NT-LIVE",
    host: "live.ninjatrader.com",
    port: 443,
    useTls: true,
    heartBtInt: 30,
    resetSeqNumFlag: true,
    encryptMethod: "0",
    enabled: false,
    isDefault: false,
    createdAt: Date.now(),
  },
  {
    id: "metrotrade-paper",
    name: "MetroTrade (Paper)",
    kind: "METROTRADE",
    environment: "PAPER",
    senderCompId: "TWG-TRADER",
    targetCompId: "MT-PAPER",
    host: "fix-sandbox.metrotrade.com",
    port: 443,
    useTls: true,
    heartBtInt: 30,
    resetSeqNumFlag: true,
    encryptMethod: "0",
    enabled: true,
    isDefault: false,
    createdAt: Date.now(),
  },
  {
    id: "metrotrade-live",
    name: "MetroTrade (Live)",
    kind: "METROTRADE",
    environment: "LIVE",
    senderCompId: "TWG-TRADER",
    targetCompId: "MT-LIVE",
    host: "fix.metrotrade.com",
    port: 443,
    useTls: true,
    heartBtInt: 30,
    resetSeqNumFlag: true,
    encryptMethod: "0",
    enabled: false,
    isDefault: false,
    createdAt: Date.now(),
  },
];

export const BROKER_KIND_INFO: Record<BrokerKind, { name: string; description: string; docUrl: string }> = {
  SIMULATOR: { name: "TWG Simulator", description: "Built-in simulator. No network. Used for testing FIX message flow.", docUrl: "" },
  TRADOVATE: { name: "Tradovate (CME Futures)", description: "Tradovate FIX 4.4 over TLS 443. Paper: fix-demo.tradovate.com / Live: fix.tradovate.com", docUrl: "https://api.tradovate.com" },
  IBKR: { name: "Interactive Brokers", description: "IBKR FIX 4.4 via TWS/Gateway local socket. Paper: 7496 / Live: 7497. Requires TWS running.", docUrl: "https://www.interactivebrokers.com/campus/ibkr-api-page/fix-api/" },
  TASTYTRADE: { name: "TastyTrade", description: "TastyTrade FIX 4.4 over TLS. Paper: fix.cert.tastytrade.com / Live: fix.live.tastytrade.com", docUrl: "https://developer.tastytrade.com" },
  NINJATRADER: { name: "NinjaTrader", description: "NinjaTrader FIX 4.4 over TLS. Paper: sim.ninjatrader.com / Live: live.ninjatrader.com", docUrl: "https://api.ninjatrader.com" },
  METROTRADE: { name: "MetroTrade", description: "MetroTrade FIX 4.4 over TLS. Paper: fix-sandbox.metrotrade.com / Live: fix.metrotrade.com", docUrl: "https://docs.metrotrade.com" },
  CUSTOM: { name: "Custom Broker", description: "Custom FIX 4.4 endpoint. Provide host/port and credentials.", docUrl: "" },
};

// ============================================================
// localStorage persistence
// ============================================================
function loadProfilesRaw(): BrokerProfile[] {
  if (typeof window === "undefined") return [...DEFAULT_PROFILES];
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return [...DEFAULT_PROFILES];
    const parsed = JSON.parse(raw) as BrokerProfile[];
    if (!Array.isArray(parsed)) return [...DEFAULT_PROFILES];
    // Merge: keep user-saved profiles, but always ensure the SIMULATOR default exists.
    const merged: BrokerProfile[] = [...parsed];
    if (!merged.some(p => p.id === "sim-default")) {
      merged.unshift(DEFAULT_PROFILES[0]);
    }
    return merged;
  } catch {
    return [...DEFAULT_PROFILES];
  }
}

function saveProfilesRaw(profiles: BrokerProfile[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch { /* ignore */ }
}

export function loadProfiles(): BrokerProfile[] {
  return loadProfilesRaw();
}

export function saveProfiles(profiles: BrokerProfile[]): void {
  saveProfilesRaw(profiles);
}

export function addProfile(p: Omit<BrokerProfile, "id" | "createdAt" | "custom"> & Partial<Pick<BrokerProfile, "id" | "custom" | "createdAt">>): BrokerProfile[] {
  const current = loadProfilesRaw();
  const newProfile: BrokerProfile = {
    ...p,
    id: p.id ?? `custom-${Date.now()}`,
    createdAt: p.createdAt ?? Date.now(),
    custom: true,
  };
  const next = [...current, newProfile];
  saveProfilesRaw(next);
  return next;
}

export function updateProfile(id: string, updates: Partial<BrokerProfile>): BrokerProfile[] {
  const current = loadProfilesRaw();
  // If marking as default, unset all other defaults.
  if (updates.isDefault) {
    for (const p of current) if (p.id !== id) p.isDefault = false;
  }
  const next = current.map(p => (p.id === id ? { ...p, ...updates } : p));
  saveProfilesRaw(next);
  return next;
}

export function removeProfile(id: string): BrokerProfile[] {
  if (id === "sim-default") return loadProfilesRaw(); // Can't delete simulator
  const current = loadProfilesRaw();
  const next = current.filter(p => p.id !== id);
  saveProfilesRaw(next);
  return next;
}

export function resetProfiles(): BrokerProfile[] {
  saveProfilesRaw([...DEFAULT_PROFILES]);
  return [...DEFAULT_PROFILES];
}

export function getDefaultProfile(): BrokerProfile {
  const profiles = loadProfilesRaw();
  return profiles.find(p => p.isDefault) ?? profiles[0];
}

// ============================================================
// Active session persistence (auto-reconnect on reload)
// ============================================================
interface ActiveSessionRecord {
  profileId: string;
  connectedAt: number;
}

export function loadActiveSession(): ActiveSessionRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ActiveSessionRecord;
  } catch { return null; }
}

export function saveActiveSession(profileId: string, connectedAt: number): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(ACTIVE_KEY, JSON.stringify({ profileId, connectedAt })); } catch { /* ignore */ }
}

export function clearActiveSession(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
}

// ============================================================
// FIX connection state machine (simulated, but produces real wire-format messages)
// ============================================================
/**
 * Connect using a profile. Returns the new connection state.
 *
 * In a browser-only environment, this simulates the FIX handshake:
 *   1. Build a Logon (35=A) message and push it to the session log.
 *   2. Simulate the broker's Logon response (which would come over the
 *      real TCP socket in production).
 *   3. Mark the session as LOGGED_IN.
 *
 * To wire this to a real broker, replace the `simulateBrokerLogon` call
 * with a server-side relay (e.g. /api/fix/relay) that:
 *   - Opens a TCP socket to profile.host:profile.port
 *   - Sends the Logon bytes
 *   - Streams inbound FIX messages back to the client via SSE / WebSocket
 *   - Buffers outbound messages from the client
 */
export function connectWithProfile(profile: BrokerProfile): FixConnectionState {
  const session = createSession(profile.senderCompId, profile.targetCompId, profile.heartBtInt);
  // Build and "send" Logon
  const logon = buildLogon(
    profile.senderCompId,
    profile.targetCompId,
    profile.heartBtInt,
    profile.resetSeqNumFlag,
    profile.username,
    profile.password,
  );
  const afterSend = sendSessionMessage(session, logon);
  afterSend.state = "LOGGING_IN";

  // Simulate broker accepting the logon (real implementation: wait for 35=A reply)
  const brokerLogonReply: FixMessage = {
    msgType: "A",
    msgTypeName: "Logon",
    tags: [
      { tag: 49, name: "SenderCompID", value: profile.targetCompId },
      { tag: 56, name: "TargetCompID", value: profile.senderCompId },
      { tag: 34, name: "MsgSeqNum", value: "1" },
      { tag: 108, name: "HeartBtInt", value: String(profile.heartBtInt) },
    ],
    raw: `8=FIX.4.4|49=${profile.targetCompId}|56=${profile.senderCompId}|34=1|35=A|108=${profile.heartBtInt}|10=000|`,
    checksum: "000",
  };
  const afterLogon = receiveMessage(afterSend, brokerLogonReply);
  afterLogon.state = "LOGGED_IN";

  return {
    profileId: profile.id,
    session: afterLogon,
    state: "LOGGED_IN",
    connectedAt: Date.now(),
    heartbeatCount: 0,
    lastHeartbeatAt: Date.now(),
  };
}

export function disconnectConnection(conn: FixConnectionState): FixConnectionState {
  const logout = buildLogout(conn.session.senderCompId, conn.session.targetCompId, conn.session.outgoingSeqNum);
  const afterSend = sendSessionMessage(conn.session, logout);
  afterSend.state = "DISCONNECTED";
  return { ...conn, session: afterSend, state: "DISCONNECTED" };
}

export function sendHeartbeat(conn: FixConnectionState): FixConnectionState {
  const hb = buildHeartbeat(conn.session.senderCompId, conn.session.targetCompId, conn.session.outgoingSeqNum);
  const afterSend = sendSessionMessage(conn.session, hb);
  return {
    ...conn,
    session: afterSend,
    heartbeatCount: conn.heartbeatCount + 1,
    lastHeartbeatAt: Date.now(),
  };
}

export interface SubmitOrderParams {
  clOrdId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";
  qty: number;
  price?: number;
  stopPrice?: number;
  tif: "DAY" | "GTC" | "IOC" | "FOK";
}

export function submitOrder(conn: FixConnectionState, params: SubmitOrderParams): { conn: FixConnectionState; msg: FixMessage } {
  const orderTypeMap: Record<SubmitOrderParams["orderType"], "1" | "2" | "3" | "4"> = {
    MARKET: "1", LIMIT: "2", STOP: "3", STOP_LIMIT: "4",
  };
  const tifMap: Record<SubmitOrderParams["tif"], "0" | "1" | "3" | "4"> = {
    DAY: "0", GTC: "1", IOC: "3", FOK: "4",
  };
  const msg = buildNewOrderSingle({
    senderCompId: conn.session.senderCompId,
    targetCompId: conn.session.targetCompId,
    clOrdId: params.clOrdId,
    symbol: params.symbol,
    side: params.side,
    orderType: params.orderType === "MARKET" ? "MARKET" : params.orderType === "LIMIT" ? "LIMIT" : params.orderType === "STOP" ? "STOP" : "STOP_LIMIT",
    qty: params.qty,
    price: params.price,
    stopPrice: params.stopPrice,
    tif: params.tif,
    seqNum: conn.session.outgoingSeqNum,
  });
  const afterSend = sendSessionMessage(conn.session, msg);
  return { conn: { ...conn, session: afterSend }, msg };
}

export interface CancelOrderParams {
  clOrdId: string;
  origClOrdId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
}

export function cancelOrder(conn: FixConnectionState, params: CancelOrderParams): { conn: FixConnectionState; msg: FixMessage } {
  const msg = buildOrderCancel({
    senderCompId: conn.session.senderCompId,
    targetCompId: conn.session.targetCompId,
    clOrdId: params.clOrdId,
    origClOrdId: params.origClOrdId,
    symbol: params.symbol,
    side: params.side,
    qty: params.qty,
    seqNum: conn.session.outgoingSeqNum,
  });
  const afterSend = sendSessionMessage(conn.session, msg);
  return { conn: { ...conn, session: afterSend }, msg };
}

/**
 * Simulate the broker sending back an execution report (fill confirmation).
 * In production this arrives over the TCP socket as 35=8 messages.
 */
export function simulateFill(conn: FixConnectionState, params: {
  clOrdId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
}): { conn: FixConnectionState; msg: FixMessage } {
  const msg = buildExecutionReport({
    senderCompId: conn.session.targetCompId,
    targetCompId: conn.session.senderCompId,
    orderId: `ORD-${Date.now()}`,
    clOrdId: params.clOrdId,
    execId: `EXEC-${Date.now()}`,
    symbol: params.symbol,
    side: params.side,
    ordStatus: "2", // Filled
    execType: "2",  // Fill
    cumQty: params.qty,
    avgPx: params.price,
    leavesQty: 0,
    lastQty: params.qty,
    lastPx: params.price,
    seqNum: conn.session.incomingSeqNum,
  });
  const afterReceive = receiveMessage(conn.session, msg);
  return { conn: { ...conn, session: afterReceive }, msg };
}
