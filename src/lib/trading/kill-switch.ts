/**
 * Real-Time Kill Switch / Auto-Derisk Engine
 *
 * Based on /home/z/my-project/research/kill_switch.md (7,120 words).
 *
 * Implements a graduated risk-reduction system that runs on every market tick:
 *
 *   1. Soft warnings at 80% of each limit (alert only, no action)
 *   2. Hard derisk at 100% (auto-flatten affected positions)
 *   3. Hard kill switch at 120% (flatten everything, latch, require re-arm)
 *
 * Triggers monitored (16 total):
 *
 *   LOSS_LIMIT        — daily P&L < -dailyLossLimit
 *   DRAWDOWN          — peak-to-trough drawdown > maxDrawdownPct
 *   VAR_BREACH        — 1-day 99% VaR > varLimitPct of equity
 *   STRESS_TEST       — worst-case stress scenario loss > stressLimitPct
 *   MARGIN_UTIL       — margin used / equity > marginLimitPct
 *   CONCENTRATION     — single position > concentrationPct of portfolio
 *   POSITION_LOSS     — per-position loss > positionLossLimit
 *   VOLATILITY_REGIME — realized vol > 2x 30-day avg (vol regime shift)
 *   CIRCUIT_BREAKER   — rapid price move > circuitBreakerPct in 5 min
 *   LATENCY_ANOMALY   — tick gap > 5s (engine/data anomaly)
 *   MIDQUOTE_GAP      — bid/ask mid jumps > 1% in single tick
 *   THREE_STRIKES     — 3 consecutive losing fills
 *   CALMAR_PROTECTION — Calmar ratio < 0.5 over recent window
 *   BETA_EXPOSURE     — portfolio beta-adjusted exposure > threshold
 *   TIME_RULE         — pre-FOMC / pre-close / weekend carry
 *   ENGINE_ANOMALY    — engine health issue (data gap, mid-quote gap)
 *
 * Hierarchy (most-specific first):
 *   per-position → per-strategy → per-account → per-broker
 *
 * Latching: once the hard kill switch fires, it stays armed until the user
 * manually re-arms (with a 5-minute cooldown). Soft warnings auto-clear when
 * the metric returns below 80%.
 *
 * Audit: every trigger, action, and override is logged with timestamp for
 * SEC 17a-4 / MiFID II RTS 6 compliance.
 */
import type { Alert, Fill, Position, Quote } from "./types";
import { getContract } from "./contracts";
import { getEngine } from "./market-engine";

// ============================================================
// Types
// ============================================================

export type TriggerType =
  | "LOSS_LIMIT"
  | "DRAWDOWN"
  | "VAR_BREACH"
  | "STRESS_TEST"
  | "MARGIN_UTIL"
  | "CONCENTRATION"
  | "POSITION_LOSS"
  | "VOLATILITY_REGIME"
  | "CIRCUIT_BREAKER"
  | "LATENCY_ANOMALY"
  | "MIDQUOTE_GAP"
  | "THREE_STRIKES"
  | "CALMAR_PROTECTION"
  | "BETA_EXPOSURE"
  | "TIME_RULE"
  | "ENGINE_ANOMALY";

export type TriggerLevel = "SOFT" | "HARD" | "KILL";
export type TriggerStatus = TriggerLevel | "OK";
export type ActionType = "NONE" | "WARN" | "TRIM_POSITION" | "FLATTEN_POSITION" | "FLATTEN_ALL" | "BLOCK_NEW_ORDERS";

export interface KillSwitchRule {
  id: TriggerType;
  name: string;
  description: string;
  enabled: boolean;
  // Thresholds (in their natural units)
  softThreshold: number; // 80% of hard
  hardThreshold: number;
  killThreshold: number; // 120% of hard
  unit: string;          // "USD" | "%" | "bps" | "sec" | "count"
  // Current value (updated each tick)
  currentValue: number;
  currentLevel: TriggerStatus; // "SOFT" | "HARD" | "KILL" | "OK"
  // Last trigger info
  lastTriggeredAt?: number;
  lastAction?: ActionType;
}

