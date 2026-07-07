/**
 * Display formatting helpers.
 */

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
