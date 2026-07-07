"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS } from "@/lib/trading/contracts";
import { getCandlesForTimeframe, TIMEFRAMES, type Timeframe } from "@/lib/trading/timeframes";
import {
  INDICATOR_REGISTRY, INDICATOR_CATEGORIES, DEFAULT_PRESETS, makePresetId,
  getIndicator, type IndicatorPreset, type IndicatorCategory,
} from "@/lib/trading/indicator-registry";
import {
  detectRegime, parsePrompt, predictCandles, evaluateRule, computeLearningStats,
  evaluateSignalOutcomes, type SignalRule, type IndicatorCondition, type SignalLogEntry,
} from "@/lib/trading/indicators-intelligence";
import { detectChartPatterns } from "@/lib/trading/patterns";
import { heikinAshi, detectCandlePatterns } from "@/lib/trading/indicators-advanced";
import { fmtPrice, fmtPct, fmtTime, decimalsFor } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Bar, BarChart, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, Area, AreaChart, Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  Activity, Brain, Calendar, ChevronDown, ChevronRight, Cpu, Flame, Layers,
  Lightbulb, LineChart as LineIcon, Plus, Radar, Save, Sparkles, Target,
  TrendingDown, TrendingUp, Trash2, Waves, Zap,
} from "lucide-react";

type TabId = "chart" | "library" | "signals" | "prompt" | "patterns" | "prediction" | "learning" | "presets";

const TABS: { id: TabId; name: string; icon: any }[] = [
  { id: "chart", name: "Live Chart", icon: LineIcon },
  { id: "library", name: "Indicator Library", icon: Layers },
  { id: "signals", name: "Signal Builder", icon: Zap },
  { id: "prompt", name: "Prompt Executor", icon: Brain },
  { id: "patterns", name: "Pattern Recognition", icon: Activity },
  { id: "prediction", name: "Prediction Engine", icon: TrendingUp },
  { id: "learning", name: "Learning Log", icon: Cpu },
  { id: "presets", name: "Presets", icon: Save },
];

interface ActiveIndicator {
  uid: string;
  indicatorId: string;
  params: Record<string, number>;
  enabled: boolean;
  color: string;
}

let uidCounter = 0;
function makeUid(): string { return `ind-${uidCounter++}`; }

