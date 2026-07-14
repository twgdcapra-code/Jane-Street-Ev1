/**
 * RL Execution Agent Engine
 *
 * Based on /home/z/my-project/research/rl_execution.md (4,750 words).
 *
 * Implements a Deep Q-Network (DQN)-style agent that learns optimal order
 * execution slicing. Instead of fixed TWAP/VWAP schedules, the agent observes
 * market state and learns to minimize implementation shortfall.
 *
 * Architecture:
 *   - State: discretized market features (spread, depth, vol, time, qty)
 *   - Action: execution rate (0%, 25%, 50%, 75%, 100% of remaining)
 *   - Reward: -implementation_shortfall (negative cost)
 *   - Q-function: tabular Q-table (lightweight, trains in-browser)
 *   - Training: epsilon-greedy exploration, experience replay, Bellman updates
 *
 * The agent trains on simulated episodes (each episode = one parent order
 * execution). After N episodes, the learned policy should beat TWAP/VWAP by
 * adapting to market conditions (wider spread → slower execution, etc.).
 *
 * Benchmark: Almgren-Chriss optimal execution (closed-form solution).
 */
import { getEngine } from "./market-engine";
import { getContract } from "./contracts";

// ============================================================
// Types
// ============================================================

export type ActionType = "EXEC_0" | "EXEC_25" | "EXEC_50" | "EXEC_75" | "EXEC_100";
export const ACTIONS: ActionType[] = ["EXEC_0", "EXEC_25", "EXEC_50", "EXEC_75", "EXEC_100"];
const ACTION_RATES: Record<ActionType, number> = {
  EXEC_0: 0.0, EXEC_25: 0.25, EXEC_50: 0.5, EXEC_75: 0.75, EXEC_100: 1.0,
};

export interface MarketState {
  remainingQtyRatio: number;  // 0-1 (1 = full order remaining)
  timeRemainingRatio: number; // 0-1 (1 = start of execution)
  spreadPct: number;          // spread / midprice × 100
  depthImbalance: number;     // -1 to 1 (bid-heavy to ask-heavy)
  volatility: number;         // recent realized vol (daily)
  volumeRatio: number;        // current volume / avg volume
  // Discretized state key
  stateKey: string;
}

export interface ExecutionStep {
  step: number;
  state: MarketState;
  action: ActionType;
  execQty: number;
  execPrice: number;
  reward: number;
  cumulativeCost: number;
  remainingQty: number;
  marketPrice: number;
  spread: number;
  isExplore: boolean;
}

export interface EpisodeResult {
  episode: number;
  totalCost: number;          // total implementation shortfall ($)
  avgFillPrice: number;
  arrivalPrice: number;
  vwapBenchmark: number;
  twapBenchmark: number;
  slippageVsArrivalBps: number;
  slippageVsVwapBps: number;
  slippageVsTwapBps: number;
  steps: ExecutionStep[];
  isExplore: boolean;
  epsilon: number;
  episodeReward: number;
}

export interface TrainingResult {
  episodes: EpisodeResult[];
  qTable: Map<string, number[]>;
  finalEpsilon: number;
  avgCostLast10: number;
  avgCostFirst10: number;
  improvementPct: number;       // (first10 - last10) / first10 × 100
  beatsTwap: boolean;
  beatsVwap: boolean;
  bestEpisode: EpisodeResult;
  worstEpisode: EpisodeResult;
  totalTrainingSteps: number;
  durationMs: number;
}

export interface AgentPolicy {
  stateKey: string;
  state: MarketState;
  qValues: number[];
  bestAction: ActionType;
  actionProbabilities: number[];
  description: string;
}

// ============================================================
// State discretization
// ============================================================

function discretize(
  remainingQtyRatio: number,
  timeRemainingRatio: number,
  spreadPct: number,
  depthImbalance: number,
  volatility: number,
  volumeRatio: number,
): string {
  // Discretize each feature into buckets to create a state key
  const qtyBucket = Math.floor(remainingQtyRatio * 4);           // 0-3 (4 buckets)
  const timeBucket = Math.floor(timeRemainingRatio * 4);         // 0-3
  const spreadBucket = spreadPct < 0.05 ? 0 : spreadPct < 0.1 ? 1 : spreadPct < 0.2 ? 2 : 3; // 4 buckets
  const depthBucket = depthImbalance < -0.3 ? 0 : depthImbalance < 0 ? 1 : depthImbalance < 0.3 ? 2 : 3; // 4
  const volBucket = volatility < 0.01 ? 0 : volatility < 0.02 ? 1 : volatility < 0.03 ? 2 : 3; // 4
  const volumeBucket = volumeRatio < 0.5 ? 0 : volumeRatio < 1.0 ? 1 : volumeRatio < 1.5 ? 2 : 3; // 4
  return `${qtyBucket}_${timeBucket}_${spreadBucket}_${depthBucket}_${volBucket}_${volumeBucket}`;
}

