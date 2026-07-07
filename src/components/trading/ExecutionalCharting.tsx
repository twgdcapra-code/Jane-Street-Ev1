"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS, getContract } from "@/lib/trading/contracts";
import { getCandlesForTimeframe, TIMEFRAMES, type Timeframe } from "@/lib/trading/timeframes";
import { ensemblePredict, type EnsemblePrediction } from "@/lib/trading/prediction-engine";
import {
  computeEnsembleWeights, evaluatePendingPredictions, minePatterns, matchCurrentPattern,
  type PredictionRecord, type ModelPerformance, type CandlePattern, type AdaptationEntry,
} from "@/lib/trading/pattern-learning";
import {
  AVAILABLE_ADAPTERS, DEFAULT_PLUGINS, smartRouteOrder, type ExecutionPlugin,
  type SORBenchmark, type AdapterConfig,
} from "@/lib/trading/execution-plugins";
import { fmtPrice, fmtPct, fmtTime, decimalsFor } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Scatter,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  Activity, Brain, Cpu, Flame, GitBranch, Layers, Plug, Radar, Sparkles,
  Target, TrendingDown, TrendingUp, Wifi, Zap,
} from "lucide-react";

type TabId = "chart" | "models" | "patterns" | "execution" | "learning";

const TABS: { id: TabId; name: string; icon: any }[] = [
  { id: "chart", name: "Neon Chart + Prediction", icon: Activity },
  { id: "models", name: "Prediction Models", icon: Brain },
  { id: "patterns", name: "Pattern Mining", icon: GitBranch },
  { id: "execution", name: "Execution Plugins", icon: Plug },
  { id: "learning", name: "Self-Learning", icon: Cpu },
];

const NEON_COLORS = {
  bullGlow: "#00ff9d",
  bearGlow: "#ff0080",
  predictBull: "#00ffff",
  predictBear: "#ff44ff",
  neutral: "#888888",
};

