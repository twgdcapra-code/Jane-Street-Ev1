"use client";
import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import {
  computeVPINForSymbol, computeVPINScan, THRESHOLD_INFO,
  type VPINResult, type VPINThreshold,
} from "@/lib/trading/vpin";
import { CONTRACTS } from "@/lib/trading/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, BarChart3, Gauge, Grid3x3, ShieldAlert, TrendingUp, Waves, Zap } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type View = "monitor" | "timeseries" | "scan" | "buckets";
const VIEWS: { id: View; name: string; icon: any }[] = [
  { id: "monitor", name: "VPIN Monitor", icon: Gauge },
  { id: "timeseries", name: "Time Series", icon: Activity },
  { id: "scan", name: "Multi-Symbol Scan", icon: Grid3x3 },
  { id: "buckets", name: "Volume Buckets", icon: BarChart3 },
];

const THRESHOLD_COLORS: Record<VPINThreshold, string> = {
  NORMAL: "#10b981",
  ELEVATED: "#f59e0b",
  HIGH: "#f97316",
  EXTREME: "#ef4444",
};

function fmtPct(v: number): string { return `${(v * 100).toFixed(1)}%`; }
function fmtNum(v: number, decimals: number = 4): string { return v.toFixed(decimals); }

export function VpinOrderFlow() {
  const tickCount = useTradingStore((s) => s.tickCount);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const [view, setView] = useState<View>("monitor");
  const [symbol, setSymbol] = useState("ES");
  const [numBuckets, setNumBuckets] = useState(50);

  const tickBucket = Math.floor(tickCount / 30);
  const result = useMemo(() => computeVPINForSymbol(symbol, 500, numBuckets), [symbol, numBuckets, tickBucket]);
  const scanResults = useMemo(() => {
    if (view !== "scan") return null;
    return computeVPINScan(CONTRACTS.map((c) => c.symbol));
  }, [view, tickBucket]);

  return (
    <div className="space-y-4">
      {/* Config bar */}
      <Card>
        <CardContent className="p-3 flex items-center gap-3 flex-wrap">
          <div className="text-xs font-semibold">VPIN Config:</div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Symbol:</span>
            <select value={symbol} onChange={(e) => { setSymbol(e.target.value); selectSymbol(e.target.value); }} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs h-7 font-mono">
              {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Buckets (N):</span>
            <select value={numBuckets} onChange={(e) => setNumBuckets(Number(e.target.value))} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs h-7">
              <option value={20}>20 (fast)</option>
              <option value={50}>50 (standard)</option>
              <option value={100}>100 (precise)</option>
            </select>
          </div>
          <div className="text-[10px] text-muted-foreground ml-auto">
            Bucket size: {result.bucketSize.toFixed(0)} contracts · {result.numBuckets} buckets computed
          </div>
        </CardContent>
      </Card>

      {/* View switcher */}
      <div className="flex items-center gap-1 flex-wrap">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors",
              view === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>
            <v.icon className="w-3.5 h-3.5" />{v.name}
          </button>
        ))}
      </div>

      {view === "monitor" && <MonitorView result={result} />}
      {view === "timeseries" && <TimeSeriesView result={result} />}
      {view === "scan" && scanResults && <ScanView results={scanResults} onSelectSymbol={(s) => { setSymbol(s); selectSymbol(s); setView("monitor"); }} />}
      {view === "buckets" && <BucketsView result={result} />}
    </div>
  );
}