// ============================================================
// Market simulator for execution
// ============================================================

class ExecutionSimulator {
  symbol: string;
  totalQty: number;
  numSteps: number;
  currentStep: number = 0;
  remainingQty: number;
  filledQty: number = 0;
  totalCost: number = 0;
  weightedPriceSum: number = 0;
  arrivalPrice: number;
  baseVol: number;
  adv: number;

  constructor(symbol: string, totalQty: number, numSteps: number = 10) {
    this.symbol = symbol;
    this.totalQty = totalQty;
    this.numSteps = numSteps;
    this.remainingQty = totalQty;
    const contract = getContract(symbol);
    const engine = getEngine();
    const quote = engine.getQuote(symbol);
    this.arrivalPrice = quote?.last ?? contract.basePrice;
    this.baseVol = contract.volatility;
    // ADV approximation from recent candle volume
    const candles = engine.getCandles(symbol, 30);
    this.adv = candles.length > 0 ? candles.reduce((s, c) => s + c.volume, 0) / candles.length : 1000;
  }

  getCurrentState(): MarketState {
    const engine = getEngine();
    const quote = engine.getQuote(this.symbol);
    const mid = quote ? (quote.bid + quote.ask) / 2 : this.arrivalPrice;
    const spread = quote ? (quote.ask - quote.bid) : 0;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;
    const depthImbalance = quote && (quote.bidSize + quote.askSize) > 0
      ? (quote.bidSize - quote.askSize) / (quote.bidSize + quote.askSize)
      : 0;

    // Recent volatility from candles
    const candles = engine.getCandles(this.symbol, 20);
    let vol = this.baseVol;
    if (candles.length >= 10) {
      const rets: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        if (candles[i - 1].close > 0) rets.push(Math.log(candles[i].close / candles[i - 1].close));
      }
      const mean = rets.reduce((s, v) => s + v, 0) / Math.max(rets.length, 1);
      vol = Math.sqrt(rets.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(rets.length - 1, 1));
    }

    // Volume ratio: current candle volume / avg
    const currentVol = candles.length > 0 ? candles[candles.length - 1].volume : 1000;
    const avgVol = candles.length > 5 ? candles.slice(-5).reduce((s, c) => s + c.volume, 0) / 5 : 1000;
    const volumeRatio = avgVol > 0 ? currentVol / avgVol : 1;

    const remainingQtyRatio = this.totalQty > 0 ? this.remainingQty / this.totalQty : 0;
    const timeRemainingRatio = this.numSteps > 0 ? (this.numSteps - this.currentStep) / this.numSteps : 0;

    const stateKey = discretize(remainingQtyRatio, timeRemainingRatio, spreadPct, depthImbalance, vol, volumeRatio);

