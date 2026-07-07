"use client";

import { useState } from "react";
import { useTradingStore } from "@/lib/trading/store";
import { STRATEGIES } from "@/lib/trading/strategies";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fmtMoney } from "@/lib/trading/format";
import { cn } from "@/lib/utils";
import { Brain, Plus, Sparkles, Trash2 } from "lucide-react";
import type { StrategyParams } from "@/lib/trading/types";

export function StrategyLab() {
  const strategies = useTradingStore((s) => s.strategies);
  const toggleStrategy = useTradingStore((s) => s.toggleStrategy);
  const removeStrategy = useTradingStore((s) => s.removeStrategy);
  const updateStrategy = useTradingStore((s) => s.updateStrategy);
  const addStrategy = useTradingStore((s) => s.addStrategy);
  const [selectedDef, setSelectedDef] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Strategy library */}
        <Card className="lg:col-span-1">
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Brain className="w-4 h-4" /> Strategy Library
            </CardTitle>
            <Button size="sm" className="h-7 text-xs" onClick={() => setShowCreate(true)}>
              <Plus className="w-3 h-3 mr-1" /> New
            </Button>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedDef(s.id)}
                className={cn(
                  "w-full text-left p-3 rounded-md border transition-colors",
                  selectedDef === s.id
                    ? "bg-primary/10 border-primary/30"
                    : "bg-muted/30 border-border hover:bg-muted/50",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{s.name}</span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1">{s.type}</Badge>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{s.description}</p>
              </button>
            ))}
          </CardContent>
        </Card>

        {/* Strategy detail */}
        <Card className="lg:col-span-2">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Active Strategies ({strategies.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {strategies.length === 0 ? (
              <div className="text-center py-8 text-xs text-muted-foreground">
                No active strategies. Create one from the library.
              </div>
            ) : (
              strategies.map((s) => {
                const def = STRATEGIES.find((d) => d.type === s.type);
                return (
                  <div key={s.id} className="border border-border rounded-md p-3 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{s.name}</span>
                          <Badge variant="outline" className="text-[9px] h-4 px-1">{s.type}</Badge>
                          <span className={cn("text-[10px]", s.enabled ? "text-emerald-400" : "text-muted-foreground")}>
                            {s.enabled ? "● LIVE" : "○ PAUSED"}
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{s.description}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] font-mono">
                          <span>P&L: <span className={s.pnl >= 0 ? "text-emerald-400" : "text-rose-400"}>{fmtMoney(s.pnl, 0)}</span></span>
                          <span>Trades: <span className="text-foreground">{s.trades}</span></span>
                          <span>Sharpe: <span className="text-foreground">{s.sharpe.toFixed(2)}</span></span>
                          <span>MDD: <span className="text-rose-400">{(s.maxDrawdown * 100).toFixed(1)}%</span></span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={s.enabled} onCheckedChange={() => toggleStrategy(s.id)} />
                        <Button variant="ghost" size="sm" className="h-7 text-rose-400" onClick={() => removeStrategy(s.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    {def && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-border/40">
                        {def.paramSchema.map((p) => (
                          <div key={p.key}>
                            <Label className="text-[10px] text-muted-foreground">{p.label}</Label>
                            <Input
                              type="number"
                              value={Number(s.params[p.key] ?? p.default)}
                              min={p.min}
                              max={p.max}
                              step={p.step}
                              onChange={(e) =>
                                updateStrategy(s.id, {
                                  params: { ...s.params, [p.key]: parseFloat(e.target.value) || 0 },
                                })
                              }
                              className="h-7 text-xs font-mono mt-0.5"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create dialog */}
      {showCreate && selectedDef && (
        <CreateStrategyDialog
          defId={selectedDef}
          onClose={() => setShowCreate(false)}
          onCreate={(name, params, symbols) => {
            const def = STRATEGIES.find((d) => d.id === selectedDef)!;
            addStrategy({
              name,
              type: def.type,
              description: def.description,
              symbols,
              params,
              enabled: false,
            });
            setShowCreate(false);
          }}
        />
      )}

      {/* Show selected def details */}
      {selectedDef && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" /> {STRATEGIES.find((s) => s.id === selectedDef)?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">{STRATEGIES.find((s) => s.id === selectedDef)?.description}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {STRATEGIES.find((s) => s.id === selectedDef)?.paramSchema.map((p) => (
                <div key={p.key} className="border border-border rounded-md p-2">
                  <div className="text-[10px] text-muted-foreground">{p.label}</div>
                  <div className="text-xs font-mono mt-0.5">default: {String(p.default)}</div>
                  {p.min !== undefined && p.max !== undefined && (
                    <div className="text-[10px] text-muted-foreground">range: [{p.min}, {p.max}]</div>
                  )}
                </div>
              ))}
            </div>
            <Button
              className="mt-3"
              size="sm"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="w-3 h-3 mr-1" /> Instantiate Strategy
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CreateStrategyDialog({
  defId,
  onClose,
  onCreate,
}: {
  defId: string;
  onClose: () => void;
  onCreate: (name: string, params: StrategyParams, symbols: string[]) => void;
}) {
  const def = STRATEGIES.find((s) => s.id === defId)!;
  const [name, setName] = useState(`New ${def.name}`);
  const [params, setParams] = useState<StrategyParams>(
    def.paramSchema.reduce((acc, p) => ({ ...acc, [p.key]: p.default }), {}),
  );
  const [symbols, setSymbols] = useState<string[]>(["ES"]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-sm">Create {def.name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Symbols (comma-separated)</Label>
            <Input
              value={symbols.join(",")}
              onChange={(e) => setSymbols(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              className="mt-1 font-mono"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {def.paramSchema.map((p) => (
              <div key={p.key}>
                <Label className="text-[10px] text-muted-foreground">{p.label}</Label>
                <Input
                  type="number"
                  value={Number(params[p.key] ?? p.default)}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  onChange={(e) => setParams({ ...params, [p.key]: parseFloat(e.target.value) || 0 })}
                  className="h-8 text-xs font-mono mt-0.5"
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={() => onCreate(name, params, symbols)}>Create</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
