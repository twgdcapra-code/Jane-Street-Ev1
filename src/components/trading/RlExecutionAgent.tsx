"use client";
import { useMemo, useState, useRef } from "react";
import {
  trainAgent, getAgentPolicy, getQTableStats, ACTIONS, type ActionType, type TrainingResult, type AgentPolicy,
} from "@/lib/trading/rl-execution";
import { CONTRACTS } from "@/lib/trading/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Activity, BarChart3, Brain, Loader2, Play, Settings, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type View = "train" | "policy" | "learning" | "qtable";
const VIEWS: { id: View; name: string; icon: any }[] = [
  { id: "train", name: "Train Agent", icon: Play },
  { id: "policy", name: "Live Policy", icon: Brain },
  { id: "learning", name: "Learning Curve", icon: TrendingUp },
  { id: "qtable", name: "Q-Table Explorer", icon: Settings },
];

const ACTION_COLORS: Record<ActionType, string> = {
  EXEC_0: "#6b7280", EXEC_25: "#3b82f6", EXEC_50: "#10b981", EXEC_75: "#f59e0b", EXEC_100: "#ef4444",
};
const ACTION_LABELS: Record<ActionType, string> = {
  EXEC_0: "Pause (0%)", EXEC_25: "Slow (25%)", EXEC_50: "Moderate (50%)", EXEC_75: "Aggressive (75%)", EXEC_100: "Max (100%)",
};

function fmtBps(b: number): string { const sign = b >= 0 ? "+" : ""; return `${sign}${b.toFixed(2)} bps`; }
function fmtUsd(v: number): string { const sign = v >= 0 ? "+" : ""; return `${sign}$${v.toFixed(2)}`; }

export function RlExecutionAgent() {
  const [view, setView] = useState<View>("train");
  const [symbol, setSymbol] = useState("ES");
  const [totalQty, setTotalQty] = useState(10);
  const [numEpisodes, setNumEpisodes] = useState(500);
  const [stepsPerEpisode, setStepsPerEpisode] = useState(10);
  const [training, setTraining] = useState(false);
  const [result, setResult] = useState<TrainingResult | null>(null);

  const handleTrain = () => {
    setTraining(true);
    setTimeout(() => {
      try {
        const r = trainAgent(symbol, totalQty, numEpisodes, stepsPerEpisode);
        setResult(r);
      } finally {
        setTraining(false);
      }
    }, 50);
  };

  const qTableStats = useMemo(() => result ? getQTableStats(result.qTable) : null, [result]);
  const livePolicy = useMemo(() => {
    if (!result) return null;
    return getAgentPolicy(result.qTable, symbol, totalQty);
  }, [result, symbol, totalQty]);

  return (
    <div className="space-y-4">
      {/* Config card */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Brain className="w-3.5 h-3.5" /> RL Execution Agent — DQN with Q-Learning</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <Label className="text-[10px] text-muted-foreground">Symbol</Label>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8 font-mono">
                {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Order Size (contracts)</Label>
              <Input type="number" value={totalQty} onChange={(e) => setTotalQty(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Training Episodes</Label>
              <select value={numEpisodes} onChange={(e) => setNumEpisodes(Number(e.target.value))} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
                <option value={100}>100 (fast)</option>
                <option value={500}>500</option>
                <option value={1000}>1,000</option>
                <option value={2000}>2,000 (slow)</option>
              </select>
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Steps per Episode</Label>
              <select value={stepsPerEpisode} onChange={(e) => setStepsPerEpisode(Number(e.target.value))} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
                <option value={5}>5 steps</option>
                <option value={10}>10 steps</option>
                <option value={20}>20 steps</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleTrain} disabled={training}>
              {training ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Training {numEpisodes} episodes...</> : <><Play className="w-3.5 h-3.5 mr-1" /> Train RL Agent</>}
            </Button>
            {result && (
              <div className="text-[10px] text-muted-foreground">
                Last training: {result.durationMs}ms · {result.totalTrainingSteps} steps · {result.qTable.size} states learned · ε={result.finalEpsilon.toFixed(3)}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* View switcher */}
      <div className="flex items-center gap-1 flex-wrap">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)} disabled={!result && v.id !== "train"}
            className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors disabled:opacity-50",
              view === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>
            <v.icon className="w-3.5 h-3.5" />{v.name}
          </button>
        ))}
      </div>

      {!result && !training && (
        <Card>
          <CardContent className="p-8 text-center">
            <Brain className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <div className="text-sm font-semibold mb-1">No trained agent yet</div>
            <div className="text-xs text-muted-foreground">Click "Train RL Agent" to train a Q-learning agent that learns optimal execution slicing. The agent will run {numEpisodes} simulated episodes and learn from experience.</div>
          </CardContent>
        </Card>
      )}

      {result && view === "train" && <TrainResultView result={result} />}
      {result && view === "policy" && livePolicy && <PolicyView policy={livePolicy} />}
      {result && view === "learning" && <LearningCurveView result={result} />}
      {result && view === "qtable" && qTableStats && <QTableView stats={qTableStats} />}
    </div>
  );
}

