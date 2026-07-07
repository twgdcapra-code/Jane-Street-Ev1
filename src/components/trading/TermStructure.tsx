"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS } from "@/lib/trading/contracts";
import { buildCurve, buildAllCurves, type CurveSnapshot } from "@/lib/trading/termstructure";
import { fmtPrice, fmtPct, fmtCompact, decimalsFor } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Scatter, ComposedChart } from "recharts";
import { cn } from "@/lib/utils";
import { Activity, TrendingDown, TrendingUp } from "lucide-react";

const REGIME_COLORS: Record<CurveSnapshot["regime"], string> = {
  CONTANGO: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  BACKWARDATION: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  FLAT: "bg-muted text-muted-foreground border-border",
  HUMPED: "bg-purple-500/15 text-purple-400 border-purple-500/30",
};

const REGIME_DESC: Record<CurveSnapshot["regime"], string> = {
  CONTANGO: "Back months trade above front. Normal for storable commodities (cost of carry). Rolling short earns positive carry.",
  BACKWARDATION: "Front months trade above back. Signals physical scarcity or tight supply. Rolling long earns positive carry.",
  FLAT: "Curve is roughly flat. Market is balanced — no strong carry signal in either direction.",
  HUMPED: "Mid-curve trades at premium to both ends. Often indicates expected supply squeeze at a specific future date.",
};