    return {
      remainingQtyRatio,
      timeRemainingRatio,
      spreadPct,
      depthImbalance,
      volatility: vol,
      volumeRatio,
      stateKey,
    };
  }

  execute(action: ActionType): { execQty: number; execPrice: number; reward: number; marketPrice: number; spread: number } {
    const engine = getEngine();
    const quote = engine.getQuote(this.symbol);
    const mid = quote ? (quote.bid + quote.ask) / 2 : this.arrivalPrice;
    const spread = quote ? (quote.ask - quote.bid) : 0;

    const execRate = ACTION_RATES[action];
    const execQty = Math.min(this.remainingQty, this.totalQty * execRate * (1 / this.numSteps) * 2);
    // Actually: execQty = remaining × rate
    const actualExecQty = Math.min(this.remainingQty, this.remainingQty * execRate + (this.totalQty / this.numSteps) * 0.1);
    const finalExecQty = Math.max(0, actualExecQty);

    if (finalExecQty === 0) {
      // Penalty for not executing when time is running out
      const timePenalty = this.currentStep >= this.numSteps - 1 && this.remainingQty > 0 ? -this.remainingQty * 0.5 : 0;
      this.currentStep++;
      return { execQty: 0, execPrice: mid, reward: timePenalty, marketPrice: mid, spread };
    }

    // Execution price = mid + half-spread + market impact
    const halfSpread = spread / 2;
    const contract = getContract(this.symbol);
    // Square-root market impact: impact = κ × σ × √(Q/ADV)
    const kappa = 0.142;
    const impact = kappa * this.baseVol * Math.sqrt(finalExecQty / Math.max(this.adv, 1));
    // For buys: pay mid + halfSpread + impact; for sells: receive mid - halfSpread - impact
    // We assume buy for simplicity (the agent learns the same way for sells)
    const execPrice = mid + halfSpread + impact * mid;

    // Reward = negative implementation shortfall
    const shortfall = (execPrice - this.arrivalPrice) * finalExecQty;
    const reward = -shortfall;

    this.remainingQty -= finalExecQty;
    this.filledQty += finalExecQty;
    this.totalCost += shortfall;
    this.weightedPriceSum += execPrice * finalExecQty;
    this.currentStep++;

    return { execQty: finalExecQty, execPrice, reward, marketPrice: mid, spread };
  }

  getAvgFillPrice(): number {
    return this.filledQty > 0 ? this.weightedPriceSum / this.filledQty : this.arrivalPrice;
  }

  isDone(): boolean {
    return this.currentStep >= this.numSteps || this.remainingQty <= 0;
  }

  getVwapBenchmark(): number {
    // VWAP = average of all step prices weighted by simulated volume
    const engine = getEngine();
    const candles = engine.getCandles(this.symbol, this.numSteps);
    if (candles.length === 0) return this.arrivalPrice;
    const totalVol = candles.reduce((s, c) => s + c.volume, 0);
    return totalVol > 0 ? candles.reduce((s, c) => s + c.close * c.volume, 0) / totalVol : this.arrivalPrice;
  }

  getTwapBenchmark(): number {
    const engine = getEngine();
    const candles = engine.getCandles(this.symbol, this.numSteps);
    if (candles.length === 0) return this.arrivalPrice;
    return candles.reduce((s, c) => s + c.close, 0) / candles.length;
  }
}

// ============================================================
// Q-Learning Agent
// ============================================================

const LEARNING_RATE = 0.1;
const DISCOUNT_FACTOR = 0.95;
const INITIAL_EPSILON = 1.0;
const MIN_EPSILON = 0.05;
const EPSILON_DECAY = 0.995;

export class QLearningAgent {
  qTable: Map<string, number[]>;
  epsilon: number;
  replayBuffer: { state: string; action: number; reward: number; nextState: string; done: boolean }[];
  maxReplaySize: number;

  constructor() {
    this.qTable = new Map();
    this.epsilon = INITIAL_EPSILON;
    this.replayBuffer = [];
    this.maxReplaySize = 5000;
  }

  getQValues(stateKey: string): number[] {
    if (!this.qTable.has(stateKey)) {
      this.qTable.set(stateKey, new Array(ACTIONS.length).fill(0));
    }
    return this.qTable.get(stateKey)!;
  }

  selectAction(stateKey: string, explore: boolean = true): { action: ActionType; actionIndex: number; isExplore: boolean } {
    const qValues = this.getQValues(stateKey);
    if (explore && Math.random() < this.epsilon) {
      // Explore: random action
      const idx = Math.floor(Math.random() * ACTIONS.length);
      return { action: ACTIONS[idx], actionIndex: idx, isExplore: true };
    }
    // Exploit: best action
    let bestIdx = 0;
    let bestQ = qValues[0];
    for (let i = 1; i < qValues.length; i++) {
      if (qValues[i] > bestQ) { bestQ = qValues[i]; bestIdx = i; }
    }
    return { action: ACTIONS[bestIdx], actionIndex: bestIdx, isExplore: false };
  }

  update(stateKey: string, actionIndex: number, reward: number, nextStateKey: string, done: boolean): void {
    const currentQ = this.getQValues(stateKey);
    const nextQ = this.getQValues(nextStateKey);
    const maxNextQ = done ? 0 : Math.max(...nextQ);
    // Bellman update: Q(s,a) = Q(s,a) + α [r + γ max_a' Q(s',a') - Q(s,a)]
    currentQ[actionIndex] = currentQ[actionIndex] + LEARNING_RATE * (reward + DISCOUNT_FACTOR * maxNextQ - currentQ[actionIndex]);

    // Store in replay buffer
    this.replayBuffer.push({ state: stateKey, action: actionIndex, reward, nextState: nextStateKey, done });
    if (this.replayBuffer.length > this.maxReplaySize) {
      this.replayBuffer.shift();
    }
  }

