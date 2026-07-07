"use client";

import { useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { CONTRACTS } from "@/lib/trading/contracts";
import type { AlertCondition } from "@/lib/trading/alerts";
import { fmtPrice, fmtTime, decimalsFor } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Bell, BellRing, Eye, EyeOff, Plus, RotateCcw, Star, Trash2, X } from "lucide-react";

const CONDITIONS: { value: AlertCondition; label: string; category: string; thresholdLabel: string; default: number }[] = [
  { value: "PRICE_ABOVE", label: "Price Above", category: "Price", thresholdLabel: "Price Level", default: 5500 },
  { value: "PRICE_BELOW", label: "Price Below", category: "Price", thresholdLabel: "Price Level", default: 5400 },
  { value: "PCT_CHANGE_UP", label: "% Change Up", category: "Price", thresholdLabel: "% from creation", default: 1 },
  { value: "PCT_CHANGE_DOWN", label: "% Change Down", category: "Price", thresholdLabel: "% from creation", default: 1 },
  { value: "RSI_OVERBOUGHT", label: "RSI Overbought", category: "Technical", thresholdLabel: "RSI level", default: 70 },
  { value: "RSI_OVERSOLD", label: "RSI Oversold", category: "Technical", thresholdLabel: "RSI level", default: 30 },
  { value: "SMA_CROSS_UP", label: "SMA Cross Up", category: "Technical", thresholdLabel: "SMA period", default: 20 },
  { value: "SMA_CROSS_DOWN", label: "SMA Cross Down", category: "Technical", thresholdLabel: "SMA period", default: 20 },
  { value: "BB_UPPER_TOUCH", label: "BB Upper Touch", category: "Technical", thresholdLabel: "(unused)", default: 0 },
  { value: "BB_LOWER_TOUCH", label: "BB Lower Touch", category: "Technical", thresholdLabel: "(unused)", default: 0 },
  { value: "ATR_SPIKE", label: "ATR Spike", category: "Technical", thresholdLabel: "% ATR jump", default: 50 },
  { value: "VOLUME_SPIKE", label: "Volume Spike", category: "Technical", thresholdLabel: "% above baseline", default: 200 },
];

