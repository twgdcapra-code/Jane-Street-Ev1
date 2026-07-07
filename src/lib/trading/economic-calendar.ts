/**
 * Economic Calendar Engine
 *
 * Simulates a stream of macro economic events (FOMC, CPI, NFP, GDP, etc.)
 * with expected vs actual values and computed market impact.
 *
 * Each event has:
 *  - Forecast (consensus)
 *  - Previous (last release)
 *  - Actual (simulated with surprise component)
 *  - Impact level (LOW/MEDIUM/HIGH)
 *  - Affected contracts (which futures should move and how)
 *
 * When an event "fires" (its release time passes), the market engine
 * sees a shock — we expose a function to compute the shock direction
 * and magnitude based on surprise vs forecast.
 */
import { CONTRACTS } from "./contracts";

export type EventImpact = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type EventStatus = "UPCOMING" | "IN_PROGRESS" | "RELEASED" | "CANCELLED";

export interface EconomicEvent {
  id: string;
  name: string;
  country: string;
  datetime: number; // release time (epoch ms)
  impact: EventImpact;
  forecast?: number;
  previous?: number;
  actual?: number;
  unit?: string; // "%", "K", "B", etc.
  status: EventStatus;
  affectedContracts: { symbol: string; sensitivity: number }[]; // sensitivity = price move per unit surprise
  // Computed post-release
  surprise?: number; // actual - forecast
  surprisePct?: number;
  marketImpact?: { symbol: string; expectedMove: number; actualMove: number }[];
  description: string;
}

let eventCounter = 0;
function nextEventId(): string {
  return `evt-${eventCounter++}`;
}

/** Generate a calendar of upcoming + recent events around the current time. */
export function generateEconomicCalendar(): EconomicEvent[] {
  const now = Date.now();
  const events: EconomicEvent[] = [];
  // Past events (already released)
  const pastDefs = [
    { name: "FOMC Rate Decision", country: "US", offsetH: -2, impact: "CRITICAL" as EventImpact, forecast: 5.5, previous: 5.5, unit: "%", desc: "Federal Reserve interest rate decision", affected: [{ symbol: "ES", sensitivity: 0.5 }, { symbol: "ZN", sensitivity: 0.05 }, { symbol: "BRR", sensitivity: 0.02 }] },
    { name: "CPI (YoY)", country: "US", offsetH: -6, impact: "HIGH" as EventImpact, forecast: 3.1, previous: 3.2, unit: "%", desc: "Consumer Price Index year-over-year", affected: [{ symbol: "ES", sensitivity: 0.4 }, { symbol: "GC", sensitivity: 0.3 }, { symbol: "ZN", sensitivity: 0.04 }] },
    { name: "Non-Farm Payrolls", country: "US", offsetH: -28, impact: "CRITICAL" as EventImpact, forecast: 180, previous: 175, unit: "K", desc: "Monthly change in non-farm payrolls", affected: [{ symbol: "ES", sensitivity: 0.6 }, { symbol: "ZN", sensitivity: 0.06 }] },
    { name: "GDP (QoQ Adv)", country: "US", offsetH: -50, impact: "HIGH" as EventImpact, forecast: 2.4, previous: 2.3, unit: "%", desc: "Gross Domestic Product advance estimate", affected: [{ symbol: "ES", sensitivity: 0.5 }, { symbol: "ZN", sensitivity: 0.03 }] },
    { name: "ECB Rate Decision", country: "EU", offsetH: -72, impact: "HIGH" as EventImpact, forecast: 4.25, previous: 4.25, unit: "%", desc: "European Central Bank rate decision", affected: [{ symbol: "6E", sensitivity: 0.01 }, { symbol: "ES", sensitivity: 0.2 }] },
  ];
  // Future events (upcoming)
  const futureDefs = [
    { name: "Initial Jobless Claims", country: "US", offsetH: 2, impact: "MEDIUM" as EventImpact, forecast: 220, previous: 218, unit: "K", desc: "Weekly initial unemployment claims", affected: [{ symbol: "ES", sensitivity: 0.15 }, { symbol: "ZN", sensitivity: 0.02 }] },
    { name: "PCE Price Index (YoY)", country: "US", offsetH: 5, impact: "HIGH" as EventImpact, forecast: 2.6, previous: 2.7, unit: "%", desc: "Fed's preferred inflation measure", affected: [{ symbol: "ES", sensitivity: 0.4 }, { symbol: "GC", sensitivity: 0.3 }, { symbol: "ZN", sensitivity: 0.05 }] },
    { name: "ISM Manufacturing PMI", country: "US", offsetH: 26, impact: "MEDIUM" as EventImpact, forecast: 48.5, previous: 48.7, unit: "", desc: "Institute for Supply Management manufacturing index", affected: [{ symbol: "ES", sensitivity: 0.25 }] },
    { name: "JOLTs Job Openings", country: "US", offsetH: 30, impact: "LOW" as EventImpact, forecast: 8400, previous: 8450, unit: "K", desc: "Job Openings and Labor Turnover Survey", affected: [{ symbol: "ES", sensitivity: 0.1 }] },
    { name: "ADP Employment Change", country: "US", offsetH: 48, impact: "MEDIUM" as EventImpact, forecast: 150, previous: 152, unit: "K", desc: "Private sector employment change", affected: [{ symbol: "ES", sensitivity: 0.2 }, { symbol: "ZN", sensitivity: 0.025 }] },
    { name: "Crude Oil Inventories", country: "US", offsetH: 52, impact: "HIGH" as EventImpact, forecast: -1500, previous: -2100, unit: "K bbl", desc: "Weekly EIA crude oil stock change", affected: [{ symbol: "CL", sensitivity: 0.005 }, { symbol: "NG", sensitivity: 0.003 }] },
    { name: "Non-Farm Payrolls", country: "US", offsetH: 74, impact: "CRITICAL" as EventImpact, forecast: 185, previous: 180, unit: "K", desc: "Monthly change in non-farm payrolls (next release)", affected: [{ symbol: "ES", sensitivity: 0.6 }, { symbol: "ZN", sensitivity: 0.06 }, { symbol: "BRR", sensitivity: 0.015 }] },
    { name: "Unemployment Rate", country: "US", offsetH: 74, impact: "HIGH" as EventImpact, forecast: 4.1, previous: 4.1, unit: "%", desc: "U-3 unemployment rate", affected: [{ symbol: "ES", sensitivity: 0.4 }, { symbol: "ZN", sensitivity: 0.04 }] },
    { name: "FOMC Rate Decision", country: "US", offsetH: 168, impact: "CRITICAL" as EventImpact, forecast: 5.25, previous: 5.5, unit: "%", desc: "Next FOMC — market pricing 25bp cut", affected: [{ symbol: "ES", sensitivity: 0.8 }, { symbol: "ZN", sensitivity: 0.08 }, { symbol: "BRR", sensitivity: 0.025 }] },
    { name: "CPI (YoY)", country: "US", offsetH: 192, impact: "HIGH" as EventImpact, forecast: 3.0, previous: 3.1, unit: "%", desc: "Next CPI release", affected: [{ symbol: "ES", sensitivity: 0.4 }, { symbol: "GC", sensitivity: 0.3 }] },
    { name: "Retail Sales (MoM)", country: "US", offsetH: 216, impact: "MEDIUM" as EventImpact, forecast: 0.3, previous: 0.2, unit: "%", desc: "Monthly retail sales change", affected: [{ symbol: "ES", sensitivity: 0.2 }] },
  ];
  for (const def of pastDefs) {
    const actual = simulateActual(def.forecast ?? 0, def.previous ?? 0);
    const surprise = actual - (def.forecast ?? 0);
    const surprisePct = (def.forecast ?? 0) !== 0 ? (surprise / (def.forecast ?? 1)) * 100 : 0;
    events.push({
      id: nextEventId(),
      name: def.name,
      country: def.country,
      datetime: now + def.offsetH * 3600_000,
      impact: def.impact,
      forecast: def.forecast,
      previous: def.previous,
      actual,
      unit: def.unit,
      status: "RELEASED",
      affectedContracts: def.affected,
      surprise,
      surprisePct,
      marketImpact: def.affected.map((a) => ({
        symbol: a.symbol,
        expectedMove: a.sensitivity * Math.abs(surprise),
        actualMove: a.sensitivity * surprise * (0.5 + Math.random() * 0.5),
      })),
      description: def.desc,
    });
  }
  for (const def of futureDefs) {
    events.push({
      id: nextEventId(),
      name: def.name,
      country: def.country,
      datetime: now + def.offsetH * 3600_000,
      impact: def.impact,
      forecast: def.forecast,
      previous: def.previous,
      unit: def.unit,
      status: "UPCOMING",
      affectedContracts: def.affected,
      description: def.desc,
    });
  }
  // Sort by datetime
  return events.sort((a, b) => a.datetime - b.datetime);
}

