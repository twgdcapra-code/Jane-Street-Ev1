"use client";

import { useMemo, useState } from "react";
import { getEngine } from "@/lib/trading/market-engine";
import { CONTRACTS } from "@/lib/trading/contracts";
import { cointegration, halfLife, correlation, returns } from "@/lib/trading/indicators";
import { fmtPrice, fmtPct } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine, Area, AreaChart, Cell } from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BarChart3, Binary, GitCompare, Sigma } from "lucide-react";

type Tool = "factor_analysis" | "cointegration" | "correlation" | "volatility";

const TOOLS: { id: Tool; name: string; icon: any; description: string }[] = [
  { id: "factor_analysis", name: "Factor / Beta Decomposition", icon: Sigma, description: "Decompose each contract's returns against ES (market factor)" },
  { id: "cointegration", name: "Cointegration Lab", icon: Binary, description: "Engle-Granger two-step test, hedge ratio, OU half-life" },
  { id: "correlation", name: "Rolling Correlation", icon: GitCompare, description: "Time-varying correlation between two assets" },
  { id: "volatility", name: "Volatility Surface (proxy)", icon: BarChart3, description: "Annualised vol per asset class and rank" },
];

export function ResearchTerminal() {
  const [tool, setTool] = useState<Tool>("factor_analysis");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={cn(
              "px-3 py-1.5 rounded-md border text-xs flex items-center gap-2 transition-colors",
              tool === t.id
                ? "bg-primary/15 text-primary border-primary/30"
                : "border-border text-muted-foreground hover:bg-muted/40",
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.name}
          </button>
        ))}
      </div>

      {tool === "factor_analysis" && <FactorAnalysis />}
      {tool === "cointegration" && <CointegrationLab />}
      {tool === "correlation" && <RollingCorrelation />}
      {tool === "volatility" && <VolatilitySurface />}
    </div>
  );
}

