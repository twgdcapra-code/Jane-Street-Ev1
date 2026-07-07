"use client";

import { useMemo, useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import {
  generateEconomicCalendar,
  formatEventValue,
  getImpactColor,
  isImminent,
  type EventImpact,
} from "@/lib/trading/economic-calendar";
import { fmtDateTime, fmtPct } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, Calendar, Clock, Flame } from "lucide-react";

const COUNTRY_FLAGS: Record<string, string> = {
  US: "🇺🇸",
  EU: "🇪🇺",
  UK: "🇬🇧",
  JP: "🇯🇵",
  CN: "🇨🇳",
};

export function EconomicCalendar() {
  const tickCount = useTradingStore((s) => s.tickCount); // re-render on tick
  const [filter, setFilter] = useState<"ALL" | EventImpact>("ALL");
  const [countryFilter, setCountryFilter] = useState<string>("ALL");

  const events = useMemo(() => generateEconomicCalendar(), []);
  const now = Date.now();

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (filter !== "ALL" && e.impact !== filter) return false;
      if (countryFilter !== "ALL" && e.country !== countryFilter) return false;
      return true;
    });
  }, [events, filter, countryFilter]);

  const upcoming = filtered.filter((e) => e.datetime > now);
  const released = filtered.filter((e) => e.datetime <= now);
  const nextEvent = upcoming[0];
  const nextHighImpact = upcoming.find((e) => e.impact === "HIGH" || e.impact === "CRITICAL");

  const countries = Array.from(new Set(events.map((e) => e.country)));

  return (
    <div className="space-y-4">
      {/* Next event banner */}
      {nextEvent && (
        <Card className={cn(
          "border",
          isImminent(nextEvent, now) ? "border-rose-500/40 bg-rose-500/5" : "border-amber-500/30 bg-amber-500/5",
        )}>
          <CardContent className="p-3 flex items-center gap-3">
            {isImminent(nextEvent, now) ? (
              <Flame className="w-5 h-5 text-rose-500 animate-pulse" />
            ) : (
              <Clock className="w-5 h-5 text-amber-500" />
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{nextEvent.name}</span>
                <Badge variant="outline" className={cn("text-[9px] h-4 px-1", getImpactColor(nextEvent.impact))}>{nextEvent.impact}</Badge>
                <span className="text-xs text-muted-foreground">{COUNTRY_FLAGS[nextEvent.country] ?? nextEvent.country}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {fmtDateTime(nextEvent.datetime)} · in {formatTimeUntil(nextEvent.datetime - now)}
              </div>
            </div>
            <div className="text-right text-xs">
              <div className="text-muted-foreground">Forecast</div>
              <div className="font-mono font-semibold">{formatEventValue(nextEvent.forecast, nextEvent.unit)}</div>
            </div>
            <div className="text-right text-xs">
              <div className="text-muted-foreground">Previous</div>
              <div className="font-mono text-muted-foreground">{formatEventValue(nextEvent.previous, nextEvent.unit)}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Upcoming</div><div className="text-lg font-mono font-semibold">{upcoming.length}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Released</div><div className="text-lg font-mono font-semibold">{released.length}</div></Card>
        <Card className="p-3 border-rose-500/30 bg-rose-500/5"><div className="text-[10px] text-muted-foreground uppercase">Critical</div><div className="text-lg font-mono font-semibold text-rose-400">{events.filter((e) => e.impact === "CRITICAL").length}</div></Card>
        <Card className="p-3 border-amber-500/30 bg-amber-500/5"><div className="text-[10px] text-muted-foreground uppercase">High Impact</div><div className="text-lg font-mono font-semibold text-amber-400">{events.filter((e) => e.impact === "HIGH").length}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-muted-foreground uppercase">Next High Impact</div><div className="text-xs font-mono font-semibold mt-1">{nextHighImpact ? formatTimeUntil(nextHighImpact.datetime - now) : "—"}</div></Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
          {(["ALL", "CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-2.5 py-1 text-xs rounded transition-colors",
                filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f === "ALL" ? "All Impact" : f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
          <button
            onClick={() => setCountryFilter("ALL")}
            className={cn(
              "px-2.5 py-1 text-xs rounded transition-colors",
              countryFilter === "ALL" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            All Countries
          </button>
          {countries.map((c) => (
            <button
              key={c}
              onClick={() => setCountryFilter(c)}
              className={cn(
                "px-2 py-1 text-xs rounded transition-colors",
                countryFilter === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {COUNTRY_FLAGS[c] ?? c}
            </button>
          ))}
        </div>
      </div>

      {/* Event table */}
      <Card>
        <CardHeader className="py-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2"><Calendar className="w-4 h-4" /> Economic Calendar</CardTitle>
          <span className="text-[10px] text-muted-foreground">Times in local timezone</span>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  <th className="text-left py-2 px-3">Time</th>
                  <th className="text-left py-2 px-3">Country</th>
                  <th className="text-left py-2 px-3">Event</th>
                  <th className="text-center py-2 px-3">Impact</th>
                  <th className="text-right py-2 px-3">Forecast</th>
                  <th className="text-right py-2 px-3">Previous</th>
                  <th className="text-right py-2 px-3">Actual</th>
                  <th className="text-right py-2 px-3">Surprise</th>
                  <th className="text-left py-2 px-3">Affected</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const isPast = e.datetime <= now;
                  const imminent = isImminent(e, now);
                  return (
                    <tr
                      key={e.id}
                      className={cn(
                        "border-b border-border/40 hover:bg-muted/30",
                        imminent && "bg-rose-500/5",
                        isPast && "opacity-80",
                      )}
                    >
                      <td className="py-2 px-3 font-mono text-[10px] whitespace-nowrap">
                        {fmtDateTime(e.datetime)}
                        {imminent && <Flame className="w-3 h-3 text-rose-500 inline ml-1" />}
                      </td>
                      <td className="py-2 px-3 text-base">{COUNTRY_FLAGS[e.country] ?? e.country}</td>
                      <td className="py-2 px-3">
                        <div className="font-medium">{e.name}</div>
                        <div className="text-[10px] text-muted-foreground">{e.description}</div>
                      </td>
                      <td className="py-2 px-3 text-center">
                        <Badge variant="outline" className={cn("text-[9px] h-4 px-1", getImpactColor(e.impact))}>{e.impact}</Badge>
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatEventValue(e.forecast, e.unit)}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-muted-foreground">{formatEventValue(e.previous, e.unit)}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {e.actual != null ? (
                          <span className={cn("font-semibold", e.surprise != null && e.surprise > 0 ? "text-emerald-400" : e.surprise != null && e.surprise < 0 ? "text-rose-400" : "text-foreground")}>
                            {formatEventValue(e.actual, e.unit)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">
                        {e.surprise != null ? (
                          <span className={cn(e.surprise > 0 ? "text-emerald-400" : e.surprise < 0 ? "text-rose-400" : "text-muted-foreground")}>
                            {e.surprise > 0 ? "+" : ""}{formatEventValue(e.surprise, e.unit)}
                            {e.surprisePct != null && <span className="text-[9px] text-muted-foreground ml-1">({fmtPct(e.surprisePct)})</span>}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {e.affectedContracts.slice(0, 4).map((a) => (
                            <Badge key={a.symbol} variant="outline" className="text-[9px] h-4 px-1 font-mono">{a.symbol}</Badge>
                          ))}
                          {e.affectedContracts.length > 4 && <span className="text-[10px] text-muted-foreground">+{e.affectedContracts.length - 4}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Market impact for most recent released event */}
      {released.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Market Impact — {released[released.length - 1].name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {released[released.length - 1].marketImpact?.map((mi) => (
                <div key={mi.symbol} className="border border-border rounded-md p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-sm">{mi.symbol}</span>
                    <span className="text-[10px] text-muted-foreground">Expected vs Actual</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div>
                      <div className="text-[10px] text-muted-foreground">Expected Move</div>
                      <div className="font-mono tabular-nums">{fmtPct(mi.expectedMove)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-muted-foreground">Actual Move</div>
                      <div className={cn("font-mono tabular-nums font-semibold", mi.actualMove >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {fmtPct(mi.actualMove)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn("h-full", mi.actualMove >= 0 ? "bg-emerald-500" : "bg-rose-500")}
                      style={{ width: `${Math.min(100, Math.abs(mi.actualMove) * 20)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-muted-foreground mt-3">
              Surprise: {formatEventValue(released[released.length - 1].surprise, released[released.length - 1].unit)} ({fmtPct(released[released.length - 1].surprisePct ?? 0)}).
              Sensitivity = expected price move per unit of surprise. Actual move includes random market reaction component.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatTimeUntil(ms: number): string {
  if (ms <= 0) return "now";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (day > 0) return `${day}d ${hr % 24}h`;
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m`;
  return `${sec}s`;
}