export function AlertsWatchlist() {
  const priceAlerts = useTradingStore((s) => s.priceAlerts);
  const watchlists = useTradingStore((s) => s.watchlists);
  const addPriceAlert = useTradingStore((s) => s.addPriceAlert);
  const removePriceAlert = useTradingStore((s) => s.removePriceAlert);
  const togglePriceAlert = useTradingStore((s) => s.togglePriceAlert);
  const resetPriceAlert = useTradingStore((s) => s.resetPriceAlert);
  const addWatchlist = useTradingStore((s) => s.addWatchlist);
  const removeWatchlist = useTradingStore((s) => s.removeWatchlist);
  const addWatchlistEntry = useTradingStore((s) => s.addWatchlistEntry);
  const removeWatchlistEntry = useTradingStore((s) => s.removeWatchlistEntry);
  const selectSymbol = useTradingStore((s) => s.selectSymbol);
  const quotes = useTradingStore((s) => s.quotes);
  const selectedSymbol = useTradingStore((s) => s.selectedSymbol);
  const [newAlertSymbol, setNewAlertSymbol] = useState(selectedSymbol);
  const [newAlertCondition, setNewAlertCondition] = useState<AlertCondition>("PRICE_ABOVE");
  const [newAlertThreshold, setNewAlertThreshold] = useState(5500);
  const [newAlertName, setNewAlertName] = useState("Alert");
  const [newWlName, setNewWlName] = useState("");
  const [activeWatchlist, setActiveWatchlist] = useState<string>(watchlists[0]?.id ?? "");
  const [newEntrySymbol, setNewEntrySymbol] = useState("ES");
  const [newEntryNote, setNewEntryNote] = useState("");

  const currentCondition = CONDITIONS.find((c) => c.value === newAlertCondition)!;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Price alerts */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BellRing className="w-4 h-4" /> Price Alerts
              <Badge variant="outline" className="text-[10px]">{priceAlerts.filter((a) => a.enabled && !a.triggered).length} active</Badge>
              <Badge variant="outline" className="text-[10px] bg-rose-500/15 text-rose-400 border-rose-500/30">{priceAlerts.filter((a) => a.triggered).length} triggered</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Create new alert */}
            <div className="border border-border rounded-md p-2.5 space-y-2 bg-muted/30">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Create New Alert</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Symbol</Label>
                  <select
                    value={newAlertSymbol}
                    onChange={(e) => setNewAlertSymbol(e.target.value)}
                    className="w-full mt-0.5 bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono"
                  >
                    {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Name</Label>
                  <Input value={newAlertName} onChange={(e) => setNewAlertName(e.target.value)} className="h-8 text-xs mt-0.5" />
                </div>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Condition</Label>
                <select
                  value={newAlertCondition}
                  onChange={(e) => {
                    setNewAlertCondition(e.target.value as AlertCondition);
                    const cond = CONDITIONS.find((c) => c.value === e.target.value)!;
                    setNewAlertThreshold(cond.default);
                  }}
                  className="w-full mt-0.5 bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs"
                >
                  {["Price", "Technical"].map((cat) => (
                    <optgroup key={cat} label={cat}>
                      {CONDITIONS.filter((c) => c.category === cat).map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              {currentCondition.thresholdLabel !== "(unused)" && (
                <div>
                  <Label className="text-[10px] text-muted-foreground">{currentCondition.thresholdLabel}</Label>
                  <Input
                    type="number"
                    step="any"
                    value={newAlertThreshold}
                    onChange={(e) => setNewAlertThreshold(Number(e.target.value))}
                    className="h-8 text-xs font-mono mt-0.5"
                  />
                </div>
              )}
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  addPriceAlert(newAlertSymbol, newAlertCondition, newAlertThreshold, newAlertName);
                }}
              >
                <Plus className="w-3 h-3 mr-1" /> Add Alert
              </Button>
            </div>

            {/* Active alerts list */}
            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {priceAlerts.length === 0 ? (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  <Bell className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  No alerts. Create one above.
                </div>
              ) : (
                priceAlerts.map((a) => {
                  const cond = CONDITIONS.find((c) => c.value === a.condition);
                  const quote = quotes[a.symbol];
                  return (
                    <div
                      key={a.id}
                      className={cn(
                        "border rounded-md p-2 text-xs",
                        a.triggered
                          ? "border-rose-500/40 bg-rose-500/10"
                          : a.enabled
                            ? "border-border bg-muted/30"
                            : "border-border/40 bg-muted/10 opacity-60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-medium truncate">{a.name}</span>
                            {a.triggered && <Badge variant="outline" className="text-[9px] h-4 px-1 bg-rose-500/15 text-rose-400 border-rose-500/30">TRIGGERED</Badge>}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            {a.symbol} · {cond?.label} {a.threshold}
                            {quote && <> · Now: <span className="text-foreground">{fmtPrice(quote.last, decimalsFor(a.symbol))}</span></>}
                          </div>
                          {a.triggered && a.triggeredAt && (
                            <div className="text-[10px] text-rose-400 font-mono mt-0.5">
                              Fired at {fmtTime(a.triggeredAt)} @ {a.triggeredValue?.toFixed(4)}
                            </div>
                          )}
                          {a.anchorPrice && (
                            <div className="text-[10px] text-muted-foreground">Anchor: {fmtPrice(a.anchorPrice, decimalsFor(a.symbol))}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Switch checked={a.enabled} onCheckedChange={() => togglePriceAlert(a.id)} />
                          {a.triggered && (
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => resetPriceAlert(a.id)} title="Reset">
                              <RotateCcw className="w-3 h-3" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-rose-400" onClick={() => removePriceAlert(a.id)} title="Remove">
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {/* Watchlists */}
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Star className="w-4 h-4" /> Watchlists
              <Badge variant="outline" className="text-[10px]">{watchlists.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Watchlist selector + create */}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-[10px] text-muted-foreground">Active Watchlist</Label>
                <select
                  value={activeWatchlist}
                  onChange={(e) => setActiveWatchlist(e.target.value)}
                  className="w-full mt-0.5 bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs"
                >
                  {watchlists.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.entries.length})</option>)}
                </select>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => activeWatchlist && removeWatchlist(activeWatchlist)}
                disabled={!activeWatchlist || watchlists.length <= 1}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <Input
                value={newWlName}
                onChange={(e) => setNewWlName(e.target.value)}
                placeholder="New watchlist name..."
                className="h-8 text-xs"
              />
              <Button
                size="sm"
                className="h-8"
                onClick={() => {
                  if (newWlName.trim()) {
                    addWatchlist(newWlName.trim());
                    setNewWlName("");
                  }
                }}
              >
                <Plus className="w-3 h-3 mr-1" /> Create
              </Button>
            </div>

            {/* Add entry */}
            <div className="border border-border rounded-md p-2 bg-muted/30 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Add Symbol to Watchlist</div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <select
                    value={newEntrySymbol}
                    onChange={(e) => setNewEntrySymbol(e.target.value)}
                    className="w-full bg-muted/50 border border-border rounded-md px-2 py-1.5 text-xs font-mono"
                  >
                    {CONTRACTS.map((c) => <option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>)}
                  </select>
                </div>
                <Input
                  value={newEntryNote}
                  onChange={(e) => setNewEntryNote(e.target.value)}
                  placeholder="Note (optional)"
                  className="h-8 text-xs flex-1"
                />
                <Button
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    if (activeWatchlist) {
                      addWatchlistEntry(activeWatchlist, newEntrySymbol, newEntryNote || undefined);
                      setNewEntryNote("");
                    }
                  }}
                >
                  <Plus className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {/* Watchlist entries */}
            <div className="border border-border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 border-b border-border">
                  <tr className="text-muted-foreground text-[10px] uppercase tracking-wider">
                    <th className="text-left py-1.5 px-2">Symbol</th>
                    <th className="text-right py-1.5 px-2">Last</th>
                    <th className="text-right py-1.5 px-2">Chg%</th>
                    <th className="text-left py-1.5 px-2">Note</th>
                    <th className="text-center py-1.5 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {watchlists.find((w) => w.id === activeWatchlist)?.entries.map((entry) => {
                    const q = quotes[entry.symbol];
                    return (
                      <tr
                        key={entry.symbol}
                        className="border-b border-border/40 hover:bg-muted/30 cursor-pointer"
                        onClick={() => selectSymbol(entry.symbol)}
                      >
                        <td className="py-1.5 px-2 font-mono font-medium">{entry.symbol}</td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">{q ? fmtPrice(q.last, decimalsFor(entry.symbol)) : "—"}</td>
                        <td className={cn("py-1.5 px-2 text-right font-mono tabular-nums", q && q.changePct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                          {q ? `${q.changePct >= 0 ? "+" : ""}${q.changePct.toFixed(2)}%` : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[150px]">{entry.note ?? ""}</td>
                        <td className="py-1.5 px-2 text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-rose-400"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (activeWatchlist) removeWatchlistEntry(activeWatchlist, entry.symbol);
                            }}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {(watchlists.find((w) => w.id === activeWatchlist)?.entries.length ?? 0) === 0 && (
                    <tr><td colSpan={5} className="text-center py-6 text-muted-foreground text-xs">Empty watchlist</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