function FactorAnalysis() {
  const data = (() => {
    const esHistory = getEngine().getHistory("ES");
    if (esHistory.length === 0) return [];
    const esRets = returns(esHistory.map((c) => c.close));
    return CONTRACTS.map((c) => {
      const hist = getEngine().getHistory(c.symbol);
      if (hist.length < 5) return null;
      const r = returns(hist.map((c) => c.close));
      const n = Math.min(r.length, esRets.length);
      const a = r.slice(-n);
      const b = esRets.slice(-n);
      const ma = a.reduce((s, v) => s + v, 0) / n;
      const mb = b.reduce((s, v) => s + v, 0) / n;
      let cov = 0, va = 0, vb = 0;
      for (let i = 0; i < n; i++) {
        cov += (a[i] - ma) * (b[i] - mb);
        vb += (b[i] - mb) ** 2;
        va += (a[i] - ma) ** 2;
      }
      const beta = vb === 0 ? 0 : cov / vb;
      const alpha = ma - beta * mb;
      const corr = va === 0 || vb === 0 ? 0 : cov / Math.sqrt(va * vb);
      const vol = Math.sqrt(va / (n - 1)) * Math.sqrt(252) * 100;
      return { symbol: c.symbol, name: c.name, beta, alpha: alpha * 252 * 100, corr, vol, assetClass: c.assetClass };
    }).filter(Boolean) as { symbol: string; name: string; beta: number; alpha: number; corr: number; vol: number; assetClass: string }[];
  })();

  const chartData = data.map((d) => ({ symbol: d.symbol, beta: d.beta, alpha: d.alpha, vol: d.vol }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Beta to ES (market factor)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="symbol" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                <ReferenceLine y={1} stroke="#666" strokeDasharray="3 3" />
                <ReferenceLine y={0} stroke="#666" />
                <Bar dataKey="beta" fill="#3b82f6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Factor Decomposition Table</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-3">Symbol</th>
                  <th className="text-left py-2 px-3">Name</th>
                  <th className="text-left py-2 px-3">Asset Class</th>
                  <th className="text-right py-2 px-3">Beta</th>
                  <th className="text-right py-2 px-3">Alpha (ann. %)</th>
                  <th className="text-right py-2 px-3">Correlation</th>
                  <th className="text-right py-2 px-3">Volatility (ann. %)</th>
                  <th className="text-right py-2 px-3">Idio. Vol (ann. %)</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => {
                  const idioVol = Math.sqrt(Math.max(0, d.vol ** 2 - (d.beta * d.vol) ** 2 * d.corr ** 2));
                  return (
                    <tr key={d.symbol} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="py-1.5 px-3 font-mono font-medium">{d.symbol}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">{d.name}</td>
                      <td className="py-1.5 px-3"><Badge variant="outline" className="text-[9px]">{d.assetClass}</Badge></td>
                      <td className={cn("py-1.5 px-3 text-right font-mono", d.beta > 1 ? "text-amber-400" : d.beta < 0 ? "text-emerald-400" : "text-foreground")}>{d.beta.toFixed(3)}</td>
                      <td className={cn("py-1.5 px-3 text-right font-mono", d.alpha > 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(d.alpha)}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{d.corr.toFixed(3)}</td>
                      <td className="py-1.5 px-3 text-right font-mono">{d.vol.toFixed(1)}%</td>
                      <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{idioVol.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CointegrationLab() {
  const [a, setA] = useState("ES");
  const [b, setB] = useState("NQ");
  const result = useMemo(() => {
    const histA = getEngine().getHistory(a).map((c) => c.close);
    const histB = getEngine().getHistory(b).map((c) => c.close);
    if (histA.length < 50 || histB.length < 50) return null;
    return cointegration(histA, histB);
  }, [a, b]);
  const spreadData = useMemo(() => {
    if (!result) return [];
    return result.residual.slice(-200).map((r, i) => ({ i, z: (r - result.residual.reduce((s, v) => s + v, 0) / result.residual.length) / (Math.sqrt(result.residual.reduce((s, v) => s + (v - result.residual.reduce((sm, vm) => sm + vm, 0) / result.residual.length) ** 2, 0) / result.residual.length) || 1) }));
  }, [result]);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm">Pair Selection</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <select value={a} onChange={(e) => setA(e.target.value)} className="bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono">
            {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}
          </select>
          <span className="text-muted-foreground">vs</span>
          <select value={b} onChange={(e) => setB(e.target.value)} className="bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono">
            {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}
          </select>
        </CardContent>
      </Card>
      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="py-3"><CardTitle className="text-sm">Cointegration Stats</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-xs">
              <StatRow label="Hedge Ratio (β)" value={result.beta.toFixed(4)} />
              <StatRow label="OU Half-Life" value={isFinite(result.halfLife) ? `${result.halfLife.toFixed(1)} bars` : "∞ (non-mean-reverting)"} />
              <StatRow label="Current Z-Score" value={result.zScore.toFixed(3)} />
              <StatRow label="Interpretation" value={Math.abs(result.zScore) > 2 ? "TRADE SIGNAL" : Math.abs(result.zScore) > 1 ? "WATCH" : "NEUTRAL"} />
              <StatRow label="Mean Reverting?" value={result.halfLife < 30 && result.halfLife > 0 ? "YES" : "NO / WEAK"} />
            </CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader className="py-3"><CardTitle className="text-sm">Residual Spread (Z-Score)</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={spreadData}>
                    <defs>
                      <linearGradient id="residGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                    <XAxis dataKey="i" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(spreadData.length / 6)} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={40} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                    <ReferenceLine y={2} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
                    <ReferenceLine y={-2} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.5} />
                    <ReferenceLine y={0} stroke="#666" />
                    <Area type="monotone" dataKey="z" stroke="#3b82f6" strokeWidth={1.5} fill="url(#residGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function RollingCorrelation() {
  const [a, setA] = useState("ES");
  const [b, setB] = useState("ZN");
  const [window, setWindow] = useState(30);
  const data = useMemo(() => {
    const histA = getEngine().getHistory(a).map((c) => c.close);
    const histB = getEngine().getHistory(b).map((c) => c.close);
    const n = Math.min(histA.length, histB.length);
    const out: { i: number; corr: number }[] = [];
    for (let i = window; i < n; i++) {
      const sliceA = histA.slice(i - window, i);
      const sliceB = histB.slice(i - window, i);
      out.push({ i: i - window, corr: correlation(sliceA, sliceB) });
    }
    return out;
  }, [a, b, window]);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Pair Selection</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <select value={a} onChange={(e) => setA(e.target.value)} className="bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono">
            {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}
          </select>
          <span className="text-muted-foreground">vs</span>
          <select value={b} onChange={(e) => setB(e.target.value)} className="bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono">
            {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">Window:</span>
            <input type="range" min={5} max={100} value={window} onChange={(e) => setWindow(Number(e.target.value))} className="w-32" />
            <span className="text-xs font-mono">{window}</span>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Rolling Correlation</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="i" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(data.length / 6)} />
                <YAxis domain={[-1, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} formatter={(v: any) => Number(v).toFixed(3)} />
                <ReferenceLine y={0} stroke="#666" />
                <ReferenceLine y={1} stroke="#10b981" strokeDasharray="3 3" strokeOpacity={0.3} />
                <ReferenceLine y={-1} stroke="#ef4444" strokeDasharray="3 3" strokeOpacity={0.3} />
                <Line type="monotone" dataKey="corr" stroke="#a855f7" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">Current: <span className="font-mono">{data.length > 0 ? data[data.length - 1].corr.toFixed(3) : "—"}</span> · Mean: <span className="font-mono">{data.length > 0 ? (data.reduce((s, d) => s + d.corr, 0) / data.length).toFixed(3) : "—"}</span></div>
        </CardContent>
      </Card>
    </div>
  );
}

function VolatilitySurface() {
  const data = useMemo(() => {
    return CONTRACTS.map((c) => {
      const hist = getEngine().getHistory(c.symbol).map((c) => c.close);
      const r = returns(hist);
      const m = r.reduce((s, v) => s + v, 0) / Math.max(r.length, 1);
      const v = Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(r.length - 1, 1)) * Math.sqrt(252) * 100;
      return { symbol: c.symbol, name: c.name, vol: v, assetClass: c.assetClass, baseVol: c.volatility * 100 };
    }).sort((a, b) => b.vol - a.vol);
  }, []);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Annualised Volatility (computed vs spec)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis type="category" dataKey="symbol" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                <Bar dataKey="vol" fill="#f59e0b" radius={[0, 2, 2, 0]} name="Realised Vol" />
                <Bar dataKey="baseVol" fill="#3b82f6" radius={[0, 2, 2, 0]} name="Spec Vol" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Volatility Ranking</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border">
              <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                <th className="text-left py-2 px-3">Rank</th>
                <th className="text-left py-2 px-3">Symbol</th>
                <th className="text-left py-2 px-3">Asset Class</th>
                <th className="text-right py-2 px-3">Realised Vol</th>
                <th className="text-right py-2 px-3">Spec Vol</th>
                <th className="text-right py-2 px-3">VRP</th>
                <th className="text-right py-2 px-3">Sharpe Potential</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={d.symbol} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="py-1.5 px-3 font-mono text-[10px] text-muted-foreground">{i + 1}</td>
                  <td className="py-1.5 px-3 font-mono font-medium">{d.symbol}</td>
                  <td className="py-1.5 px-3"><Badge variant="outline" className="text-[9px]">{d.assetClass}</Badge></td>
                  <td className="py-1.5 px-3 text-right font-mono">{d.vol.toFixed(1)}%</td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{d.baseVol.toFixed(1)}%</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono", d.vol > d.baseVol ? "text-rose-400" : "text-emerald-400")}>
                    {(d.baseVol - d.vol).toFixed(1)}%
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">
                    {(0.5 / (d.vol / 100)).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/30 py-1">
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span className="font-mono text-[11px] font-medium">{value}</span>
    </div>
  );
}
