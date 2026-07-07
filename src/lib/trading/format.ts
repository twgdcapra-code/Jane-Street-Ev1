/**
 * Display formatting helpers.
 */
import { MICRO_TO_FULL } from "./contracts";

/** Standard decimal places per symbol type — used by all UI panels. */
export function decimalsFor(symbol: string): number {
  const baseSym = MICRO_TO_FULL[symbol] ?? symbol;
  if (symbol === "BRR" || baseSym === "BRR") return 0;
  if (["6E", "6B", "M6E", "NG"].includes(baseSym) || ["6E", "6B", "M6E", "NG"].includes(symbol)) return 4;
  if (baseSym === "ZN" || baseSym === "ZB" || symbol === "MUB") return 4; // treasuries quote in 32nds, but we display decimals
  if (symbol === "SR3") return 3;
  if (symbol === "MUB") return 3;
  return 2;
}

export function fmtPrice(p: number, decimals = 2): string {
  if (!isFinite(p)) return "—";
  return p.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtMoney(p: number, decimals = 2): string {
  const sign = p < 0 ? "-" : "";
  return `${sign}$${Math.abs(p).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function fmtCompact(p: number, decimals = 1): string {
  if (!isFinite(p)) return "—";
  return p.toLocaleString("en-US", {
    notation: "compact",
    maximumFractionDigits: decimals,
  });
}

export function fmtPct(p: number, decimals = 2): string {
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(decimals)}%`;
}

export function fmtNum(p: number, decimals = 4): string {
  return p.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString("en-US", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function pnlColor(p: number): string {
  if (p > 0) return "text-emerald-400";
  if (p < 0) return "text-rose-400";
  return "text-muted-foreground";
}

export function bgPnlColor(p: number): string {
  if (p > 0) return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (p < 0) return "bg-rose-500/15 text-rose-400 border-rose-500/30";
  return "bg-muted text-muted-foreground border-border";
}

export function shortenId(id: string, len = 8): string {
  return id.length <= len ? id : `${id.slice(0, len)}…`;
}
