/**
 * Execution Algorithm Engine
 *
 * Implements 5 execution algorithms commonly used by institutional desks:
 *  - TWAP: Time-Weighted Average Price — split order evenly across time horizon
 *  - VWAP: Volume-Weighted Average Price — weight slices by historical intraday volume curve
 *  - ICEBERG: Show only a small visible quantity, refill as fills occur
 *  - POV: Percentage of Volume — dynamically size slices to X% of real-time volume
 *  - IS: Implementation Shortfall — trade aggressively early (risk-averse) or late (passive)
 *
 * Each algo runs as a state machine driven by ticks from the MarketEngine.
 */

import type { Quote, Side, OrderType, TimeInForce } from "./types";

export type AlgoType = "TWAP" | "VWAP" | "ICEBERG" | "POV" | "IS";

export interface AlgoParams {
  // Common
  totalQty: number;
  side: Side;
  symbol: string;
  // TWAP / VWAP
  durationSec?: number; // total time to execute
  slices?: number; // number of child orders (TWAP)
  // ICEBERG
  visibleQty?: number;
  // POV
  targetPct?: number; // 0.10 = 10% of volume
  // IS
  urgency?: "LOW" | "MEDIUM" | "HIGH"; // trade-front-weight
}

export interface AlgoState {
  id: string;
  type: AlgoType;
  params: AlgoParams;
  status: "QUEUED" | "RUNNING" | "PAUSED" | "COMPLETED" | "CANCELLED" | "FAILED";
  filledQty: number;
  remainingQty: number;
  avgFillPrice: number;
  startedAt: number;
  completedAt?: number;
  // Live tracking
  childOrdersPlaced: number;
  lastSliceAt?: number;
  nextSliceAt?: number;
  // Performance vs benchmark
  benchmarkPrice?: number; // arrival price
  slippageBps?: number;
  // Slice schedule (for TWAP/VWAP)
  schedule?: { time: number; qty: number; expectedPrice: number }[];
  scheduleIdx?: number;
  // Volume profile (for VWAP)
  volumeProfile?: number[]; // 390 1-minute buckets
  log: { time: number; message: string }[];
}

/** Standard U-shape intraday volume profile (open heavy, midday light, close heavy). */
export function defaultVolumeProfile(): number[] {
  const out: number[] = [];
  for (let i = 0; i < 390; i++) {
    // 6.5h RTH in 1-min buckets
    const t = i / 390;
    // U-shape: high at open, dips at lunch, ramps at close
    const openWeight = Math.exp(-t * 8) * 2.5;
    const closeWeight = Math.exp(-(1 - t) * 8) * 2.5;
    const lunchDip = 1 + 0.5 * Math.sin(Math.PI * t); // baseline
    out.push(openWeight + closeWeight + lunchDip);
  }
  // Normalize to sum = 1
  const sum = out.reduce((s, v) => s + v, 0);
  return out.map((v) => v / sum);
}

let algoCounter = 0;
function nextAlgoId(): string {
  return `algo-${Date.now().toString(36)}-${(algoCounter++).toString(36)}`;
}

/**
 * Initialise an algo state from params.
 */
