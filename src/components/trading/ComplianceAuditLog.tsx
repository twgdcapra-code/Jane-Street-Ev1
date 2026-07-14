"use client";
import { useState, useEffect, useRef } from "react";
import {
  queryEvents, computeStats, verifyHashChain, exportCSV, exportJSON, downloadExport,
  replayStateAt, clearAuditLog, describeEvent,
  type AuditEvent, type AuditEventType, type AuditLevel, type ChainVerificationResult,
} from "@/lib/trading/audit-log";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Activity, CheckCircle2, Database, Download, FileText, Filter, History, Lock, Shield, ShieldCheck, XCircle } from "lucide-react";

type View = "events" | "stats" | "verify" | "replay";
const VIEWS: { id: View; name: string; icon: any }[] = [
  { id: "events", name: "Event Log", icon: History },
  { id: "stats", name: "Statistics", icon: Activity },
  { id: "verify", name: "Hash Chain Verify", icon: ShieldCheck },
  { id: "replay", name: "State Replay", icon: Database },
];

const CATEGORY_BADGES: Record<string, string> = {
  ORDER: "bg-blue-500/15 text-blue-400", FILL: "bg-emerald-500/15 text-emerald-400",
  POSITION: "bg-purple-500/15 text-purple-400", RISK: "bg-rose-500/15 text-rose-400",
  STRATEGY: "bg-amber-500/15 text-amber-400", USER: "bg-cyan-500/15 text-cyan-400",
  SYSTEM: "bg-muted text-muted-foreground",
};

const LEVEL_BADGES: Record<AuditLevel, string> = {
  INFO: "bg-muted text-muted-foreground", WARN: "bg-amber-500/15 text-amber-400",
  ERROR: "bg-rose-500/15 text-rose-400", CRITICAL: "bg-rose-500/25 text-rose-300 border-rose-500/40",
};

