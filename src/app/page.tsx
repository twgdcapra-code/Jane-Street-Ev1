"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpen,
  Brain,
  Calendar,
  CircleDot,
  Cpu,
  Gauge,
  Layers,
  LayoutDashboard,
  LineChart,
  type LucideIcon,
  Radar,
  RefreshCw,
  Calculator,
  ShieldAlert,
  Sigma,
  Star,
  Terminal as TerminalIcon,
  TrendingUp,
  Waves,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTradingStore } from "@/lib/trading/store";
import { Dashboard } from "@/components/trading/Dashboard";
import { MarketWatch } from "@/components/trading/MarketWatch";
import { ChartPanel } from "@/components/trading/ChartPanel";
import { OrderTicket } from "@/components/trading/OrderTicket";
import { OrderBlotter } from "@/components/trading/OrderBlotter";
import { StrategyLab } from "@/components/trading/StrategyLab";
import { Backtester } from "@/components/trading/Backtester";
import { RiskManager } from "@/components/trading/RiskManager";
import { PortfolioAnalytics } from "@/components/trading/PortfolioAnalytics";
import { ResearchTerminal } from "@/components/trading/ResearchTerminal";
import { SystemMonitor } from "@/components/trading/SystemMonitor";
import { AlertsPanel } from "@/components/trading/AlertsPanel";
import { SpreadTrading } from "@/components/trading/SpreadTrading";
import { ExecutionAlgos } from "@/components/trading/ExecutionAlgos";
import { OptionsLab } from "@/components/trading/OptionsLab";
import { AlertsWatchlist } from "@/components/trading/AlertsWatchlist";
import { TradeJournal } from "@/components/trading/TradeJournal";
import { MarketScanner } from "@/components/trading/MarketScanner";
import { OrderFlow } from "@/components/trading/OrderFlow";
import { TermStructure } from "@/components/trading/TermStructure";
import { EconomicCalendar } from "@/components/trading/EconomicCalendar";
import { PositionSizer } from "@/components/trading/PositionSizer";
import { VolatilityAnalyzer } from "@/components/trading/VolatilityAnalyzer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ModuleId =
  | "dashboard"
  | "markets"
  | "chart"
  | "strategy"
  | "backtest"
  | "risk"
  | "portfolio"
  | "research"
  | "system"
  | "spreads"
  | "algos"
  | "options"
  | "alerts"
  | "journal"
  | "scanner"
  | "orderflow"
  | "termstructure"
  | "economic"
  | "sizer"
  | "volatility";

interface ModuleDef {
  id: ModuleId;
  name: string;
  icon: LucideIcon;
  description: string;
}

const MODULES: ModuleDef[] = [
  { id: "dashboard", name: "Dashboard", icon: LayoutDashboard, description: "Account, positions, working orders, P&L" },
  { id: "markets", name: "Market Watch", icon: Radar, description: "Live quotes across all futures contracts" },
  { id: "chart", name: "Charting", icon: LineChart, description: "Candlestick charts with technical indicators" },
  { id: "strategy", name: "Strategy Lab", icon: Brain, description: "6 quant strategies inspired by TwigCapra" },
  { id: "backtest", name: "Backtester", icon: TrendingUp, description: "Walk-forward strategy validation" },
  { id: "spreads", name: "Spread Trading", icon: Layers, description: "Calendar, inter-commodity, butterfly spreads" },
  { id: "algos", name: "Execution Algos", icon: Cpu, description: "TWAP, VWAP, Iceberg, POV, Implementation Shortfall" },
  { id: "options", name: "Options Lab", icon: Sigma, description: "Black's model, Greeks, vol surface, strategies" },
  { id: "risk", name: "Risk Manager", icon: ShieldAlert, description: "VaR, stress tests, Monte Carlo" },
  { id: "portfolio", name: "Portfolio", icon: Gauge, description: "Sharpe, Sortino, correlation matrix" },
  { id: "alerts", name: "Alerts & Watchlist", icon: Star, description: "Price/technical alerts and symbol watchlists" },
  { id: "journal", name: "Trade Journal", icon: BookOpen, description: "Tag-based P&L attribution and trade notes" },
  { id: "scanner", name: "Market Scanner", icon: Radar, description: "Scan all contracts for technical setups" },
  { id: "orderflow", name: "Order Flow / DOM", icon: Activity, description: "Depth ladder, trade tape, volume profile" },
  { id: "termstructure", name: "Futures Curve", icon: TrendingUp, description: "Term structure, contango/backwardation" },
  { id: "economic", name: "Economic Calendar", icon: Calendar, description: "Macro events with market impact analysis" },
  { id: "sizer", name: "Position Sizer", icon: Calculator, description: "Kelly, vol targeting, what-if sizing" },
  { id: "volatility", name: "Volatility Analyzer", icon: Waves, description: "Realized vol, GARCH forecast, regime detection" },
  { id: "research", name: "Research", icon: TrendingUp, description: "Factor analysis and cointegration tools" },
  { id: "system", name: "System Monitor", icon: Activity, description: "Latency, throughput, event log" },
];

