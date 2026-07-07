"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { scanMarket, getSignalLabel, DEFAULT_SCAN_CONFIG, type ScanConfig, type SignalType } from "@/lib/trading/scanner";
import { fmtPrice, fmtPct, decimalsFor } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Radar, RefreshCw, Settings, TrendingDown, TrendingUp } from "lucide-react";

const SIGNAL_COLORS: Record<SignalType, string> = {
  RSI_OVERSOLD: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  RSI_OVERBOUGHT: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  SMA_CROSS_UP: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  SMA_CROSS_DOWN: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  BB_UPPER_TOUCH: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  BB_LOWER_TOUCH: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  VOLUME_SPIKE: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  MOMENTUM_UP: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  MOMENTUM_DOWN: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  ATR_BREAKOUT: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  VWAP_DEV_HIGH: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  VWAP_DEV_LOW: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

export function MarketScanner() {
  const tickCount = useTradingStore((s) => s.tickCount);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const [config, setConfig] = useState<ScanConfig>(DEFAULT_SCAN_CONFIG);
  const [showConfig, setShowConfig] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [filterBias, setFilterBias] = useState<"ALL" | "BULL" | "BEAR">("ALL");

  // Re-scan on every tick
  const results = useMemo(() => scanMarket(config), [config, tickCount]);
  const filtered = useMemo(
    () => results
      .filter((r) => r.compositeScore >= minScore)
      .filter((r) => filterBias === "ALL" || (filterBias === "BULL" && r.bias > 0) || (filterBias === "BEAR" && r.bias < 0)),
    [results, minScore, filterBias],
  );

  const bullCount = results.filter((r) => r.bias > 0).length;
  const bearCount = results.filter((r) => r.bias < 0).length;
  const neutralCount = results.filter((r) => r.bias === 0).length;

  return (
    <div className="space-y-4">
      {/* Header stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Total Signals</div><div className="text-lg font-mono font-semibold">{results.length}</div></Card>
        <Card className="p-3 border-emerald-500/30 bg-emerald-500/5"><div className="text-[10px] text-muted-foreground uppercase">Bullish</div><div className="text-lg font-mono font-semibold text-emerald-400">{bullCount}</div></Card>
        <Card className="p-3 border-rose-500/30 bg-rose-500/5"><div className="text-[10px] text-muted-foreground uppercase">Bearish</div><div className="text-lg font-mono font-semibold text-rose-400">{bearCount}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Neutral</div><div className="text-lg font-mono font-semibold">{neutralCount}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Avg Score</div><div className="text-lg font-mono font-semibold">{results.length > 0 ? (results.reduce((s, r) => s + r.compositeScore, 0) / results.length).toFixed(0) : "0"}</div></Card>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
          {(["ALL", "BULL", "BEAR"] as const).map((b) => (
            <button
              key={b}
              onClick={() => setFilterBias(b)}
              className={cn(
                "px-2.5 py-1 text-xs rounded transition-colors",
                filterBias === b ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {b === "ALL" ? "All Bias" : b === "BULL" ? "Bullish Only" : "Bearish Only"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Label className="text-[10px] text-muted-foreground">Min Score:</Label>
          <Input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="h-7 w-20 text-xs font-mono"
          />
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs ml-auto" onClick={() => setShowConfig(!showConfig)}>
          <Settings className="w-3 h-3 mr-1" /> {showConfig ? "Hide" : "Show"} Config
        </Button>
      </div>

      {/* Config panel */}
      {showConfig && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Scanner Configuration</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ConfigInput label="RSI Period" value={config.rsiPeriod} onChange={(v) => setConfig({ ...config, rsiPeriod: v })} />
            <ConfigInput label="RSI Overbought" value={config.rsiOverbought} onChange={(v) => setConfig({ ...config, rsiOverbought: v })} />
            <ConfigInput label="RSI Oversold" value={config.rsiOversold} onChange={(v) => setConfig({ ...config, rsiOversold: v })} />
            <ConfigInput label="SMA Period" value={config.smaPeriod} onChange={(v) => setConfig({ ...config, smaPeriod: v })} />
            <ConfigInput label="BB Period" value={config.bbPeriod} onChange={(v) => setConfig({ ...config, bbPeriod: v })} />
            <ConfigInput label="BB Std" value={config.bbStd} step={0.25} onChange={(v) => setConfig({ ...config, bbStd: v })} />
            <ConfigInput label="Vol Spike Mult" value={config.volSpikeMult} step={0.1} onChange={(v) => setConfig({ ...config, volSpikeMult: v })} />
            <ConfigInput label="Momentum Period" value={config.momentumPeriod} onChange={(v) => setConfig({ ...config, momentumPeriod: v })} />
            <ConfigInput label="Momentum Threshold %" value={config.momentumThreshold} step={0.25} onChange={(v) => setConfig({ ...config, momentumThreshold: v })} />
            <ConfigInput label="ATR Lookback" value={config.atrLookback} onChange={(v) => setConfig({ ...config, atrLookback: v })} />
            <ConfigInput label="ATR Mult" value={config.atrMult} step={0.1} onChange={(v) => setConfig({ ...config, atrMult: v })} />
            <ConfigInput label="VWAP Dev %" value={config.vwapDevThreshold} step={0.1} onChange={(v) => setConfig({ ...config, vwapDevThreshold: v })} />
            <Button variant="outline" size="sm" className="col-span-2 md:col-span-4 h-8 text-xs" onClick={() => setConfig(DEFAULT_SCAN_CONFIG)}>
              <RefreshCw className="w-3 h-3 mr-1" /> Reset to Defaults
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Results table */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Radar className="w-4 h-4" /> Scan Results ({filtered.length})</CardTitle>
          <span className="text-[10px] text-muted-foreground">Updates every tick · Click row to view chart</span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-3">Symbol</th>
                  <th className="text-left py-2 px-3">Name</th>
                  <th className="text-right py-2 px-3">Last</th>
                  <th className="text-right py-2 px-3">Chg%</th>
                  <th className="text-right py-2 px-3">Score</th>
                  <th className="text-center py-2 px-3">Bias</th>
                  <th className="text-left py-2 px-3">Signals</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No signals match filter. Lower min score or change bias filter.</td></tr>
                ) : (
                  filtered.map((r) => (
                    <tr
                      key={r.symbol}
                      className="border-b border-border/40 hover:bg-muted/30 cursor-pointer"
                      onClick={() => selectSymbol(r.symbol)}
                    >
                      <td className="py-2 px-3 font-mono font-semibold">{r.symbol}</td>
                      <td className="py-2 px-3 text-muted-foreground truncate max-w-[180px]">{r.name}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{fmtPrice(r.lastPrice, decimalsFor(r.symbol))}</td>
                      <td className={cn("py-2 px-3 text-right font-mono tabular-nums", r.changePct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {fmtPct(r.changePct)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold">{r.compositeScore.toFixed(0)}</td>
                      <td className="py-2 px-3 text-center">
                        {r.bias > 0 ? (
                          <TrendingUp className="w-4 h-4 text-emerald-400 mx-auto" />
                        ) : r.bias < 0 ? (
                          <TrendingDown className="w-4 h-4 text-rose-400 mx-auto" />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {r.signals.slice(0, 4).map((s, i) => (
                            <Badge key={i} variant="outline" className={cn("text-[9px] h-4 px-1", SIGNAL_COLORS[s.type])} title={s.description}>
                              {getSignalLabel(s.type)}
                            </Badge>
                          ))}
                          {r.signals.length > 4 && <span className="text-[10px] text-muted-foreground">+{r.signals.length - 4}</span>}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top signal details */}
      {filtered.length > 0 && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Top Setup Details — {filtered[0].symbol}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="text-xs text-muted-foreground">{filtered[0].name} · Score {filtered[0].compositeScore.toFixed(0)} · Bias {filtered[0].bias > 0 ? "Bullish" : filtered[0].bias < 0 ? "Bearish" : "Neutral"}</div>
            <div className="space-y-1.5">
              {filtered[0].signals.map((s, i) => (
                <div key={i} className="flex items-center gap-3 border border-border/40 rounded-md p-2">
                  <Badge variant="outline" className={cn("text-[10px] h-5 px-1.5", SIGNAL_COLORS[s.type])}>{getSignalLabel(s.type)}</Badge>
                  <span className="text-xs flex-1">{s.description}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${s.strength}%` }} />
                    </div>
                    <span className="text-xs font-mono tabular-nums w-8 text-right">{s.strength.toFixed(0)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ConfigInput({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 text-xs font-mono mt-0.5"
      />
    </div>
  );
}
