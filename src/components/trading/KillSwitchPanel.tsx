"use client";
import { useMemo, useState, useEffect, useRef } from "react";
import { useTradingStore } from "@/lib/trading/store";
import {
  evaluateKillSwitch, loadConfig, saveConfig, resetConfig,
  hardThreshold, softThreshold, killThreshold,
  type KillSwitchConfig, type KillSwitchState, type KillSwitchRule, type TriggerType,
  type EvaluationResult, type KillSwitchAuditEntry,
} from "@/lib/trading/kill-switch";
import { computeRiskMetrics } from "@/lib/trading/risk";
import { STRESS_SCENARIOS, runStressTest } from "@/lib/trading/risk";
import { getEngine } from "@/lib/trading/market-engine";
import { getContract, CONTRACTS } from "@/lib/trading/contracts";
import { fmtTime } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AlertOctagon, AlertTriangle, CheckCircle2, Power, RotateCcw, Settings, Shield, ShieldAlert, ShieldCheck, Siren, Zap } from "lucide-react";

type View = "monitor" | "rules" | "audit";
const VIEWS: { id: View; name: string; icon: any }[] = [
  { id: "monitor", name: "Live Monitor", icon: Shield },
  { id: "rules", name: "Configure Rules", icon: Settings },
  { id: "audit", name: "Audit Log", icon: AlertTriangle },
];

// Initial empty state for kill switch
const INITIAL_STATE: KillSwitchState = {
  rules: [],
  killSwitchArmed: true,
  blockNewOrders: false,
  auditLog: [],
  sessionStartEquity: 0,
  sessionStartTime: Date.now(),
  peakEquity: 0,
  recentFills: [],
  recentQuotes: new Map(),
};

