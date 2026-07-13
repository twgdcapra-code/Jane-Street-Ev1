"use client";
import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import {
  computeSessionTCA, computeFillTCA, computeOrderTCA, computeComplianceStats,
  type FillTCA, type Benchmark,
} from "@/lib/trading/tca";
import { fmtTime } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, DollarSign, Gauge, Scale, Shield, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";

type View = "overview" | "fills" | "orders" | "symbols" | "decomposition" | "compliance";
const VIEWS: { id: View; name: string; icon: any }[] = [
  { id: "overview", name: "Overview", icon: Gauge },
  { id: "fills", name: "Per-Fill", icon: Activity },
  { id: "orders", name: "Per-Order", icon: BarChart3 },
  { id: "symbols", name: "Per-Symbol", icon: Scale },
  { id: "decomposition", name: "Decomposition", icon: TrendingDown },
  { id: "compliance", name: "Compliance", icon: ShieldCheck },
];

const BENCH_OPTS: Benchmark[] = ["ARRIVAL", "MIDPOINT", "VWAP", "PREV_CLOSE"];

function fmtBps(b: number): string {
  const sign = b >= 0 ? "+" : "";
  return `${sign}${b.toFixed(2)} bps`;
}
function fmtUsd(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
function fmtK(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

export function TcaDashboard() {
  const fills = useTradingStore((s) => s.fills);
  const orders = useTradingStore((s) => s.orders);
  const [view, setView] = useState<View>("overview");
  const [benchmark, setBenchmark] = useState<Benchmark>("ARRIVAL");

  const session = useMemo(() => computeSessionTCA(fills, orders), [fills, orders]);
  const compliance = useMemo(() => computeComplianceStats(session), [session]);
  const fillTCAs = useMemo(
    () => fills.map((f) => computeFillTCA(f)).filter((x): x is FillTCA => x !== null),
    [fills],
  );
  const orderTCAs = useMemo(
    () => orders.map((o) => computeOrderTCA(o, fills)).filter((x): x is NonNullable<typeof x> => x !== null),
    [orders, fills],
  );

  if (fills.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <div className="text-sm font-semibold mb-1">No fills yet</div>
          <div className="text-xs text-muted-foreground">Place orders from the Order Ticket or Dashboard. Every fill will be analysed here with full TCA decomposition.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* View switcher */}
      <div className="flex items-center gap-1 flex-wrap">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors",
              view === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>
            <v.icon className="w-3.5 h-3.5" />{v.name}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground">Benchmark:</span>
          <select value={benchmark} onChange={(e) => setBenchmark(e.target.value as Benchmark)}
            className="bg-muted/50 border border-border rounded px-2 py-1 text-xs h-7">
            {BENCH_OPTS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {view === "overview" && <OverviewView session={session} fillTCAs={fillTCAs} benchmark={benchmark} />}
      {view === "fills" && <FillsView fillTCAs={fillTCAs} benchmark={benchmark} />}
      {view === "orders" && <OrdersView orderTCAs={orderTCAs} />}
      {view === "symbols" && <SymbolsView session={session} />}
      {view === "decomposition" && <DecompositionView session={session} />}
      {view === "compliance" && <ComplianceView stats={compliance} session={session} />}
    </div>
  );
}

// ============================================================
// Overview View
// ============================================================
function OverviewView({ session, fillTCAs, benchmark }: { session: ReturnType<typeof computeSessionTCA>; fillTCAs: FillTCA[]; benchmark: Benchmark }) {
  const slippageKey = benchmark === "ARRIVAL" ? "slippageArrivalBps" : benchmark === "MIDPOINT" ? "slippageMidpointBps" : benchmark === "VWAP" ? "slippageVwapBps" : "slippagePrevCloseBps";

  // Size-bucket chart data
  const sizeData = (["TINY", "SMALL", "MEDIUM", "LARGE", "BLOCK"] as const).map((b) => ({
    bucket: b,
    count: session.sizeBuckets[b].count,
    notional: session.sizeBuckets[b].notional,
    slippage: session.sizeBuckets[b].avgSlippageBps,
  })).filter((d) => d.count > 0);

  // Buy vs sell data
  const buySellData = [
    { side: "BUY", notional: session.buyNotional, slippage: session.buySlippageBps, count: fillTCAs.filter((f) => f.side === "BUY").length },
    { side: "SELL", notional: session.sellNotional, slippage: session.sellSlippageBps, count: fillTCAs.filter((f) => f.side === "SELL").length },
  ].filter((d) => d.count > 0);

  return (
    <div className="space-y-3">
      {/* Top stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Total Fills</div>
          <div className="text-sm font-mono font-semibold">{session.totalFills}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Total Notional</div>
          <div className="text-sm font-mono font-semibold">{fmtK(session.totalNotional)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Avg Slippage ({benchmark})</div>
          <div className={cn("text-sm font-mono font-semibold", session.avgSlippageArrivalBps > 0 ? "text-rose-400" : "text-emerald-400")}>
            {fmtBps(session.avgSlippageArrivalBps)}
          </div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Market Impact</div>
          <div className="text-sm font-mono font-semibold text-amber-400">{session.marketImpactBps.toFixed(2)} bps</div>
        </Card>
        <Card className={cn("p-2.5 border", session.totalCostDollars > 0 ? "border-rose-500/20 bg-rose-500/5" : "border-emerald-500/20 bg-emerald-500/5")}>
          <div className="text-[9px] uppercase text-muted-foreground">Total Cost</div>
          <div className={cn("text-sm font-mono font-semibold", session.totalCostDollars > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtUsd(session.totalCostDollars)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Commission</div>
          <div className="text-sm font-mono font-semibold">${session.totalCommission.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div>
        </Card>
      </div>

      {/* Slippage histogram + Cumulative cost chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><BarChart3 className="w-3.5 h-3.5" /> Slippage Distribution ({benchmark})</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={session.slippageHistogram}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} angle={-25} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={30} />
                  <Tooltip formatter={(v: any) => [`${v} fills`, "Count"]} contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                    {session.slippageHistogram.map((d, i) => {
                      const bucketLabel = d.bucket;
                      const isCost = bucketLabel.includes("+") && !bucketLabel.includes("<");
                      const isGain = bucketLabel.includes("-") || bucketLabel.includes("< -");
                      return <Cell key={i} fill={isCost ? "#ef4444" : isGain ? "#10b981" : "#6b7280"} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><TrendingDown className="w-3.5 h-3.5" /> Cumulative Cost ($)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={session.cumulativeCostSeries.map((d) => ({ time: fmtTime(d.time), cost: d.cumulativeCost }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.max(1, Math.floor(session.cumulativeCostSeries.length / 6))} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}K`} />
                  <Tooltip formatter={(v: any) => [`$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`, "Cumulative Cost"]} contentStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#666" strokeOpacity={0.3} />
                  <Line type="monotone" dataKey="cost" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Slippage by size bucket + by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Slippage by Order Size Bucket</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sizeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} tickFormatter={(v) => `${v.toFixed(1)} bps`} />
                  <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)} bps`, "Avg Slippage"]} contentStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#666" />
                  <Bar dataKey="slippage" radius={[2, 2, 0, 0]}>
                    {sizeData.map((d, i) => <Cell key={i} fill={d.slippage >= 0 ? "#ef4444" : "#10b981"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Slippage: Buy vs Sell</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={buySellData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis dataKey="side" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} tickFormatter={(v) => `${v.toFixed(1)} bps`} />
                  <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)} bps`, "Avg Slippage"]} contentStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#666" />
                  <Bar dataKey="slippage" radius={[2, 2, 0, 0]}>
                    {buySellData.map((d, i) => <Cell key={i} fill={d.side === "BUY" ? "#3b82f6" : "#a855f7"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* By order type + by strategy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">By Order Type</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border">
                <tr className="text-muted-foreground text-[10px] uppercase">
                  <th className="text-left py-2 px-3">Type</th>
                  <th className="text-right py-2 px-3">Fills</th>
                  <th className="text-right py-2 px-3">Avg Slippage</th>
                  <th className="text-right py-2 px-3">Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {session.byOrderType.map((t) => (
                  <tr key={t.type} className="border-b border-border/30">
                    <td className="py-1.5 px-3 font-mono font-medium">{t.type}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{t.count}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", t.avgSlippageBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(t.avgSlippageBps)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", t.totalCost > 0 ? "text-rose-400" : "text-emerald-400")}>${t.totalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">By Strategy</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border">
                <tr className="text-muted-foreground text-[10px] uppercase">
                  <th className="text-left py-2 px-3">Strategy</th>
                  <th className="text-right py-2 px-3">Fills</th>
                  <th className="text-right py-2 px-3">Avg Slippage</th>
                  <th className="text-right py-2 px-3">Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {session.byStrategy.map((s) => (
                  <tr key={s.strategy} className="border-b border-border/30">
                    <td className="py-1.5 px-3 font-mono font-medium">{s.strategy}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{s.count}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", s.avgSlippageBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(s.avgSlippageBps)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", s.totalCost > 0 ? "text-rose-400" : "text-emerald-400")}>${s.totalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// Per-Fill View
// ============================================================
function FillsView({ fillTCAs, benchmark }: { fillTCAs: FillTCA[]; benchmark: Benchmark }) {
  const [sortKey, setSortKey] = useState<"time" | "slippage" | "cost" | "notional">("time");
  const [sortDesc, setSortDesc] = useState(true);
  const [filterSymbol, setFilterSymbol] = useState("ALL");
  const symbols = Array.from(new Set(fillTCAs.map((f) => f.symbol))).sort();

  const sorted = useMemo(() => {
    const filtered = fillTCAs.filter((f) => filterSymbol === "ALL" || f.symbol === filterSymbol);
    const key = benchmark === "ARRIVAL" ? "slippageArrivalBps" : benchmark === "MIDPOINT" ? "slippageMidpointBps" : benchmark === "VWAP" ? "slippageVwapBps" : "slippagePrevCloseBps";
    const sortedArr = [...filtered].sort((a, b) => {
      if (sortKey === "time") return sortDesc ? b.fillTime - a.fillTime : a.fillTime - b.fillTime;
      if (sortKey === "slippage") return sortDesc ? (b as any)[key] - (a as any)[key] : (a as any)[key] - (b as any)[key];
      if (sortKey === "cost") return sortDesc ? b.totalCostDollars - a.totalCostDollars : a.totalCostDollars - b.totalCostDollars;
      if (sortKey === "notional") return sortDesc ? b.notional - a.notional : a.notional - b.notional;
      return 0;
    });
    return sortedArr;
  }, [fillTCAs, sortKey, sortDesc, benchmark, filterSymbol]);

  const slippageKey = benchmark === "ARRIVAL" ? "slippageArrivalBps" : benchmark === "MIDPOINT" ? "slippageMidpointBps" : benchmark === "VWAP" ? "slippageVwapBps" : "slippagePrevCloseBps";

  return (
    <Card>
      <CardHeader className="py-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs">Per-Fill TCA ({sorted.length} fills)</CardTitle>
        <div className="flex items-center gap-2">
          <select value={filterSymbol} onChange={(e) => setFilterSymbol(e.target.value)} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs h-7">
            <option value="ALL">All Symbols</option>
            {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs h-7">
            <option value="time">Sort: Time</option>
            <option value="slippage">Sort: Slippage</option>
            <option value="cost">Sort: Cost $</option>
            <option value="notional">Sort: Notional</option>
          </select>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSortDesc(!sortDesc)}>{sortDesc ? "↓" : "↑"}</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border sticky top-0">
              <tr className="text-muted-foreground text-[10px] uppercase">
                <th className="text-left py-2 px-2">Time</th>
                <th className="text-left py-2 px-2">Symbol</th>
                <th className="text-center py-2 px-2">Side</th>
                <th className="text-right py-2 px-2">Qty</th>
                <th className="text-right py-2 px-2">Fill Px</th>
                <th className="text-right py-2 px-2">Arrival</th>
                <th className="text-right py-2 px-2">Slip ({benchmark})</th>
                <th className="text-right py-2 px-2">Spread</th>
                <th className="text-right py-2 px-2">Impact</th>
                <th className="text-right py-2 px-2">Timing</th>
                <th className="text-right py-2 px-2">Comm</th>
                <th className="text-right py-2 px-2">Total bps</th>
                <th className="text-right py-2 px-2">Cost $</th>
                <th className="text-center py-2 px-2">Bucket</th>
                <th className="text-left py-2 px-2">Type</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((f) => (
                <tr key={f.fillId} className="border-b border-border/30 hover:bg-muted/30">
                  <td className="py-1 px-2 font-mono text-[10px] text-muted-foreground">{fmtTime(f.fillTime)}</td>
                  <td className="py-1 px-2 font-mono font-medium">{f.symbol}</td>
                  <td className="py-1 px-2 text-center">
                    <Badge variant="outline" className={cn("text-[9px] h-4 px-1", f.side === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>{f.side}</Badge>
                  </td>
                  <td className="py-1 px-2 text-right font-mono">{f.qty}</td>
                  <td className="py-1 px-2 text-right font-mono">{f.fillPrice.toFixed(2)}</td>
                  <td className="py-1 px-2 text-right font-mono text-muted-foreground">{f.arrivalPrice.toFixed(2)}</td>
                  <td className={cn("py-1 px-2 text-right font-mono font-medium", (f as any)[slippageKey] > 0 ? "text-rose-400" : (f as any)[slippageKey] < 0 ? "text-emerald-400" : "")}>
                    {(f as any)[slippageKey] >= 0 ? "+" : ""}{(f as any)[slippageKey].toFixed(2)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono text-muted-foreground">{f.spreadCostBps.toFixed(2)}</td>
                  <td className="py-1 px-2 text-right font-mono text-amber-400">{f.marketImpactBps.toFixed(2)}</td>
                  <td className="py-1 px-2 text-right font-mono text-muted-foreground">{f.timingCostBps.toFixed(2)}</td>
                  <td className="py-1 px-2 text-right font-mono text-muted-foreground">{f.commissionBps.toFixed(2)}</td>
                  <td className={cn("py-1 px-2 text-right font-mono font-semibold", f.totalCostBps > 0 ? "text-rose-400" : "text-emerald-400")}>{f.totalCostBps.toFixed(2)}</td>
                  <td className={cn("py-1 px-2 text-right font-mono", f.totalCostDollars > 0 ? "text-rose-400" : "text-emerald-400")}>${f.totalCostDollars.toFixed(2)}</td>
                  <td className="py-1 px-2 text-center">
                    <Badge variant="outline" className="text-[9px] h-4 px-1">{f.sizeBucket}</Badge>
                  </td>
                  <td className="py-1 px-2 font-mono text-[10px] text-muted-foreground">{f.orderType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Per-Order View
// ============================================================
function OrdersView({ orderTCAs }: { orderTCAs: NonNullable<ReturnType<typeof computeOrderTCA>>[] }) {
  return (
    <Card>
      <CardHeader className="py-2"><CardTitle className="text-xs">Per-Order TCA ({orderTCAs.length} orders)</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border sticky top-0">
              <tr className="text-muted-foreground text-[10px] uppercase">
                <th className="text-left py-2 px-3">Order ID</th>
                <th className="text-left py-2 px-3">Symbol</th>
                <th className="text-center py-2 px-3">Side</th>
                <th className="text-right py-2 px-3">Ord Qty</th>
                <th className="text-right py-2 px-3">Filled</th>
                <th className="text-right py-2 px-3">Fill Rate</th>
                <th className="text-right py-2 px-3">Avg Px</th>
                <th className="text-right py-2 px-3">Arrival</th>
                <th className="text-right py-2 px-3">Slip Arr</th>
                <th className="text-right py-2 px-3">Slip VWAP</th>
                <th className="text-right py-2 px-3">Spread</th>
                <th className="text-right py-2 px-3">Impact</th>
                <th className="text-right py-2 px-3">Timing</th>
                <th className="text-right py-2 px-3">Opp Cost</th>
                <th className="text-right py-2 px-3">Comm</th>
                <th className="text-right py-2 px-3">Total $</th>
                <th className="text-right py-2 px-3">Part Rate</th>
                <th className="text-right py-2 px-3">Duration</th>
                <th className="text-center py-2 px-3">Bucket</th>
              </tr>
            </thead>
            <tbody>
              {orderTCAs.map((o) => (
                <tr key={o.orderId} className="border-b border-border/30 hover:bg-muted/30">
                  <td className="py-1.5 px-3 font-mono text-[10px] text-muted-foreground">{o.orderId.slice(0, 14)}</td>
                  <td className="py-1.5 px-3 font-mono font-medium">{o.symbol}</td>
                  <td className="py-1.5 px-3 text-center">
                    <Badge variant="outline" className={cn("text-[9px] h-4 px-1", o.side === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>{o.side}</Badge>
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono">{o.orderQty}</td>
                  <td className="py-1.5 px-3 text-right font-mono">{o.filledQty}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono", o.fillRate < 1 ? "text-amber-400" : "text-emerald-400")}>{(o.fillRate * 100).toFixed(0)}%</td>
                  <td className="py-1.5 px-3 text-right font-mono">{o.avgFillPrice.toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{o.arrivalPrice.toFixed(2)}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono font-medium", o.slippageArrivalBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(o.slippageArrivalBps)}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono", o.slippageVwapBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(o.slippageVwapBps)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{o.spreadCostBps.toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-amber-400">{o.marketImpactBps.toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{o.timingCostBps.toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{o.opportunityCostBps.toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{o.commissionBps.toFixed(2)}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono font-semibold", o.totalCostDollars > 0 ? "text-rose-400" : "text-emerald-400")}>${o.totalCostDollars.toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-[10px]">{(o.participationRate * 100).toFixed(2)}%</td>
                  <td className="py-1.5 px-3 text-right font-mono text-[10px] text-muted-foreground">{(o.executionDurationMs / 1000).toFixed(1)}s</td>
                  <td className="py-1.5 px-3 text-center"><Badge variant="outline" className="text-[9px] h-4 px-1">{o.sizeBucket}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Per-Symbol View
// ============================================================
function SymbolsView({ session }: { session: ReturnType<typeof computeSessionTCA> }) {
  return (
    <Card>
      <CardHeader className="py-2"><CardTitle className="text-xs">Per-Symbol TCA ({session.bySymbol.length} symbols)</CardTitle></CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border">
              <tr className="text-muted-foreground text-[10px] uppercase">
                <th className="text-left py-2 px-3">Symbol</th>
                <th className="text-left py-2 px-3">Name</th>
                <th className="text-right py-2 px-3">Fills</th>
                <th className="text-right py-2 px-3">Qty</th>
                <th className="text-right py-2 px-3">Notional</th>
                <th className="text-right py-2 px-3">Slip Arr</th>
                <th className="text-right py-2 px-3">Slip VWAP</th>
                <th className="text-right py-2 px-3">Spread</th>
                <th className="text-right py-2 px-3">Impact</th>
                <th className="text-right py-2 px-3">Timing</th>
                <th className="text-right py-2 px-3">Comm</th>
                <th className="text-right py-2 px-3">Total Cost</th>
                <th className="text-right py-2 px-3">Buy Slip</th>
                <th className="text-right py-2 px-3">Sell Slip</th>
                <th className="text-right py-2 px-3">Worst Fill</th>
                <th className="text-right py-2 px-3">Best Fill</th>
              </tr>
            </thead>
            <tbody>
              {session.bySymbol.map((s) => (
                <tr key={s.symbol} className="border-b border-border/30 hover:bg-muted/30">
                  <td className="py-1.5 px-3 font-mono font-medium">{s.symbol}</td>
                  <td className="py-1.5 px-3 text-muted-foreground text-[10px] truncate max-w-[180px]">{s.name}</td>
                  <td className="py-1.5 px-3 text-right font-mono">{s.fillCount}</td>
                  <td className="py-1.5 px-3 text-right font-mono">{s.totalQty}</td>
                  <td className="py-1.5 px-3 text-right font-mono">{fmtK(s.totalNotional)}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono font-medium", s.avgSlippageArrivalBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(s.avgSlippageArrivalBps)}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono", s.avgSlippageVwapBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(s.avgSlippageVwapBps)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{s.avgSpreadCostBps.toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-amber-400">{s.avgMarketImpactBps.toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{s.avgTimingCostBps.toFixed(2)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{s.avgCommissionBps.toFixed(2)}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono font-semibold", s.totalCostDollars > 0 ? "text-rose-400" : "text-emerald-400")}>${s.totalCostDollars.toFixed(0)}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono", s.buySlippageBps > 0 ? "text-rose-400" : "text-emerald-400")}>{s.buyCount > 0 ? fmtBps(s.buySlippageBps) : "—"}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono", s.sellSlippageBps > 0 ? "text-rose-400" : "text-emerald-400")}>{s.sellCount > 0 ? fmtBps(s.sellSlippageBps) : "—"}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-rose-400">{s.worstFillSlippageBps.toFixed(1)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-emerald-400">{s.bestFillSlippageBps.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Decomposition View
// ============================================================
function DecompositionView({ session }: { session: ReturnType<typeof computeSessionTCA> }) {
  const decompData = [
    { component: "Spread Cost", bps: session.spreadCostBps, color: "#3b82f6", description: "Half-spread × sign(side). Cost of crossing the bid-ask spread." },
    { component: "Market Impact", bps: session.marketImpactBps, color: "#f59e0b", description: "κ × σ × √(Q/ADV). Square-root model (Almgren-Chriss / Bouchaud)." },
    { component: "Timing Cost", bps: session.timingCostBps, color: "#a855f7", description: "Residual drift during execution window = max(0, slippage − impact − spread)." },
    { component: "Opportunity Cost", bps: session.opportunityCostBps, color: "#ec4899", description: "Unfilled × price move × sign. Cost of not getting filled." },
    { component: "Commission", bps: session.commissionBps, color: "#64748b", description: "Broker commission + exchange fees per contract." },
  ];

  const totalBps = decompData.reduce((s, d) => s + Math.abs(d.bps), 0);

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Slippage Decomposition (vs Arrival Price)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={decompData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `${v.toFixed(2)} bps`} />
                <YAxis type="category" dataKey="component" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={110} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(3)} bps`, "Cost"]} contentStyle={{ fontSize: 11 }} />
                <ReferenceLine x={0} stroke="#666" />
                <Bar dataKey="bps" radius={[0, 4, 4, 0]}>
                  {decompData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Decomposition Breakdown</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border">
              <tr className="text-muted-foreground text-[10px] uppercase">
                <th className="text-left py-2 px-3">Component</th>
                <th className="text-right py-2 px-3">Cost (bps)</th>
                <th className="text-right py-2 px-3">% of Total</th>
                <th className="text-left py-2 px-3">Description</th>
              </tr>
            </thead>
            <tbody>
              {decompData.map((d) => (
                <tr key={d.component} className="border-b border-border/30">
                  <td className="py-1.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
                      <span className="font-medium">{d.component}</span>
                    </div>
                  </td>
                  <td className={cn("py-1.5 px-3 text-right font-mono", d.bps > 0 ? "text-rose-400" : "text-emerald-400")}>{d.bps.toFixed(3)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{totalBps > 0 ? `${((Math.abs(d.bps) / totalBps) * 100).toFixed(1)}%` : "—"}</td>
                  <td className="py-1.5 px-3 text-muted-foreground text-[10px]">{d.description}</td>
                </tr>
              ))}
              <tr className="bg-muted/40 font-semibold">
                <td className="py-2 px-3">Total Slippage</td>
                <td className={cn("py-2 px-3 text-right font-mono", session.avgSlippageArrivalBps > 0 ? "text-rose-400" : "text-emerald-400")}>{session.avgSlippageArrivalBps.toFixed(3)} bps</td>
                <td className="py-2 px-3 text-right font-mono">100%</td>
                <td className="py-2 px-3 text-[10px] text-muted-foreground">Perold (1988) Implementation Shortfall identity</td>
              </tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Compliance View (MiFID II RTS 28 / SEC 605/606)
// ============================================================
function ComplianceView({ stats, session }: { stats: ReturnType<typeof computeComplianceStats>; session: ReturnType<typeof computeSessionTCA> }) {
  const passCount = stats.filter((s) => s.status === "PASS").length;
  const reviewCount = stats.filter((s) => s.status === "REVIEW").length;
  const failCount = stats.filter((s) => s.status === "FAIL").length;

  return (
    <div className="space-y-3">
      <Card className={cn("border", failCount > 0 ? "border-rose-500/30 bg-rose-500/5" : reviewCount > 0 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5")}>
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            <Shield className={cn("w-10 h-10", failCount > 0 ? "text-rose-400" : reviewCount > 0 ? "text-amber-400" : "text-emerald-400")} />
            <div className="flex-1">
              <div className="text-sm font-semibold">Best Execution Compliance — MiFID II RTS 28 / SEC Rule 605/606</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {passCount} passed · {reviewCount} need review · {failCount} failed
              </div>
            </div>
            <div className="flex items-center gap-2">
              {passCount > 0 && <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400"><CheckCircle2 className="w-3 h-3 mr-1" />{passCount} PASS</Badge>}
              {reviewCount > 0 && <Badge variant="outline" className="bg-amber-500/15 text-amber-400"><AlertTriangle className="w-3 h-3 mr-1" />{reviewCount} REVIEW</Badge>}
              {failCount > 0 && <Badge variant="outline" className="bg-rose-500/15 text-rose-400"><AlertTriangle className="w-3 h-3 mr-1" />{failCount} FAIL</Badge>}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Compliance Metrics</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border">
              <tr className="text-muted-foreground text-[10px] uppercase">
                <th className="text-left py-2 px-3">Metric</th>
                <th className="text-right py-2 px-3">Value</th>
                <th className="text-right py-2 px-3">Threshold</th>
                <th className="text-center py-2 px-3">Status</th>
                <th className="text-left py-2 px-3">Description</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.metric} className="border-b border-border/30">
                  <td className="py-1.5 px-3 font-medium">{s.metric}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono font-semibold",
                    s.status === "FAIL" ? "text-rose-400" : s.status === "REVIEW" ? "text-amber-400" : "text-emerald-400")}>
                    {s.value.toFixed(2)} {s.unit}
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{s.threshold} {s.unit}</td>
                  <td className="py-1.5 px-3 text-center">
                    <Badge variant="outline" className={cn("text-[9px]",
                      s.status === "PASS" ? "bg-emerald-500/15 text-emerald-400" :
                      s.status === "REVIEW" ? "bg-amber-500/15 text-amber-400" :
                      "bg-rose-500/15 text-rose-400")}>
                      {s.status}
                    </Badge>
                  </td>
                  <td className="py-1.5 px-3 text-muted-foreground text-[10px]">{s.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><DollarSign className="w-3.5 h-3.5" /> Session Cost Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[9px] uppercase text-muted-foreground">Total Notional</div>
              <div className="text-base font-mono font-semibold">{fmtK(session.totalNotional)}</div>
            </div>
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[9px] uppercase text-muted-foreground">Total Cost $</div>
              <div className={cn("text-base font-mono font-semibold", session.totalCostDollars > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtUsd(session.totalCostDollars)}</div>
            </div>
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[9px] uppercase text-muted-foreground">Cost as % of Notional</div>
              <div className="text-base font-mono font-semibold">{session.totalNotional > 0 ? ((session.totalCostDollars / session.totalNotional) * 100).toFixed(3) : "0.000"}%</div>
            </div>
            <div className="bg-muted/40 rounded p-2">
              <div className="text-[9px] uppercase text-muted-foreground">Commission + Fees</div>
              <div className="text-base font-mono font-semibold">${(session.totalCommission + session.totalFees).toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