export interface KillSwitchState {
  rules: KillSwitchRule[];
  // Master kill switch (latched)
  killSwitchArmed: boolean;
  killSwitchTriggeredAt?: number;
  killSwitchTriggeredBy?: TriggerType;
  killSwitchReason?: string;
  // Re-arm
  canRearmAt?: number;          // cooldown timestamp
  // Block new orders
  blockNewOrders: boolean;
  blockReason?: string;
  // Audit log (append-only)
  auditLog: KillSwitchAuditEntry[];
  // Daily reset tracking
  sessionStartEquity: number;
  sessionStartTime: number;
  peakEquity: number;
  recentFills: Fill[];          // for three-strikes rule
  recentQuotes: Map<string, { time: number; mid: number }>; // for midquote gap
}

export interface KillSwitchAuditEntry {
  id: string;
  timestamp: number;
  triggerType: TriggerType;
  level: TriggerLevel;
  action: ActionType;
  ruleName: string;
  message: string;
  currentValue: number;
  threshold: number;
  symbol?: string;
}

// ============================================================
// Default rules (configurable via UI; persisted to localStorage)
// ============================================================

export interface KillSwitchConfig {
  dailyLossLimitUSD: number;        // hard threshold; soft = 80%, kill = 120%
  maxDrawdownPct: number;           // e.g. 10 = 10%
  varLimitPct: number;              // e.g. 3 = 3% of equity
  stressLimitPct: number;           // e.g. 5 = 5% of equity
  marginLimitPct: number;           // e.g. 90 = 90%
  concentrationPct: number;         // e.g. 25 = 25%
  positionLossLimitUSD: number;     // per-position
  volatilityRegimeMultiplier: number; // e.g. 2.0 = 2x avg
  circuitBreakerPct: number;        // e.g. 5 = 5% in 5 min
  latencyAnomalyMs: number;         // e.g. 5000 = 5s
  midquoteGapPct: number;           // e.g. 1 = 1%
  threeStrikesCount: number;        // e.g. 3
  calmarThreshold: number;          // e.g. 0.5
  betaExposureLimit: number;        // e.g. 2.0
  preFOMCMinutes: number;           // e.g. 15
  preCloseMinutes: number;          // e.g. 5
  cooldownSeconds: number;          // re-arm cooldown
  // Per-rule enable flags
  enabledRules: Partial<Record<TriggerType, boolean>>;
}

export const DEFAULT_CONFIG: KillSwitchConfig = {
  dailyLossLimitUSD: 50_000,
  maxDrawdownPct: 10,
  varLimitPct: 3,
  stressLimitPct: 5,
  marginLimitPct: 90,
  concentrationPct: 25,
  positionLossLimitUSD: 15_000,
  volatilityRegimeMultiplier: 2.0,
  circuitBreakerPct: 5,
  latencyAnomalyMs: 5_000,
  midquoteGapPct: 1,
  threeStrikesCount: 3,
  calmarThreshold: 0.5,
  betaExposureLimit: 2.0,
  preFOMCMinutes: 15,
  preCloseMinutes: 5,
  cooldownSeconds: 300, // 5 min
  enabledRules: {
    LOSS_LIMIT: true,
    DRAWDOWN: true,
    VAR_BREACH: true,
    STRESS_TEST: true,
    MARGIN_UTIL: true,
    CONCENTRATION: true,
    POSITION_LOSS: true,
    VOLATILITY_REGIME: true,
    CIRCUIT_BREAKER: true,
    LATENCY_ANOMALY: true,
    MIDQUOTE_GAP: true,
    THREE_STRIKES: true,
    CALMAR_PROTECTION: false, // off by default — requires longer history
    BETA_EXPOSURE: true,
    TIME_RULE: false,         // off by default — requires economic calendar integration
    ENGINE_ANOMALY: true,
  },
};