/** Simulate an actual release value based on forecast + random surprise. */
function simulateActual(forecast: number, previous: number): number {
  // Surprise = small random deviation, biased slightly toward previous (mean reversion)
  const surpriseMagnitude = Math.abs(forecast) * 0.05 + Math.abs(forecast - previous) * 0.3;
  const surprise = (Math.random() - 0.5) * 2 * surpriseMagnitude;
  return forecast + surprise;
}

/**
 * When an event fires (its release time passes), compute the price shocks
 * to apply to affected contracts.
 */
export function computeEventShocks(event: EconomicEvent): { symbol: string; shockPct: number }[] {
  if (event.actual == null || event.forecast == null) return [];
  const surprise = event.actual - event.forecast;
  return event.affectedContracts.map((a) => {
    // Direction: positive surprise (beat) = bullish for equities, bearish for bonds
    // Negative surprise (miss) = bearish for equities, bullish for bonds
    // We use a simple sign convention: positive surprise moves ES up, ZN down
    let direction = 1;
    if (a.symbol === "ZN" || a.symbol === "ZB" || a.symbol === "SR3") direction = -1;
    if (a.symbol === "GC") direction = surprise > 0 ? -1 : 1; // hot CPI = bearish gold (real rates up)
    const shockPct = direction * a.sensitivity * surprise * 100;
    return { symbol: a.symbol, shockPct };
  });
}

/** Format an event value with its unit. */
export function formatEventValue(value: number | undefined, unit?: string): string {
  if (value == null) return "—";
  let formatted: string;
  if (Math.abs(value) >= 1000) formatted = value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  else if (Math.abs(value) >= 10) formatted = value.toFixed(1);
  else formatted = value.toFixed(2);
  return unit ? `${formatted}${unit === "%" ? "%" : ` ${unit}`}` : formatted;
}

const IMPACT_COLORS: Record<EventImpact, string> = {
  LOW: "bg-muted text-muted-foreground border-border",
  MEDIUM: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  HIGH: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  CRITICAL: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

export function getImpactColor(impact: EventImpact): string {
  return IMPACT_COLORS[impact];
}

/** Check if event is "imminent" — within next 60 minutes. */
export function isImminent(event: EconomicEvent, now: number = Date.now()): boolean {
  const delta = event.datetime - now;
  return delta > 0 && delta < 3600_000;
}

/** Check if event just released — within last 60 minutes. */
export function isJustReleased(event: EconomicEvent, now: number = Date.now()): boolean {
  const delta = now - event.datetime;
  return delta > 0 && delta < 3600_000 && event.status === "RELEASED";
}