export default function Home() {
  const [active, setActive] = useState<ModuleId>("dashboard");
  const [showAlerts, setShowAlerts] = useState(false);
  const init = useTradingStore((s) => s.init);
  const connected = useTradingStore((s) => s.connected);
  const tickCount = useTradingStore((s) => s.tickCount);
  const lastTickAt = useTradingStore((s) => s.lastTickAt);
  const alerts = useTradingStore((s) => s.alerts);
  const unack = alerts.filter((a) => !a.acknowledged).length;
  const quotes = useTradingStore((s) => s.quotes);
  const positions = useTradingStore((s) => s.positions);
  const selectedSymbol = useTradingStore((s) => s.selectedSymbol);

  useEffect(() => {
    init();
  }, [init]);

  const sessionPL = useMemo(() => {
    return Object.values(positions).reduce((s, p) => s + p.sessionPnL, 0);
  }, [positions]);

  const activeModule = MODULES.find((m) => m.id === active)!;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground font-sans">
      {/* Top bar */}
      <header className="h-14 border-b border-border flex items-center px-4 gap-4 bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" fill="white" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold tracking-tight">TWG Terminal</span>
            <span className="text-[10px] text-muted-foreground -mt-0.5">TwigCapra Capital · Tribute Edition</span>
          </div>
        </div>
        <div className="h-6 w-px bg-border mx-1" />
        {/* Live status */}
        <div className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              "w-2 h-2 rounded-full",
              connected ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground",
            )}
          />
          <span className="text-muted-foreground">{connected ? "LIVE" : "OFFLINE"}</span>
          <span className="text-muted-foreground/60">·</span>
          <span className="text-muted-foreground">Ticks: <span className="text-foreground tabular-nums">{tickCount.toLocaleString()}</span></span>
          <span className="text-muted-foreground/60">·</span>
          <span className="text-muted-foreground">P&L: <span className={cn("tabular-nums font-medium", sessionPL >= 0 ? "text-emerald-400" : "text-rose-400")}>
            {sessionPL >= 0 ? "+" : ""}${sessionPL.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          </span></span>
        </div>
        <div className="flex-1" />
        {/* Quick symbol switcher */}
        <SymbolSwitcher />
        {/* Alerts */}
        <Button
          variant="ghost"
          size="sm"
          className="relative h-8"
          onClick={() => setShowAlerts(!showAlerts)}
        >
          <Bell className="w-4 h-4" />
          {unack > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center font-medium">
              {unack}
            </span>
          )}
        </Button>
        <Button variant="ghost" size="sm" className="h-8 text-xs font-mono">
          <CircleDot className="w-3.5 h-3.5 mr-1 text-emerald-500" />
          RTH
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 border-r border-border bg-card/30 flex flex-col">
          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            {MODULES.map((m) => (
              <button
                key={m.id}
                onClick={() => setActive(m.id)}
                className={cn(
                  "w-full flex items-start gap-3 px-3 py-2 rounded-md text-left transition-colors group",
                  active === m.id
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent",
                )}
              >
                <m.icon className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="flex flex-col leading-tight">
                  <span className="text-xs font-medium">{m.name}</span>
                  <span className="text-[10px] text-muted-foreground/80 group-hover:text-muted-foreground">{m.description}</span>
                </div>
              </button>
            ))}
          </nav>
          <div className="border-t border-border p-3">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Engine</span>
              <Badge variant="outline" className="text-[9px] h-4 px-1 font-mono">v1.0.0</Badge>
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
              <span>Mode</span>
              <span className="text-emerald-400 font-mono">SIM</span>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden relative">
          <div className="absolute inset-0 overflow-y-auto">
            <div className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <activeModule.icon className="w-5 h-5 text-primary" />
                <h1 className="text-lg font-semibold">{activeModule.name}</h1>
                <span className="text-xs text-muted-foreground">{activeModule.description}</span>
              </div>
              <ModuleRenderer active={active} selectedSymbol={selectedSymbol} />
            </div>
          </div>

          {/* Alerts drawer */}
          {showAlerts && (
            <div className="absolute right-0 top-0 bottom-0 w-96 border-l border-border bg-card/95 backdrop-blur-sm z-20 shadow-xl">
              <AlertsPanel onClose={() => setShowAlerts(false)} />
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer className="h-7 border-t border-border bg-card/50 px-4 flex items-center text-[11px] text-muted-foreground gap-4">
        <span className="flex items-center gap-1">
          <Activity className="w-3 h-3" /> Tick: <span className="text-foreground font-mono tabular-nums">{lastTickAt ? new Date(lastTickAt).toLocaleTimeString("en-US", { hour12: false }) : "—"}</span>
        </span>
        <span>Latency: <span className="text-emerald-400 font-mono">0.42μs</span></span>
        <span>Subscriptions: <span className="text-foreground font-mono">{Object.keys(quotes).length}</span></span>
        <span>Open Positions: <span className="text-foreground font-mono">{Object.values(positions).filter((p) => p.netQty !== 0).length}</span></span>
        <div className="flex-1" />
        <span className="font-mono text-[10px]">For research & education only · Not investment advice · No real-money trading</span>
      </footer>
    </div>
  );
}