export function ComplianceAuditLog() {
  const [view, setView] = useState<View>("events");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [stats, setStats] = useState<ReturnType<typeof computeStats> | null>(null);
  const [verification, setVerification] = useState<ChainVerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [replayTimestamp, setReplayTimestamp] = useState<number>(Date.now());
  const [replayResult, setReplayResult] = useState<ReturnType<typeof replayStateAt> | null>(null);
  const [filterType, setFilterType] = useState<string>("ALL");
  const [filterCategory, setFilterCategory] = useState<string>("ALL");
  const [filterLevel, setFilterLevel] = useState<string>("ALL");
  const [filterSymbol, setFilterSymbol] = useState<string>("");
  const [filterOrderId, setFilterOrderId] = useState<string>("");
  const [filterStrategy, setFilterStrategy] = useState<string>("");
  const [filterLimit, setFilterLimit] = useState<number>(200);
  const [refreshKey, setRefreshKey] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const params: any = { limit: filterLimit };
    if (filterType !== "ALL") params.event_types = [filterType];
    if (filterCategory !== "ALL") params.categories = [filterCategory];
    if (filterLevel !== "ALL") params.levels = [filterLevel];
    if (filterSymbol) params.symbol = filterSymbol;
    if (filterOrderId) params.order_id = filterOrderId;
    if (filterStrategy) params.strategy_id = filterStrategy;
    setEvents(queryEvents(params));
    setStats(computeStats());
  }, [refreshKey, filterType, filterCategory, filterLevel, filterSymbol, filterOrderId, filterStrategy, filterLimit]);

  const refresh = () => setRefreshKey((k) => k + 1);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (view !== "events") return;
    autoRef.current = setInterval(refresh, 3000);
    return () => { if (autoRef.current) clearInterval(autoRef.current); };
  }, [view]);

  const handleVerify = () => {
    setVerifying(true);
    try { setVerification(verifyHashChain()); } finally { setVerifying(false); }
  };
  const handleReplay = () => setReplayResult(replayStateAt(replayTimestamp));
  const handleExportCSV = () => {
    const csv = exportCSV(queryEvents({ limit: 50000 }));
    downloadExport(csv, `audit-log-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`, "text/csv");
  };
  const handleExportJSON = () => {
    const json = exportJSON(queryEvents({ limit: 50000 }));
    downloadExport(json, `audit-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, "application/json");
  };
  const handleClear = () => {
    if (!confirm("Clear audit log? This is irreversible.")) return;
    clearAuditLog(); refresh();
  };

  return (
    <div className="space-y-4">
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-md bg-primary/20 flex items-center justify-center"><Shield className="w-5 h-5 text-primary" /></div>
          <div className="flex-1">
            <div className="text-sm font-semibold flex items-center gap-2">
              Compliance & Audit Log
              <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-400">MiFID II RTS 6</Badge>
              <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-400">CFTC 1.35</Badge>
              <Badge variant="outline" className="text-[9px] bg-emerald-500/15 text-emerald-400">SEC 17a-4</Badge>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Append-only hash-chained event log · Microsecond UTC timestamps · 5-year retention · {stats?.total_events ?? 0} events captured</div>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExportCSV}><Download className="w-3 h-3 mr-1" /> CSV</Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExportJSON}><FileText className="w-3 h-3 mr-1" /> JSON</Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-1 flex-wrap">
        {VIEWS.map((v) => (
          <button key={v.id} onClick={() => setView(v.id)} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-colors", view === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>
            <v.icon className="w-3.5 h-3.5" />{v.name}
          </button>
        ))}
        <Button variant="outline" size="sm" className="h-7 text-xs ml-auto" onClick={refresh}><Activity className="w-3 h-3 mr-1" /> Refresh</Button>
      </div>

      {view === "events" && (
        <div className="space-y-3">
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground"><Filter className="w-3.5 h-3.5" /> Filters</div>
              <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
                <div><Label className="text-[10px] text-muted-foreground">Event Type</Label><select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8"><option value="ALL">All Types</option>{(["ORDER_RECEIVED","ORDER_FILLED","ORDER_CANCELLED","FILL_EXECUTED","POSITION_OPENED","POSITION_CLOSED","POSITION_INCREASED","POSITION_DECREASED","RISK_LIMIT_BREACH","KILL_SWITCH_TRIGGERED","KILL_SWITCH_REARMED","SYSTEM_STARTUP","SYSTEM_ERROR","STRATEGY_ENABLED","STRATEGY_DISABLED","USER_ORDER_PLACED","USER_ORDER_CANCELLED","USER_POSITION_FLATTENED"] as AuditEventType[]).map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
                <div><Label className="text-[10px] text-muted-foreground">Category</Label><select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8"><option value="ALL">All</option><option value="ORDER">Order</option><option value="FILL">Fill</option><option value="POSITION">Position</option><option value="RISK">Risk</option><option value="STRATEGY">Strategy</option><option value="USER">User</option><option value="SYSTEM">System</option></select></div>
                <div><Label className="text-[10px] text-muted-foreground">Level</Label><select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8"><option value="ALL">All</option><option value="INFO">Info</option><option value="WARN">Warning</option><option value="ERROR">Error</option><option value="CRITICAL">Critical</option></select></div>
                <div><Label className="text-[10px] text-muted-foreground">Symbol</Label><Input value={filterSymbol} onChange={(e) => setFilterSymbol(e.target.value)} placeholder="e.g. ES" className="h-8 text-xs mt-0.5 font-mono" /></div>
                <div><Label className="text-[10px] text-muted-foreground">Order ID</Label><Input value={filterOrderId} onChange={(e) => setFilterOrderId(e.target.value)} placeholder="ord-..." className="h-8 text-xs mt-0.5 font-mono" /></div>
                <div><Label className="text-[10px] text-muted-foreground">Strategy</Label><Input value={filterStrategy} onChange={(e) => setFilterStrategy(e.target.value)} placeholder="strat-..." className="h-8 text-xs mt-0.5 font-mono" /></div>
                <div><Label className="text-[10px] text-muted-foreground">Limit</Label><select value={filterLimit} onChange={(e) => setFilterLimit(Number(e.target.value))} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8"><option value={50}>50</option><option value={200}>200</option><option value={500}>500</option><option value={1000}>1000</option></select></div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs">Audit Events ({events.length} shown)</CardTitle>
              <Badge variant="outline" className="text-[9px]">Click row to expand</Badge>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                {events.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-xs">No audit events yet. Place orders, modify positions, or trigger risk rules — every action is logged here automatically.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-y border-border sticky top-0">
                      <tr className="text-muted-foreground text-[10px] uppercase">
                        <th className="text-left py-2 px-2">Time (UTC)</th><th className="text-left py-2 px-2">Seq</th><th className="text-left py-2 px-2">Event Type</th><th className="text-center py-2 px-2">Level</th><th className="text-center py-2 px-2">Cat</th><th className="text-left py-2 px-2">Symbol</th><th className="text-center py-2 px-2">Side</th><th className="text-right py-2 px-2">Qty</th><th className="text-right py-2 px-2">Price</th><th className="text-left py-2 px-2">Order ID</th><th className="text-left py-2 px-2">Reason</th><th className="text-center py-2 px-2">Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e) => (
                        <tr key={e.event_id} className="border-b border-border/30 hover:bg-muted/30 cursor-pointer" onClick={() => setExpandedId(expandedId === e.event_id ? null : e.event_id)}>
                          <td className="py-1 px-2 font-mono text-[10px] text-muted-foreground">{e.timestamp_utc.slice(11, 23)}</td>
                          <td className="py-1 px-2 font-mono text-[10px] text-muted-foreground">{e.sequence_num}</td>
                          <td className="py-1 px-2 font-mono text-[10px] font-medium">{e.event_type}</td>
                          <td className="py-1 px-2 text-center"><Badge variant="outline" className={cn("text-[9px] h-4 px-1", LEVEL_BADGES[e.level])}>{e.level}</Badge></td>
                          <td className="py-1 px-2 text-center"><Badge variant="outline" className={cn("text-[9px] h-4 px-1", CATEGORY_BADGES[e.category] ?? "bg-muted text-muted-foreground")}>{e.category}</Badge></td>
                          <td className="py-1 px-2 font-mono text-[10px]">{e.symbol ?? "—"}</td>
                          <td className="py-1 px-2 text-center">{e.side && <Badge variant="outline" className={cn("text-[9px] h-4 px-1", e.side === "BUY" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400")}>{e.side}</Badge>}</td>
                          <td className="py-1 px-2 text-right font-mono text-[10px]">{e.qty ?? "—"}</td>
                          <td className="py-1 px-2 text-right font-mono text-[10px]">{e.price !== undefined ? e.price.toFixed(2) : "—"}</td>
                          <td className="py-1 px-2 font-mono text-[10px] text-muted-foreground">{e.order_id ? e.order_id.slice(0, 12) : "—"}</td>
                          <td className="py-1 px-2 text-[10px] text-muted-foreground truncate max-w-[200px]">{e.reason ?? "—"}</td>
                          <td className="py-1 px-2 text-center font-mono text-[9px] text-muted-foreground">{e.curr_hash.slice(0, 8)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {expandedId && (() => {
                const e = events.find((x) => x.event_id === expandedId);
                if (!e) return null;
                return (
                  <div className="border-t border-border p-3 bg-muted/20">
                    <div className="text-xs font-semibold mb-2">{describeEvent(e.event_type)}</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
                      <div><span className="text-muted-foreground">Event ID:</span> <span className="font-mono">{e.event_id}</span></div>
                      <div><span className="text-muted-foreground">Sequence:</span> <span className="font-mono">{e.sequence_num}</span></div>
                      <div><span className="text-muted-foreground">Timestamp UTC:</span> <span className="font-mono">{e.timestamp_utc}</span></div>
                      <div><span className="text-muted-foreground">Category:</span> <span className="font-mono">{e.category}</span></div>
                      {e.client_order_id && <div><span className="text-muted-foreground">Client Order ID:</span> <span className="font-mono">{e.client_order_id}</span></div>}
                      {e.user_id && <div><span className="text-muted-foreground">User ID:</span> <span className="font-mono">{e.user_id}</span></div>}
                      {e.strategy_id && <div><span className="text-muted-foreground">Strategy ID:</span> <span className="font-mono">{e.strategy_id}</span></div>}
                      {e.commission !== undefined && <div><span className="text-muted-foreground">Commission:</span> <span className="font-mono">${e.commission.toFixed(2)}</span></div>}
                      {e.arrival_price !== undefined && <div><span className="text-muted-foreground">Arrival Price:</span> <span className="font-mono">{e.arrival_price.toFixed(2)}</span></div>}
                      {e.old_qty !== undefined && <div><span className="text-muted-foreground">Old Qty:</span> <span className="font-mono">{e.old_qty}</span></div>}
                      {e.new_qty !== undefined && <div><span className="text-muted-foreground">New Qty:</span> <span className="font-mono">{e.new_qty}</span></div>}
                      {e.realized_pnl !== undefined && <div><span className="text-muted-foreground">Realized P&L:</span> <span className="font-mono">${e.realized_pnl.toFixed(2)}</span></div>}
                      {e.threshold !== undefined && <div><span className="text-muted-foreground">Threshold:</span> <span className="font-mono">{e.threshold.toFixed(2)}</span></div>}
                    </div>
                    <div className="mt-2 pt-2 border-t border-border/30">
                      <div className="text-[9px] uppercase text-muted-foreground">Hash Chain</div>
                      <div className="font-mono text-[9px] mt-1 break-all text-muted-foreground">
                        <div><span className="text-amber-400">prev_hash:</span> {e.prev_hash}</div>
                        <div className="mt-0.5"><span className="text-emerald-400">curr_hash:</span> {e.curr_hash}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      )}

      {view === "stats" && stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Total Events</div><div className="text-sm font-mono font-semibold">{stats.total_events.toLocaleString()}</div></Card>
            <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Unique Orders</div><div className="text-sm font-mono font-semibold">{stats.unique_orders}</div></Card>
            <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Unique Symbols</div><div className="text-sm font-mono font-semibold">{stats.unique_symbols}</div></Card>
            <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Unique Strategies</div><div className="text-sm font-mono font-semibold">{stats.unique_strategies}</div></Card>
            <Card className="p-2.5"><div className="text-[9px] uppercase text-muted-foreground">Storage Used</div><div className="text-sm font-mono font-semibold">{stats.storage_used_kb} KB</div></Card>
          </div>
          <Card className="border-emerald-500/20 bg-emerald-500/5">
            <CardContent className="p-3">
              <div className="flex items-center gap-3"><ShieldCheck className="w-8 h-8 text-emerald-400" /><div className="flex-1"><div className="text-sm font-semibold">Retention Compliance</div><div className="text-[10px] text-muted-foreground">MiFID II / CFTC / SEC require 5-year minimum retention</div></div></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-2"><CardTitle className="text-xs">Events by Category</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2">
                {Object.entries(stats.events_by_category).sort(([, a], [, b]) => b - a).map(([cat, count]) => (
                  <div key={cat} className="border border-border/40 rounded-md p-2">
                    <div className="flex items-center justify-between"><Badge variant="outline" className={cn("text-[9px] h-4 px-1", CATEGORY_BADGES[cat] ?? "bg-muted text-muted-foreground")}>{cat}</Badge><span className="text-sm font-mono font-semibold">{count.toLocaleString()}</span></div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">{stats.total_events > 0 ? ((count / stats.total_events) * 100).toFixed(1) : 0}%</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-2"><CardTitle className="text-xs">Events by Level</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-2">
                {Object.entries(stats.events_by_level).sort(([, a], [, b]) => b - a).map(([lvl, count]) => (
                  <div key={lvl} className="border border-border/40 rounded-md p-2"><div className="flex items-center justify-between"><Badge variant="outline" className={cn("text-[9px] h-4 px-1", LEVEL_BADGES[lvl as AuditLevel] ?? "bg-muted text-muted-foreground")}>{lvl}</Badge><span className="text-sm font-mono font-semibold">{count.toLocaleString()}</span></div></div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-2"><CardTitle className="text-xs">Events by Type (Top 20)</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-y-auto max-h-[400px]">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 border-y border-border sticky top-0"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-2 px-3">Event Type</th><th className="text-right py-2 px-3">Count</th><th className="text-right py-2 px-3">% of Total</th><th className="text-left py-2 px-3">Description</th></tr></thead>
                  <tbody>
                    {Object.entries(stats.events_by_type).sort(([, a], [, b]) => b - a).slice(0, 20).map(([type, count]) => (
                      <tr key={type} className="border-b border-border/30"><td className="py-1.5 px-3 font-mono text-[10px] font-medium">{type}</td><td className="py-1.5 px-3 text-right font-mono">{count.toLocaleString()}</td><td className="py-1.5 px-3 text-right font-mono text-muted-foreground">{stats.total_events > 0 ? ((count / stats.total_events) * 100).toFixed(1) : 0}%</td><td className="py-1.5 px-3 text-[10px] text-muted-foreground">{describeEvent(type as AuditEventType)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {view === "verify" && (
        <div className="space-y-3">
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-3 mb-3">
                <Lock className="w-8 h-8 text-primary" />
                <div className="flex-1"><div className="text-sm font-semibold">Hash Chain Integrity Verification</div><div className="text-[10px] text-muted-foreground mt-0.5">Each event is hashed with the previous event's hash, creating a tamper-evident chain.</div></div>
                <Button onClick={handleVerify} disabled={verifying}>{verifying ? "Verifying..." : "Verify Chain Now"}</Button>
              </div>
              {stats && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">Total Entries</div><div className="font-mono font-semibold">{stats.total_events.toLocaleString()}</div></div>
                  <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">First Event</div><div className="font-mono font-semibold text-[10px]">{stats.first_event_at ? new Date(stats.first_event_at).toISOString().slice(0, 19) : "—"}</div></div>
                  <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">Last Event</div><div className="font-mono font-semibold text-[10px]">{stats.last_event_at ? new Date(stats.last_event_at).toISOString().slice(0, 19) : "—"}</div></div>
                </div>
              )}
            </CardContent>
          </Card>
          {verification && (
            <Card className={cn("border", verification.valid ? "border-emerald-500/30 bg-emerald-500/5" : "border-rose-500/40 bg-rose-500/10")}>
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  {verification.valid ? <CheckCircle2 className="w-12 h-12 text-emerald-400" /> : <XCircle className="w-12 h-12 text-rose-400" />}
                  <div className="flex-1">
                    <div className={cn("text-sm font-semibold", verification.valid ? "text-emerald-400" : "text-rose-400")}>{verification.valid ? "CHAIN VALID — No tampering detected" : "CHAIN BROKEN — Tampering detected"}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{verification.valid ? `All ${verification.verified_entries.toLocaleString()} entries verified.` : `Failed at entry #${verification.first_broken_at}.`}</div>
                  </div>
                  <div className="text-right"><div className="text-[9px] uppercase text-muted-foreground">Verified</div><div className="text-lg font-mono font-semibold">{verification.verified_entries.toLocaleString()}/{verification.total_entries.toLocaleString()}</div></div>
                </div>
                {!verification.valid && (
                  <div className="mt-3 pt-3 border-t border-border/30 space-y-1 text-xs">
                    <div><span className="text-muted-foreground">Expected:</span> <span className="font-mono text-emerald-400 break-all">{verification.expected_hash}</span></div>
                    <div><span className="text-muted-foreground">Actual:</span> <span className="font-mono text-rose-400 break-all">{verification.actual_hash}</span></div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {view === "replay" && (
        <div className="space-y-3">
          <Card>
            <CardContent className="p-3">
              <div className="flex items-center gap-3 mb-3">
                <Database className="w-8 h-8 text-primary" />
                <div className="flex-1"><div className="text-sm font-semibold">Event-Sourced State Replay</div><div className="text-[10px] text-muted-foreground mt-0.5">Reconstruct positions, orders, and P&L at any historical timestamp.</div></div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div><Label className="text-[10px] text-muted-foreground">Replay to Timestamp</Label><Input type="datetime-local" value={new Date(replayTimestamp).toISOString().slice(0, 16)} onChange={(e) => { const t = new Date(e.target.value + "Z").getTime(); if (!isNaN(t)) setReplayTimestamp(t); }} className="h-8 text-xs mt-0.5" /></div>
                <div className="flex items-end"><Button onClick={handleReplay} className="w-full"><History className="w-3.5 h-3.5 mr-1" /> Replay State</Button></div>
              </div>
            </CardContent>
          </Card>
          {replayResult && (
            <div className="space-y-3">
              <Card>
                <CardHeader className="py-2"><CardTitle className="text-xs">Reconstructed State at {new Date(replayResult.timestamp_ms).toISOString()}</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">Open Positions</div><div className="text-sm font-mono font-semibold">{Object.values(replayResult.positions).filter((p) => p.qty !== 0).length}</div></div>
                    <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">Total Realized P&L</div><div className={cn("text-sm font-mono font-semibold", replayResult.total_realized_pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>${replayResult.total_realized_pnl.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div></div>
                    <div className="bg-muted/40 rounded p-2"><div className="text-[9px] uppercase text-muted-foreground">Total Commission</div><div className="text-sm font-mono font-semibold">${replayResult.total_commission.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div></div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="py-2"><CardTitle className="text-xs">Positions</CardTitle></CardHeader>
                <CardContent className="p-0">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40 border-y border-border"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-2 px-3">Symbol</th><th className="text-right py-2 px-3">Qty</th><th className="text-right py-2 px-3">Avg Price</th><th className="text-right py-2 px-3">Realized P&L</th></tr></thead>
                    <tbody>
                      {Object.entries(replayResult.positions).filter(([, p]) => p.qty !== 0 || p.realized_pnl !== 0).length === 0 ? (
                        <tr><td colSpan={4} className="text-center py-4 text-muted-foreground text-xs">No positions at this timestamp</td></tr>
                      ) : (
                        Object.entries(replayResult.positions).filter(([, p]) => p.qty !== 0 || p.realized_pnl !== 0).map(([sym, p]) => (
                          <tr key={sym} className="border-b border-border/30"><td className="py-1.5 px-3 font-mono font-medium">{sym}</td><td className={cn("py-1.5 px-3 text-right font-mono", p.qty > 0 ? "text-emerald-400" : p.qty < 0 ? "text-rose-400" : "")}>{p.qty}</td><td className="py-1.5 px-3 text-right font-mono">{p.avg_price > 0 ? p.avg_price.toFixed(2) : "—"}</td><td className={cn("py-1.5 px-3 text-right font-mono", p.realized_pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>${p.realized_pnl.toFixed(2)}</td></tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
