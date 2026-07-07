"use client";

import { useTradingStore } from "@/lib/trading/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtTime, fmtDateTime } from "@/lib/trading/format";
import { cn } from "@/lib/utils";
import { AlertTriangle, Bell, BellOff, CheckCheck, X } from "lucide-react";
import type { Alert as AlertType } from "@/lib/trading/types";

const SEVERITY_COLORS: Record<AlertType["severity"], string> = {
  INFO: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  WARN: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  ERROR: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  CRITICAL: "bg-red-500/20 text-red-400 border-red-500/40 animate-pulse",
};

const TYPE_ICONS: Record<AlertType["type"], string> = {
  PRICE: "$",
  RISK: "⚠",
  ORDER: "↯",
  STRATEGY: "✦",
  SYSTEM: "⚙",
};

export function AlertsPanel({ onClose }: { onClose: () => void }) {
  const alerts = useTradingStore((s) => s.alerts);
  const ackAlert = useTradingStore((s) => s.ackAlert);
  const clearAlerts = useTradingStore((s) => s.clearAlerts);

  return (
    <Card className="h-full rounded-none border-0">
      <CardHeader className="py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="w-4 h-4" /> Alerts
          <Badge variant="outline" className="text-[10px]">{alerts.filter((a) => !a.acknowledged).length} new</Badge>
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => alerts.forEach((a) => !a.acknowledged && ackAlert(a.id))}>
            <CheckCheck className="w-3 h-3 mr-1" /> Ack all
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearAlerts}>
            <BellOff className="w-3 h-3 mr-1" /> Clear
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-xs">
            <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No alerts
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {alerts.map((a) => (
              <div
                key={a.id}
                className={cn(
                  "border rounded-md p-2 text-xs",
                  a.acknowledged ? "border-border/40 opacity-60" : SEVERITY_COLORS[a.severity],
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 flex-1">
                    <span className="font-mono text-sm leading-none mt-0.5">{TYPE_ICONS[a.type]}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1">{a.type}</Badge>
                        <Badge variant="outline" className={cn("text-[9px] h-3.5 px-1", SEVERITY_COLORS[a.severity])}>{a.severity}</Badge>
                        {a.symbol && <Badge variant="outline" className="text-[9px] h-3.5 px-1 font-mono">{a.symbol}</Badge>}
                      </div>
                      <div className="text-xs">{a.message}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{fmtDateTime(a.timestamp)}</div>
                    </div>
                  </div>
                  {!a.acknowledged && (
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5" onClick={() => ackAlert(a.id)}>
                      <CheckCheck className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