// ============================================================
// Train Result View
// ============================================================
function TrainResultView({ result }: { result: TrainingResult }) {
  const last10 = result.episodes.slice(-10);
  const avgSlippageVsTwap = last10.reduce((s, e) => s + e.slippageVsTwapBps, 0) / Math.max(last10.length, 1);
  const avgSlippageVsVwap = last10.reduce((s, e) => s + e.slippageVsVwapBps, 0) / Math.max(last10.length, 1);
  const avgSlippageVsArrival = last10.reduce((s, e) => s + e.slippageVsArrivalBps, 0) / Math.max(last10.length, 1);

  return (
    <div className="space-y-3">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card className={cn("p-2.5 border", result.improvementPct > 0 ? "border-emerald-500/20 bg-emerald-500/5" : "border-rose-500/20 bg-rose-500/5")}>
          <div className="text-[9px] uppercase text-muted-foreground">Cost Improvement</div>
          <div className={cn("text-sm font-mono font-semibold", result.improvementPct > 0 ? "text-emerald-400" : "text-rose-400")}>{result.improvementPct > 0 ? "+" : ""}{result.improvementPct.toFixed(1)}%</div>
          <div className="text-[9px] text-muted-foreground mt-0.5">First 10 vs Last 10 episodes</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Avg Slippage vs Arrival</div>
          <div className={cn("text-sm font-mono font-semibold", avgSlippageVsArrival > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(avgSlippageVsArrival)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Avg Slippage vs TWAP</div>
          <div className={cn("text-sm font-mono font-semibold", avgSlippageVsTwap > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(avgSlippageVsTwap)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">Avg Slippage vs VWAP</div>
          <div className={cn("text-sm font-mono font-semibold", avgSlippageVsVwap > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(avgSlippageVsVwap)}</div>
        </Card>
        <Card className="p-2.5">
          <div className="text-[9px] uppercase text-muted-foreground">States Learned</div>
          <div className="text-sm font-mono font-semibold">{result.qTable.size}</div>
        </Card>
      </div>

      {/* Benchmark comparison */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Benchmark Comparison (Last 10 Episodes Average)</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className={cn("border rounded-md p-3", result.beatsTwap ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5")}>
              <div className="flex items-center gap-2 mb-1">
                {result.beatsTwap ? <TrendingDown className="w-4 h-4 text-emerald-400" /> : <TrendingUp className="w-4 h-4 text-rose-400" />}
                <span className="text-xs font-semibold">vs TWAP</span>
              </div>
              <div className={cn("text-lg font-mono font-bold", result.beatsTwap ? "text-emerald-400" : "text-rose-400")}>{fmtBps(avgSlippageVsTwap)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{result.beatsTwap ? "Agent BEATS TWAP" : "TWAP still better"}</div>
            </div>
            <div className={cn("border rounded-md p-3", result.beatsVwap ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/30 bg-rose-500/5")}>
              <div className="flex items-center gap-2 mb-1">
                {result.beatsVwap ? <TrendingDown className="w-4 h-4 text-emerald-400" /> : <TrendingUp className="w-4 h-4 text-rose-400" />}
                <span className="text-xs font-semibold">vs VWAP</span>
              </div>
              <div className={cn("text-lg font-mono font-bold", result.beatsVwap ? "text-emerald-400" : "text-rose-400")}>{fmtBps(avgSlippageVsVwap)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{result.beatsVwap ? "Agent BEATS VWAP" : "VWAP still better"}</div>
            </div>
            <div className="border rounded-md p-3">
              <div className="text-xs font-semibold mb-1">Best Episode</div>
              <div className="text-lg font-mono font-bold text-emerald-400">{fmtUsd(result.bestEpisode.totalCost)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Episode #{result.bestEpisode.episode}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Best vs Worst episode */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Best vs Worst Episode</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 border-y border-border"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-2 px-3">Metric</th><th className="text-right py-2 px-3">Best Episode</th><th className="text-right py-2 px-3">Worst Episode</th></tr></thead>
            <tbody>
              <tr className="border-b border-border/30"><td className="py-1.5 px-3">Episode #</td><td className="py-1.5 px-3 text-right font-mono">{result.bestEpisode.episode}</td><td className="py-1.5 px-3 text-right font-mono">{result.worstEpisode.episode}</td></tr>
              <tr className="border-b border-border/30"><td className="py-1.5 px-3">Total Cost</td><td className="py-1.5 px-3 text-right font-mono text-emerald-400">{fmtUsd(result.bestEpisode.totalCost)}</td><td className="py-1.5 px-3 text-right font-mono text-rose-400">{fmtUsd(result.worstEpisode.totalCost)}</td></tr>
              <tr className="border-b border-border/30"><td className="py-1.5 px-3">Avg Fill Price</td><td className="py-1.5 px-3 text-right font-mono">{result.bestEpisode.avgFillPrice.toFixed(4)}</td><td className="py-1.5 px-3 text-right font-mono">{result.worstEpisode.avgFillPrice.toFixed(4)}</td></tr>
              <tr className="border-b border-border/30"><td className="py-1.5 px-3">Arrival Price</td><td className="py-1.5 px-3 text-right font-mono">{result.bestEpisode.arrivalPrice.toFixed(4)}</td><td className="py-1.5 px-3 text-right font-mono">{result.worstEpisode.arrivalPrice.toFixed(4)}</td></tr>
              <tr className="border-b border-border/30"><td className="py-1.5 px-3">Slippage vs Arrival</td><td className={cn("py-1.5 px-3 text-right font-mono", result.bestEpisode.slippageVsArrivalBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(result.bestEpisode.slippageVsArrivalBps)}</td><td className={cn("py-1.5 px-3 text-right font-mono", result.worstEpisode.slippageVsArrivalBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(result.worstEpisode.slippageVsArrivalBps)}</td></tr>
              <tr className="border-b border-border/30"><td className="py-1.5 px-3">Slippage vs TWAP</td><td className={cn("py-1.5 px-3 text-right font-mono", result.bestEpisode.slippageVsTwapBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(result.bestEpisode.slippageVsTwapBps)}</td><td className={cn("py-1.5 px-3 text-right font-mono", result.worstEpisode.slippageVsTwapBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(result.worstEpisode.slippageVsTwapBps)}</td></tr>
              <tr><td className="py-1.5 px-3">Slippage vs VWAP</td><td className={cn("py-1.5 px-3 text-right font-mono", result.bestEpisode.slippageVsVwapBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(result.bestEpisode.slippageVsVwapBps)}</td><td className={cn("py-1.5 px-3 text-right font-mono", result.worstEpisode.slippageVsVwapBps > 0 ? "text-rose-400" : "text-emerald-400")}>{fmtBps(result.worstEpisode.slippageVsVwapBps)}</td></tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Live Policy View
// ============================================================
function PolicyView({ policy }: { policy: AgentPolicy }) {
  const actionData = ACTIONS.map((action, i) => ({
    action: ACTION_LABELS[action],
    qValue: policy.qValues[i],
    probability: policy.actionProbabilities[i] * 100,
    color: ACTION_COLORS[action],
  }));

  return (
    <div className="space-y-3">
      {/* Current recommendation */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-lg flex items-center justify-center" style={{ backgroundColor: ACTION_COLORS[policy.bestAction] + "30" }}>
              <Zap className="w-7 h-7" style={{ color: ACTION_COLORS[policy.bestAction] }} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold" style={{ color: ACTION_COLORS[policy.bestAction] }}>{ACTION_LABELS[policy.bestAction]}</span>
                <Badge variant="outline" className="text-[10px]">Recommended Action</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{policy.description}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase text-muted-foreground">Confidence</div>
              <div className="text-xl font-mono font-bold">{(Math.max(...policy.actionProbabilities) * 100).toFixed(0)}%</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current market state */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Current Market State</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
            <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">Remaining Qty</div><div className="font-mono font-semibold">{(policy.state.remainingQtyRatio * 100).toFixed(0)}%</div></div>
            <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">Time Remaining</div><div className="font-mono font-semibold">{(policy.state.timeRemainingRatio * 100).toFixed(0)}%</div></div>
            <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">Spread</div><div className="font-mono font-semibold">{policy.state.spreadPct.toFixed(3)}%</div></div>
            <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">Depth Imbalance</div><div className="font-mono font-semibold">{policy.state.depthImbalance.toFixed(2)}</div></div>
            <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">Volatility</div><div className="font-mono font-semibold">{(policy.state.volatility * 100).toFixed(2)}%</div></div>
            <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">Volume Ratio</div><div className="font-mono font-semibold">{policy.state.volumeRatio.toFixed(2)}x</div></div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">State Key: <code className="font-mono text-amber-400">{policy.stateKey}</code></div>
        </CardContent>
      </Card>

      {/* Q-values + action probabilities */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Q-Values per Action</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={actionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis dataKey="action" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} angle={-20} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} />
                  <Tooltip formatter={(v: any) => [Number(v).toFixed(4), "Q-Value"]} contentStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="#666" />
                  <Bar dataKey="qValue" radius={[2, 2, 0, 0]}>
                    {actionData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2"><CardTitle className="text-xs">Action Probabilities (Softmax)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={actionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                  <XAxis dataKey="action" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} angle={-20} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} tickFormatter={(v) => `${v.toFixed(0)}%`} />
                  <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}%`, "Probability"]} contentStyle={{ fontSize: 11 }} />
                  <Bar dataKey="probability" radius={[2, 2, 0, 0]}>
                    {actionData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// Learning Curve View
// ============================================================
function LearningCurveView({ result }: { result: TrainingResult }) {
  // Sample every N episodes for chart readability
  const sampleInterval = Math.max(1, Math.floor(result.episodes.length / 100));
  const chartData = result.episodes.filter((_, i) => i % sampleInterval === 0).map((e) => ({
    episode: e.episode,
    cost: e.totalCost,
    slippageArrival: e.slippageVsArrivalBps,
    slippageTwap: e.slippageVsTwapBps,
    epsilon: e.epsilon,
  }));

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Training Cost Over Episodes (lower = better)</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="episode" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={60} tickFormatter={(v) => `$${v.toFixed(0)}`} />
                <Tooltip formatter={(v: any, name: any) => [`$${Number(v).toFixed(2)}`, name]} contentStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#666" />
                <Line type="monotone" dataKey="cost" stroke="#ef4444" strokeWidth={1.5} dot={false} name="Total Cost" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Slippage vs Benchmarks Over Training</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="episode" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={50} tickFormatter={(v) => `${v.toFixed(1)}bps`} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)} bps`, ""]} contentStyle={{ fontSize: 11 }} />
                <ReferenceLine y={0} stroke="#666" />
                <Line type="monotone" dataKey="slippageArrival" stroke="#3b82f6" strokeWidth={1} dot={false} name="vs Arrival" />
                <Line type="monotone" dataKey="slippageTwap" stroke="#10b981" strokeWidth={1.5} dot={false} name="vs TWAP" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Exploration Rate (Epsilon) Decay</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="episode" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} tickFormatter={(v) => v.toFixed(2)} />
                <Tooltip formatter={(v: any) => [Number(v).toFixed(4), "Epsilon"]} contentStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="epsilon" stroke="#a855f7" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Q-Table Explorer View
// ============================================================
function QTableView({ stats }: { stats: ReturnType<typeof getQTableStats> }) {
  const distData = (Object.keys(stats.actionDistribution) as ActionType[]).map((action) => ({
    action: ACTION_LABELS[action],
    count: stats.actionDistribution[action],
    color: ACTION_COLORS[action],
  }));

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Total States</div><div className="text-sm font-mono font-semibold">{stats.totalStates}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Avg Q-Value</div><div className="text-sm font-mono font-semibold">{stats.avgQValue.toFixed(4)}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Max Q-Value</div><div className="text-sm font-mono font-semibold text-emerald-400">{stats.maxQValue.toFixed(4)}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Min Q-Value</div><div className="text-sm font-mono font-semibold text-rose-400">{stats.minQValue.toFixed(4)}</div></Card>
        <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Q-Range</div><div className="text-sm font-mono font-semibold">{(stats.maxQValue - stats.minQValue).toFixed(4)}</div></Card>
      </div>

      {/* Action distribution */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Action Distribution Across All States</CardTitle></CardHeader>
        <CardContent>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={distData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.2} />
                <XAxis dataKey="action" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={40} />
                <Tooltip formatter={(v: any) => [`${v} states`, "Count"]} contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {distData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Top states */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs">Top 10 Most Interesting States (by Q-value spread)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase">
                  <th className="text-left py-2 px-3">State Key</th>
                  <th className="text-center py-2 px-2">Best Action</th>
                  <th className="text-right py-2 px-3">Q[0]</th>
                  <th className="text-right py-2 px-3">Q[25]</th>
                  <th className="text-right py-2 px-3">Q[50]</th>
                  <th className="text-right py-2 px-3">Q[75]</th>
                  <th className="text-right py-2 px-3">Q[100]</th>
                  <th className="text-right py-2 px-3">Spread</th>
                  <th className="text-left py-2 px-3">Description</th>
                </tr>
              </thead>
              <tbody>
                {stats.topStates.map(({ stateKey, policy }) => {
                  const spread = Math.max(...policy.qValues) - Math.min(...policy.qValues);
                  return (
                    <tr key={stateKey} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-1.5 px-3 font-mono text-[10px] text-amber-400">{stateKey}</td>
                      <td className="py-1.5 px-2 text-center"><Badge variant="outline" className="text-[9px] h-4 px-1" style={{ backgroundColor: ACTION_COLORS[policy.bestAction] + "20", color: ACTION_COLORS[policy.bestAction] }}>{ACTION_LABELS[policy.bestAction]}</Badge></td>
                      {policy.qValues.map((q, i) => <td key={i} className={cn("py-1.5 px-3 text-right font-mono text-[10px]", q === Math.max(...policy.qValues) ? "text-emerald-400 font-bold" : "")}>{q.toFixed(4)}</td>)}
                      <td className="py-1.5 px-3 text-right font-mono font-semibold">{spread.toFixed(4)}</td>
                      <td className="py-1.5 px-3 text-[10px] text-muted-foreground truncate max-w-[150px]">{policy.description}</td>
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