export function KillSwitchPanel() {
  const [view, setView] = useState<View>("monitor");
  const [config, setConfig] = useState<KillSwitchConfig>(() => loadConfig());
  const [state, setState] = useState<KillSwitchState>(INITIAL_STATE);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [autoAct, setAutoAct] = useState(true);
  const [showRearm, setShowRearm] = useState(false);

  // Store subscriptions
  const quotes = useTradingStore((s) => s.quotes);
  const positions = useTradingStore((s) => s.positions);
  const fills = useTradingStore((s) => s.fills);
  const orders = useTradingStore((s) => s.orders);
  const cashBalance = useTradingStore((s) => s.cashBalance);
  const tickCount = useTradingStore((s) => s.tickCount);
  const lastTickAt = useTradingStore((s) => s.lastTickAt);
  const flattenAll = useTradingStore((s) => s.flattenAll);
  const flattenSymbol = useTradingStore((s) => s.flattenSymbol);
  const addAlert = useTradingStore((s) => s.addAlert);
  const log = useTradingStore((s) => s.log);

  // Throttle evaluation to every 2 seconds
  const lastEvalAt = useRef(0);
  const lastActionAt = useRef<Record<string, number>>({});

  // Run evaluation on every tick (throttled)
  useEffect(() => {
    const now = Date.now();
    if (now - lastEvalAt.current < 2000) return;
    lastEvalAt.current = now;

    const posArray = Object.values(positions);
    const equity = cashBalance + posArray.reduce((s, p) => s + (p.unrealizedPnL || 0), 0);
    const sessionStartEquity = state.sessionStartEquity || equity;
    const peakEquity = Math.max(state.peakEquity || equity, equity);
    const todayPnL = equity - sessionStartEquity;
    const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;

    // Compute VaR (lazy — only if positions exist)
    let var99 = 0;
    let stressWorstLoss = 0;
    if (posArray.some((p) => p.netQty !== 0)) {
      try {
        const history: Record<string, any[]> = {};
        for (const p of posArray) {
          if (p.netQty === 0) continue;
          history[p.symbol] = getEngine().getCandles(p.symbol, 250);
        }
        const riskMetrics = computeRiskMetrics({
          positions: posArray,
          history,
          accountEquity: equity,
        });
        var99 = riskMetrics.var99;
        const stressResults = STRESS_SCENARIOS.map((sc) => runStressTest(posArray, sc));
        stressWorstLoss = Math.max(...stressResults.map((r) => Math.abs(r.portfolioImpact)));
      } catch { /* engine not ready */ }
    }

    // Compute margin used
    let marginUsed = 0;
    for (const p of posArray) {
      if (p.netQty === 0) continue;
      const contract = getContract(p.symbol);
      marginUsed += Math.abs(p.netQty) * contract.marginInitial;
    }
    const marginAvailable = equity - marginUsed;

    // Update recentQuotes for midquote-gap detection
    const newRecentQuotes = new Map<string, { time: number; mid: number }>();
    for (const [sym, q] of Object.entries(quotes)) {
      const prev = state.recentQuotes.get(sym);
      const mid = (q.bid + q.ask) / 2;
      newRecentQuotes.set(sym, { time: now, mid });
      // (midquote gap is evaluated inside evaluateKillSwitch using prevState)
      void prev;
    }

    const result = evaluateKillSwitch(
      {
        equity,
        sessionStartEquity,
        peakEquity,
        todayPnL,
        drawdownPct,
        var99,
        stressWorstLoss,
        marginUsed,
        marginAvailable,
        positions: posArray,
        quotes,
        fills: fills.slice(0, 10),
        lastTickAt,
        now,
      },
      config,
      state,
    );

    // Defer state updates out of the effect body to avoid cascading-render warning.
    Promise.resolve().then(() => {
      setEvaluation(result);

      // Update state with new rules + recentQuotes
      setState((prev) => ({
        ...prev,
        rules: result.rules,
        recentQuotes: newRecentQuotes,
        peakEquity,
        sessionStartEquity,
        recentFills: fills.slice(0, 10),
      }));

      // Auto-act on triggers (with per-rule cooldown to avoid spam)
      if (autoAct && !state.killSwitchArmed) {
        // Kill switch already fired — do nothing until re-armed
      } else if (autoAct) {
        // Add audit entries to state
        const newEntries: KillSwitchAuditEntry[] = result.auditEntries.map((a) => ({
          ...a,
          id: `audit-${now}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: now,
        }));
        if (newEntries.length > 0) {
          setState((prev) => ({
            ...prev,
            auditLog: [...newEntries, ...prev.auditLog].slice(0, 500),
          }));
        }

        // Push to store alerts
        for (const entry of newEntries) {
          const cooldownKey = `${entry.triggerType}:${entry.level}`;
          const lastTime = lastActionAt.current[cooldownKey] ?? 0;
          if (now - lastTime < 10_000) continue; // 10s cooldown per rule+level
          lastActionAt.current[cooldownKey] = now;
          addAlert({
            type: "RISK",
            severity: entry.level === "KILL" ? "CRITICAL" : entry.level === "HARD" ? "ERROR" : "WARN",
            message: `[Kill Switch] ${entry.message}`,
            symbol: entry.symbol,
          });
          log(entry.level === "KILL" ? "ERROR" : "WARN", "KillSwitch", entry.message, {
            trigger: entry.triggerType, level: entry.level, value: entry.currentValue, threshold: entry.threshold,
          });
        }

        // Hard kill switch
        if (result.killSwitchShouldFire && state.killSwitchArmed) {
          flattenAll();
          setState((prev) => ({
            ...prev,
          killSwitchArmed: false,
          killSwitchTriggeredAt: now,
          killSwitchTriggeredBy: result.rules.find((r) => r.currentLevel === "KILL")?.id,
          killSwitchReason: result.rules.find((r) => r.currentLevel === "KILL")?.name,
          canRearmAt: now + config.cooldownSeconds * 1000,
          blockNewOrders: true,
          blockReason: "Kill switch triggered — manual re-arm required",
        }));
      } else if (result.positionsToFlatten.length > 0) {
        // Flatten specific positions
        for (const sym of result.positionsToFlatten) {
          const pos = positions[sym];
          if (pos && pos.netQty !== 0) {
            flattenSymbol(sym);
          }
        }
      }
      // Block new orders
      if (result.blockNewOrders && !state.blockNewOrders) {
        setState((prev) => ({ ...prev, blockNewOrders: true, blockReason: "Risk limit breached" }));
      } else if (!result.blockNewOrders && state.blockNewOrders && state.killSwitchArmed) {
        setState((prev) => ({ ...prev, blockNewOrders: false, blockReason: undefined }));
      }
    }
    });
  }, [tickCount]);

  // Manual re-arm
  const handleRearm = () => {
    const now = Date.now();
    if (state.canRearmAt && now < state.canRearmAt) {
      const waitSec = Math.ceil((state.canRearmAt - now) / 1000);
      alert(`Re-arm cooldown active. Wait ${waitSec}s.`);
      return;
    }
    setState((prev) => ({
      ...prev,
      killSwitchArmed: true,
      killSwitchTriggeredAt: undefined,
      killSwitchTriggeredBy: undefined,
      killSwitchReason: undefined,
      canRearmAt: undefined,
      blockNewOrders: false,
      blockReason: undefined,
      sessionStartEquity: cashBalance + Object.values(positions).reduce((s, p) => s + (p.unrealizedPnL || 0), 0),
      sessionStartTime: now,
      peakEquity: cashBalance + Object.values(positions).reduce((s, p) => s + (p.unrealizedPnL || 0), 0),
    }));
    setShowRearm(false);
    addAlert({ type: "RISK", severity: "INFO", message: "Kill switch re-armed by user. New session started." });
    log("INFO", "KillSwitch", "Kill switch re-armed", { userInitiated: true });
  };

  const handleManualKill = () => {
    if (!confirm("Manually trigger kill switch? This will flatten ALL positions immediately.")) return;
    flattenAll();
    setState((prev) => ({
      ...prev,
      killSwitchArmed: false,
      killSwitchTriggeredAt: Date.now(),
      killSwitchTriggeredBy: "ENGINE_ANOMALY" as TriggerType,
      killSwitchReason: "Manual trigger by user",
      canRearmAt: Date.now() + config.cooldownSeconds * 1000,
      blockNewOrders: true,
      blockReason: "Manual kill switch trigger",
    }));
    addAlert({ type: "RISK", severity: "CRITICAL", message: "Manual kill switch triggered — all positions flattened" });
    log("ERROR", "KillSwitch", "Manual kill switch triggered by user");
  };

  return (
    <div className="space-y-4">
      {/* Header status banner */}
      <div className={cn(
        "border rounded-md p-3 flex items-center gap-3",
        !state.killSwitchArmed ? "border-rose-500/40 bg-rose-500/10" :
        evaluation?.highestLevel === "HARD" ? "border-amber-500/40 bg-amber-500/10" :
        evaluation?.highestLevel === "SOFT" ? "border-blue-500/40 bg-blue-500/10" :
        "border-emerald-500/30 bg-emerald-500/5"
      )}>
        <div className={cn("w-12 h-12 rounded-md flex items-center justify-center",
          !state.killSwitchArmed ? "bg-rose-500/20" :
          evaluation?.highestLevel === "HARD" ? "bg-amber-500/20" :
          evaluation?.highestLevel === "SOFT" ? "bg-blue-500/20" :
          "bg-emerald-500/20"
        )}>
          {!state.killSwitchArmed ? <Siren className="w-6 h-6 text-rose-400" /> :
           evaluation?.highestLevel === "HARD" ? <ShieldAlert className="w-6 h-6 text-amber-400" /> :
           evaluation?.highestLevel === "SOFT" ? <AlertTriangle className="w-6 h-6 text-blue-400" /> :
           <ShieldCheck className="w-6 h-6 text-emerald-400" />}
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">
            {!state.killSwitchArmed ? "KILL SWITCH TRIGGERED" :
             evaluation?.highestLevel === "HARD" ? "HARD RISK LIMIT BREACHED" :
             evaluation?.highestLevel === "SOFT" ? "SOFT WARNING — RISK APPROACHING LIMIT" :
             "ALL CLEAR — NO RISK TRIGGERS"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {!state.killSwitchArmed && state.killSwitchReason ? `Reason: ${state.killSwitchReason} · Triggered: ${state.killSwitchTriggeredAt ? fmtTime(state.killSwitchTriggeredAt) : "—"}` :
             evaluation ? `${evaluation.rules.filter((r) => r.currentLevel !== "OK").length} rules monitoring · ${evaluation.rules.filter((r) => r.currentLevel !== "OK" && r.enabled).length} active triggers` :
             "Initializing…"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!state.killSwitchArmed && (
            <Button size="sm" variant="outline" className="h-8 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" onClick={() => setShowRearm(true)}>
              <Power className="w-3.5 h-3.5 mr-1" /> Re-arm
            </Button>
          )}
          {state.killSwitchArmed && (
            <Button size="sm" variant="outline" className="h-8 border-rose-500/30 text-rose-400 hover:bg-rose-500/10" onClick={handleManualKill}>
              <Siren className="w-3.5 h-3.5 mr-1" /> Manual Kill
            </Button>
          )}
        </div>
      </div>

      {/* View switcher */}
      <div className="flex items-center gap-1 flex-wrap">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors",
              view === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>
            <v.icon className="w-3.5 h-3.5" />{v.name}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
          <input type="checkbox" checked={autoAct} onChange={(e) => setAutoAct(e.target.checked)} className="w-3 h-3 accent-primary" />
          Auto-act on triggers
        </label>
      </div>

      {view === "monitor" && evaluation && <MonitorView evaluation={evaluation} state={state} />}
      {view === "rules" && (
        <RulesView config={config} onConfigChange={(c) => { setConfig(c); saveConfig(c); }} onReset={() => { const r = resetConfig(); setConfig(r); }} />
      )}
      {view === "audit" && <AuditView state={state} />}
      {showRearm && <RearmModal state={state} onConfirm={handleRearm} onCancel={() => setShowRearm(false)} />}
    </div>
  );
}

// ============================================================
// Live Monitor View
// ============================================================
function MonitorView({ evaluation, state }: { evaluation: EvaluationResult; state: KillSwitchState }) {
  const activeRules = evaluation.rules.filter((r) => r.enabled);
  const okCount = activeRules.filter((r) => r.currentLevel === "OK").length;
  const softCount = activeRules.filter((r) => r.currentLevel === "SOFT").length;
  const hardCount = activeRules.filter((r) => r.currentLevel === "HARD").length;
  const killCount = activeRules.filter((r) => r.currentLevel === "KILL").length;

  return (
    <div className="space-y-3">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card className="p-2.5 border-emerald-500/20 bg-emerald-500/5">
          <div className="text-[9px] uppercase text-muted-foreground">OK</div>
          <div className="text-sm font-mono font-semibold text-emerald-400">{okCount}</div>
        </Card>
        <Card className="p-2.5 border-blue-500/20 bg-blue-500/5">
          <div className="text-[9px] uppercase text-muted-foreground">Soft Warning</div>
          <div className="text-sm font-mono font-semibold text-blue-400">{softCount}</div>
        </Card>
        <Card className="p-2.5 border-amber-500/20 bg-amber-500/5">
          <div className="text-[9px] uppercase text-muted-foreground">Hard Limit</div>
          <div className="text-sm font-mono font-semibold text-amber-400">{hardCount}</div>
        </Card>
        <Card className="p-2.5 border-rose-500/20 bg-rose-500/5">
          <div className="text-[9px] uppercase text-muted-foreground">Kill Switch</div>
          <div className="text-sm font-mono font-semibold text-rose-400">{killCount}</div>
        </Card>
        <Card className={cn("p-2.5 border", state.killSwitchArmed ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/10")}>
          <div className="text-[9px] uppercase text-muted-foreground">Status</div>
          <div className={cn("text-sm font-mono font-semibold", state.killSwitchArmed ? "text-emerald-400" : "text-rose-400")}>
            {state.killSwitchArmed ? "ARMED" : "LATCHED"}
          </div>
        </Card>
      </div>

      {/* Rule cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {activeRules.map((rule) => <RuleCard key={rule.id} rule={rule} />)}
      </div>
    </div>
  );
}

function RuleCard({ rule }: { rule: KillSwitchRule }) {
  const levelColor = {
    OK: "border-emerald-500/20 bg-emerald-500/5",
    SOFT: "border-blue-500/30 bg-blue-500/5",
    HARD: "border-amber-500/40 bg-amber-500/10",
    KILL: "border-rose-500/40 bg-rose-500/10",
  }[rule.currentLevel];
  const badgeColor = {
    OK: "bg-emerald-500/15 text-emerald-400",
    SOFT: "bg-blue-500/15 text-blue-400",
    HARD: "bg-amber-500/15 text-amber-400",
    KILL: "bg-rose-500/15 text-rose-400",
  }[rule.currentLevel];
  const icon = {
    OK: <CheckCircle2 className="w-3.5 h-3.5" />,
    SOFT: <AlertTriangle className="w-3.5 h-3.5" />,
    HARD: <ShieldAlert className="w-3.5 h-3.5" />,
    KILL: <Siren className="w-3.5 h-3.5" />,
  }[rule.currentLevel];

  // Compute progress bar (0 to kill)
  const progressPct = rule.killThreshold > 0 ? Math.min(100, (Math.abs(rule.currentValue) / Math.abs(rule.killThreshold)) * 100) : 0;
  const softPct = rule.killThreshold > 0 ? (Math.abs(rule.softThreshold) / Math.abs(rule.killThreshold)) * 100 : 0;
  const hardPct = rule.killThreshold > 0 ? (Math.abs(rule.hardThreshold) / Math.abs(rule.killThreshold)) * 100 : 0;

  return (
    <Card className={cn("border", levelColor)}>
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold">{rule.name}</span>
              {!rule.enabled && <Badge variant="outline" className="text-[9px] h-4 px-1 text-muted-foreground">DISABLED</Badge>}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{rule.description}</p>
          </div>
          <Badge variant="outline" className={cn("text-[9px] h-5 px-1.5 flex items-center gap-1 shrink-0", badgeColor)}>
            {icon}
            {rule.currentLevel}
          </Badge>
        </div>
        <div className="flex items-baseline gap-3 mt-1.5 font-mono">
          <div>
            <div className="text-[9px] uppercase text-muted-foreground">Current</div>
            <div className={cn("text-sm font-semibold",
              rule.currentLevel === "OK" ? "text-foreground" :
              rule.currentLevel === "SOFT" ? "text-blue-400" :
              rule.currentLevel === "HARD" ? "text-amber-400" : "text-rose-400")}>
              {rule.currentValue.toFixed(2)} <span className="text-[10px] text-muted-foreground">{rule.unit}</span>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground">
            <div>Soft: {rule.softThreshold.toFixed(1)} {rule.unit}</div>
            <div>Hard: {rule.hardThreshold.toFixed(1)} {rule.unit}</div>
            <div className="text-rose-400">Kill: {rule.killThreshold.toFixed(1)} {rule.unit}</div>
          </div>
          {rule.lastTriggeredAt && (
            <div className="ml-auto text-[10px] text-muted-foreground text-right">
              <div>Last triggered</div>
              <div className="font-mono">{fmtTime(rule.lastTriggeredAt)}</div>
            </div>
          )}
        </div>
        {/* Progress bar */}
        <div className="mt-2">
          <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
            {/* Threshold zones */}
            <div className="absolute inset-y-0 left-0 bg-blue-500/20" style={{ width: `${softPct}%` }} />
            <div className="absolute inset-y-0 bg-amber-500/20" style={{ left: `${softPct}%`, width: `${hardPct - softPct}%` }} />
            <div className="absolute inset-y-0 bg-rose-500/20" style={{ left: `${hardPct}%`, width: `${100 - hardPct}%` }} />
            {/* Current value marker */}
            <div className={cn("absolute inset-y-0 left-0 transition-all",
              rule.currentLevel === "OK" ? "bg-emerald-500" :
              rule.currentLevel === "SOFT" ? "bg-blue-500" :
              rule.currentLevel === "HARD" ? "bg-amber-500" : "bg-rose-500"
            )} style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
            <span>0</span>
            <span>{rule.killThreshold.toFixed(1)} {rule.unit}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Rules Configuration View
// ============================================================
function RulesView({ config, onConfigChange, onReset }: {
  config: KillSwitchConfig;
  onConfigChange: (c: KillSwitchConfig) => void;
  onReset: () => void;
}) {
  const update = (updates: Partial<KillSwitchConfig>) => onConfigChange({ ...config, ...updates });
  const toggleRule = (type: TriggerType, enabled: boolean) => {
    onConfigChange({ ...config, enabledRules: { ...config.enabledRules, [type]: enabled } });
  };

  const numericFields: { key: keyof KillSwitchConfig; label: string; unit: string; type: TriggerType }[] = [
    { key: "dailyLossLimitUSD", label: "Daily Loss Limit", unit: "USD", type: "LOSS_LIMIT" },
    { key: "maxDrawdownPct", label: "Max Drawdown", unit: "%", type: "DRAWDOWN" },
    { key: "varLimitPct", label: "VaR Limit (1d 99%)", unit: "% of equity", type: "VAR_BREACH" },
    { key: "stressLimitPct", label: "Stress Test Loss Limit", unit: "% of equity", type: "STRESS_TEST" },
    { key: "marginLimitPct", label: "Margin Utilization Limit", unit: "%", type: "MARGIN_UTIL" },
    { key: "concentrationPct", label: "Position Concentration Limit", unit: "%", type: "CONCENTRATION" },
    { key: "positionLossLimitUSD", label: "Per-Position Loss Limit", unit: "USD", type: "POSITION_LOSS" },
    { key: "volatilityRegimeMultiplier", label: "Vol Regime Multiplier", unit: "x avg", type: "VOLATILITY_REGIME" },
    { key: "circuitBreakerPct", label: "Circuit Breaker Move (5min)", unit: "%", type: "CIRCUIT_BREAKER" },
    { key: "latencyAnomalyMs", label: "Latency Anomaly Threshold", unit: "ms", type: "LATENCY_ANOMALY" },
    { key: "midquoteGapPct", label: "Midquote Gap Threshold", unit: "%", type: "MIDQUOTE_GAP" },
    { key: "threeStrikesCount", label: "Three-Strikes Count", unit: "fills", type: "THREE_STRIKES" },
    { key: "calmarThreshold", label: "Calmar Ratio Threshold", unit: "ratio", type: "CALMAR_PROTECTION" },
    { key: "betaExposureLimit", label: "Beta-Adjusted Exposure", unit: "x equity", type: "BETA_EXPOSURE" },
    { key: "cooldownSeconds", label: "Re-arm Cooldown", unit: "seconds", type: "ENGINE_ANOMALY" },
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold">Threshold Configuration</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Soft trigger fires at 80% · Hard trigger at 100% · Kill switch at 120% of each threshold. Config is persisted to localStorage.</div>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onReset}>
            <RotateCcw className="w-3 h-3 mr-1" /> Reset to Defaults
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Threshold Values</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {numericFields.map(({ key, label, unit }) => (
              <div key={key} className="border border-border/40 rounded-md p-2">
                <Label className="text-[10px] text-muted-foreground">{label}</Label>
                <div className="flex items-center gap-1 mt-0.5">
                  <Input
                    type="number"
                    value={config[key] as number}
                    onChange={(e) => update({ [key]: Number(e.target.value) } as any)}
                    className="h-7 text-xs font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground shrink-0 w-16">{unit}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Per-Rule Enable</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 p-2">
            {(Object.keys(RULE_TYPE_LIST) as TriggerType[]).map((type) => {
              const enabled = config.enabledRules[type] ?? false;
              const meta = RULE_TYPE_LIST[type];
              return (
                <label key={type} className={cn("flex items-start gap-2 p-2 border rounded-md cursor-pointer",
                  enabled ? "border-primary/30 bg-primary/5" : "border-border/40")}>
                  <input type="checkbox" checked={enabled} onChange={(e) => toggleRule(type, e.target.checked)} className="w-3.5 h-3.5 accent-primary mt-0.5" />
                  <div>
                    <div className="text-xs font-medium">{meta.name}</div>
                    <div className="text-[10px] text-muted-foreground leading-tight">{meta.description}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Rule type metadata for the RulesView
const RULE_TYPE_LIST: Record<TriggerType, { name: string; description: string }> = {
  LOSS_LIMIT:        { name: "Daily Loss Limit",       description: "Per-session P&L loss exceeds hard limit." },
  DRAWDOWN:          { name: "Max Drawdown",           description: "Peak-to-trough drawdown from session-high equity." },
  VAR_BREACH:        { name: "VaR Breach",             description: "1-day 99% parametric VaR exceeds threshold." },
  STRESS_TEST:       { name: "Stress Test Loss",       description: "Worst-case stress scenario loss exceeds threshold." },
  MARGIN_UTIL:       { name: "Margin Utilization",     description: "Total margin used / equity exceeds threshold." },
  CONCENTRATION:     { name: "Position Concentration", description: "Single position exceeds threshold % of portfolio." },
  POSITION_LOSS:     { name: "Per-Position Loss",      description: "Single position loss exceeds USD threshold." },
  VOLATILITY_REGIME: { name: "Volatility Regime Shift",description: "Realized vol > N× 30-day average." },
  CIRCUIT_BREAKER:   { name: "Price Circuit Breaker",  description: "Rapid price move > threshold% in 5 minutes." },
  LATENCY_ANOMALY:   { name: "Latency Anomaly",        description: "Tick gap exceeds threshold." },
  MIDQUOTE_GAP:      { name: "Midquote Gap",           description: "Single-tick midquote jump exceeds threshold." },
  THREE_STRIKES:     { name: "Three Strikes",          description: "N consecutive losing fills." },
  CALMAR_PROTECTION: { name: "Calmar Protection",      description: "Calmar ratio below threshold." },
  BETA_EXPOSURE:     { name: "Beta-Adjusted Exposure", description: "Portfolio beta-adjusted exposure exceeds threshold." },
  TIME_RULE:         { name: "Time-Based Rule",        description: "Pre-FOMC / pre-close / weekend carry limit." },
  ENGINE_ANOMALY:    { name: "Engine Anomaly",         description: "Engine health issue (data gap, latency spike)." },
};

// ============================================================
// Audit Log View
// ============================================================
function AuditView({ state }: { state: KillSwitchState }) {
  const [filterLevel, setFilterLevel] = useState<string>("ALL");
  const filtered = state.auditLog.filter((e) => filterLevel === "ALL" || e.level === filterLevel);

  return (
    <Card>
      <CardHeader className="py-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs">Kill Switch Audit Log ({filtered.length} entries)</CardTitle>
        <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs h-7">
          <option value="ALL">All Levels</option>
          <option value="SOFT">Soft Only</option>
          <option value="HARD">Hard Only</option>
          <option value="KILL">Kill Only</option>
        </select>
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">No audit entries yet. Triggers will be logged here in real time.</div>
        ) : (
          <div className="overflow-y-auto max-h-[600px]">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase">
                  <th className="text-left py-2 px-3">Time</th>
                  <th className="text-left py-2 px-3">Rule</th>
                  <th className="text-center py-2 px-2">Level</th>
                  <th className="text-center py-2 px-2">Action</th>
                  <th className="text-right py-2 px-3">Value</th>
                  <th className="text-right py-2 px-3">Threshold</th>
                  <th className="text-left py-2 px-3">Message</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id} className="border-b border-border/30 hover:bg-muted/30">
                    <td className="py-1.5 px-3 font-mono text-[10px] text-muted-foreground">{fmtTime(entry.timestamp)}</td>
                    <td className="py-1.5 px-3 font-medium">{entry.ruleName}</td>
                    <td className="py-1.5 px-2 text-center">
                      <Badge variant="outline" className={cn("text-[9px] h-4 px-1",
                        entry.level === "KILL" ? "bg-rose-500/15 text-rose-400" :
                        entry.level === "HARD" ? "bg-amber-500/15 text-amber-400" :
                        "bg-blue-500/15 text-blue-400"
                      )}>{entry.level}</Badge>
                    </td>
                    <td className="py-1.5 px-2 text-center font-mono text-[9px] text-muted-foreground">{entry.action}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono font-medium",
                      entry.level === "KILL" ? "text-rose-400" :
                      entry.level === "HARD" ? "text-amber-400" :
                      "text-blue-400"
                    )}>{entry.currentValue.toFixed(2)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{entry.threshold.toFixed(2)}</td>
                    <td className="py-1.5 px-3 text-[10px] text-muted-foreground">{entry.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// Re-arm Modal
// ============================================================
function RearmModal({ state, onConfirm, onCancel }: {
  state: KillSwitchState;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const now = Date.now();
  const canRearm = !state.canRearmAt || now >= state.canRearmAt;
  const waitSec = state.canRearmAt ? Math.max(0, Math.ceil((state.canRearmAt - now) / 1000)) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Card className="w-full max-w-md border-rose-500/30">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2"><Power className="w-4 h-4 text-emerald-400" /> Re-arm Kill Switch</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            {!canRearm ? (
              <div>
                <div className="text-amber-400 font-semibold mb-1">Cooldown active</div>
                <div>Wait <span className="font-mono font-semibold text-foreground">{waitSec}s</span> before re-arming.</div>
              </div>
            ) : (
              <div>
                <div className="font-semibold text-foreground mb-1">Ready to re-arm</div>
                <div>This will:</div>
                <ul className="list-disc list-inside mt-1 space-y-0.5 text-[11px]">
                  <li>Reset session start equity to current equity</li>
                  <li>Reset peak equity to current equity</li>
                  <li>Clear all blocking flags</li>
                  <li>Allow new orders</li>
                </ul>
                <div className="text-[10px] text-amber-400 mt-2">Trigger reason: {state.killSwitchReason ?? "—"}</div>
              </div>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={!canRearm} onClick={onConfirm}>
              <Power className="w-3 h-3 mr-1" /> Re-arm Now
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