  replay(batchSize: number = 32): void {
    if (this.replayBuffer.length < batchSize) return;
    // Sample random batch and update
    for (let i = 0; i < batchSize; i++) {
      const idx = Math.floor(Math.random() * this.replayBuffer.length);
      const exp = this.replayBuffer[idx];
      const currentQ = this.getQValues(exp.state);
      const nextQ = this.getQValues(exp.nextState);
      const maxNextQ = exp.done ? 0 : Math.max(...nextQ);
      currentQ[exp.action] = currentQ[exp.action] + LEARNING_RATE * (exp.reward + DISCOUNT_FACTOR * maxNextQ - currentQ[exp.action]);
    }
  }

  decayEpsilon(): void {
    this.epsilon = Math.max(MIN_EPSILON, this.epsilon * EPSILON_DECAY);
  }

  getPolicy(stateKey: string): AgentPolicy {
    const qValues = this.getQValues(stateKey);
    let bestIdx = 0;
    for (let i = 1; i < qValues.length; i++) {
      if (qValues[i] > qValues[bestIdx]) bestIdx = i;
    }
    // Softmax to get action probabilities
    const maxQ = Math.max(...qValues);
    const expQ = qValues.map((q) => Math.exp((q - maxQ) / 10));
    const sumExp = expQ.reduce((s, v) => s + v, 0);
    const probs = expQ.map((e) => e / sumExp);

    return {
      stateKey,
      state: this.parseStateKey(stateKey),
      qValues,
      bestAction: ACTIONS[bestIdx],
      actionProbabilities: probs,
      description: this.describePolicy(ACTIONS[bestIdx]),
    };
  }

  parseStateKey(key: string): MarketState {
    const [qty, time, spread, depth, vol, volume] = key.split("_").map(Number);
    return {
      remainingQtyRatio: qty / 3,
      timeRemainingRatio: time / 3,
      spreadPct: spread * 0.05 + 0.025,
      depthImbalance: (depth - 1.5) / 1.5,
      volatility: vol * 0.01 + 0.005,
      volumeRatio: volume * 0.5 + 0.25,
      stateKey: key,
    };
  }

  describePolicy(action: ActionType): string {
    const rate = ACTION_RATES[action];
    if (rate === 0) return "Pause execution — wait for better conditions";
    if (rate <= 0.25) return "Slow execution — minimize market impact";
    if (rate <= 0.5) return "Moderate execution — balance speed vs impact";
    if (rate <= 0.75) return "Aggressive execution — front-load to beat drift";
    return "Maximum execution — fill immediately (urgent)";
  }
}

// ============================================================
// Training loop
// ============================================================