export function IndicatorsLab() {
  const [tab, setTab] = useState<TabId>("chart");
  const [symbol, setSymbol] = useState("ES");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [lookback, setLookback] = useState(150);
  const [useHeikinAshi, setUseHeikinAshi] = useState(false);
  const [activeIndicators, setActiveIndicators] = useState<ActiveIndicator[]>([
    { uid: makeUid(), indicatorId: "ema", params: { period: 9 }, enabled: true, color: "#3b82f6" },
    { uid: makeUid(), indicatorId: "ema", params: { period: 21 }, enabled: true, color: "#a855f7" },
    { uid: makeUid(), indicatorId: "vwap", params: {}, enabled: true, color: "#facc15" },
    { uid: makeUid(), indicatorId: "rsi", params: { period: 14 }, enabled: true, color: "#8b5cf6" },
  ]);
  const [presets, setPresets] = useState<IndicatorPreset[]>(DEFAULT_PRESETS);
  const [signalRules, setSignalRules] = useState<SignalRule[]>([]);
  const [signalLog, setSignalLog] = useState<SignalLogEntry[]>([]);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const tickCount = useTradingStore((s) => s.tickCount);

  // Sync with global symbol selector
  const globalSymbol = useTradingStore((s) => s.selectedSymbol);
  useEffect(() => { setSymbol(globalSymbol); }, [globalSymbol]);

  // Get candles for current timeframe
  const candles = useMemo(
    () => getCandlesForTimeframe(symbol, timeframe, lookback),
    [symbol, timeframe, lookback, tickCount],
  );
  // Apply Heikin-Ashi if enabled
  const displayCandles = useMemo(() => useHeikinAshi ? heikinAshi(candles) : candles, [candles, useHeikinAshi]);
  const decimals = decimalsFor(symbol);

  return (
    <div className="space-y-4">
      {/* Top control bar */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <div>
            <Label className="text-[10px] text-muted-foreground">Symbol</Label>
            <select
              value={symbol}
              onChange={(e) => { setSymbol(e.target.value); selectSymbol(e.target.value); }}
              className="bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono ml-1"
            >
              {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}
            </select>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Timeframe</Label>
            <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5 ml-1">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => setTimeframe(tf.value)}
                  className={cn(
                    "px-2 py-1 text-xs rounded transition-colors",
                    timeframe === tf.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                  title={tf.label}
                >
                  {tf.value}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Lookback</Label>
            <select
              value={lookback}
              onChange={(e) => setLookback(Number(e.target.value))}
              className="bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs ml-1"
            >
              <option value={75}>75 bars</option>
              <option value={150}>150 bars</option>
              <option value={250}>250 bars</option>
              <option value={400}>400 bars</option>
            </select>
          </div>
          <div className="flex items-center gap-2 ml-2">
            <Switch checked={useHeikinAshi} onCheckedChange={setUseHeikinAshi} />
            <Label className="text-xs">Heikin-Ashi</Label>
          </div>
          <div className="flex-1" />
          <Badge variant="outline" className="text-[10px]">{candles.length} bars · {timeframe}</Badge>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs whitespace-nowrap border transition-colors",
              tab === t.id
                ? "bg-primary/15 text-primary border-primary/30"
                : "border-border text-muted-foreground hover:bg-muted/40",
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.name}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "chart" && (
        <ChartTab
          candles={displayCandles} decimals={decimals} symbol={symbol}
          activeIndicators={activeIndicators} setActiveIndicators={setActiveIndicators}
        />
      )}
      {tab === "library" && (
        <LibraryTab
          candles={displayCandles}
          activeIndicators={activeIndicators} setActiveIndicators={setActiveIndicators}
        />
      )}
      {tab === "signals" && (
        <SignalsTab candles={displayCandles} signalRules={signalRules} setSignalRules={setSignalRules}
          signalLog={signalLog} setSignalLog={setSignalLog} symbol={symbol} decimals={decimals}
        />
      )}
      {tab === "prompt" && <PromptTab candles={displayCandles} symbol={symbol} decimals={decimals} />}
      {tab === "patterns" && <PatternsTab candles={displayCandles} decimals={decimals} />}
      {tab === "prediction" && <PredictionTab candles={displayCandles} decimals={decimals} />}
      {tab === "learning" && <LearningTab signalLog={signalLog} setSignalLog={setSignalLog} candles={displayCandles} />}
      {tab === "presets" && (
        <PresetsTab presets={presets} setPresets={setPresets}
          activeIndicators={activeIndicators} setActiveIndicators={setActiveIndicators}
          timeframe={timeframe} setTimeframe={setTimeframe}
        />
      )}
    </div>
  );
}

// ============================================================
// CHART TAB
// ============================================================
function ChartTab({ candles, decimals, symbol, activeIndicators, setActiveIndicators }: any) {
  const [showIndicators, setShowIndicators] = useState(true);
  // Compute indicator series
  const indicatorData = useMemo(() => {
    const data = candles.map((c: any, i: number) => {
      const point: any = {
        time: c.time,
        timeStr: fmtTime(c.time),
        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        range: [c.low, c.high],
        bodyRange: [Math.min(c.open, c.close), Math.max(c.open, c.close)],
        isUp: c.close >= c.open,
      };
      return point;
    });
    // Add indicator series
    for (const ai of activeIndicators) {
      if (!ai.enabled) continue;
      const def = getIndicator(ai.indicatorId);
      if (!def) continue;
      const { series } = def.compute(candles, ai.params);
      for (const s of series) {
        for (let i = 0; i < data.length; i++) {
          data[i][`${ai.uid}_${s.name}`] = s.values[i];
        }
      }
    }
    return data;
  }, [candles, activeIndicators]);

  // Separate oscillator indicators (RSI, MACD, Stoch, etc.) from overlay indicators
  const oscillatorUids = activeIndicators.filter((ai: ActiveIndicator) => {
    const def = getIndicator(ai.indicatorId);
    if (!def) return false;
    return ["rsi", "macd", "stochastic", "cci", "williamsr", "mfi", "trix", "roc", "momentum", "dpo", "kst", "awesome", "cmf", "adx", "aroon", "vortex", "atr", "stdev", "ttmsqueeze", "obv", "ad", "force", "emv", "volosc"].includes(ai.indicatorId);
  });
  const overlayUids = activeIndicators.filter((ai: ActiveIndicator) => !oscillatorUids.includes(ai));

  const lastCandle = candles[candles.length - 1];
  const regime = useMemo(() => detectRegime(candles), [candles]);

  return (
    <div className="space-y-3">
      {/* Regime banner */}
      <Card className={cn("border", regime.regime === "TRENDING_UP" ? "border-emerald-500/30 bg-emerald-500/5" : regime.regime === "TRENDING_DOWN" ? "border-rose-500/30 bg-rose-500/5" : regime.regime === "HIGH_VOLATILITY" ? "border-amber-500/30 bg-amber-500/5" : "border-border")}>
        <CardContent className="p-3 flex items-center gap-3">
          {regime.regime === "TRENDING_UP" ? <TrendingUp className="w-5 h-5 text-emerald-500" /> : regime.regime === "TRENDING_DOWN" ? <TrendingDown className="w-5 h-5 text-rose-500" /> : regime.regime === "HIGH_VOLATILITY" ? <Flame className="w-5 h-5 text-amber-500" /> : <Activity className="w-5 h-5 text-muted-foreground" />}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{regime.regime.replace(/_/g, " ")}</span>
              <Badge variant="outline" className="text-[9px]">Confidence {regime.confidence.toFixed(0)}%</Badge>
              <span className="text-[10px] text-muted-foreground">ADX {regime.adx.toFixed(1)} · Vol {regime.volatility.toFixed(1)}% ({regime.volatilityPercentile.toFixed(0)}pct)</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{regime.description}</p>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowIndicators(!showIndicators)}>
            {showIndicators ? "Hide" : "Show"} Recommendations
          </Button>
        </CardContent>
      </Card>

      {/* Regime recommendations */}
      {showIndicators && regime.recommendedIndicators.length > 0 && (
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Sparkles className="w-3.5 h-3.5 text-primary" /> Recommended Indicators for {regime.regime.replace(/_/g, " ")}</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {regime.recommendedIndicators.map((r, i) => (
                <div key={i} className="border border-border/40 rounded-md p-2 text-xs">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-[10px] text-muted-foreground">{r.reason}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main chart */}
      <Card>
        <CardHeader className="py-2 flex flex-row items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-2">
            <LineIcon className="w-3.5 h-3.5" /> {symbol} · {candles.length} bars
          </CardTitle>
          <div className="flex items-center gap-2 text-xs">
            {lastCandle && <span className="font-mono">Last: <span className="font-semibold">{fmtPrice(lastCandle.close, decimals)}</span></span>}
            <Badge variant="outline" className="text-[9px]">{activeIndicators.filter((a: ActiveIndicator) => a.enabled).length} indicators active</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={indicatorData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="timeStr" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(indicatorData.length / 8)} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={55} orientation="right" />
                <Tooltip content={<CandleTooltip decimals={decimals} />} />
                {/* Candle wicks */}
                <Bar dataKey="range" fill="transparent" stroke="#666" strokeWidth={0.5}>
                  {indicatorData.map((d: any, i: number) => <Cell key={i} stroke={d.isUp ? "#10b981" : "#ef4444"} />)}
                </Bar>
                {/* Candle bodies */}
                <Bar dataKey="bodyRange" strokeWidth={0}>
                  {indicatorData.map((d: any, i: number) => <Cell key={i} fill={d.isUp ? "#10b981" : "#ef4444"} />)}
                </Bar>
                {/* Overlay indicator lines */}
                {overlayUids.map((ai: ActiveIndicator) => {
                  const def = getIndicator(ai.indicatorId);
                  if (!def) return null;
                  const series = def.compute(candles, ai.params).series;
                  return series.map((s, si) => (
                    <Line
                      key={`${ai.uid}_${si}`}
                      type="monotone"
                      dataKey={`${ai.uid}_${s.name}`}
                      stroke={s.color}
                      strokeWidth={1.5}
                      dot={false}
                      connectNulls
                      name={s.name}
                    />
                  ));
                })}
                {lastCandle && <ReferenceLine y={lastCandle.close} stroke="#fbbf24" strokeDasharray="4 4" strokeWidth={1} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Volume subchart */}
          <div className="h-[60px] mt-1 border-t border-border/40 pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={indicatorData} margin={{ top: 0, right: 5, left: 0, bottom: 0 }}>
                <XAxis dataKey="timeStr" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(indicatorData.length / 6)} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={55} orientation="right" />
                <Bar dataKey="volume" radius={[2, 2, 0, 0]}>
                  {indicatorData.map((d: any, i: number) => <Cell key={i} fill={d.isUp ? "#10b98155" : "#ef444455"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Oscillator subcharts */}
          {oscillatorUids.map((ai: ActiveIndicator) => {
            const def = getIndicator(ai.indicatorId);
            if (!def) return null;
            const series = def.compute(candles, ai.params).series;
            return (
              <div key={ai.uid} className="h-[100px] mt-1 border-t border-border/40 pt-1">
                <div className="text-[10px] text-muted-foreground mb-0.5 flex items-center justify-between">
                  <span>{def.name} {ai.enabled ? "" : "(disabled)"}</span>
                  <span className="font-mono">{series.map((s) => {
                    const v = s.values[s.values.length - 1];
                    return `${s.name}: ${v != null ? v.toFixed(2) : "—"}`;
                  }).join(" · ")}</span>
                </div>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={indicatorData} margin={{ top: 0, right: 5, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                    <XAxis dataKey="timeStr" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(indicatorData.length / 6)} />
                    <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={55} orientation="right" domain={["auto", "auto"]} />
                    <Tooltip
                      formatter={(v: any, name: string) => [Number(v).toFixed(4), name]}
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                    />
                    {ai.indicatorId === "rsi" && <>
                      <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="2 2" strokeOpacity={0.4} />
                      <ReferenceLine y={30} stroke="#10b981" strokeDasharray="2 2" strokeOpacity={0.4} />
                    </>}
                    {series.map((s, si) => (
                      <Line key={si} type="monotone" dataKey={`${ai.uid}_${s.name}`} stroke={s.color} strokeWidth={1.5} dot={false} connectNulls name={s.name} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Active indicators list */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Active Indicators ({activeIndicators.length})</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap gap-1.5">
            {activeIndicators.map((ai: ActiveIndicator) => {
              const def = getIndicator(ai.indicatorId);
              return (
                <Badge key={ai.uid} variant="outline" className={cn("text-[10px]", !ai.enabled && "opacity-50")}>
                  <span className="w-2 h-2 rounded-full inline-block mr-1" style={{ background: ai.color }} />
                  {def?.name.split("(")[0].trim()}{Object.keys(ai.params).length > 0 ? ` (${Object.values(ai.params).join(",")})` : ""}
                </Badge>
              );
            })}
            {activeIndicators.length === 0 && <span className="text-xs text-muted-foreground">No indicators active. Add from the Indicator Library tab.</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CandleTooltip({ active, payload, decimals }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-card border border-border rounded-md p-2 text-xs shadow-lg">
      <div className="font-mono text-muted-foreground mb-1">{d.timeStr}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
        <span className="text-muted-foreground">O:</span><span>{fmtPrice(d.open, decimals)}</span>
        <span className="text-muted-foreground">H:</span><span className="text-emerald-400">{fmtPrice(d.high, decimals)}</span>
        <span className="text-muted-foreground">L:</span><span className="text-rose-400">{fmtPrice(d.low, decimals)}</span>
        <span className="text-muted-foreground">C:</span><span className={d.isUp ? "text-emerald-400" : "text-rose-400"}>{fmtPrice(d.close, decimals)}</span>
        <span className="text-muted-foreground">Vol:</span><span>{d.volume?.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ============================================================
// LIBRARY TAB
// ============================================================
function LibraryTab({ candles, activeIndicators, setActiveIndicators }: any) {
  const [filter, setFilter] = useState<IndicatorCategory | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const filtered = INDICATOR_REGISTRY.filter((ind) => filter === "ALL" || ind.category === filter)
    .filter((ind) => ind.name.toLowerCase().includes(search.toLowerCase()) || ind.description.toLowerCase().includes(search.toLowerCase()));

  const addIndicator = (indicatorId: string) => {
    const def = getIndicator(indicatorId);
    if (!def) return;
    const defaultParams: Record<string, number> = {};
    for (const p of def.params) defaultParams[p.key] = p.default;
    const colors = ["#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#84cc16", "#f43f5e", "#fbbf24", "#8b5cf6"];
    setActiveIndicators([...activeIndicators, {
      uid: makeUid(),
      indicatorId,
      params: defaultParams,
      enabled: true,
      color: colors[activeIndicators.length % colors.length],
    }]);
  };

  const removeIndicator = (uid: string) => setActiveIndicators(activeIndicators.filter((ai: ActiveIndicator) => ai.uid !== uid));
  const toggleIndicator = (uid: string) => setActiveIndicators(activeIndicators.map((ai: ActiveIndicator) => ai.uid === uid ? { ...ai, enabled: !ai.enabled } : ai));
  const updateParam = (uid: string, key: string, value: number) => setActiveIndicators(activeIndicators.map((ai: ActiveIndicator) => ai.uid === uid ? { ...ai, params: { ...ai.params, [key]: value } } : ai));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
          <button onClick={() => setFilter("ALL")} className={cn("px-2.5 py-1 text-xs rounded", filter === "ALL" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>All</button>
          {INDICATOR_CATEGORIES.map((c) => (
            <button key={c.value} onClick={() => setFilter(c.value)} className={cn("px-2.5 py-1 text-xs rounded", filter === c.value ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{c.label}</button>
          ))}
        </div>
        <Input placeholder="Search indicators..." value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 text-xs max-w-xs flex-1" />
        <span className="text-xs text-muted-foreground">{filtered.length} indicators</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Indicator library */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Indicator Library ({filtered.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 max-h-[600px] overflow-y-auto pt-0">
            {filtered.map((ind) => {
              const isActive = activeIndicators.some((ai: ActiveIndicator) => ai.indicatorId === ind.id);
              return (
                <div key={ind.id} className={cn("border rounded-md p-2.5", isActive ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{ind.name}</span>
                        <Badge variant="outline" className="text-[9px] h-4 px-1">{ind.category}</Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">{ind.description}</p>
                      {/* Current values */}
                      <div className="flex flex-wrap gap-2 mt-1.5">
                        {ind.currentValue(candles, ind.params.reduce((acc, p) => ({ ...acc, [p.key]: p.default }), {})).map((cv, i) => (
                          <span key={i} className="text-[10px] font-mono bg-muted/50 rounded px-1.5 py-0.5">
                            {cv.name}: <span className="text-foreground">{cv.value != null ? cv.value.toFixed(2) : "—"}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button size="sm" variant={isActive ? "outline" : "default"} className="h-7 text-xs shrink-0" onClick={() => addIndicator(ind.id)}>
                      <Plus className="w-3 h-3 mr-0.5" /> {isActive ? "Add Another" : "Add"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Active indicators with params */}
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Active Indicators ({activeIndicators.length}) — Click to customize</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-[600px] overflow-y-auto pt-0">
            {activeIndicators.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">No active indicators. Add from the library.</div>
            ) : (
              activeIndicators.map((ai: ActiveIndicator) => {
                const def = getIndicator(ai.indicatorId);
                if (!def) return null;
                return (
                  <div key={ai.uid} className="border border-border rounded-md p-2.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full" style={{ background: ai.color }} />
                        <span className="text-xs font-semibold">{def.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Switch checked={ai.enabled} onCheckedChange={() => toggleIndicator(ai.uid)} />
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400" onClick={() => removeIndicator(ai.uid)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    {def.params.length > 0 && (
                      <div className="grid grid-cols-2 gap-2">
                        {def.params.map((p) => (
                          <div key={p.key}>
                            <Label className="text-[10px] text-muted-foreground">{p.label}</Label>
                            <Input
                              type="number"
                              value={ai.params[p.key] ?? p.default}
                              min={p.min}
                              max={p.max}
                              step={p.step}
                              onChange={(e) => updateParam(ai.uid, p.key, Number(e.target.value))}
                              className="h-7 text-xs font-mono mt-0.5"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Current values */}
                    <div className="flex flex-wrap gap-1.5">
                      {def.currentValue(candles, ai.params).map((cv, i) => (
                        <span key={i} className="text-[10px] font-mono bg-muted/50 rounded px-1.5 py-0.5">
                          {cv.name}: <span className="text-foreground">{cv.value != null ? cv.value.toFixed(2) : "—"}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// SIGNALS TAB
// ============================================================
function SignalsTab({ candles, signalRules, setSignalRules, signalLog, setSignalLog, symbol, decimals }: any) {
  const INDICATORS_FOR_CONDITIONS = ["RSI", "SMA", "EMA", "MACD", "ATR", "CCI", "Stochastic", "WilliamsR", "MFI", "Bollinger", "SuperTrend", "ADX"];
  const OPERATORS = [
    { value: "ABOVE", label: "Above" },
    { value: "BELOW", label: "Below" },
    { value: "CROSS_ABOVE", label: "Crosses Above" },
    { value: "CROSS_BELOW", label: "Crosses Below" },
    { value: "BETWEEN", label: "Between" },
  ];
  const [showCreate, setShowCreate] = useState(false);
  const [newRuleName, setNewRuleName] = useState("My Signal Rule");
  const [newLogic, setNewLogic] = useState<"AND" | "OR">("AND");
  const [conditions, setConditions] = useState<IndicatorCondition[]>([]);

  const addCondition = () => {
    setConditions([...conditions, {
      id: `cond-${Date.now()}`,
      indicator: "RSI",
      params: { period: 14 },
      operator: "BELOW",
      value: 30,
      weight: 1,
    }]);
  };
  const removeCondition = (id: string) => setConditions(conditions.filter((c) => c.id !== id));
  const updateCondition = (id: string, updates: Partial<IndicatorCondition>) =>
    setConditions(conditions.map((c) => c.id === id ? { ...c, ...updates } : c));

  const createRule = () => {
    const rule: SignalRule = {
      id: `rule-${Date.now()}`,
      name: newRuleName,
      conditions,
      logic: newLogic,
      enabled: true,
    };
    setSignalRules([...signalRules, rule]);
    setConditions([]);
    setShowCreate(false);
    setNewRuleName(`Rule ${signalRules.length + 1}`);
  };

  // Evaluate all rules against current candles
  const evaluations = useMemo(() => signalRules.map((rule: SignalRule) => evaluateRule(rule, candles)), [signalRules, candles]);

  // Log fired signals
  useEffect(() => {
    for (const ev of evaluations) {
      if (ev.fired) {
        const existing = signalLog.find((e) => e.ruleName === ev.rule.name && e.timestamp > Date.now() - 60000);
        if (!existing) {
          const entry: SignalLogEntry = {
            id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
            symbol,
            ruleName: ev.rule.name,
            conditions: ev.rule.conditions.map((c) => `${c.indicator} ${c.operator} ${c.value}`).join(" " + ev.rule.logic + " "),
            fired: true,
            strength: ev.strength,
            priceAtSignal: candles[candles.length - 1]?.close ?? 0,
            evaluated: false,
          };
          setSignalLog((prev: SignalLogEntry[]) => [entry, ...prev].slice(0, 500));
        }
      }
    }
  }, [evaluations]);

  const firedCount = evaluations.filter((e: any) => e.fired).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="w-3 h-3 mr-1" /> New Signal Rule
        </Button>
        <Badge variant="outline" className="text-xs">{signalRules.length} rules</Badge>
        <Badge variant="outline" className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/30">{firedCount} firing now</Badge>
        <Badge variant="outline" className="text-xs">{signalLog.length} logged</Badge>
      </div>

      {showCreate && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Create Signal Rule</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Rule Name</Label>
                <Input value={newRuleName} onChange={(e) => setNewRuleName(e.target.value)} className="h-8 text-xs mt-0.5" />
              </div>
              <div>
                <Label className="text-xs">Logic</Label>
                <div className="grid grid-cols-2 gap-1 mt-0.5">
                  <Button size="sm" variant={newLogic === "AND" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setNewLogic("AND")}>AND (all)</Button>
                  <Button size="sm" variant={newLogic === "OR" ? "default" : "outline"} className="h-8 text-xs" onClick={() => setNewLogic("OR")}>OR (any)</Button>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Conditions</Label>
                <Button size="sm" variant="outline" className="h-6 text-xs" onClick={addCondition}><Plus className="w-3 h-3 mr-1" /> Add Condition</Button>
              </div>
              {conditions.map((c) => (
                <div key={c.id} className="grid grid-cols-12 gap-1.5 items-end border border-border/40 rounded p-2">
                  <div className="col-span-3">
                    <Label className="text-[10px] text-muted-foreground">Indicator</Label>
                    <select value={c.indicator} onChange={(e) => updateCondition(c.id, { indicator: e.target.value })} className="w-full bg-muted/50 border border-border rounded px-1.5 py-1 text-[10px] mt-0.5">
                      {INDICATORS_FOR_CONDITIONS.map((i) => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <Label className="text-[10px] text-muted-foreground">Operator</Label>
                    <select value={c.operator} onChange={(e) => updateCondition(c.id, { operator: e.target.value as any })} className="w-full bg-muted/50 border border-border rounded px-1.5 py-1 text-[10px] mt-0.5">
                      {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <Label className="text-[10px] text-muted-foreground">Value</Label>
                    <Input type="number" value={c.value} onChange={(e) => updateCondition(c.id, { value: Number(e.target.value) })} className="h-7 text-[10px] font-mono mt-0.5" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] text-muted-foreground">Weight</Label>
                    <Input type="number" value={c.weight} onChange={(e) => updateCondition(c.id, { weight: Number(e.target.value) })} className="h-7 text-[10px] font-mono mt-0.5" />
                  </div>
                  <div className="col-span-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-400" onClick={() => removeCondition(c.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
              {conditions.length === 0 && <div className="text-center text-xs text-muted-foreground py-3">No conditions yet. Add at least one.</div>}
            </div>
            <Button onClick={createRule} disabled={conditions.length === 0} className="w-full">
              <Save className="w-3 h-3 mr-1" /> Create Rule
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Active rules + evaluations */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Signal Rules & Live Evaluation</CardTitle></CardHeader>
        <CardContent className="space-y-2 pt-0">
          {signalRules.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">No rules created. Click "New Signal Rule" to start.</div>
          ) : (
            evaluations.map((ev: any) => (
              <div key={ev.rule.id} className={cn("border rounded-md p-2.5", ev.fired ? "border-emerald-500/40 bg-emerald-500/5" : "border-border")}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{ev.rule.name}</span>
                    <Badge variant="outline" className="text-[9px]">{ev.rule.logic}</Badge>
                    {ev.fired && <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">FIRING</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-[10px] text-muted-foreground">Strength: <span className="font-mono text-foreground">{ev.strength.toFixed(0)}%</span></div>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400" onClick={() => setSignalRules(signalRules.filter((r: SignalRule) => r.id !== ev.rule.id))}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                <div className="mt-1.5 space-y-0.5">
                  {ev.contributingConditions.map((cc: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className={cn("w-2 h-2 rounded-full", cc.met ? "bg-emerald-500" : "bg-muted-foreground/30")} />
                      <span className="text-muted-foreground">{cc.condition.indicator} {cc.condition.operator} {cc.condition.value}</span>
                      <span className={cn(cc.met ? "text-emerald-400" : "text-muted-foreground")}>
                        → {cc.currentValue != null ? cc.currentValue.toFixed(2) : "—"} {cc.met ? "✓" : "✗"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Signal log preview */}
      {signalLog.length > 0 && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Recent Signal Log (last 20)</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-y border-border sticky top-0">
                  <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                    <th className="text-left py-1.5 px-2">Time</th>
                    <th className="text-left py-1.5 px-2">Rule</th>
                    <th className="text-left py-1.5 px-2">Symbol</th>
                    <th className="text-right py-1.5 px-2">Price</th>
                    <th className="text-right py-1.5 px-2">Strength</th>
                    <th className="text-center py-1.5 px-2">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {signalLog.slice(0, 20).map((e: SignalLogEntry) => (
                    <tr key={e.id} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="py-1 px-2 text-[10px] font-mono text-muted-foreground">{fmtTime(e.timestamp)}</td>
                      <td className="py-1 px-2">{e.ruleName}</td>
                      <td className="py-1 px-2 font-mono">{e.symbol}</td>
                      <td className="py-1 px-2 text-right font-mono">{fmtPrice(e.priceAtSignal, decimals)}</td>
                      <td className="py-1 px-2 text-right font-mono">{e.strength.toFixed(0)}%</td>
                      <td className="py-1 px-2 text-center">
                        {e.evaluated ? (
                          <Badge variant="outline" className={cn("text-[9px]", e.outcome === "WIN" ? "bg-emerald-500/15 text-emerald-400" : e.outcome === "LOSS" ? "bg-rose-500/15 text-rose-400" : "bg-muted text-muted-foreground")}>
                            {e.outcome} {e.outcomePct != null ? `${e.outcomePct > 0 ? "+" : ""}${e.outcomePct.toFixed(2)}%` : ""}
                          </Badge>
                        ) : <span className="text-[10px] text-muted-foreground">pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// PROMPT TAB
// ============================================================
function PromptTab({ candles, symbol, decimals }: any) {
  const [prompt, setPrompt] = useState("Find oversold setup: RSI below 30, MACD bullish, price above EMA 50, ADX above 25 (strong trend)");
  const [parsed, setParsed] = useState<any>(null);
  const [history, setHistory] = useState<{ prompt: string; parsed: any; timestamp: number }[]>([]);

  const handleParse = () => {
    const result = parsePrompt(prompt);
    setParsed(result);
    setHistory([{ prompt, parsed: result, timestamp: Date.now() }, ...history].slice(0, 20));
  };

  // If parsed has conditions, create a rule and evaluate
  const evaluation = useMemo(() => {
    if (!parsed || !parsed.understood) return null;
    const rule: SignalRule = {
      id: "prompt-rule",
      name: "Prompt Signal",
      conditions: parsed.conditions,
      logic: parsed.logic,
      enabled: true,
    };
    return evaluateRule(rule, candles);
  }, [parsed, candles]);

  const examplePrompts = [
    "Find oversold ES with RSI below 30 and MACD bullish crossover",
    "Show overbought signals when Stochastic above 80",
    "Bullish setup: price above SMA 50, ADX above 25",
    "Bearish divergence: RSI above 70, MACD negative",
    "Strong trend: ADX above 30, high volatility",
  ];

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2"><Brain className="w-4 h-4" /> Natural Language Prompt Executor</CardTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">Type a trading signal description in plain English. The parser extracts indicator conditions and evaluates them in real-time.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Your Prompt</Label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full mt-1 bg-muted/50 border border-border rounded-md p-2 text-xs h-20 resize-none"
              placeholder="e.g. Find oversold setup with RSI below 30 and MACD bullish"
            />
          </div>
          <Button onClick={handleParse} className="w-full">
            <Zap className="w-3 h-3 mr-1" /> Parse & Evaluate
          </Button>
          <div>
            <Label className="text-[10px] text-muted-foreground">Example Prompts (click to use):</Label>
            <div className="flex flex-wrap gap-1 mt-1">
              {examplePrompts.map((p, i) => (
                <button key={i} onClick={() => setPrompt(p)} className="text-[10px] px-2 py-1 border border-border rounded hover:bg-muted/40 text-muted-foreground text-left">
                  {p}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {parsed && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-amber-400" /> Parsed Result
              {parsed.understood ? (
                <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Understood</Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] bg-rose-500/15 text-rose-400 border-rose-500/30">Not Understood</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">Original: "{parsed.description}"</p>
            <p className="text-xs">Logic: <span className="font-mono font-medium">{parsed.logic}</span></p>
            {parsed.conditions.length > 0 ? (
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground uppercase">Extracted Conditions</div>
                {parsed.conditions.map((c: IndicatorCondition, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs border border-border/40 rounded p-1.5">
                    <Badge variant="outline" className="text-[9px]">{c.indicator}</Badge>
                    <span className="font-mono">{c.operator.replace(/_/g, " ")} {c.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-rose-400">No conditions extracted. Try using keywords like "RSI below 30", "oversold", "MACD bullish", "ADX above 25".</p>
            )}
          </CardContent>
        </Card>
      )}

      {evaluation && (
        <Card className={cn("border", evaluation.fired ? "border-emerald-500/40 bg-emerald-500/5" : "border-border")}>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              {evaluation.fired ? <Flame className="w-4 h-4 text-emerald-400" /> : <Target className="w-4 h-4 text-muted-foreground" />}
              Live Evaluation — {evaluation.fired ? "SIGNAL FIRING" : "Not Firing"}
              {evaluation.fired && <Badge variant="outline" className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Strength {evaluation.strength.toFixed(0)}%</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {evaluation.contributingConditions.map((cc: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs border border-border/40 rounded p-1.5">
                <span className={cn("w-2 h-2 rounded-full", cc.met ? "bg-emerald-500" : "bg-muted-foreground/30")} />
                <span className="font-medium">{cc.condition.indicator}</span>
                <span className="text-muted-foreground">{cc.condition.operator.replace(/_/g, " ")} {cc.condition.value}</span>
                <span className="ml-auto font-mono">Current: {cc.currentValue != null ? cc.currentValue.toFixed(2) : "—"}</span>
                <span className={cn("font-bold", cc.met ? "text-emerald-400" : "text-muted-foreground")}>{cc.met ? "✓ MET" : "✗ NOT MET"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm">Prompt History</CardTitle></CardHeader>
          <CardContent className="space-y-1 pt-0">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-xs border-b border-border/30 py-1">
                <span className="text-[10px] text-muted-foreground font-mono">{fmtTime(h.timestamp)}</span>
                <span className="flex-1 truncate">{h.prompt}</span>
                {h.parsed.understood ? <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-400">{h.parsed.conditions.length} conditions</Badge> : <Badge variant="outline" className="text-[9px] bg-rose-500/15 text-rose-400">failed</Badge>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// PATTERNS TAB
// ============================================================
function PatternsTab({ candles, decimals }: any) {
  const chartPatterns = useMemo(() => detectChartPatterns(candles), [candles]);
  const candlePatterns = useMemo(() => detectCandlePatterns(candles), [candles]);
  const recentCandlePatterns = candlePatterns.slice(-15).reverse();

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4" /> Chart Pattern Recognition</CardTitle></CardHeader>
        <CardContent className="space-y-2 pt-0">
          {chartPatterns.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">No chart patterns detected in current data.</div>
          ) : (
            chartPatterns.map((p, i) => (
              <div key={i} className={cn("border rounded-md p-2.5", p.type === "BULLISH" ? "border-emerald-500/30 bg-emerald-500/5" : p.type === "BEARISH" ? "border-rose-500/30 bg-rose-500/5" : "border-border")}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {p.type === "BULLISH" ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : p.type === "BEARISH" ? <TrendingDown className="w-4 h-4 text-rose-400" /> : <Activity className="w-4 h-4 text-muted-foreground" />}
                    <span className="text-xs font-semibold">{p.name}</span>
                    <Badge variant="outline" className={cn("text-[9px]", p.type === "BULLISH" ? "bg-emerald-500/15 text-emerald-400" : p.type === "BEARISH" ? "bg-rose-500/15 text-rose-400" : "")}>{p.type}</Badge>
                  </div>
                  <div className="text-[10px] text-muted-foreground">Confidence: <span className="font-mono text-foreground">{p.confidence.toFixed(0)}%</span></div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">{p.description}</p>
                <div className="flex gap-3 mt-1.5 text-[10px] font-mono">
                  {p.targetPrice && <span>Target: <span className="text-foreground">{fmtPrice(p.targetPrice, decimals)}</span></span>}
                  {p.stopPrice && <span>Stop: <span className="text-rose-400">{fmtPrice(p.stopPrice, decimals)}</span></span>}
                  <span>Bars: {p.startIndex}-{p.endIndex}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Flame className="w-4 h-4" /> Candlestick Patterns (last 15 bars)</CardTitle></CardHeader>
        <CardContent className="p-0">
          {recentCandlePatterns.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">No candlestick patterns detected.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-3">Bar</th>
                  <th className="text-left py-2 px-3">Pattern</th>
                  <th className="text-center py-2 px-3">Type</th>
                  <th className="text-right py-2 px-3">Strength</th>
                </tr>
              </thead>
              <tbody>
                {recentCandlePatterns.map((p, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-1.5 px-3 font-mono text-[10px]">{p.index}</td>
                    <td className="py-1.5 px-3 font-medium">{p.name}</td>
                    <td className="py-1.5 px-3 text-center">
                      <Badge variant="outline" className={cn("text-[9px]", p.type === "BULLISH" ? "bg-emerald-500/15 text-emerald-400" : p.type === "BEARISH" ? "bg-rose-500/15 text-rose-400" : "bg-muted")}>{p.type}</Badge>
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono">{p.strength}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// PREDICTION TAB
// ============================================================
function PredictionTab({ candles, decimals }: any) {
  const [lookforward, setLookforward] = useState(5);
  const prediction = useMemo(() => predictCandles(candles, lookforward), [candles, lookforward]);
  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  // Build chart data: last 50 historical + predicted
  const chartData = useMemo(() => {
    const hist = candles.slice(-50).map((c: any) => ({
      time: fmtTime(c.time),
      type: "historical",
      close: c.close,
      high: c.high,
      low: c.low,
    }));
    const pred = prediction.candles.map((c, i) => ({
      time: `+${i + 1}`,
      type: "predicted",
      close: c.close,
      high: c.high,
      low: c.low,
      predHigh: c.high,
      predLow: c.low,
    }));
    // Add a connecting point
    if (hist.length > 0 && pred.length > 0) {
      pred[0].close = hist[hist.length - 1].close;
    }
    return [...hist, ...pred];
  }, [candles, prediction]);

  return (
    <div className="space-y-3">
      <Card className={cn("border", prediction.expectedMovePct > 0 ? "border-emerald-500/30 bg-emerald-500/5" : prediction.expectedMovePct < 0 ? "border-rose-500/30 bg-rose-500/5" : "border-border")}>
        <CardContent className="p-3 flex items-center gap-3">
          {prediction.expectedMovePct > 0 ? <TrendingUp className="w-5 h-5 text-emerald-500" /> : prediction.expectedMovePct < 0 ? <TrendingDown className="w-5 h-5 text-rose-500" /> : <Activity className="w-5 h-5 text-muted-foreground" />}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Predicted Move: {fmtPct(prediction.expectedMovePct)}</span>
              <Badge variant="outline" className="text-[9px]">Confidence {prediction.confidence.toFixed(0)}%</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">{prediction.method}</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground">Predicted Price ({lookforward} bars ahead)</div>
            <div className="text-lg font-mono font-bold">{prediction.candles.length > 0 ? fmtPrice(prediction.candles[prediction.candles.length - 1].close, decimals) : "—"}</div>
          </div>
        </CardContent>
      </Card>

      {/* Probability bars */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 border-emerald-500/30 bg-emerald-500/5">
          <div className="text-[10px] text-muted-foreground uppercase">Bullish</div>
          <div className="text-lg font-mono font-semibold text-emerald-400">{(prediction.bullProb * 100).toFixed(1)}%</div>
          <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${prediction.bullProb * 100}%` }} /></div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Neutral</div>
          <div className="text-lg font-mono font-semibold">{(prediction.neutralProb * 100).toFixed(1)}%</div>
          <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden"><div className="h-full bg-muted-foreground" style={{ width: `${prediction.neutralProb * 100}%` }} /></div>
        </Card>
        <Card className="p-3 border-rose-500/30 bg-rose-500/5">
          <div className="text-[10px] text-muted-foreground uppercase">Bearish</div>
          <div className="text-lg font-mono font-semibold text-rose-400">{(prediction.bearProb * 100).toFixed(1)}%</div>
          <div className="h-1.5 bg-muted rounded-full mt-1 overflow-hidden"><div className="h-full bg-rose-500" style={{ width: `${prediction.bearProb * 100}%` }} /></div>
        </Card>
      </div>

      {/* Controls */}
      <Card>
        <CardContent className="p-3 flex items-center gap-3">
          <Label className="text-xs">Prediction Horizon:</Label>
          <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
            {[1, 3, 5, 10, 15].map((n) => (
              <button key={n} onClick={() => setLookforward(n)} className={cn("px-2.5 py-1 text-xs rounded", lookforward === n ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{n} bars</button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">Current: {fmtPrice(lastPrice, decimals)} → Predicted: {prediction.candles.length > 0 ? fmtPrice(prediction.candles[prediction.candles.length - 1].close, decimals) : "—"}</span>
        </CardContent>
      </Card>

      {/* Prediction chart */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Prediction Visualization (historical + forecast)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={5} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={60} orientation="right" />
                <Tooltip
                  formatter={(v: any, name: string) => [fmtPrice(Number(v), decimals), name === "close" ? "Close" : name]}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                />
                <ReferenceLine x={chartData[chartData.length - lookforward - 1]?.time} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.6} label={{ value: "Forecast →", fontSize: 9, fill: "#fbbf24", position: "top" }} />
                <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls name="Close" />
                {prediction.candles.length > 0 && (
                  <>
                    <Line type="monotone" dataKey="predHigh" stroke="#10b981" strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls name="Pred High" />
                    <Line type="monotone" dataKey="predLow" stroke="#ef4444" strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls name="Pred Low" />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10px] text-muted-foreground mt-2">
            Blue line = close price (historical solid, predicted dashed). Green dashed = predicted high. Red dashed = predicted low. Yellow line marks forecast boundary.
            Method: Markov chain transition matrix on return states + indicator bias (RSI/MACD/EMA) + ATR-based range + mean reversion adjustment.
          </div>
        </CardContent>
      </Card>

      {/* Predicted candle details */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Predicted Candle Details</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border">
              <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                <th className="text-left py-2 px-3">Bar</th>
                <th className="text-right py-2 px-3">Open</th>
                <th className="text-right py-2 px-3">High</th>
                <th className="text-right py-2 px-3">Low</th>
                <th className="text-right py-2 px-3">Close</th>
                <th className="text-right py-2 px-3">Δ from current</th>
                <th className="text-right py-2 px-3">Volume</th>
              </tr>
            </thead>
            <tbody>
              {prediction.candles.map((c, i) => (
                <tr key={i} className="border-b border-border/40">
                  <td className="py-1.5 px-3 font-mono">+{i + 1}</td>
                  <td className="py-1.5 px-3 text-right font-mono">{fmtPrice(c.open, decimals)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-emerald-400">{fmtPrice(c.high, decimals)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-rose-400">{fmtPrice(c.low, decimals)}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono font-semibold", c.close >= lastPrice ? "text-emerald-400" : "text-rose-400")}>{fmtPrice(c.close, decimals)}</td>
                  <td className={cn("py-1.5 px-3 text-right font-mono", c.close >= lastPrice ? "text-emerald-400" : "text-rose-400")}>{fmtPct(((c.close - lastPrice) / lastPrice) * 100)}</td>
                  <td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{c.volume}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// LEARNING TAB
// ============================================================
function LearningTab({ signalLog, setSignalLog, candles }: any) {
  // Evaluate outcomes
  const evaluatedLog = useMemo(() => evaluateSignalOutcomes(signalLog, candles, 5), [signalLog, candles]);
  const stats = useMemo(() => computeLearningStats(evaluatedLog), [evaluatedLog]);
  // Update signal log with evaluated entries periodically
  useEffect(() => {
    if (evaluatedLog.some((e: SignalLogEntry) => e.evaluated && !signalLog.find((s: SignalLogEntry) => s.id === e.id)?.evaluated)) {
      setSignalLog(evaluatedLog);
    }
  }, [evaluatedLog]);

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Total Signals</div><div className="text-lg font-mono font-semibold">{stats.totalSignals}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Evaluated</div><div className="text-lg font-mono font-semibold">{stats.evaluatedSignals}</div></Card>
        <Card className={cn("p-3", stats.winRate >= 60 ? "border-emerald-500/30 bg-emerald-500/5" : stats.winRate < 40 ? "border-rose-500/30 bg-rose-500/5" : "")}>
          <div className="text-[10px] text-muted-foreground uppercase">Win Rate</div>
          <div className={cn("text-lg font-mono font-semibold", stats.winRate >= 60 ? "text-emerald-400" : stats.winRate < 40 ? "text-rose-400" : "")}>{stats.winRate.toFixed(1)}%</div>
        </Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Avg Win</div><div className="text-lg font-mono font-semibold text-emerald-400">{stats.avgWinPct.toFixed(2)}%</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Avg Loss</div><div className="text-lg font-mono font-semibold text-rose-400">{stats.avgLossPct.toFixed(2)}%</div></Card>
      </div>

      {/* Insights */}
      {stats.insights.length > 0 && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-400" /> AI Insights & Learnings</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 pt-0">
            {stats.insights.map((insight, i) => (
              <div key={i} className="flex items-start gap-2 text-xs p-2 border border-border/40 rounded-md bg-muted/30">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                <span>{insight}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Per-rule breakdown */}
      {stats.perRule.length > 0 && (
        <Card>
          <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Cpu className="w-4 h-4" /> Per-Rule Performance</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-3">Rule Name</th>
                  <th className="text-right py-2 px-3">Signals</th>
                  <th className="text-right py-2 px-3">Wins</th>
                  <th className="text-right py-2 px-3">Losses</th>
                  <th className="text-right py-2 px-3">Win Rate</th>
                  <th className="text-right py-2 px-3">Avg Return</th>
                  <th className="text-right py-2 px-3">Performance</th>
                </tr>
              </thead>
              <tbody>
                {stats.perRule.map((r, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-1.5 px-3 font-medium">{r.ruleName}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{r.signals}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-emerald-400">{r.wins}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-rose-400">{r.losses}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono font-semibold", r.winRate >= 60 ? "text-emerald-400" : r.winRate < 40 ? "text-rose-400" : "")}>{r.winRate.toFixed(1)}%</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", r.avgReturn >= 0 ? "text-emerald-400" : "text-rose-400")}>{r.avgReturn >= 0 ? "+" : ""}{r.avgReturn.toFixed(3)}%</td>
                    <td className="py-1.5 px-3 text-right">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden ml-auto">
                        <div className={cn("h-full", r.winRate >= 60 ? "bg-emerald-500" : r.winRate < 40 ? "bg-rose-500" : "bg-amber-500")} style={{ width: `${r.winRate}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Full signal log */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Complete Signal Log</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-2">Time</th>
                  <th className="text-left py-2 px-2">Symbol</th>
                  <th className="text-left py-2 px-2">Rule</th>
                  <th className="text-left py-2 px-2">Conditions</th>
                  <th className="text-right py-2 px-2">Price</th>
                  <th className="text-right py-2 px-2">Strength</th>
                  <th className="text-center py-2 px-2">Outcome</th>
                  <th className="text-right py-2 px-2">Return</th>
                </tr>
              </thead>
              <tbody>
                {evaluatedLog.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No signals logged yet. Create signal rules in the Signal Builder tab to start logging.</td></tr>
                ) : (
                  evaluatedLog.map((e: SignalLogEntry) => (
                    <tr key={e.id} className="border-b border-border/40 hover:bg-muted/30">
                      <td className="py-1 px-2 text-[10px] font-mono text-muted-foreground">{fmtTime(e.timestamp)}</td>
                      <td className="py-1 px-2 font-mono">{e.symbol}</td>
                      <td className="py-1 px-2">{e.ruleName}</td>
                      <td className="py-1 px-2 text-[10px] text-muted-foreground truncate max-w-[200px]">{e.conditions}</td>
                      <td className="py-1 px-2 text-right font-mono">{fmtPrice(e.priceAtSignal, 2)}</td>
                      <td className="py-1 px-2 text-right font-mono">{e.strength.toFixed(0)}%</td>
                      <td className="py-1 px-2 text-center">
                        {e.evaluated ? (
                          <Badge variant="outline" className={cn("text-[9px]", e.outcome === "WIN" ? "bg-emerald-500/15 text-emerald-400" : e.outcome === "LOSS" ? "bg-rose-500/15 text-rose-400" : "bg-muted text-muted-foreground")}>{e.outcome}</Badge>
                        ) : <span className="text-[10px] text-muted-foreground">pending</span>}
                      </td>
                      <td className={cn("py-1 px-2 text-right font-mono", (e.outcomePct ?? 0) > 0 ? "text-emerald-400" : (e.outcomePct ?? 0) < 0 ? "text-rose-400" : "text-muted-foreground")}>
                        {e.evaluated ? `${(e.outcomePct ?? 0) > 0 ? "+" : ""}${(e.outcomePct ?? 0).toFixed(3)}%` : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// PRESETS TAB
// ============================================================
function PresetsTab({ presets, setPresets, activeIndicators, setActiveIndicators, timeframe, setTimeframe }: any) {
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const applyPreset = (preset: IndicatorPreset) => {
    const newActive = preset.indicators.map((p) => {
      const def = getIndicator(p.id);
      const colors = ["#3b82f6", "#10b981", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#84cc16", "#f43f5e"];
      return {
        uid: makeUid(),
        indicatorId: p.id,
        params: p.params,
        enabled: p.enabled,
        color: colors[Math.floor(Math.random() * colors.length)],
      };
    });
    setActiveIndicators(newActive);
    setTimeframe(preset.timeframe as Timeframe);
  };

  const saveCurrentAsPreset = () => {
    if (!newName.trim()) return;
    const preset: IndicatorPreset = {
      id: makePresetId(),
      name: newName,
      description: newDesc || `${activeIndicators.length} indicators on ${timeframe}`,
      createdAt: Date.now(),
      timeframe,
      indicators: activeIndicators.map((ai: ActiveIndicator) => ({
        id: ai.indicatorId,
        params: ai.params,
        enabled: ai.enabled,
      })),
    };
    setPresets([preset, ...presets]);
    setNewName("");
    setNewDesc("");
  };

  const deletePreset = (id: string) => setPresets(presets.filter((p: IndicatorPreset) => p.id !== id));

  return (
    <div className="space-y-3">
      {/* Save current as preset */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm flex items-center gap-2"><Save className="w-4 h-4" /> Save Current Configuration as Preset</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Preset Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. My Scalping Setup" className="h-8 text-xs mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Description (optional)</Label>
              <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Brief description..." className="h-8 text-xs mt-0.5" />
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground">Current config: {activeIndicators.length} indicators on {timeframe} timeframe</div>
          <Button onClick={saveCurrentAsPreset} disabled={!newName.trim()} className="w-full">
            <Save className="w-3 h-3 mr-1" /> Save Preset
          </Button>
        </CardContent>
      </Card>

      {/* Preset list */}
      <Card>
        <CardHeader className="py-3"><CardTitle className="text-sm">Saved Presets ({presets.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2 pt-0">
          {presets.map((preset: IndicatorPreset) => (
            <div key={preset.id} className="border border-border rounded-md p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">{preset.name}</span>
                    <Badge variant="outline" className="text-[9px]">{preset.timeframe}</Badge>
                    <span className="text-[10px] text-muted-foreground">{preset.indicators.length} indicators</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{preset.description}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {preset.indicators.map((ind, i) => {
                      const def = getIndicator(ind.id);
                      return (
                        <Badge key={i} variant="outline" className="text-[9px] h-4 px-1">
                          {def?.name.split("(")[0].trim()}
                          {Object.keys(ind.params).length > 0 && ` (${Object.values(ind.params).join(",")})`}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="default" className="h-7 text-xs" onClick={() => applyPreset(preset)}>
                    Load
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-400" onClick={() => deletePreset(preset.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {presets.length === 0 && <div className="text-center py-6 text-xs text-muted-foreground">No presets saved.</div>}
        </CardContent>
      </Card>
    </div>
  );
}