const RULE_METADATA: Record<TriggerType, { name: string; description: string }> = {
  LOSS_LIMIT:        { name: "Daily Loss Limit",       description: "Per-session P&L loss exceeds hard limit. Soft warning at 80%, hard flatten at 100%, kill switch at 120%." },
  DRAWDOWN:          { name: "Max Drawdown",           description: "Peak-to-trough drawdown from session-high equity exceeds threshold." },
  VAR_BREACH:        { name: "VaR Breach",             description: "1-day 99% parametric VaR exceeds threshold % of equity." },
  STRESS_TEST:       { name: "Stress Test Loss",       description: "Worst-case scenario loss from 2008 GFC / 2020 COVID / 2022 rate shock exceeds threshold." },
  MARGIN_UTIL:       { name: "Margin Utilization",     description: "Total margin used / account equity exceeds threshold. Auto-flatten to avoid margin call." },
  CONCENTRATION:     { name: "Position Concentration", description: "Single position exceeds threshold % of portfolio notional." },
  POSITION_LOSS:     { name: "Per-Position Loss",      description: "Single position unrealized+realized loss exceeds USD threshold." },
  VOLATILITY_REGIME: { name: "Volatility Regime Shift",description: "Realized vol > N× 30-day average. Indicates regime change." },
  CIRCUIT_BREAKER:   { name: "Price Circuit Breaker",  description: "Rapid price move > threshold% in 5 minutes. CME-style SPI trigger." },
  LATENCY_ANOMALY:   { name: "Latency Anomaly",        description: "Tick gap exceeds threshold. Engine or data feed anomaly." },
  MIDQUOTE_GAP:      { name: "Midquote Gap",           description: "Single-tick midquote jump exceeds threshold%. Stale quote or gap risk." },
  THREE_STRIKES:     { name: "Three Strikes",          description: "N consecutive losing fills. Trader tilt detection." },
  CALMAR_PROTECTION: { name: "Calmar Protection",      description: "Calmar ratio below threshold over recent window." },
  BETA_EXPOSURE:     { name: "Beta-Adjusted Exposure", description: "Portfolio beta-adjusted notional exposure exceeds threshold." },
  TIME_RULE:         { name: "Time-Based Rule",        description: "Pre-FOMC / pre-close / weekend carry limit triggered." },
  ENGINE_ANOMALY:    { name: "Engine Anomaly",         description: "Engine health issue (data gap, mid-quote gap, latency spike)." },
};

// ============================================================
// localStorage persistence
// ============================================================

const CONFIG_KEY = "twg-killswitch-config-v1";

export function loadConfig(): KillSwitchConfig {
  if (typeof window === "undefined") return { ...DEFAULT_CONFIG };
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<KillSwitchConfig>;
    // Merge with defaults to handle new fields added in upgrades
    return { ...DEFAULT_CONFIG, ...parsed, enabledRules: { ...DEFAULT_CONFIG.enabledRules, ...parsed.enabledRules } };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: KillSwitchConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch { /* ignore */ }
}

export function resetConfig(): KillSwitchConfig {
  saveConfig({ ...DEFAULT_CONFIG });
  return { ...DEFAULT_CONFIG };
}

// ============================================================
// Trigger evaluation
// ============================================================

export interface EvaluationContext {
  equity: number;
  sessionStartEquity: number;
  peakEquity: number;
  todayPnL: number;
  drawdownPct: number;
  var99: number;
  stressWorstLoss: number;
  marginUsed: number;
  marginAvailable: number;
  positions: Position[];
  quotes: Record<string, Quote>;
  fills: Fill[];
  lastTickAt: number;
  now: number;
}

function levelFor(value: number, soft: number, hard: number, kill: number): TriggerStatus {
  const av = Math.abs(value);
  if (av >= Math.abs(kill)) return "KILL";
  if (av >= Math.abs(hard)) return "HARD";
  if (av >= Math.abs(soft)) return "SOFT";
  return "OK";
}

function actionFor(level: TriggerStatus): ActionType {
  if (level === "KILL") return "FLATTEN_ALL";
  if (level === "HARD") return "FLATTEN_POSITION";
  if (level === "SOFT") return "WARN";
  return "NONE";
}

// ============================================================
// Main evaluation: returns updated rules + recommended action
// ============================================================