export function trainAgent(
  symbol: string,
  totalQty: number = 10,
  numEpisodes: number = 500,
  stepsPerEpisode: number = 10,
): TrainingResult {
  const startTime = Date.now();
  const agent = new QLearningAgent();
  const episodes: EpisodeResult[] = [];

  for (let ep = 0; ep < numEpisodes; ep++) {
    const sim = new ExecutionSimulator(symbol, totalQty, stepsPerEpisode);
    const steps: ExecutionStep[] = [];
    let cumulativeCost = 0;
    let episodeReward = 0;
    let hadExploration = false;

    while (!sim.isDone()) {
      const state = sim.getCurrentState();
      const { action, actionIndex, isExplore } = agent.selectAction(state.stateKey, true);
      if (isExplore) hadExploration = true;
      const { execQty, execPrice, reward, marketPrice, spread } = sim.execute(action);
      cumulativeCost += (execPrice - sim.arrivalPrice) * execQty;
      episodeReward += reward;

      // Get next state (currentStep already advanced in execute)
      const nextState = sim.isDone() ? state : sim.getCurrentState();
      agent.update(state.stateKey, actionIndex, reward, nextState.stateKey, sim.isDone());

      steps.push({
        step: sim.currentStep - 1,
        state,
        action,
        execQty,
        execPrice,
        reward,
        cumulativeCost,
        remainingQty: sim.remainingQty,
        marketPrice,
        spread,
        isExplore,
      });
    }

    // Replay experience
    agent.replay(32);
    agent.decayEpsilon();

    const avgFillPrice = sim.getAvgFillPrice();
    const vwap = sim.getVwapBenchmark();
    const twap = sim.getTwapBenchmark();
    const arrivalPrice = sim.arrivalPrice;

    const slippageVsArrivalBps = arrivalPrice > 0 ? ((avgFillPrice - arrivalPrice) / arrivalPrice) * 10000 : 0;
    const slippageVsVwapBps = vwap > 0 ? ((avgFillPrice - vwap) / vwap) * 10000 : 0;
    const slippageVsTwapBps = twap > 0 ? ((avgFillPrice - twap) / twap) * 10000 : 0;

    episodes.push({
      episode: ep,
      totalCost: sim.totalCost,
      avgFillPrice,
      arrivalPrice,
      vwapBenchmark: vwap,
      twapBenchmark: twap,
      slippageVsArrivalBps,
      slippageVsVwapBps,
      slippageVsTwapBps,
      steps,
      isExplore: hadExploration,
      epsilon: agent.epsilon,
      episodeReward,
    });
  }

  // Compute stats
  const first10 = episodes.slice(0, 10);
  const last10 = episodes.slice(-10);
  const avgCostFirst10 = first10.reduce((s, e) => s + e.totalCost, 0) / Math.max(first10.length, 1);
  const avgCostLast10 = last10.reduce((s, e) => s + e.totalCost, 0) / Math.max(last10.length, 1);
  const improvementPct = avgCostFirst10 > 0 ? ((avgCostFirst10 - avgCostLast10) / avgCostFirst10) * 100 : 0;

  // Check if beats TWAP/VWAP
  const avgSlippageLast10VsTwap = last10.reduce((s, e) => s + e.slippageVsTwapBps, 0) / Math.max(last10.length, 1);
  const avgSlippageLast10VsVwap = last10.reduce((s, e) => s + e.slippageVsVwapBps, 0) / Math.max(last10.length, 1);
  const beatsTwap = avgSlippageLast10VsTwap < 0;
  const beatsVwap = avgSlippageLast10VsVwap < 0;

  const bestEpisode = episodes.reduce((a, b) => a.totalCost < b.totalCost ? a : b);
  const worstEpisode = episodes.reduce((a, b) => a.totalCost > b.totalCost ? a : b);

  return {
    episodes,
    qTable: agent.qTable,
    finalEpsilon: agent.epsilon,
    avgCostLast10,
    avgCostFirst10,
    improvementPct,
    beatsTwap,
    beatsVwap,
    bestEpisode,
    worstEpisode,
    totalTrainingSteps: numEpisodes * stepsPerEpisode,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================
// Inference: get policy for current market state
// ============================================================

export function getAgentPolicy(qTable: Map<string, number[]>, symbol: string, totalQty: number): AgentPolicy | null {
  if (qTable.size === 0) return null;
  const sim = new ExecutionSimulator(symbol, totalQty, 10);
  const state = sim.getCurrentState();
  const agent = new QLearningAgent();
  agent.qTable = qTable;
  agent.epsilon = 0; // pure exploitation
  return agent.getPolicy(state.stateKey);
}

// ============================================================
// Q-table statistics
// ============================================================

export interface QTableStats {
  totalStates: number;
  topStates: { stateKey: string; policy: AgentPolicy }[];
  actionDistribution: Record<ActionType, number>;
  avgQValue: number;
  maxQValue: number;
  minQValue: number;
}

export function getQTableStats(qTable: Map<string, number[]>): QTableStats {
  const agent = new QLearningAgent();
  agent.qTable = qTable;
  agent.epsilon = 0;

  const states = Array.from(qTable.keys());
  const actionDist: Record<ActionType, number> = { EXEC_0: 0, EXEC_25: 0, EXEC_50: 0, EXEC_75: 0, EXEC_100: 0 };
  let totalQ = 0;
  let maxQ = -Infinity;
  let minQ = Infinity;
  const policies: { stateKey: string; policy: AgentPolicy }[] = [];

  for (const stateKey of states) {
    const policy = agent.getPolicy(stateKey);
    actionDist[policy.bestAction]++;
    policies.push({ stateKey, policy });
    for (const q of policy.qValues) {
      totalQ += q;
      maxQ = Math.max(maxQ, q);
      minQ = Math.min(minQ, q);
    }
  }

  // Top states by Q-value spread (most interesting policies)
  policies.sort((a, b) => {
    const aSpread = Math.max(...a.policy.qValues) - Math.min(...a.policy.qValues);
    const bSpread = Math.max(...b.policy.qValues) - Math.min(...b.policy.qValues);
    return bSpread - aSpread;
  });

  return {
    totalStates: states.length,
    topStates: policies.slice(0, 10),
    actionDistribution: actionDist,
    avgQValue: states.length > 0 ? totalQ / (states.length * ACTIONS.length) : 0,
    maxQValue: maxQ === -Infinity ? 0 : maxQ,
    minQValue: minQ === Infinity ? 0 : minQ,
  };
}