export function createAlgo(type: AlgoType, params: AlgoParams): AlgoState {
  const id = nextAlgoId();
  const now = Date.now();
  const base: AlgoState = {
    id,
    type,
    params,
    status: "QUEUED",
    filledQty: 0,
    remainingQty: params.totalQty,
    avgFillPrice: 0,
    startedAt: now,
    childOrdersPlaced: 0,
    log: [{ time: now, message: `Algo ${type} created for ${params.side} ${params.totalQty} ${params.symbol}` }],
  };
  // Build slice schedule for TWAP/VWAP
  if (type === "TWAP" || type === "VWAP") {
    const slices = params.slices ?? 10;
    const durationSec = params.durationSec ?? 300;
    const intervalMs = (durationSec * 1000) / slices;
    const profile = type === "VWAP" ? defaultVolumeProfile() : null;
    const schedule: { time: number; qty: number; expectedPrice: number }[] = [];
    let remaining = params.totalQty;
    for (let i = 0; i < slices; i++) {
      const sliceTime = now + i * intervalMs;
      let qty: number;
      if (i === slices - 1) {
        qty = remaining;
      } else if (profile) {
        // VWAP weighting: use bucket proportional to profile (assume each slice = ~39 buckets)
        const bucketsPerSlice = Math.floor(profile.length / slices);
        let weight = 0;
        for (let j = 0; j < bucketsPerSlice; j++) weight += profile[i * bucketsPerSlice + j] ?? 0;
        qty = Math.max(1, Math.floor(params.totalQty * weight));
      } else {
        qty = Math.floor(params.totalQty / slices);
      }
      remaining -= qty;
      schedule.push({ time: sliceTime, qty, expectedPrice: 0 });
    }
    base.schedule = schedule;
    base.scheduleIdx = 0;
    base.nextSliceAt = schedule[0]?.time;
  }
  return base;
}

/**
 * Step the algo forward — called on each tick. Returns child orders to place.
 * Returns an array of { qty } that the host should submit as market/limit orders.
 */
export function stepAlgo(state: AlgoState, quote: Quote): { qty: number; orderType: OrderType; price?: number }[] {
  if (state.status !== "RUNNING" && state.status !== "QUEUED") return [];
  if (state.remainingQty <= 0) {
    state.status = "COMPLETED";
    state.completedAt = Date.now();
    state.log.push({ time: Date.now(), message: `Algo completed: filled ${state.filledQty} @ avg ${state.avgFillPrice.toFixed(4)}` });
    return [];
  }
  if (state.status === "QUEUED") {
    state.status = "RUNNING";
    state.benchmarkPrice = quote.last;
    state.log.push({ time: Date.now(), message: `Algo started. Benchmark (arrival) price: ${quote.last.toFixed(4)}` });
  }
  const now = Date.now();
  const orders: { qty: number; orderType: OrderType; price?: number }[] = [];
  switch (state.type) {
    case "TWAP":
    case "VWAP": {
      if (!state.schedule || state.scheduleIdx == null) return [];
      // Find due slices
      while (state.scheduleIdx < state.schedule.length && state.schedule[state.scheduleIdx].time <= now) {
        const slice = state.schedule[state.scheduleIdx];
        const qty = Math.min(slice.qty, state.remainingQty);
        if (qty > 0) {
          orders.push({ qty, orderType: "LIMIT", price: state.params.side === "BUY" ? quote.ask : quote.bid });
          state.childOrdersPlaced++;
          state.lastSliceAt = now;
          state.log.push({ time: now, message: `Slice ${state.scheduleIdx + 1}/${state.schedule.length}: ${qty} @ ${state.params.side === "BUY" ? quote.ask : quote.bid}` });
        }
        state.scheduleIdx++;
        if (state.scheduleIdx < state.schedule.length) {
          state.nextSliceAt = state.schedule[state.scheduleIdx].time;
        } else {
          state.nextSliceAt = undefined;
        }
      }
      break;
    }
    case "ICEBERG": {
      const visible = state.params.visibleQty ?? Math.max(1, Math.floor(state.params.totalQty * 0.1));
      const qty = Math.min(visible, state.remainingQty);
      if (qty > 0) {
        orders.push({ qty, orderType: "LIMIT", price: state.params.side === "BUY" ? quote.bid : quote.ask });
        state.childOrdersPlaced++;
        state.lastSliceAt = now;
        state.log.push({ time: now, message: `Iceberg slice: ${qty} (visible) @ ${state.params.side === "BUY" ? quote.bid : quote.ask}` });
      }
      // Refill every 2 seconds
      state.nextSliceAt = now + 2000;
      break;
    }
    case "POV": {
      // POV: aim for X% of recent volume. Without real volume tick stream,
      // we approximate by slicing proportional to recent volume (quote.volume changes).
      const targetPct = state.params.targetPct ?? 0.10;
      const recentVolume = quote.volume; // cumulative day volume
      // Approximate "volume since last slice"
      const lastVol = (state as any)._lastVol ?? 0;
      const volDelta = Math.max(0, recentVolume - lastVol);
      (state as any)._lastVol = recentVolume;
      if (volDelta > 0) {
        const targetQty = Math.min(state.remainingQty, Math.floor(volDelta * targetPct));
        if (targetQty > 0) {
          orders.push({ qty: targetQty, orderType: "MARKET" });
          state.childOrdersPlaced++;
          state.lastSliceAt = now;
          state.log.push({ time: now, message: `POV slice: ${targetQty} (${(targetPct * 100).toFixed(1)}% of vol ${volDelta})` });
        }
      }
      state.nextSliceAt = now + 3000;
      break;
    }
    case "IS": {
      // Implementation Shortfall: front-load if HIGH urgency (pay spread),
      // back-load if LOW (passive limit at mid), even if MEDIUM.
      const urgency = state.params.urgency ?? "MEDIUM";
      const durationSec = state.params.durationSec ?? 300;
      const elapsed = (now - state.startedAt) / 1000;
      const pctElapsed = Math.min(1, elapsed / durationSec);
      // Target completion curve: HIGH=aggressive front, LOW=passive back
      const targetPct =
        urgency === "HIGH" ? Math.pow(pctElapsed, 0.5) : urgency === "LOW" ? Math.pow(pctElapsed, 2) : pctElapsed;
      const targetFilled = state.params.totalQty * targetPct;
      const shortfall = targetFilled - state.filledQty;
      if (shortfall > 0) {
        const qty = Math.min(Math.ceil(shortfall), state.remainingQty);
        if (qty > 0) {
          // HIGH pays the ask (cross spread), LOW joins bid (passive)
          const price = urgency === "HIGH"
            ? (state.params.side === "BUY" ? quote.ask : quote.bid)
            : (state.params.side === "BUY" ? quote.bid : quote.ask);
          orders.push({ qty, orderType: "LIMIT", price });
          state.childOrdersPlaced++;
          state.lastSliceAt = now;
          state.log.push({ time: now, message: `IS slice: ${qty} @ ${price} (${urgency} urgency, target ${(targetPct * 100).toFixed(0)}%)` });
        }
      }
      state.nextSliceAt = now + 5000;
      break;
    }
  }
  return orders;
}

