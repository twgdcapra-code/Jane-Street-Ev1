"use client";

import { useEffect, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fmtTime } from "@/lib/trading/format";
import { Activity, Cpu, Gauge, Server, Terminal as TerminalIcon, Zap } from "lucide-react";
import type { SystemMetric } from "@/lib/trading/types";

export function SystemMonitor() {
  const logs = useTradingStore((s) => s.logs);
  const metrics = useTradingStore((s) => s.metrics);
  const tickCount = useTradingStore((s) => s.tickCount);
  const lastTickAt = useTradingStore((s) => s.lastTickAt);
  const orders = useTradingStore((s) => s.orders);
  const fills = useTradingStore((s) => s.fills);
  const positions = useTradingStore((s) => s.positions);
  const strategies = useTradingStore((s) => s.strategies);
  const quotes = useTradingStore((s) => s.quotes);

  const [tickRate, setTickRate] = useState(0);
  const [throughput, setThroughput] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const last1000 = logs.slice(0, 50);
      setTickRate(tickCount);
      setThroughput(Object.keys(quotes).length * 4); // approx msgs/s per symbol
    }, 1000);
    return () => clearInterval(id);
  }, [tickCount, quotes, logs]);

  const liveMetrics: SystemMetric[] = [
    { name: "Tick-to-Trade Latency", value: 0.42 + Math.random() * 0.1, unit: "μs", status: "healthy", target: 5 },
    { name: "Order Ack Latency", value: 1.8 + Math.random() * 0.4, unit: "ms", status: "healthy", target: 10 },
    { name: "Market Data Throughput", value: throughput, unit: "msg/s", status: "healthy", target: 10000 },
    { name: "Active Strategies", value: strategies.filter((s) => s.enabled).length, unit: "", status: "healthy" },
    { name: "Open Orders", value: orders.filter((o) => o.status === "WORKING").length, unit: "", status: "healthy" },
    { name: "Open Positions", value: Object.values(positions).filter((p) => p.netQty !== 0).length, unit: "", status: "healthy" },
    { name: "Total Fills", value: fills.length, unit: "", status: "healthy" },
    { name: "Memory Usage", value: 312 + Math.random() * 50, unit: "MB", status: "healthy", target: 1024 },
    { name: "Order Match Rate", value: 100, unit: "%", status: "healthy", target: 99.9 },
    { name: "Risk Engine Cycle", value: 0.3 + Math.random() * 0.1, unit: "ms", status: "healthy", target: 5 },
    { name: "Strategy Eval Cycle", value: 1.2 + Math.random() * 0.2, unit: "ms", status: "healthy", target: 10 },
    { name: "Uptime", value: ((Date.now() - (window as any).SESSION_START) / 1000) || 0, unit: "s", status: "healthy" },
  ];

  return (
    <div className="space-y-4">
      {/* Architecture diagram */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Server className="w-4 h-4" /> System Architecture (Jane Street-inspired)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs">
            <ArchBox
              title="Market Data"
              subtitle="GBM + jumps + Heston vol"
              items={["Quote feed", "Order book L2", "Historical bars"]}
              tone="emerald"
            />
            <ArchArrow />
            <ArchBox
              title="OMS + Matching"
              subtitle="Limit / Stop / MIT / etc."
              items={["Order validation", "Margin check", "Fill recording"]}
              tone="blue"
            />
            <ArchArrow />
            <ArchBox
              title="Risk Engine"
              subtitle="VaR · Monte Carlo · Stress"
              items={["No silos view", "Kill switch", "Position limits"]}
              tone="rose"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs mt-2">
            <ArchBox
              title="Strategy Engine"
              subtitle="6 quant strategies"
              items={["Mean rev / Momentum", "Pairs / MM", "Breakout / VRP"]}
              tone="purple"
            />
            <ArchArrow />
            <ArchBox
              title="Analytics"
              subtitle="Sharpe · Sortino · Beta"
              items={["Portfolio attribution", "Correlation matrix", "Factor decomp"]}
              tone="amber"
            />
            <ArchArrow />
            <ArchBox
              title="Backtester"
              subtitle="Walk-forward"
              items={["Equity curve", "Drawdown", "Trade ledger"]}
              tone="cyan"
            />
          </div>
          <div className="text-[10px] text-muted-foreground mt-3 leading-relaxed">
            Inspired by Jane Street's "no silos" architecture — a single integrated view across all functions.
            <br />Real Jane Street tech: OCaml · Hardcaml (FPGA) · Bonsai (web) · Superstore (columnar DB) · JX (internal cross).
            <br />This simulator: TypeScript · Zustand · Recharts — a tribute, not a clone.
          </div>
        </CardContent>
      </Card>

      {/* Live metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {liveMetrics.map((m) => (
          <Card key={m.name} className={cn(
            "p-3 border",
            m.status === "healthy" && "border-emerald-500/20",
            m.status === "warning" && "border-amber-500/30",
            m.status === "critical" && "border-rose-500/30",
          )}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{m.name}</div>
            <div className="text-lg font-mono font-semibold tabular-nums mt-0.5">
              {m.unit === "s" ? formatUptime(m.value) : m.value.toLocaleString("en-US", { maximumFractionDigits: 2 })} <span className="text-xs text-muted-foreground">{m.unit !== "s" && m.unit}</span>
            </div>
            {m.target && <div className="text-[9px] text-muted-foreground font-mono">target ≤ {m.target}{m.unit}</div>}
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Engine state */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2"><Cpu className="w-4 h-4" /> Engine State</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <Row label="Status" value={<Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">RUNNING</Badge>} />
            <Row label="Mode" value={<Badge variant="outline" className="text-[10px]">SIMULATION</Badge>} />
            <Row label="Tick Count" value={<span className="font-mono">{tickCount.toLocaleString()}</span>} />
            <Row label="Last Tick" value={<span className="font-mono text-[10px]">{lastTickAt ? fmtTime(lastTickAt) : "—"}</span>} />
            <Row label="Symbols Tracked" value={<span className="font-mono">{Object.keys(quotes).length}</span>} />
            <Row label="Tick Rate" value={<span className="font-mono">{tickRate}/s</span>} />
            <Row label="Engine" value={<span className="font-mono">GBM + Heston + Merton</span>} />
            <Row label="Tick Cadence" value={<span className="font-mono">1500ms</span>} />
          </CardContent>
        </Card>

        {/* Performance counters */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2"><Gauge className="w-4 h-4" /> Performance Counters</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <Row label="Orders Placed" value={<span className="font-mono">{orders.length}</span>} />
            <Row label="Fills Recorded" value={<span className="font-mono">{fills.length}</span>} />
            <Row label="Working Orders" value={<span className="font-mono">{orders.filter((o) => o.status === "WORKING").length}</span>} />
            <Row label="Cancelled" value={<span className="font-mono">{orders.filter((o) => o.status === "CANCELLED").length}</span>} />
            <Row label="Rejected" value={<span className="font-mono">{orders.filter((o) => o.status === "REJECTED").length}</span>} />
            <Row label="Open Positions" value={<span className="font-mono">{Object.values(positions).filter((p) => p.netQty !== 0).length}</span>} />
            <Row label="Strategies Active" value={<span className="font-mono">{strategies.filter((s) => s.enabled).length} / {strategies.length}</span>} />
            <Row label="Alerts Outstanding" value={<span className="font-mono">{useTradingStore.getState().alerts.filter((a) => !a.acknowledged).length}</span>} />
          </CardContent>
        </Card>

        {/* Risk budget */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2"><Zap className="w-4 h-4" /> Risk Budget</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            <Row label="Max Leverage" value={<span className="font-mono">4.0x</span>} />
            <Row label="VaR Limit (95%)" value={<span className="font-mono">$50,000</span>} />
            <Row label="VaR Limit (99%)" value={<span className="font-mono">$80,000</span>} />
            <Row label="Max Concentration" value={<span className="font-mono">25%</span>} />
            <Row label="Max Per-Symbol Qty" value={<span className="font-mono">50 contracts</span>} />
            <Row label="Margin Call Threshold" value={<span className="font-mono">80%</span>} />
            <Row label="Auto-Flatten Trigger" value={<span className="font-mono">95%</span>} />
            <Row label="Kill Switch" value={<Badge variant="outline" className="text-[10px] bg-rose-500/15 text-rose-400 border-rose-500/30">ARMED</Badge>} />
          </CardContent>
        </Card>
      </div>

      {/* Event log */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><TerminalIcon className="w-4 h-4" /> Event Log</CardTitle>
          <Badge variant="outline" className="text-[10px]">{logs.length} entries</Badge>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-y-auto max-h-96 font-mono text-[11px]">
            {logs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No log entries</div>
            ) : (
              logs.map((l) => (
                <div key={l.id} className="px-3 py-1 border-b border-border/30 hover:bg-muted/30 flex items-start gap-2">
                  <span className="text-muted-foreground text-[10px] tabular-nums shrink-0">{fmtTime(l.timestamp)}</span>
                  <span
                    className={cn(
                      "text-[10px] font-semibold shrink-0 w-12",
                      l.level === "INFO" && "text-blue-400",
                      l.level === "WARN" && "text-amber-400",
                      l.level === "ERROR" && "text-rose-400",
                      l.level === "DEBUG" && "text-muted-foreground",
                    )}
                  >
                    {l.level}
                  </span>
                  <span className="text-muted-foreground text-[10px] shrink-0 w-20 truncate">[{l.module}]</span>
                  <span className="text-foreground flex-1">{l.message}</span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ArchBox({ title, subtitle, items, tone }: { title: string; subtitle: string; items: string[]; tone: string }) {
  const colors: Record<string, string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/5",
    blue: "border-blue-500/30 bg-blue-500/5",
    rose: "border-rose-500/30 bg-rose-500/5",
    purple: "border-purple-500/30 bg-purple-500/5",
    amber: "border-amber-500/30 bg-amber-500/5",
    cyan: "border-cyan-500/30 bg-cyan-500/5",
  };
  return (
    <div className={cn("border rounded-md p-2 col-span-1 md:col-span-1", colors[tone])}>
      <div className="text-xs font-semibold">{title}</div>
      <div className="text-[9px] text-muted-foreground mb-1">{subtitle}</div>
      <ul className="text-[10px] space-y-0.5 text-muted-foreground">
        {items.map((i) => <li key={i}>· {i}</li>)}
      </ul>
    </div>
  );
}

function ArchArrow() {
  return (
    <div className="hidden md:flex items-center justify-center text-muted-foreground text-xl">
      →
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border/30 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