// ============================================================
// Monitor View
// ============================================================
function MonitorView({ result }: { result: VPINResult }) {
  const thresholdInfo = THRESHOLD_INFO[result.threshold];
  const vpinPct = result.currentVPIN * 100;

  return (
    <div className="space-y-3">
      {/* Big VPIN gauge */}
      <Card className={cn("border-2", "bg-card")} style={{ borderColor: thresholdInfo.color + "60" }}>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg flex items-center justify-center" style={{ backgroundColor: thresholdInfo.color + "30" }}>
              {result.threshold === "EXTREME" ? <ShieldAlert className="w-10 h-10" style={{ color: thresholdInfo.color }} /> :
               result.threshold === "HIGH" ? <AlertTriangle className="w-10 h-10" style={{ color: thresholdInfo.color }} /> :
               result.threshold === "ELEVATED" ? <Zap className="w-10 h-10" style={{ color: thresholdInfo.color }} /> :
               <Waves className="w-10 h-10" style={{ color: thresholdInfo.color }} />}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-2xl font-bold" style={{ color: thresholdInfo.color }}>{vpinPct.toFixed(1)}%</span>
                <Badge variant="outline" className="text-xs" style={{ backgroundColor: thresholdInfo.color + "20", color: thresholdInfo.color }}>
                  {result.threshold}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{thresholdInfo.description}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                EMA VPIN: <span className="font-mono font-semibold">{fmtPct(result.emaVPIN)}</span>
                {" · "}
                Trend: <span className={cn("font-mono font-semibold", result.trendVPIN > 0 ? "text-rose-400" : result.trendVPIN < 0 ? "text-emerald-400" : "")}>
                  {result.trendVPIN >= 0 ? "+" : ""}{fmtNum(result.trendVPIN)}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase text-muted-foreground">Recommended Action</div>
              <div className="text-sm font-semibold" style={{ color: thresholdInfo.color }}>{thresholdInfo.action}</div>
            </div>
          </div>
          {/* VPIN progress bar with threshold bands */}
          <div className="mt-3">
            <div className="relative h-3 rounded-full overflow-hidden bg-muted">
              {/* Threshold zones */}
              <div className="absolute inset-y-0 left-0 bg-emerald-500/30" style={{ width: "30%" }} />
              <div className="absolute inset-y-0 bg-amber-500/30" style={{ left: "30%", width: "20%" }} />
              <div className="absolute inset-y-0 bg-orange-500/30" style={{ left: "50%", width: "20%" }} />
              <div className="absolute inset-y-0 bg-rose-500/30" style={{ left: "70%", width: "30%" }} />
              {/* Current VPIN marker */}
              <div className="absolute inset-y-0 left-0 transition-all" style={{ width: `${vpinPct}%`, backgroundColor: thresholdInfo.color }} />
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5">
              <span>0%</span>
              <span>30% (Elevated)</span>
              <span>50% (High)</span>
              <span>70% (Extreme)</span>
              <span>100%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Avg VPIN</div>
          <div className="text-sm font-mono font-semibold">{fmtPct(result.avgVPIN)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Max VPIN</div>
          <div className="text-sm font-mono font-semibold text-rose-400">{fmtPct(result.maxVPIN)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Min VPIN</div>
          <div className="text-sm font-mono font-semibold text-emerald-400">{fmtPct(result.minVPIN)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">% Time Elevated</div>
          <div className="text-sm font-mono font-semibold text-amber-400">{fmtPct(result.pctTimeElevated)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">% Time Extreme</div>
          <div className="text-sm font-mono font-semibold text-rose-400">{fmtPct(result.pctTimeExtreme)}</div>
        </Card>
      </div>

      {/* Adverse selection recommendations */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className={cn("border", result.suggestedSpreadMultiplier > 2 ? "border-rose-500/30 bg-rose-500/5" : result.suggestedSpreadMultiplier > 1.5 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/20 bg-emerald-500/5")}>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Spread Multiplier</div>
            <div className={cn("text-lg font-mono font-bold", result.suggestedSpreadMultiplier > 2 ? "text-rose-400" : result.suggestedSpreadMultiplier > 1.5 ? "text-amber-400" : "text-emerald-400")}>
              {result.suggestedSpreadMultiplier.toFixed(2)}x
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Base spread × (1 + λ × VPIN), λ=2.0</div>
          </CardContent>
        </Card>
        <Card className={cn("border", result.suggestedQuoteSizeMultiplier < 0.5 ? "border-rose-500/30 bg-rose-500/5" : result.suggestedQuoteSizeMultiplier < 0.8 ? "border-amber-500/30 bg-amber-500/5" : "border-emerald-500/20 bg-emerald-500/5")}>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Quote Size Multiplier</div>
            <div className={cn("text-lg font-mono font-bold", result.suggestedQuoteSizeMultiplier < 0.5 ? "text-rose-400" : result.suggestedQuoteSizeMultiplier < 0.8 ? "text-amber-400" : "text-emerald-400")}>
              {result.suggestedQuoteSizeMultiplier.toFixed(2)}x
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Reduce size as toxicity rises (1 - VPIN)</div>
          </CardContent>
        </Card>
        <Card className={cn("border-2", result.withdrawRecommendation ? "border-rose-500/50 bg-rose-500/10" : "border-emerald-500/20 bg-emerald-500/5")}>
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground mb-1">Withdraw Recommendation</div>
            {result.withdrawRecommendation ? (
              <>
                <div className="text-lg font-mono font-bold text-rose-400 flex items-center gap-1"><ShieldAlert className="w-5 h-5" /> WITHDRAW</div>
                <div className="text-[10px] text-rose-400 mt-0.5">VPIN {">"} 0.7 — flash crash risk</div>
              </>
            ) : (
              <>
                <div className="text-lg font-mono font-bold text-emerald-400 flex items-center gap-1"><Waves className="w-5 h-5" /> CONTINUE</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">VPIN within safe range</div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Threshold legend */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">VPIN Threshold Bands (Easley-López de Prado-O'Hara 2012)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-2 px-3">Threshold</th><th className="text-center py-2 px-2">Range</th><th className="text-left py-2 px-3">Description</th><th className="text-left py-2 px-3">Recommended Action</th></tr></thead>
            <tbody>
              {(Object.keys(THRESHOLD_INFO) as VPINThreshold[]).map((t) => {
                const info = THRESHOLD_INFO[t];
                return (
                  <tr key={t} className={cn("border-b border-border/30", result.threshold === t && "bg-primary/5")}>
                    <td className="py-1.5 px-3"><Badge variant="outline" className="text-[9px] h-4 px-1" style={{ backgroundColor: info.color + "20", color: info.color }}>{t}</Badge></td>
                    <td className="py-1.5 px-2 text-center font-mono text-[10px]">{(info.min * 100).toFixed(0)}-{(info.max * 100).toFixed(0)}%</td>
                    <td className="py-1.5 px-3 text-[10px] text-muted-foreground">{info.description}</td>
                    <td className="py-1.5 px-3 text-[10px] font-medium" style={{ color: info.color }}>{info.action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Time Series View
// ============================================================
function TimeSeriesView({ result }: { result: VPINResult }) {
  if (result.vpinHistory.length === 0) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground text-xs">No VPIN history yet.</CardContent></Card>;
  }

  const chartData = result.vpinHistory.map((h) => ({
    time: new Date(h.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    vpin: h.vpin * 100,
    emaVpin: h.emaVpin * 100,
  }));

  return (
    <Card>
      <CardHeader className="py-2"><CardTitle className="text-xs">VPIN Over Time (Volume Buckets) — {result.symbol}</CardTitle></CardHeader>
      <CardContent>
        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
              <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.max(1, Math.floor(chartData.length / 10))} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} tickFormatter={(v) => `${v}%`} />
              <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}%`, ""]} contentStyle={{ fontSize: 11 }} />
              {/* Threshold bands */}
              <ReferenceLine y={30} stroke="#f59e0b" strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: "Elevated 30%", position: "right", fontSize: 9, fill: "#f59e0b" }} />
              <ReferenceLine y={50} stroke="#f97316" strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: "High 50%", position: "right", fontSize: 9, fill: "#f97316" }} />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} label={{ value: "Extreme 70%", position: "right", fontSize: 9, fill: "#ef4444" }} />
              <Area type="monotone" dataKey="vpin" stroke="#3b82f6" strokeWidth={1.5} fill="#3b82f6" fillOpacity={0.2} />
              <Line type="monotone" dataKey="emaVpin" stroke="#a855f7" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center justify-center gap-4 text-[10px]">
          <div className="flex items-center gap-1"><div className="w-3 h-2 bg-blue-500/20 border border-blue-500" /><span className="text-muted-foreground">VPIN (raw)</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-0.5 bg-purple-500" /><span className="text-muted-foreground">VPIN (EMA-10)</span></div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// Multi-Symbol Scan View
// ============================================================
function ScanView({ results, onSelectSymbol }: { results: ReturnType<typeof computeVPINScan>; onSelectSymbol: (s: string) => void }) {
  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Total Symbols</div><div className="text-sm font-mono font-semibold">{results.length}</div></Card>
        <Card className="p-2.5 border-emerald-500/20 bg-emerald-500/5"><div className="text-[9px] uppercase text-muted-foreground">Normal</div><div className="text-sm font-mono font-semibold text-emerald-400">{results.filter((r) => r.threshold === "NORMAL").length}</div></Card>
        <Card className="p-2.5 border-amber-500/20 bg-amber-500/5"><div className="text-[9px] uppercase text-muted-foreground">Elevated</div><div className="text-sm font-mono font-semibold text-amber-400">{results.filter((r) => r.threshold === "ELEVATED").length}</div></Card>
        <Card className="p-2.5 border-orange-500/20 bg-orange-500/5"><div className="text-[9px] uppercase text-muted-foreground">High</div><div className="text-sm font-mono font-semibold text-orange-400">{results.filter((r) => r.threshold === "HIGH").length}</div></Card>
        <Card className="p-2.5 border-rose-500/20 bg-rose-500/5"><div className="text-[9px] uppercase text-muted-foreground">Extreme</div><div className="text-sm font-mono font-semibold text-rose-400">{results.filter((r) => r.threshold === "EXTREME").length}</div></Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">VPIN Scan — All Contracts (sorted by VPIN descending)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase">
                  <th className="text-left py-2 px-3">#</th>
                  <th className="text-left py-2 px-3">Symbol</th>
                  <th className="text-left py-2 px-3">Name</th>
                  <th className="text-left py-2 px-3">Class</th>
                  <th className="text-right py-2 px-3">VPIN</th>
                  <th className="text-right py-2 px-3">EMA VPIN</th>
                  <th className="text-center py-2 px-2">Threshold</th>
                  <th className="text-right py-2 px-3">Spread Mult</th>
                  <th className="text-center py-2 px-2">Withdraw</th>
                  <th className="text-left py-2 px-3 w-32">VPIN Bar</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={r.symbol} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => onSelectSymbol(r.symbol)}>
                    <td className="py-1.5 px-3 font-mono text-[10px] text-muted-foreground">{i + 1}</td>
                    <td className="py-1.5 px-3 font-mono font-medium">{r.symbol}</td>
                    <td className="py-1.5 px-3 text-[10px] text-muted-foreground truncate max-w-[120px]">{r.name}</td>
                    <td className="py-1.5 px-3 text-[10px] text-muted-foreground">{r.assetClass}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono font-semibold", r.vpin > 0.7 ? "text-rose-400" : r.vpin > 0.5 ? "text-orange-400" : r.vpin > 0.3 ? "text-amber-400" : "text-emerald-400")}>{fmtPct(r.vpin)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{fmtPct(r.emaVpin)}</td>
                    <td className="py-1.5 px-2 text-center"><Badge variant="outline" className="text-[9px] h-4 px-1" style={{ backgroundColor: r.color + "20", color: r.color }}>{r.threshold}</Badge></td>
                    <td className="py-1.5 px-3 text-right font-mono">{r.spreadMultiplier.toFixed(2)}x</td>
                    <td className="py-1.5 px-2 text-center">{r.withdrawRecommendation ? <ShieldAlert className="w-3.5 h-3.5 text-rose-400 mx-auto" /> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-1.5 px-3">
                      <div className="relative h-4 bg-muted rounded-full overflow-hidden">
                        <div className="absolute inset-y-0 left-0 bg-emerald-500/20" style={{ width: "30%" }} />
                        <div className="absolute inset-y-0 bg-amber-500/20" style={{ left: "30%", width: "20%" }} />
                        <div className="absolute inset-y-0 bg-orange-500/20" style={{ left: "50%", width: "20%" }} />
                        <div className="absolute inset-y-0 bg-rose-500/20" style={{ left: "70%", width: "30%" }} />
                        <div className="absolute inset-y-0 left-0" style={{ width: `${r.vpin * 100}%`, backgroundColor: r.color }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Volume Buckets View
// ============================================================
function BucketsView({ result }: { result: VPINResult }) {
  if (result.buckets.length === 0) {
    return <Card><CardContent className="p-8 text-center text-muted-foreground text-xs">No buckets computed.</CardContent></Card>;
  }

  const recentBuckets = result.buckets.slice(-30); // last 30 buckets
  const chartData = recentBuckets.map((b) => ({
    bucket: b.bucketIndex,
    buy: b.buyVolume,
    sell: b.sellVolume,
    imbalance: b.imbalance * 100,
    vpin: b.volAtStart * 100,
  }));

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Volume Bucket Breakdown (Last 30 Buckets)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} />
                <Tooltip formatter={(v: any) => Number(v).toFixed(1)} contentStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="buy" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.4} name="Buy Vol" />
                <Area type="monotone" dataKey="sell" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.4} name="Sell Vol" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Bucket Imbalance & VPIN (Last 30)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} tickFormatter={(v) => `${v}%`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} tickFormatter={(v) => `${v}%`} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}%`, ""]} contentStyle={{ fontSize: 11 }} />
                <Line yAxisId="left" type="monotone" dataKey="imbalance" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Bucket Imbalance" />
                <Line yAxisId="right" type="monotone" dataKey="vpin" stroke="#3b82f6" strokeWidth={2} dot={false} name="VPIN (cumulative)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Bucket detail table */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Bucket Detail (Last 15)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase">
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-right py-2 px-3">Volume</th>
                  <th className="text-right py-2 px-3">Buy Vol</th>
                  <th className="text-right py-2 px-3">Sell Vol</th>
                  <th className="text-right py-2 px-3">Imbalance</th>
                  <th className="text-right py-2 px-3">Δ Price</th>
                  <th className="text-right py-2 px-3">VPIN</th>
                </tr>
              </thead>
              <tbody>
                {[...recentBuckets].reverse().slice(0, 15).map((b) => (
                  <tr key={b.bucketIndex} className="border-b border-border/30">
                    <td className="py-1 px-2 font-mono text-[10px] text-muted-foreground">{b.bucketIndex}</td>
                    <td className="py-1 px-3 text-right font-mono">{b.volume.toFixed(0)}</td>
                    <td className="py-1 px-3 text-right font-mono text-emerald-400">{b.buyVolume.toFixed(0)}</td>
                    <td className="py-1 px-3 text-right font-mono text-rose-400">{b.sellVolume.toFixed(0)}</td>
                    <td className={cn("py-1 px-3 text-right font-mono", b.imbalance > 0.5 ? "text-rose-400 font-semibold" : "")}>{(b.imbalance * 100).toFixed(1)}%</td>
                    <td className={cn("py-1 px-3 text-right font-mono", b.priceChange > 0 ? "text-emerald-400" : b.priceChange < 0 ? "text-rose-400" : "")}>{b.priceChange >= 0 ? "+" : ""}{b.priceChange.toFixed(4)}</td>
                    <td className={cn("py-1 px-3 text-right font-mono font-semibold", b.volAtStart > 0.7 ? "text-rose-400" : b.volAtStart > 0.5 ? "text-orange-400" : b.volAtStart > 0.3 ? "text-amber-400" : "text-emerald-400")}>{(b.volAtStart * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