/**
 * Record a fill on an algo (called by host when child order fills).
 */
export function recordAlgoFill(state: AlgoState, qty: number, price: number) {
  const newFilled = state.filledQty + qty;
  state.avgFillPrice = state.avgFillPrice === 0 ? price : (state.avgFillPrice * state.filledQty + price * qty) / newFilled;
  state.filledQty = newFilled;
  state.remainingQty = Math.max(0, state.params.totalQty - newFilled);
  if (state.remainingQty === 0) {
    state.status = "COMPLETED";
    state.completedAt = Date.now();
    if (state.benchmarkPrice) {
      const slippage = state.params.side === "BUY"
        ? (state.avgFillPrice - state.benchmarkPrice) / state.benchmarkPrice
        : (state.benchmarkPrice - state.avgFillPrice) / state.benchmarkPrice;
      state.slippageBps = slippage * 10000;
    }
    state.log.push({ time: Date.now(), message: `✓ Completed. Avg ${state.avgFillPrice.toFixed(4)} vs arrival ${state.benchmarkPrice?.toFixed(4)} (${state.slippageBps?.toFixed(1)} bps)` });
  }
}

export function cancelAlgo(state: AlgoState) {
  state.status = "CANCELLED";
  state.completedAt = Date.now();
  state.log.push({ time: Date.now(), message: `Cancelled: filled ${state.filledQty}/${state.params.totalQty}` });
}

export function pauseAlgo(state: AlgoState) {
  if (state.status === "RUNNING") {
    state.status = "PAUSED";
    state.log.push({ time: Date.now(), message: "Paused" });
  }
}

export function resumeAlgo(state: AlgoState) {
  if (state.status === "PAUSED") {
    state.status = "RUNNING";
    state.log.push({ time: Date.now(), message: "Resumed" });
  }
}