function SymbolSwitcher() {
  const quotes = useTradingStore((s) => s.quotes);
  const selectedSymbol = useTradingStore((s) => s.selectedSymbol);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const symbols = Object.keys(quotes).sort();
  const current = quotes[selectedSymbol];
  return (
    <select
      value={selectedSymbol}
      onChange={(e) => selectSymbol(e.target.value)}
      className="bg-muted/50 border border-border rounded-md px-2 py-1 text-xs font-mono h-8 hover:bg-muted focus:outline-none focus:ring-1 focus:ring-primary"
    >
      {symbols.map((s) => (
        <option key={s} value={s}>
          {s} {quotes[s] ? `· ${quotes[s].last.toFixed(2)}` : ""}
        </option>
      ))}
    </select>
  );
}

function ModuleRenderer({ active, selectedSymbol }: { active: ModuleId; selectedSymbol: string }) {
  switch (active) {
    case "dashboard":
      return <Dashboard />;
    case "markets":
      return <MarketWatch />;
    case "chart":
      return <ChartPanel symbol={selectedSymbol} />;
    case "strategy":
      return <StrategyLab />;
    case "backtest":
      return <Backtester />;
    case "spreads":
      return <SpreadTrading />;
    case "algos":
      return <ExecutionAlgos />;
    case "options":
      return <OptionsLab />;
    case "risk":
      return <RiskManager />;
    case "portfolio":
      return <PortfolioAnalytics />;
    case "alerts":
      return <AlertsWatchlist />;
    case "journal":
      return <TradeJournal />;
    case "scanner":
      return <MarketScanner />;
    case "orderflow":
      return <OrderFlow />;
    case "termstructure":
      return <TermStructure />;
    case "economic":
      return <EconomicCalendar />;
    case "sizer":
      return <PositionSizer />;
    case "volatility":
      return <VolatilityAnalyzer />;
    case "research":
      return <ResearchTerminal />;
    case "system":
      return <SystemMonitor />;
    default:
      return null;
  }
}