export function ExecutionalCharting() {
  const [tab, setTab] = useState<TabId>("chart");
  const [symbol, setSymbol] = useState("ES");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [lookback, setLookback] = useState(150);
  const [predictionSteps, setPredictionSteps] = useState(5);
  const [showNeonOverlay, setShowNeonOverlay] = useState(true);
  const [showVolumeProfile, setShowVolumeProfile] = useState(true);
  const [showModelBands, setShowModelBands] = useState(true);
  // Prediction records for self-learning
  const [predictionHistory, setPredictionHistory] = useState<PredictionRecord[]>([]);
  const [adaptationLog, setAdaptationLog] = useState<AdaptationEntry[]>([]);
  const [plugins, setPlugins] = useState<ExecutionPlugin[]>(DEFAULT_PLUGINS);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const tickCount = useTradingStore((s) => s.tickCount);
  const quotes = useTradingStore((s) => s.quotes);
  const placeOrder = useTradingStore((s) => s.placeOrder);

  // Sync with global symbol
  const globalSymbol = useTradingStore((s) => s.selectedSymbol);
  useEffect(() => { setSymbol(globalSymbol); }, [globalSymbol]);

  // Get candles
  const candles = useMemo(
    () => getCandlesForTimeframe(symbol, timeframe, lookback),
    [symbol, timeframe, lookback, tickCount],
  );
  const decimals = decimalsFor(symbol);

  // Compute model performances from history
  const modelNames = ["Kalman Filter", "ARIMA(1,1,1)", "Mean Reversion (OU)", "Momentum", "HMM Ensemble"];
  const modelPerformances = useMemo(
    () => computeEnsembleWeights(predictionHistory, modelNames),
    [predictionHistory],
  );

  // Run ensemble prediction
  const prediction: EnsemblePrediction | null = useMemo(() => {
    if (candles.length < 50) return null;
    return ensemblePredict(
      candles,
      predictionSteps,
      modelPerformances.map((m) => ({ name: m.modelName, accuracy: m.weight, samples: m.evaluatedPredictions })),
    );
  }, [candles, predictionSteps, modelPerformances]);

  // Log predictions periodically for self-learning
  const lastLogRef = useRef(0);
  useEffect(() => {
    if (!prediction || candles.length === 0) return;
    const now = Date.now();
    if (now - lastLogRef.current < 10000) return; // log every 10s
    lastLogRef.current = now;
    const lastPrice = candles[candles.length - 1].close;
    const newRecords: PredictionRecord[] = prediction.models.map((m) => ({
      id: `pred-${now}-${m.name}`,
      timestamp: now,
      symbol,
      modelName: m.name,
      predictedPrice: m.forecast[m.forecast.length - 1] ?? lastPrice,
      predictedDirection: (m.forecast[m.forecast.length - 1] ?? lastPrice) > lastPrice ? "UP" : "DOWN",
      priceAtPrediction: lastPrice,
      barsAhead: predictionSteps,
      evaluated: false,
    }));
    setPredictionHistory((prev) => [...prev, ...newRecords].slice(-500));
  }, [prediction, candles, symbol, predictionSteps]);

  // Evaluate pending predictions when enough time passes
  useEffect(() => {
    if (candles.length === 0) return;
    const evaluated = evaluatePendingPredictions(predictionHistory, candles);
    // Check if any new evaluations happened
    const newCount = evaluated.filter((r) => r.evaluated).length;
    const oldCount = predictionHistory.filter((r) => r.evaluated).length;
    if (newCount > oldCount) {
      setPredictionHistory(evaluated);
      const newlyEvaluated = evaluated.filter((r, i) => r.evaluated && !predictionHistory[i]?.evaluated);
      if (newlyEvaluated.length > 0) {
        const correctCount = newlyEvaluated.filter((r) => r.directionCorrect).length;
        setAdaptationLog((prev) => [{
          timestamp: Date.now(),
          event: "Prediction Evaluated",
          details: `${newlyEvaluated.length} predictions evaluated. ${correctCount} correct (${((correctCount / newlyEvaluated.length) * 100).toFixed(0)}% accuracy).`,
          metric: correctCount / newlyEvaluated.length,
        }, ...prev].slice(0, 50));
      }
    }
  }, [candles, predictionHistory]);

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
                >
                  {tf.value}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Prediction Steps</Label>
            <div className="flex items-center gap-1 bg-muted/50 rounded-md p-0.5 ml-1">
              {[1, 3, 5, 10, 15].map((n) => (
                <button
                  key={n}
                  onClick={() => setPredictionSteps(n)}
                  className={cn(
                    "px-2 py-1 text-xs rounded",
                    predictionSteps === n ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 ml-2">
            <div className="flex items-center gap-1.5">
              <Switch checked={showNeonOverlay} onCheckedChange={setShowNeonOverlay} />
              <Label className="text-xs">Neon Overlay</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Switch checked={showVolumeProfile} onCheckedChange={setShowVolumeProfile} />
              <Label className="text-xs">Vol Profile</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Switch checked={showModelBands} onCheckedChange={setShowModelBands} />
              <Label className="text-xs">Model Bands</Label>
            </div>
          </div>
          <div className="flex-1" />
          {prediction && (
            <Badge variant="outline" className="text-[10px] border-cyan-500/30 bg-cyan-500/5 text-cyan-400">
              Confidence: {(prediction.confidence * 100).toFixed(0)}%
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Tab bar */}
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
      {tab === "chart" && prediction && (
        <ChartTab
          candles={candles} prediction={prediction} decimals={decimals} symbol={symbol}
          showNeonOverlay={showNeonOverlay} showVolumeProfile={showVolumeProfile} showModelBands={showModelBands}
          placeOrder={placeOrder} quotes={quotes}
        />
      )}
      {tab === "chart" && !prediction && (
        <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">Not enough data for prediction. Need at least 50 bars.</CardContent></Card>
      )}
      {tab === "models" && prediction && <ModelsTab prediction={prediction} modelPerformances={modelPerformances} decimals={decimals} candles={candles} />}
      {tab === "patterns" && <PatternsTab candles={candles} decimals={decimals} />}
      {tab === "execution" && <ExecutionTab plugins={plugins} setPlugins={setPlugins} placeOrder={placeOrder} symbol={symbol} quotes={quotes} />}
      {tab === "learning" && <LearningTab predictionHistory={predictionHistory} modelPerformances={modelPerformances} adaptationLog={adaptationLog} />}
    </div>
  );
}

// ============================================================
// CHART TAB — Neon Candle Overlay
// ============================================================
function ChartTab({ candles, prediction, decimals, symbol, showNeonOverlay, showVolumeProfile, showModelBands, placeOrder, quotes }: any) {
  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  // Build chart data: historical + predicted
  const chartData = useMemo(() => {
    const hist = candles.slice(-80).map((c: any, i: number) => ({
      time: fmtTime(c.time),
      type: "historical",
      open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
      range: [c.low, c.high],
      bodyRange: [Math.min(c.open, c.close), Math.max(c.open, c.close)],
      isUp: c.close >= c.open,
    }));
    if (!showNeonOverlay || !prediction) return hist;
    // Add connecting point
    const lastHist = hist[hist.length - 1];
    const predPoints = prediction.predictedCandles.map((pc: any, i: number) => ({
      time: `+${i + 1}`,
      type: "predicted",
      open: pc.open, high: pc.high, low: pc.low, close: pc.close, volume: pc.volume,
      range: [pc.low, pc.high],
      bodyRange: [Math.min(pc.open, pc.close), Math.max(pc.open, pc.close)],
      isUp: pc.close >= pc.open,
      // For neon glow effect
      predClose: pc.close,
      predHigh: pc.high,
      predLow: pc.low,
    }));
    return [...hist, ...predPoints];
  }, [candles, prediction, showNeonOverlay]);

  // Volume profile
  const volumeProfile = useMemo(() => {
    if (!showVolumeProfile) return [];
    const levels = new Map<number, number>();
    for (const c of candles.slice(-100)) {
      const priceLevel = Math.round(c.close / (lastPrice * 0.001)) * (lastPrice * 0.001);
      levels.set(priceLevel, (levels.get(priceLevel) ?? 0) + c.volume);
    }
    return Array.from(levels.entries())
      .map(([price, vol]) => ({ price, vol }))
      .sort((a, b) => b.price - a.price)
      .slice(0, 30);
  }, [candles, showVolumeProfile, lastPrice]);
  const maxVol = Math.max(...volumeProfile.map((v) => v.vol), 1);

  return (
    <div className="space-y-3">
      {/* Prediction summary banner */}
      <Card className={cn("border", prediction.expectedMovePct > 0 ? "border-emerald-500/30 bg-emerald-500/5" : prediction.expectedMovePct < 0 ? "border-rose-500/30 bg-rose-500/5" : "border-border")}>
        <CardContent className="p-3 flex items-center gap-4">
          {prediction.expectedMovePct > 0 ? <TrendingUp className="w-5 h-5 text-emerald-400" /> : prediction.expectedMovePct < 0 ? <TrendingDown className="w-5 h-5 text-rose-400" /> : <Activity className="w-5 h-5 text-muted-foreground" />}
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold">Predicted Move ({prediction.predictedCandles.length} bars)</span>
              <span className={cn("text-lg font-mono font-bold", prediction.expectedMovePct > 0 ? "text-emerald-400" : "text-rose-400")}>
                {fmtPct(prediction.expectedMovePct)}
              </span>
              <span className="text-xs text-muted-foreground">
                → {fmtPrice(prediction.combined[prediction.combined.length - 1] ?? lastPrice, decimals)}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1">
                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${prediction.bullProb * 100}%` }} />
                </div>
                <span className="text-[10px] font-mono text-emerald-400">Bull {(prediction.bullProb * 100).toFixed(0)}%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-rose-500" style={{ width: `${prediction.bearProb * 100}%` }} />
                </div>
                <span className="text-[10px] font-mono text-rose-400">Bear {(prediction.bearProb * 100).toFixed(0)}%</span>
              </div>
              <span className="text-[10px] text-muted-foreground">Confidence: {(prediction.confidence * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
              onClick={() => placeOrder({ symbol, side: "BUY", type: "MARKET", tif: "DAY", qty: 1, tag: "pred:buy" })}
            >
              <Zap className="w-3 h-3 mr-1" /> Execute BUY
            </Button>
            <Button
              size="sm"
              className="bg-rose-500 hover:bg-rose-600 text-white"
              onClick={() => placeOrder({ symbol, side: "SELL", type: "MARKET", tif: "DAY", qty: 1, tag: "pred:sell" })}
            >
              <Zap className="w-3 h-3 mr-1" /> Execute SELL
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        {/* Main chart with neon overlay */}
        <Card className="lg:col-span-3">
          <CardHeader className="py-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" /> {symbol} — Neon Prediction Chart
            </CardTitle>
            <div className="flex items-center gap-2">
              {showNeonOverlay && <Badge variant="outline" className="text-[9px] border-cyan-500/30 bg-cyan-500/10 text-cyan-400">⚡ NEON OVERLAY ON</Badge>}
              <Badge variant="outline" className="text-[9px]">{candles.length} bars</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="h-[450px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.15} />
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(chartData.length / 10)} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={60} orientation="right" />
                  <Tooltip content={<NeonCandleTooltip decimals={decimals} />} />
                  {/* Historical candle wicks */}
                  <Bar dataKey="range" fill="transparent" stroke="#666" strokeWidth={0.5}>
                    {chartData.map((d: any, i: number) => (
                      <Cell key={i} stroke={d.type === "predicted" ? "transparent" : (d.isUp ? "#10b981" : "#ef4444")} />
                    ))}
                  </Bar>
                  {/* Historical candle bodies */}
                  <Bar dataKey="bodyRange" strokeWidth={0}>
                    {chartData.map((d: any, i: number) => {
                      if (d.type === "predicted") {
                        // Neon hollow candles
                        return <Cell key={i} fill="transparent" stroke={d.isUp ? NEON_COLORS.predictBull : NEON_COLORS.predictBear} strokeWidth={2} />;
                      }
                      return <Cell key={i} fill={d.isUp ? "#10b981" : "#ef4444"} />;
                    })}
                  </Bar>
                  {/* Prediction line (combined ensemble) */}
                  {showNeonOverlay && prediction && (
                    <Line
                      type="monotone"
                      dataKey="predClose"
                      stroke={NEON_COLORS.predictBull}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      strokeDasharray="5 3"
                      name="Prediction"
                    />
                  )}
                  {/* Model bands */}
                  {showModelBands && prediction && prediction.models.map((m: any, mi: number) => {
                    const colors = ["#3b82f688", "#a855f788", "#f59e0b88", "#10b98188", "#ec489988"];
                    return (
                      <Line
                        key={mi}
                        type="monotone"
                        dataKey={`model_${mi}`}
                        stroke={colors[mi % colors.length]}
                        strokeWidth={1}
                        dot={false}
                        connectNulls
                        strokeDasharray="2 2"
                        name={m.name}
                      />
                    );
                  })}
                  {/* Last price reference */}
                  <ReferenceLine y={lastPrice} stroke="#fbbf24" strokeDasharray="4 4" strokeWidth={1} strokeOpacity={0.5} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Volume subchart */}
            <div className="h-[60px] mt-1 border-t border-border/40 pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 0, right: 5, left: 0, bottom: 0 }}>
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} interval={Math.floor(chartData.length / 8)} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} width={60} orientation="right" />
                  <Bar dataKey="volume" radius={[2, 2, 0, 0]}>
                    {chartData.map((d: any, i: number) => (
                      <Cell key={i} fill={d.type === "predicted" ? NEON_COLORS.predictBull + "33" : (d.isUp ? "#10b98155" : "#ef444455")} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Volume profile sidebar */}
        {showVolumeProfile && (
          <Card>
            <CardHeader className="py-2"><CardTitle className="text-xs">Volume Profile</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <div className="max-h-[500px] overflow-y-auto">
                {volumeProfile.map((vp, i) => (
                  <div key={i} className="relative grid grid-cols-3 gap-1 px-1 py-0.5 items-center text-xs font-mono">
                    <div className="col-span-2 relative h-4">
                      <div
                        className="absolute right-0 top-0 bottom-0 bg-primary/20 rounded-l"
                        style={{ width: `${(vp.vol / maxVol) * 100}%` }}
                      />
                      <span className="relative z-10 text-[10px]">{fmtPrice(vp.price, decimals)}</span>
                    </div>
                    <div className="col-span-1 text-right text-[10px] text-muted-foreground">{(vp.vol / 1000).toFixed(0)}K</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Predicted candle detail table */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Predicted Candles (Neon Overlay)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border">
              <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                <th className="text-left py-2 px-3">Bar</th>
                <th className="text-right py-2 px-3">Open</th>
                <th className="text-right py-2 px-3">High</th>
                <th className="text-right py-2 px-3">Low</th>
                <th className="text-right py-2 px-3">Close</th>
                <th className="text-right py-2 px-3">Δ%</th>
                <th className="text-center py-2 px-3">Direction</th>
                <th className="text-center py-2 px-3">Color</th>
              </tr>
            </thead>
            <tbody>
              {prediction.predictedCandles.map((pc: any, i: number) => {
                const isUp = pc.close >= pc.open;
                return (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-1.5 px-3 font-mono">+{i + 1}</td>
                    <td className="py-1.5 px-3 text-right font-mono">{fmtPrice(pc.open, decimals)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-emerald-400">{fmtPrice(pc.high, decimals)}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-rose-400">{fmtPrice(pc.low, decimals)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono font-semibold", isUp ? "text-cyan-400" : "text-fuchsia-400")}>{fmtPrice(pc.close, decimals)}</td>
                    <td className={cn("py-1.5 px-3 text-right font-mono", isUp ? "text-emerald-400" : "text-rose-400")}>{fmtPct(((pc.close - lastPrice) / lastPrice) * 100)}</td>
                    <td className="py-1.5 px-3 text-center">{isUp ? <TrendingUp className="w-3 h-3 text-cyan-400 mx-auto" /> : <TrendingDown className="w-3 h-3 text-fuchsia-400 mx-auto" />}</td>
                    <td className="py-1.5 px-3 text-center">
                      <span className="inline-block w-3 h-3 rounded-full" style={{ background: isUp ? NEON_COLORS.predictBull : NEON_COLORS.predictBear, boxShadow: `0 0 8px ${isUp ? NEON_COLORS.predictBull : NEON_COLORS.predictBear}` }} />
                    </td>
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

function NeonCandleTooltip({ active, payload, decimals }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const isPredicted = d.type === "predicted";
  return (
    <div className={cn("border rounded-md p-2 text-xs shadow-lg", isPredicted ? "bg-card border-cyan-500/40" : "bg-card border-border")}>
      {isPredicted && <div className="text-cyan-400 font-bold mb-1 text-[10px]">⚡ PREDICTED</div>}
      <div className="font-mono text-muted-foreground mb-1">{d.time}</div>
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
// MODELS TAB
// ============================================================
function ModelsTab({ prediction, modelPerformances, decimals, candles }: any) {
  const lastPrice = candles[candles.length - 1]?.close ?? 0;
  // Build chart data for each model's forecast
  const chartData = useMemo(() => {
    const points = prediction.models[0].forecast.map((_: any, i: number) => {
      const point: any = { step: `+${i + 1}` };
      prediction.models.forEach((m: any) => {
        point[m.name] = m.forecast[i];
      });
      point.combined = prediction.combined[i];
      point.lastPrice = i === 0 ? lastPrice : null;
      return point;
    });
    return points;
  }, [prediction, lastPrice]);

  return (
    <div className="space-y-3">
      {/* Model comparison chart */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Model Forecast Comparison</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="step" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={60} orientation="right" />
                <Tooltip formatter={(v: any) => fmtPrice(Number(v), decimals)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
                <ReferenceLine y={lastPrice} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: "Current", fontSize: 9, fill: "#fbbf24" }} />
                {prediction.models.map((m: any, i: number) => {
                  const colors = ["#3b82f6", "#a855f7", "#f59e0b", "#10b981", "#ec4899"];
                  return <Line key={i} type="monotone" dataKey={m.name} stroke={colors[i % colors.length]} strokeWidth={m.weight * 4} dot={{ r: 3 }} connectNulls />;
                })}
                <Line type="monotone" dataKey="combined" stroke="#00ffff" strokeWidth={3} dot={{ r: 4, fill: "#00ffff" }} connectNulls name="Ensemble" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Model performance table */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Model Performance & Weights (Self-Learning)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border">
              <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                <th className="text-left py-2 px-3">Model</th>
                <th className="text-right py-2 px-3">Weight</th>
                <th className="text-right py-2 px-3">Confidence</th>
                <th className="text-right py-2 px-3">Direction Acc</th>
                <th className="text-right py-2 px-3">MAE</th>
                <th className="text-right py-2 px-3">Recent Acc</th>
                <th className="text-center py-2 px-3">Streak</th>
                <th className="text-center py-2 px-3">Last 10</th>
                <th className="text-right py-2 px-3">Samples</th>
              </tr>
            </thead>
            <tbody>
              {modelPerformances.map((mp: ModelPerformance, i: number) => (
                <tr key={i} className="border-b border-border/40 hover:bg-muted/30">
                  <td className="py-2 px-3 font-medium">{mp.modelName}</td>
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${mp.weight * 100}%` }} />
                      </div>
                      <span className="font-mono text-[10px] w-8">{(mp.weight * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right font-mono">{(prediction.models[i]?.confidence * 100).toFixed(0)}%</td>
                  <td className={cn("py-2 px-3 text-right font-mono", mp.directionAccuracy >= 0.55 ? "text-emerald-400" : mp.directionAccuracy < 0.45 ? "text-rose-400" : "")}>
                    {(mp.directionAccuracy * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-muted-foreground">{mp.mae.toFixed(2)}</td>
                  <td className={cn("py-2 px-3 text-right font-mono", mp.recentAccuracy >= 0.55 ? "text-emerald-400" : mp.recentAccuracy < 0.45 ? "text-rose-400" : "")}>
                    {(mp.recentAccuracy * 100).toFixed(0)}%
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className={cn("font-mono font-bold", mp.streak > 0 ? "text-emerald-400" : mp.streak < 0 ? "text-rose-400" : "text-muted-foreground")}>
                      {mp.streak > 0 ? `+${mp.streak}` : mp.streak}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <div className="flex gap-0.5 justify-center">
                      {Array.from({ length: 10 }).map((_, j) => (
                        <span key={j} className={cn("w-1.5 h-3 rounded-sm", j < mp.last10.length ? (mp.last10[j] ? "bg-emerald-500" : "bg-rose-500") : "bg-muted")} />
                      ))}
                    </div>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-muted-foreground">{mp.evaluatedPredictions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Individual model details */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {prediction.models.map((m: any, i: number) => {
          const perf = modelPerformances[i];
          return (
            <Card key={i}>
              <CardHeader className="py-2 flex flex-row items-center justify-between">
                <CardTitle className="text-xs">{m.name}</CardTitle>
                <Badge variant="outline" className="text-[9px]">w={(m.weight * 100).toFixed(0)}%</Badge>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Confidence</span><span className="font-mono">{(m.confidence * 100).toFixed(0)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Forecast</span><span className="font-mono">{fmtPrice(m.forecast[m.forecast.length - 1], decimals)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Direction Acc</span><span className={cn("font-mono", perf.directionAccuracy >= 0.55 ? "text-emerald-400" : "")}>{(perf.directionAccuracy * 100).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Evaluated</span><span className="font-mono">{perf.evaluatedPredictions}/{perf.totalPredictions}</span></div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// PATTERNS TAB
// ============================================================
function PatternsTab({ candles, decimals }: any) {
  const [patternLength, setPatternLength] = useState(3);
  const patterns = useMemo(() => minePatterns(candles, patternLength, 3), [candles, patternLength]);
  const currentMatch = useMemo(() => matchCurrentPattern(candles, patterns, patternLength), [candles, patterns, patternLength]);
  const lastPrice = candles[candles.length - 1]?.close ?? 0;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-2 flex flex-row items-center justify-between">
          <CardTitle className="text-xs">Pattern Mining Engine</CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-muted-foreground">Pattern Length:</Label>
            <select value={patternLength} onChange={(e) => setPatternLength(Number(e.target.value))} className="bg-muted/50 border border-border rounded px-2 py-1 text-xs">
              <option value={2}>2 candles</option>
              <option value={3}>3 candles</option>
              <option value={4}>4 candles</option>
              <option value={5}>5 candles</option>
            </select>
          </div>
        </CardHeader>
      </Card>

      {/* Current pattern match */}
      {currentMatch && (
        <Card className="border-cyan-500/30 bg-cyan-500/5">
          <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Current Pattern Match</CardTitle></CardHeader>
          <CardContent className="text-xs">
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {currentMatch.sequence.map((s, i) => (
                  <span key={i} className={cn("w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold", s === "UP" ? "bg-emerald-500/30 text-emerald-400" : "bg-rose-500/30 text-rose-400")}>
                    {s === "UP" ? "▲" : "▼"}
                  </span>
                ))}
              </div>
              <div className="flex-1">
                <div>Occurred <span className="font-mono font-bold">{currentMatch.occurrences}</span> times historically.</div>
                <div>Average follow-up return: <span className={cn("font-mono font-bold", currentMatch.avgFollowUpReturn > 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(currentMatch.avgFollowUpReturn * 100)}</span></div>
                <div>Win rate: <span className="font-mono font-bold">{(currentMatch.winRate * 100).toFixed(0)}%</span> · Significance: <span className="font-mono">{(currentMatch.significance * 100).toFixed(0)}%</span></div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground">Predicted next:</div>
                <div className={cn("text-lg font-bold", currentMatch.avgFollowUpReturn > 0 ? "text-emerald-400" : "text-rose-400")}>
                  {currentMatch.avgFollowUpReturn > 0 ? "▲ UP" : "▼ DOWN"}
                </div>
                <div className="text-[10px] font-mono text-muted-foreground">{fmtPrice(lastPrice * (1 + currentMatch.avgFollowUpReturn), decimals)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pattern table */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Discovered Patterns ({patterns.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-3">Pattern</th>
                  <th className="text-right py-2 px-3">Occurrences</th>
                  <th className="text-right py-2 px-3">Avg Return</th>
                  <th className="text-right py-2 px-3">Win Rate</th>
                  <th className="text-right py-2 px-3">Significance</th>
                  <th className="text-right py-2 px-3">Prediction</th>
                </tr>
              </thead>
              <tbody>
                {patterns.map((p, i) => (
                  <tr key={i} className="border-b border-border/40 hover:bg-muted/30">
                    <td className="py-2 px-3">
                      <div className="flex gap-0.5">
                        {p.sequence.map((s, j) => (
                          <span key={j} className={cn("w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold", s === "UP" ? "bg-emerald-500/20 text-emerald-400" : "bg-rose-500/20 text-rose-400")}>
                            {s === "UP" ? "▲" : "▼"}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{p.occurrences}</td>
                    <td className={cn("py-2 px-3 text-right font-mono", p.avgFollowUpReturn > 0 ? "text-emerald-400" : "text-rose-400")}>{fmtPct(p.avgFollowUpReturn * 100)}</td>
                    <td className={cn("py-2 px-3 text-right font-mono", p.winRate > 0.55 ? "text-emerald-400" : p.winRate < 0.45 ? "text-rose-400" : "")}>{(p.winRate * 100).toFixed(0)}%</td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={cn("h-full", p.significance > 0.6 ? "bg-emerald-500" : p.significance > 0.3 ? "bg-amber-500" : "bg-muted-foreground")} style={{ width: `${p.significance * 100}%` }} />
                        </div>
                        <span className="font-mono text-[10px] w-8">{(p.significance * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <span className={cn("font-bold", p.avgFollowUpReturn > 0 ? "text-emerald-400" : "text-rose-400")}>
                        {p.avgFollowUpReturn > 0 ? "▲ UP" : "▼ DOWN"}
                      </span>
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
// EXECUTION TAB
// ============================================================
function ExecutionTab({ plugins, setPlugins, placeOrder, symbol, quotes }: any) {
  const [showSOR, setShowSOR] = useState(false);
  const [sorQty, setSorQty] = useState(10);
  const [sorUrgency, setSorUrgency] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");
  const quote = quotes[symbol];
  const contract = getContract(symbol);
  const adv = 100000; // assumed ADV
  const sorResult = useMemo(() => {
    if (!quote) return null;
    return smartRouteOrder(sorQty, adv, contract.volatility, 1, sorUrgency);
  }, [sorQty, sorUrgency, quote, contract]);

  return (
    <div className="space-y-3">
      {/* Active plugins */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Plug className="w-3.5 h-3.5" /> Execution Plugins ({plugins.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2 pt-0">
          {plugins.map((plugin: ExecutionPlugin, i: number) => (
            <div key={i} className={cn("border rounded-md p-3", plugin.isPrimary ? "border-primary/30 bg-primary/5" : "border-border")}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{ background: plugin.metadata.logoColor + "22", border: `1px solid ${plugin.metadata.logoColor}55` }}>
                    <Wifi className="w-5 h-5" style={{ color: plugin.metadata.logoColor }} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{plugin.metadata.name}</span>
                      {plugin.isPrimary && <Badge variant="outline" className="text-[9px] bg-primary/15 text-primary border-primary/30">PRIMARY</Badge>}
                      {plugin.metadata.isLive ? <Badge variant="outline" className="text-[9px] bg-rose-500/15 text-rose-400 border-rose-500/30">LIVE</Badge> : <Badge variant="outline" className="text-[9px] bg-blue-500/15 text-blue-400 border-blue-500/30">PAPER</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{plugin.metadata.description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={cn("text-[9px]", plugin.status === "CONNECTED" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "bg-muted text-muted-foreground")}>
                    {plugin.status}
                  </Badge>
                  <Switch checked={plugin.isPrimary} onCheckedChange={() => setPlugins(plugins.map((p: ExecutionPlugin, j: number) => ({ ...p, isPrimary: j === i })))} />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2 text-[10px]">
                <div><span className="text-muted-foreground">Orders:</span> <span className="font-mono">{plugin.orderCount}</span></div>
                <div><span className="text-muted-foreground">Fills:</span> <span className="font-mono">{plugin.fillCount}</span></div>
                <div><span className="text-muted-foreground">Order Types:</span> <span className="font-mono">{plugin.metadata.supportedOrderTypes.length}</span></div>
                <div><span className="text-muted-foreground">Config:</span> <span className="font-mono">{Object.keys(plugin.config).length} params</span></div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Available adapters (future) */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Available Broker Adapters</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pt-0">
          {AVAILABLE_ADAPTERS.map((adapter) => (
            <div key={adapter.id} className="border border-border/40 rounded-md p-2.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: adapter.logoColor + "22" }}>
                  <Plug className="w-3.5 h-3.5" style={{ color: adapter.logoColor }} />
                </div>
                <span className="text-xs font-medium">{adapter.name}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{adapter.description}</p>
              <div className="flex gap-1 mt-1.5">
                {adapter.isLive ? <Badge variant="outline" className="text-[8px] bg-rose-500/10 text-rose-400">LIVE</Badge> : <Badge variant="outline" className="text-[8px] bg-blue-500/10 text-blue-400">PAPER</Badge>}
                <Badge variant="outline" className="text-[8px]">{adapter.supportedOrderTypes.length} order types</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Smart Order Routing */}
      <Card>
        <CardHeader className="py-2 flex flex-row items-center justify-between">
          <CardTitle className="text-xs flex items-center gap-2"><Radar className="w-3.5 h-3.5" /> Smart Order Router (SOR)</CardTitle>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowSOR(!showSOR)}>{showSOR ? "Hide" : "Show"} SOR</Button>
        </CardHeader>
        {showSOR && sorResult && (
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">Order Size (contracts)</Label>
                <Input type="number" value={sorQty} onChange={(e) => setSorQty(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Urgency</Label>
                <div className="grid grid-cols-3 gap-1 mt-0.5">
                  {(["LOW", "MEDIUM", "HIGH"] as const).map((u) => (
                    <Button key={u} size="sm" variant={sorUrgency === u ? "default" : "outline"} className="h-8 text-[10px]" onClick={() => setSorUrgency(u)}>{u}</Button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Recommended Benchmark</Label>
                <div className="h-8 flex items-center mt-0.5"><Badge variant="outline" className="text-xs">{sorResult.benchmark}</Badge></div>
              </div>
            </div>
            <div className="border border-border/40 rounded-md p-2.5 bg-muted/30 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <Target className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-medium">SOR Recommendation</span>
              </div>
              <p className="text-muted-foreground">{sorResult.explanation}</p>
              <div className="grid grid-cols-3 gap-3 mt-2">
                <div><span className="text-muted-foreground">Est. Slippage:</span> <span className="font-mono font-medium text-rose-400">{sorResult.expectedSlippageBps.toFixed(1)} bps</span></div>
                <div><span className="text-muted-foreground">Child Orders:</span> <span className="font-mono font-medium">{sorResult.childOrders.length}</span></div>
                <div><span className="text-muted-foreground">Est. Duration:</span> <span className="font-mono font-medium">{sorResult.estimatedTimeSec}s</span></div>
              </div>
            </div>
            <Button size="sm" className="w-full" onClick={() => {
              // Execute via the existing OMS (simulation adapter)
              for (const child of sorResult.childOrders) {
                placeOrder({ symbol, side: "BUY", type: child.type, tif: "DAY", qty: child.qty, tag: `sor:${sorResult.benchmark}` });
              }
            }}>
              <Zap className="w-3 h-3 mr-1" /> Execute via SOR ({sorResult.childOrders.length} child orders)
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

// ============================================================
// LEARNING TAB
// ============================================================
function LearningTab({ predictionHistory, modelPerformances, adaptationLog }: any) {
  const totalEvaluated = predictionHistory.filter((r: PredictionRecord) => r.evaluated).length;
  const totalCorrect = predictionHistory.filter((r: PredictionRecord) => r.evaluated && r.directionCorrect).length;
  const overallAccuracy = totalEvaluated > 0 ? totalCorrect / totalEvaluated : 0;
  const recentEvaluated = predictionHistory.filter((r: PredictionRecord) => r.evaluated).slice(-20);
  const recentCorrect = recentEvaluated.filter((r: PredictionRecord) => r.directionCorrect).length;
  const recentAccuracy = recentEvaluated.length > 0 ? recentCorrect / recentEvaluated.length : 0;

  return (
    <div className="space-y-3">
      {/* Overall stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Total Predictions</div><div className="text-lg font-mono font-semibold">{predictionHistory.length}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Evaluated</div><div className="text-lg font-mono font-semibold">{totalEvaluated}</div></Card>
        <Card className={cn("p-3", overallAccuracy >= 0.55 ? "border-emerald-500/30 bg-emerald-500/5" : overallAccuracy < 0.45 ? "border-rose-500/30 bg-rose-500/5" : "")}>
          <div className="text-[10px] text-muted-foreground uppercase">Overall Accuracy</div>
          <div className={cn("text-lg font-mono font-semibold", overallAccuracy >= 0.55 ? "text-emerald-400" : overallAccuracy < 0.45 ? "text-rose-400" : "")}>{(overallAccuracy * 100).toFixed(1)}%</div>
        </Card>
        <Card className={cn("p-3", recentAccuracy >= 0.55 ? "border-emerald-500/30 bg-emerald-500/5" : recentAccuracy < 0.45 ? "border-rose-500/30 bg-rose-500/5" : "")}>
          <div className="text-[10px] text-muted-foreground uppercase">Recent (20)</div>
          <div className={cn("text-lg font-mono font-semibold", recentAccuracy >= 0.55 ? "text-emerald-400" : recentAccuracy < 0.45 ? "text-rose-400" : "")}>{(recentAccuracy * 100).toFixed(1)}%</div>
        </Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Active Models</div><div className="text-lg font-mono font-semibold">{modelPerformances.length}</div></Card>
      </div>

      {/* Adaptation log */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Cpu className="w-3.5 h-3.5" /> Adaptation Log</CardTitle></CardHeader>
        <CardContent className="space-y-1 max-h-[300px] overflow-y-auto pt-0">
          {adaptationLog.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">No adaptations logged yet. The system learns as predictions are evaluated.</div>
          ) : (
            adaptationLog.map((entry: AdaptationEntry, i: number) => (
              <div key={i} className="flex items-start gap-2 text-xs border-b border-border/30 py-1.5">
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">{fmtTime(entry.timestamp)}</span>
                <Badge variant="outline" className="text-[9px] shrink-0">{entry.event}</Badge>
                <span className="flex-1">{entry.details}</span>
                {entry.metric != null && <span className={cn("font-mono text-[10px]", entry.metric >= 0.5 ? "text-emerald-400" : "text-rose-400")}>{(entry.metric * 100).toFixed(0)}%</span>}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Model weight evolution */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Brain className="w-3.5 h-3.5" /> Model Weight Distribution (Self-Adjusting)</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-2">
            {modelPerformances.map((mp: ModelPerformance, i: number) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-xs w-32 truncate">{mp.modelName}</span>
                <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden relative">
                  <div
                    className={cn("h-full transition-all", mp.weight > 0.3 ? "bg-emerald-500" : mp.weight > 0.15 ? "bg-blue-500" : "bg-muted-foreground")}
                    style={{ width: `${mp.weight * 100}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-end pr-2 text-[10px] font-mono">{(mp.weight * 100).toFixed(1)}%</span>
                </div>
                <span className="text-[10px] font-mono w-16 text-right">{mp.evaluatedPredictions} eval</span>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground mt-3">
            Weights auto-adjust based on each model's recent directional accuracy. Models that predict correctly get higher weights; models that fail get demoted. The system continuously learns and improves.
          </div>
        </CardContent>
      </Card>

      {/* Recent prediction log */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Recent Prediction Log</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-2">Time</th>
                  <th className="text-left py-2 px-2">Model</th>
                  <th className="text-left py-2 px-2">Symbol</th>
                  <th className="text-right py-2 px-2">At Pred</th>
                  <th className="text-right py-2 px-2">Predicted</th>
                  <th className="text-right py-2 px-2">Actual</th>
                  <th className="text-center py-2 px-2">Direction</th>
                  <th className="text-right py-2 px-2">MAE</th>
                </tr>
              </thead>
              <tbody>
                {predictionHistory.slice(-50).reverse().map((r: PredictionRecord, i: number) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="py-1 px-2 text-[10px] font-mono text-muted-foreground">{fmtTime(r.timestamp)}</td>
                    <td className="py-1 px-2 text-[10px]">{r.modelName}</td>
                    <td className="py-1 px-2 font-mono">{r.symbol}</td>
                    <td className="py-1 px-2 text-right font-mono text-[10px]">{r.priceAtPrediction.toFixed(2)}</td>
                    <td className="py-1 px-2 text-right font-mono text-[10px]">{r.predictedPrice.toFixed(2)}</td>
                    <td className="py-1 px-2 text-right font-mono text-[10px]">{r.actualPrice?.toFixed(2) ?? "—"}</td>
                    <td className="py-1 px-2 text-center">
                      {r.evaluated ? (
                        <span className={cn("text-[10px] font-bold", r.directionCorrect ? "text-emerald-400" : "text-rose-400")}>
                          {r.directionCorrect ? "✓" : "✗"} {r.predictedDirection}
                        </span>
                      ) : <span className="text-[10px] text-muted-foreground">pending</span>}
                    </td>
                    <td className="py-1 px-2 text-right font-mono text-[10px]">{r.mae?.toFixed(2) ?? "—"}</td>
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