export function TermStructure() {
  const quotes = useTradingStore((s) => s.quotes);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const [selectedSymbol, setSelectedSymbol] = useState("CL");
  const [filterRegime, setFilterRegime] = useState<string>("ALL");

  // Use live spot price from quotes if available
  const spotPrice = quotes[selectedSymbol]?.last;
  const curve = useMemo(
    () => buildCurve(selectedSymbol, spotPrice),
    [selectedSymbol, spotPrice],
  );

  const allCurves = useMemo(
    () => buildAllCurves(Object.fromEntries(Object.entries(quotes).map(([k, v]) => [k, v.last]))),
    [quotes],
  );

  const filteredCurves = filterRegime === "ALL" ? allCurves : allCurves.filter((c) => c.regime === filterRegime);

  const chartData = curve.points.map((p) => ({
    label: p.label,
    price: p.price,
    volume: p.volume,
    rollYield: p.rollYield,
  }));

  return (
    <div className="space-y-4">
      {/* Regime summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3 border-blue-500/30 bg-blue-500/5">
          <div className="text-[10px] text-muted-foreground uppercase">Contango</div>
          <div className="text-lg font-mono font-semibold text-blue-400">{allCurves.filter((c) => c.regime === "CONTANGO").length}</div>
        </Card>
        <Card className="p-3 border-amber-500/30 bg-amber-500/5">
          <div className="text-[10px] text-muted-foreground uppercase">Backwardation</div>
          <div className="text-lg font-mono font-semibold text-amber-400">{allCurves.filter((c) => c.regime === "BACKWARDATION").length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Flat</div>
          <div className="text-lg font-mono font-semibold">{allCurves.filter((c) => c.regime === "FLAT").length}</div>
        </Card>
        <Card className="p-3 border-purple-500/30 bg-purple-500/5">
          <div className="text-[10px] text-muted-foreground uppercase">Humped</div>
          <div className="text-lg font-mono font-semibold text-purple-400">{allCurves.filter((c) => c.regime === "HUMPED").length}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Curve list */}
        <Card className="lg:col-span-1">
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">All Curves</CardTitle>
            <select
              value={filterRegime}
              onChange={(e) => setFilterRegime(e.target.value)}
              className="bg-muted/50 border border-border rounded px-2 py-1 text-xs"
            >
              <option value="ALL">All regimes</option>
              <option value="CONTANGO">Contango</option>
              <option value="BACKWARDATION">Backwardation</option>
              <option value="FLAT">Flat</option>
              <option value="HUMPED">Humped</option>
            </select>
          </CardHeader>
          <CardContent className="space-y-1 max-h-[600px] overflow-y-auto pt-0">
            {filteredCurves.map((c) => (
              <button
                key={c.symbol}
                onClick={() => {
                  setSelectedSymbol(c.symbol);
                  selectSymbol(c.symbol);
                }}
                className={cn(
                  "w-full text-left p-2 rounded-md border transition-colors",
                  selectedSymbol === c.symbol
                    ? "bg-primary/10 border-primary/30"
                    : "bg-muted/30 border-border hover:bg-muted/50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-semibold">{c.symbol}</span>
                  <Badge variant="outline" className={cn("text-[9px] h-4 px-1", REGIME_COLORS[c.regime])}>{c.regime}</Badge>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  Slope: {fmtPct(c.slope)} · Roll: {fmtPct(c.annualRollYield)}
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Curve chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="w-4 h-4" /> {curve.name} ({curve.symbol}) — Term Structure
              </CardTitle>
              <p className="text-[11px] text-muted-foreground mt-0.5">{REGIME_DESC[curve.regime]}</p>
            </div>
            <Badge variant="outline" className={cn("text-[10px]", REGIME_COLORS[curve.regime])}>{curve.regime}</Badge>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis
                    yAxisId="price"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    width={70}
                    orientation="right"
                    domain={["auto", "auto"]}
                  />
                  <YAxis yAxisId="volume" orientation="left" hide />
                  <Tooltip
                    formatter={(v: any, name: string) => name === "price" ? fmtPrice(Number(v), decimalsFor(curve.symbol)) : fmtCompact(Number(v), 0)}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                  />
                  <ReferenceLine y={curve.spotPrice} yAxisId="price" stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: "Spot", fontSize: 9, fill: "#fbbf24" }} />
                  <Line yAxisId="price" type="monotone" dataKey="price" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4, fill: "#3b82f6" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            {/* Curve analytics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
              <Stat label="Front Month" value={fmtPrice(curve.spotPrice, decimalsFor(curve.symbol))} />
              <Stat label="12M Forward" value={fmtPrice(curve.points[curve.points.length - 1].price, decimalsFor(curve.symbol))} />
              <Stat
                label="Curve Slope"
                value={fmtPct(curve.slope)}
                tone={curve.slope > 0 ? "info" : curve.slope < 0 ? "warn" : "neutral"}
              />
              <Stat
                label="Annual Roll Yield"
                value={fmtPct(curve.annualRollYield)}
                tone={curve.annualRollYield > 0 ? "positive" : "negative"}
              />
              <Stat label="Front-Back Spread" value={fmtPrice(curve.frontBackSpread, decimalsFor(curve.symbol))} />
              <Stat label="Spread %" value={fmtPct(curve.frontBackSpreadPct)} />
              <Stat label="Max Price" value={`${curve.maxLabel}: ${fmtPrice(curve.maxPrice, decimalsFor(curve.symbol))}`} />
              <Stat label="Min Price" value={`${curve.minLabel}: ${fmtPrice(curve.minPrice, decimalsFor(curve.symbol))}`} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Curve point table */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Curve Detail — {curve.symbol}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-3">Month</th>
                  <th className="text-right py-2 px-3">Price</th>
                  <th className="text-right py-2 px-3">Δ vs Front</th>
                  <th className="text-right py-2 px-3">Δ vs Front %</th>
                  <th className="text-right py-2 px-3">Volume</th>
                  <th className="text-right py-2 px-3">Open Int</th>
                  <th className="text-right py-2 px-3">Roll Yield (ann.)</th>
                </tr>
              </thead>
              <tbody>
                {curve.points.map((p) => {
                  const diff = p.price - curve.spotPrice;
                  const diffPct = (diff / curve.spotPrice) * 100;
                  return (
                    <tr key={p.label} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="py-2 px-3 font-medium">{p.label}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{fmtPrice(p.price, decimalsFor(curve.symbol))}</td>
                      <td className={cn("py-2 px-3 text-right font-mono tabular-nums", diff >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {diff >= 0 ? "+" : ""}{fmtPrice(diff, decimalsFor(curve.symbol))}
                      </td>
                      <td className={cn("py-2 px-3 text-right font-mono tabular-nums", diff >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {fmtPct(diffPct)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-muted-foreground">{fmtCompact(p.volume, 0)}</td>
                      <td className="py-2 px-3 text-right font-mono text-muted-foreground">{fmtCompact(p.openInterest, 0)}</td>
                      <td className={cn("py-2 px-3 text-right font-mono tabular-nums", p.rollYield > 0 ? "text-emerald-400" : "text-rose-400")}>
                        {fmtPct(p.rollYield)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Strategy implications */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Trading Implications</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-xs">
          {curve.regime === "CONTANGO" && (
            <div className="flex items-start gap-2 p-2 border border-blue-500/30 bg-blue-500/5 rounded-md">
              <TrendingDown className="w-4 h-4 text-blue-400 mt-0.5" />
              <div>
                <div className="font-medium text-blue-400">Contango — Favor Short Rolls</div>
                <div className="text-muted-foreground mt-0.5">
                  Back months trade above front. Going short futures and rolling forward earns positive carry ({fmtPct(curve.annualRollYield)} annualized).
                  Calendar spreads (short front, long back) capture the carry. Watch for supply shocks that could flip the curve.
                </div>
              </div>
            </div>
          )}
          {curve.regime === "BACKWARDATION" && (
            <div className="flex items-start gap-2 p-2 border border-amber-500/30 bg-amber-500/5 rounded-md">
              <TrendingUp className="w-4 h-4 text-amber-400 mt-0.5" />
              <div>
                <div className="font-medium text-amber-400">Backwardation — Favor Long Rolls</div>
                <div className="text-muted-foreground mt-0.5">
                  Front months trade above back. Going long futures and rolling forward earns positive carry ({fmtPct(curve.annualRollYield)} annualized).
                  Common in energy markets during supply tightness. Often signals near-term scarcity.
                </div>
              </div>
            </div>
          )}
          {curve.regime === "FLAT" && (
            <div className="flex items-start gap-2 p-2 border border-border bg-muted/30 rounded-md">
              <Activity className="w-4 h-4 text-muted-foreground mt-0.5" />
              <div>
                <div className="font-medium">Flat Curve — No Carry Edge</div>
                <div className="text-muted-foreground mt-0.5">
                  Curve is balanced — no strong carry signal in either direction. Focus on outright directional trades or inter-commodity spreads.
                </div>
              </div>
            </div>
          )}
          {curve.regime === "HUMPED" && (
            <div className="flex items-start gap-2 p-2 border border-purple-500/30 bg-purple-500/5 rounded-md">
              <Activity className="w-4 h-4 text-purple-400 mt-0.5" />
              <div>
                <div className="font-medium text-purple-400">Humped Curve — Calendar Trade Opportunity</div>
                <div className="text-muted-foreground mt-0.5">
                  Mid-curve trades at premium to both ends. Often indicates expected supply squeeze at a specific future date.
                  Consider selling the hump month and buying wings (butterfly spread).
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "info" | "warn" | "neutral" }) {
  return (
    <div className={cn(
      "border rounded-md p-2",
      tone === "positive" && "border-emerald-500/30 bg-emerald-500/5",
      tone === "negative" && "border-rose-500/30 bg-rose-500/5",
      tone === "info" && "border-blue-500/30 bg-blue-500/5",
      tone === "warn" && "border-amber-500/30 bg-amber-500/5",
      tone === "neutral" && "border-border bg-muted/30",
    )}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn(
        "text-sm font-mono font-semibold tabular-nums mt-0.5",
        tone === "positive" && "text-emerald-400",
        tone === "negative" && "text-rose-400",
        tone === "info" && "text-blue-400",
        tone === "warn" && "text-amber-400",
      )}>{value}</div>
    </div>
  );
}