export interface EvaluationResult {
  rules: KillSwitchRule[];
  highestLevel: TriggerStatus;
  killSwitchShouldFire: boolean;
  blockNewOrders: boolean;
  positionsToFlatten: string[]; // symbols
  auditEntries: Omit<KillSwitchAuditEntry, "id" | "timestamp">[];
}

export function evaluateKillSwitch(
  ctx: EvaluationContext,
  config: KillSwitchConfig,
  prevState: KillSwitchState,
): EvaluationResult {
  const now = ctx.now;
  const rules: KillSwitchRule[] = [];
  const auditEntries: Omit<KillSwitchAuditEntry, "id" | "timestamp">[] = [];
  const positionsToFlatten = new Set<string>();
  let killSwitchShouldFire = false;
  let blockNewOrders = false;
  let highestLevel: TriggerStatus = "OK";

  const helper = (type: TriggerType, value: number, unit: string): KillSwitchRule => {
    const meta = RULE_METADATA[type];
    const enabled = config.enabledRules[type] ?? false;
    const soft = softThreshold(config, type);
    const hard = hardThreshold(config, type);
    const kill = killThreshold(config, type);
    const level: TriggerStatus = enabled ? levelFor(value, soft, hard, kill) : "OK";
    if (level !== "OK") {
      if (level === "KILL") killSwitchShouldFire = true;
      if (level === "HARD" || level === "KILL") blockNewOrders = true;
      const levelRank = { OK: 0, SOFT: 1, HARD: 2, KILL: 3 } as const;
      if (levelRank[level] > levelRank[highestLevel]) highestLevel = level;
      auditEntries.push({
        triggerType: type,
        level,
        action: actionFor(level),
        ruleName: meta.name,
        message: `${meta.name} ${level}: value ${value.toFixed(2)} ${unit} vs hard ${hard.toFixed(2)} / kill ${kill.toFixed(2)}`,
        currentValue: value,
        threshold: hard,
      });
    }
    return {
      id: type,
      name: meta.name,
      description: meta.description,
      enabled,
      softThreshold: soft,
      hardThreshold: hard,
      killThreshold: kill,
      unit,
      currentValue: value,
      currentLevel: level,
      lastTriggeredAt: level !== "OK" ? now : prevState.rules.find((r) => r.id === type)?.lastTriggeredAt,
      lastAction: level !== "OK" ? actionFor(level) : prevState.rules.find((r) => r.id === type)?.lastAction,
    };
  };

  // 1. LOSS_LIMIT
  const todayPnL = ctx.todayPnL;
  rules.push(helper("LOSS_LIMIT", -todayPnL, "USD")); // negate so loss is positive

  // 2. DRAWDOWN
  const drawdownPct = ctx.drawdownPct;
  rules.push(helper("DRAWDOWN", drawdownPct, "%"));

  // 3. VAR_BREACH
  const varPct = ctx.equity > 0 ? (ctx.var99 / ctx.equity) * 100 : 0;
  rules.push(helper("VAR_BREACH", varPct, "%"));

  // 4. STRESS_TEST
  const stressPct = ctx.equity > 0 ? (ctx.stressWorstLoss / ctx.equity) * 100 : 0;
  rules.push(helper("STRESS_TEST", stressPct, "%"));

  // 5. MARGIN_UTIL
  const marginUtilPct = ctx.equity > 0 ? (ctx.marginUsed / ctx.equity) * 100 : 0;
  rules.push(helper("MARGIN_UTIL", marginUtilPct, "%"));

  // 6. CONCENTRATION (max single position as % of total notional)
  const totalNotional = ctx.positions.reduce((s, p) => {
    const q = ctx.quotes[p.symbol];
    const contract = getContract(p.symbol);
    return s + Math.abs(p.netQty) * (q?.last ?? 0) * contract.pointValue;
  }, 0);
  let maxConcentrationPct = 0;
  let concentrationSymbol: string | null = null;
  for (const p of ctx.positions) {
    if (p.netQty === 0) continue;
    const q = ctx.quotes[p.symbol];
    const contract = getContract(p.symbol);
    const notional = Math.abs(p.netQty) * (q?.last ?? 0) * contract.pointValue;
    const pct = totalNotional > 0 ? (notional / totalNotional) * 100 : 0;
    if (pct > maxConcentrationPct) { maxConcentrationPct = pct; concentrationSymbol = p.symbol; }
  }
  const concRule = helper("CONCENTRATION", maxConcentrationPct, "%");
  if (concRule.currentLevel === "HARD" || concRule.currentLevel === "KILL") {
    if (concentrationSymbol) positionsToFlatten.add(concentrationSymbol);
  }
  rules.push(concRule);

  // 7. POSITION_LOSS (per-position)
  let worstPositionLoss = 0;
  let worstPositionSymbol: string | null = null;
  for (const p of ctx.positions) {
    if (p.netQty === 0) continue;
    const loss = -Math.min(p.unrealizedPnL + p.realizedPnL, 0); // positive loss
    if (loss > worstPositionLoss) { worstPositionLoss = loss; worstPositionSymbol = p.symbol; }
  }
  const posLossRule = helper("POSITION_LOSS", worstPositionLoss, "USD");
  if (posLossRule.currentLevel === "HARD" || posLossRule.currentLevel === "KILL") {
    if (worstPositionSymbol) positionsToFlatten.add(worstPositionSymbol);
  }
  rules.push(posLossRule);

  // 8. VOLATILITY_REGIME
  let volRegimeMultiplier = 1.0;
  try {
    const esCandles = getEngine().getCandles("ES", 60);
    if (esCandles.length >= 30) {
      const recent = esCandles.slice(-5);
      const recentVol = stddev(recent.map((c) => Math.log(c.close / (c.open || c.close))));
      const longTermCandles = esCandles.slice(-30);
      const longVol = stddev(longTermCandles.map((c) => Math.log(c.close / (c.open || c.close))));
      if (longVol > 0) volRegimeMultiplier = recentVol / longVol;
    }
  } catch { /* engine not ready */ }
  rules.push(helper("VOLATILITY_REGIME", volRegimeMultiplier, "x"));

  // 9. CIRCUIT_BREAKER (rapid price move in 5 min)
  let circuitBreakerMovePct = 0;
  try {
    const esCandles = getEngine().getCandles("ES", 30);
    if (esCandles.length >= 6) {
      const recent = esCandles[esCandles.length - 1].close;
      const fiveMinAgo = esCandles[esCandles.length - 6].close;
      if (fiveMinAgo > 0) circuitBreakerMovePct = Math.abs((recent - fiveMinAgo) / fiveMinAgo) * 100;
    }
  } catch { /* engine not ready */ }
  rules.push(helper("CIRCUIT_BREAKER", circuitBreakerMovePct, "%"));

  // 10. LATENCY_ANOMALY
  const latencyMs = ctx.lastTickAt > 0 ? now - ctx.lastTickAt : 0;
  rules.push(helper("LATENCY_ANOMALY", latencyMs, "ms"));

  // 11. MIDQUOTE_GAP (max single-tick midquote jump across all symbols)
  let maxMidquoteGapPct = 0;
  let midquoteGapSymbol: string | null = null;
  for (const [sym, q] of Object.entries(ctx.quotes)) {
    const prev = prevState.recentQuotes.get(sym);
    if (!prev) continue;
    const mid = (q.bid + q.ask) / 2;
    if (prev.mid > 0) {
      const gap = Math.abs((mid - prev.mid) / prev.mid) * 100;
      if (gap > maxMidquoteGapPct) { maxMidquoteGapPct = gap; midquoteGapSymbol = sym; }
    }
  }
  const midquoteRule = helper("MIDQUOTE_GAP", maxMidquoteGapPct, "%");
  if (midquoteRule.currentLevel === "HARD" || midquoteRule.currentLevel === "KILL") {
    if (midquoteGapSymbol) positionsToFlatten.add(midquoteGapSymbol);
  }
  rules.push(midquoteRule);

  // 12. THREE_STRIKES (consecutive losing fills)
  let consecutiveLosers = 0;
  const recent = ctx.fills.slice(0, 10); // last 10 fills
  for (const f of recent) {
    if (f.price < (f.arrivalPrice ?? f.price)) {
      // For BUY: fill > arrival = loss (paid more than decision price)
      // For SELL: fill < arrival = loss (sold below decision price)
      if (f.side === "BUY" && f.arrivalPrice && f.price > f.arrivalPrice) consecutiveLosers++;
      else if (f.side === "SELL" && f.arrivalPrice && f.price < f.arrivalPrice) consecutiveLosers++;
      else break;
    } else {
      break;
    }
  }
  rules.push(helper("THREE_STRIKES", consecutiveLosers, "count"));

  // 13. CALMAR_PROTECTION (skip if not enough history)
  let calmar = 1.0; // default safe
  try {
    // Approximate: use session P&L history if available
    calmar = 1.0; // would need pnlHistory; conservative default
  } catch { /* ignore */ }
  rules.push(helper("CALMAR_PROTECTION", -calmar, "")); // negate so low calmar = high "value"

  // 14. BETA_EXPOSURE (sum |netQty × beta × notional| / equity)
  let betaExposure = 0;
  try {
    for (const p of ctx.positions) {
      if (p.netQty === 0) continue;
      const contract = getContract(p.symbol);
      const q = ctx.quotes[p.symbol];
      const notional = Math.abs(p.netQty) * (q?.last ?? 0) * contract.pointValue;
      // Beta approximation: equity-index = 1.0, others = 0.5
      const beta = contract.assetClass === "equity_index" ? 1.0 : 0.5;
      betaExposure += beta * notional / Math.max(ctx.equity, 1);
    }
  } catch { /* ignore */ }
  rules.push(helper("BETA_EXPOSURE", betaExposure, "x"));

  // 15. TIME_RULE (placeholder — would integrate with economic calendar)
  rules.push(helper("TIME_RULE", 0, ""));

  // 16. ENGINE_ANOMALY (combined: latency + midquote gap)
  const engineAnomalyScore = Math.max(
    latencyMs > config.latencyAnomalyMs ? 1 : 0,
    maxMidquoteGapPct > config.midquoteGapPct ? 1 : 0,
  );
  rules.push(helper("ENGINE_ANOMALY", engineAnomalyScore, ""));

  return {
    rules,
    highestLevel,
    killSwitchShouldFire,
    blockNewOrders,
    positionsToFlatten: Array.from(positionsToFlatten),
    auditEntries,
  };
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

// ============================================================
// Config helpers: derive soft/hard/kill thresholds per rule type
// ============================================================

export function hardThreshold(config: KillSwitchConfig, type: TriggerType): number {
  switch (type) {
    case "LOSS_LIMIT": return config.dailyLossLimitUSD;
    case "DRAWDOWN": return config.maxDrawdownPct;
    case "VAR_BREACH": return config.varLimitPct;
    case "STRESS_TEST": return config.stressLimitPct;
    case "MARGIN_UTIL": return config.marginLimitPct;
    case "CONCENTRATION": return config.concentrationPct;
    case "POSITION_LOSS": return config.positionLossLimitUSD;
    case "VOLATILITY_REGIME": return config.volatilityRegimeMultiplier;
    case "CIRCUIT_BREAKER": return config.circuitBreakerPct;
    case "LATENCY_ANOMALY": return config.latencyAnomalyMs;
    case "MIDQUOTE_GAP": return config.midquoteGapPct;
    case "THREE_STRIKES": return config.threeStrikesCount;
    case "CALMAR_PROTECTION": return -config.calmarThreshold;
    case "BETA_EXPOSURE": return config.betaExposureLimit;
    case "TIME_RULE": return 1;
    case "ENGINE_ANOMALY": return 1;
  }
}

export function softThreshold(config: KillSwitchConfig, type: TriggerType): number {
  return hardThreshold(config, type) * 0.8;
}

export function killThreshold(config: KillSwitchConfig, type: TriggerType): number {
  return hardThreshold(config, type) * 1.2;
}
