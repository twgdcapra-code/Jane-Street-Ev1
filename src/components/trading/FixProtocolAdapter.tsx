"use client";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { FIX_TAG_NAMES, type FixMessage } from "@/lib/trading/fix-protocol";
import {
  loadProfiles, addProfile, updateProfile, removeProfile, resetProfiles,
  getDefaultProfile, loadActiveSession, saveActiveSession, clearActiveSession,
  connectWithProfile, disconnectConnection, sendHeartbeat, submitOrder, cancelOrder, simulateFill,
  BROKER_KIND_INFO, DEFAULT_PROFILES,
  type BrokerProfile, type BrokerKind, type Environment, type FixConnectionState,
} from "@/lib/trading/fix-brokers";
import { fmtTime } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Activity, AlertCircle, CheckCircle2, Link2, Link2Off, Plug, Plus, Radio, RefreshCw, Send, Settings, ShieldCheck, Terminal, Trash2, X } from "lucide-react";

type View = "session" | "brokers" | "builder" | "reference";
const VIEWS: { id: View; name: string }[] = [
  { id: "session", name: "Active Session" },
  { id: "brokers", name: "Broker Profiles" },
  { id: "builder", name: "Message Builder" },
  { id: "reference", name: "Tag Reference" },
];

const ENV_BADGE: Record<Environment, string> = {
  PAPER: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  LIVE: "bg-rose-500/15 text-rose-400 border-rose-500/30",
};

const KIND_BADGE: Record<BrokerKind, string> = {
  SIMULATOR: "bg-muted text-muted-foreground",
  TRADOVATE: "bg-blue-500/15 text-blue-400",
  IBKR: "bg-amber-500/15 text-amber-400",
  TASTYTRADE: "bg-purple-500/15 text-purple-400",
  NINJATRADER: "bg-cyan-500/15 text-cyan-400",
  METROTRADE: "bg-pink-500/15 text-pink-400",
  CUSTOM: "bg-orange-500/15 text-orange-400",
};

const MSG_TYPES = [
  { type: "A", name: "Logon", desc: "Session login" },
  { type: "5", name: "Logout", desc: "Session logout" },
  { type: "0", name: "Heartbeat", desc: "Keep-alive" },
  { type: "2", name: "ResendRequest", desc: "Request missed messages" },
  { type: "D", name: "NewOrderSingle", desc: "Submit new order" },
  { type: "F", name: "OrderCancelRequest", desc: "Cancel order" },
  { type: "8", name: "ExecutionReport", desc: "Fill/status update" },
  { type: "V", name: "MarketDataRequest", desc: "Subscribe to market data" },
];

export function FixProtocolAdapter() {
  const [view, setView] = useState<View>("session");
  const [profiles, setProfiles] = useState<BrokerProfile[]>(() => loadProfiles());
  const [activeProfileId, setActiveProfileId] = useState<string>(() => getDefaultProfile().id);
  const [connection, setConnection] = useState<FixConnectionState | null>(null);
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [lastMsg, setLastMsg] = useState<FixMessage | null>(null);
  const [orderSymbol, setOrderSymbol] = useState("ES");
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderQty, setOrderQty] = useState(1);
  const [orderPrice, setOrderPrice] = useState(5000);
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT">("LIMIT");
  const [orderTif, setOrderTif] = useState<"DAY" | "GTC" | "IOC" | "FOK">("DAY");
  const [selectedMsgType, setSelectedMsgType] = useState("D");
  const [clOrdId, setClOrdId] = useState("TWG-001");
  const [tagSearch, setTagSearch] = useState("");
  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-reconnect on mount if we had an active session.
  useEffect(() => {
    if (!autoReconnect) return;
    const active = loadActiveSession();
    if (!active) return;
    const profile = profiles.find(p => p.id === active.profileId);
    if (!profile) return;
    let cancelled = false;
    // Defer to a microtask so we don't trigger a cascading render warning.
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const conn = connectWithProfile(profile);
        setConnection(conn);
        setActiveProfileId(profile.id);
      } catch (err) {
        // ignore — user can connect manually
      }
    });
    return () => { cancelled = true; };
  }, [autoReconnect]);

  // Heartbeat loop while connected.
  useEffect(() => {
    if (!connection || connection.state !== "LOGGED_IN") {
      if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
      return;
    }
    const interval = profiles.find(p => p.id === connection.profileId)?.heartBtInt ?? 30;
    heartbeatTimer.current = setInterval(() => {
      setConnection(prev => prev ? sendHeartbeat(prev) : prev);
    }, Math.max(5, interval) * 1000);
    return () => { if (heartbeatTimer.current) clearInterval(heartbeatTimer.current); };
  }, [connection?.state, connection?.profileId, profiles]);

  const activeProfile = profiles.find(p => p.id === activeProfileId) ?? profiles[0];

  const handleConnect = useCallback(() => {
    if (!activeProfile) return;
    try {
      const conn = connectWithProfile(activeProfile);
      setConnection(conn);
      saveActiveSession(activeProfile.id, Date.now());
      setProfiles(updateProfile(activeProfile.id, { lastConnectedAt: Date.now(), lastError: undefined }));
    } catch (err: any) {
      setProfiles(updateProfile(activeProfile.id, { lastError: err?.message ?? "Connect failed" }));
    }
  }, [activeProfile]);

  const handleDisconnect = useCallback(() => {
    if (!connection) return;
    const dc = disconnectConnection(connection);
    setConnection(dc);
    clearActiveSession();
  }, [connection]);

  const handleSendBuiltMessage = () => {
    if (!connection) {
      alert("Connect to a broker first.");
      return;
    }
    let result: { conn: FixConnectionState; msg: FixMessage } | null = null;
    if (selectedMsgType === "D") {
      result = submitOrder(connection, {
        clOrdId, symbol: orderSymbol, side: orderSide, orderType, qty: orderQty,
        price: orderType !== "MARKET" ? orderPrice : undefined,
        stopPrice: orderType === "STOP" || orderType === "STOP_LIMIT" ? orderPrice : undefined,
        tif: orderTif,
      });
      // If this is a real broker, the actual fill would arrive asynchronously.
      // For paper/simulator, simulate an immediate fill.
      const profile = profiles.find(p => p.id === connection.profileId);
      if (profile && (profile.kind === "SIMULATOR" || profile.environment === "PAPER")) {
        setTimeout(() => {
          setConnection(prev => {
            if (!prev) return prev;
            const fill = simulateFill(prev, {
              clOrdId, symbol: orderSymbol, side: orderSide,
              qty: orderQty, price: orderType === "MARKET" ? orderPrice + (orderSide === "BUY" ? 0.25 : -0.25) : orderPrice,
            });
            setLastMsg(fill.msg);
            return fill.conn;
          });
        }, 400);
      }
    } else if (selectedMsgType === "F") {
      result = cancelOrder(connection, {
        clOrdId: `CANCEL-${Date.now()}`, origClOrdId: clOrdId, symbol: orderSymbol, side: orderSide, qty: orderQty,
      });
    } else if (selectedMsgType === "0") {
      const updated = sendHeartbeat(connection);
      setConnection(updated);
      setLastMsg(updated.session.messages[updated.session.messages.length - 1] ?? null);
      return;
    }
    if (result) {
      setConnection(result.conn);
      setLastMsg(result.msg);
    }
  };

  const filteredTags = Object.entries(FIX_TAG_NAMES).filter(([tag, name]) => !tagSearch || name.toLowerCase().includes(tagSearch.toLowerCase()) || tag.includes(tagSearch)).slice(0, 100);

  const connectionStateBadge = (state: FixConnectionState["state"]) => {
    const map = {
      DISCONNECTED: "bg-muted text-muted-foreground",
      CONNECTING: "bg-amber-500/15 text-amber-400",
      LOGGED_IN: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      LOGGING_OUT: "bg-amber-500/15 text-amber-400",
      ERROR: "bg-rose-500/15 text-rose-400 border-rose-500/30",
    } as const;
    return map[state];
  };

  return (
    <div className="space-y-4">
      {/* View switcher */}
      <div className="flex items-center gap-1 flex-wrap">
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={cn("px-3 py-1.5 rounded-md text-xs border transition-colors",
              view === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>
            {v.name}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-[10px]">
          <label className="flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={autoReconnect} onChange={e => setAutoReconnect(e.target.checked)} className="w-3 h-3 accent-primary" />
            Auto-reconnect
          </label>
        </div>
      </div>

      {/* Active Session View */}
      {view === "session" && (
        <div className="space-y-3">
          {/* Profile picker + connect/disconnect */}
          <Card className={cn("border", connection?.state === "LOGGED_IN" ? "border-emerald-500/30 bg-emerald-500/5" : "border-border")}>
            <CardContent className="p-3 space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="w-10 h-10 rounded-md bg-primary/20 flex items-center justify-center">
                  <Terminal className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <Label className="text-[10px] text-muted-foreground">Active Broker Profile</Label>
                  <select
                    value={activeProfileId}
                    onChange={e => setActiveProfileId(e.target.value)}
                    disabled={connection?.state === "LOGGED_IN"}
                    className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs font-mono disabled:opacity-60"
                  >
                    {profiles.filter(p => p.enabled).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.kind}{p.environment === "LIVE" ? " · LIVE" : " · PAPER"})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  {connection?.state === "LOGGED_IN" ? (
                    <Button variant="outline" size="sm" className="h-8 border-rose-500/30 text-rose-400 hover:bg-rose-500/10" onClick={handleDisconnect}>
                      <Link2Off className="w-3.5 h-3.5 mr-1" /> Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" className="h-8" onClick={handleConnect}>
                      <Link2 className="w-3.5 h-3.5 mr-1" /> Connect
                    </Button>
                  )}
                </div>
              </div>

              {/* Connection state strip */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-[10px]">
                <div className="bg-muted/40 rounded p-2">
                  <div className="uppercase text-muted-foreground">State</div>
                  <Badge variant="outline" className={cn("text-[9px] mt-0.5", connectionStateBadge(connection?.state ?? "DISCONNECTED"))}>
                    {connection?.state ?? "DISCONNECTED"}
                  </Badge>
                </div>
                <div className="bg-muted/40 rounded p-2">
                  <div className="uppercase text-muted-foreground">Sender → Target</div>
                  <div className="font-mono mt-0.5">{activeProfile?.senderCompId} → {activeProfile?.targetCompId}</div>
                </div>
                <div className="bg-muted/40 rounded p-2">
                  <div className="uppercase text-muted-foreground">Endpoint</div>
                  <div className="font-mono mt-0.5">{activeProfile?.host}:{activeProfile?.port}{activeProfile?.useTls ? " (TLS)" : ""}</div>
                </div>
                <div className="bg-muted/40 rounded p-2">
                  <div className="uppercase text-muted-foreground">Seq In/Out</div>
                  <div className="font-mono mt-0.5">{connection?.session.incomingSeqNum ?? 1} / {connection?.session.outgoingSeqNum ?? 1}</div>
                </div>
                <div className="bg-muted/40 rounded p-2">
                  <div className="uppercase text-muted-foreground">Heartbeats</div>
                  <div className="font-mono mt-0.5">{connection?.heartbeatCount ?? 0}</div>
                </div>
                <div className="bg-muted/40 rounded p-2">
                  <div className="uppercase text-muted-foreground">Messages</div>
                  <div className="font-mono mt-0.5">{connection?.session.messages.length ?? 0}</div>
                </div>
              </div>

              {activeProfile && (
                <div className="text-[10px] text-muted-foreground flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={cn("text-[9px]", KIND_BADGE[activeProfile.kind])}>{activeProfile.kind}</Badge>
                  <Badge variant="outline" className={cn("text-[9px]", ENV_BADGE[activeProfile.environment])}>{activeProfile.environment}</Badge>
                  <span>HeartBtInt: {activeProfile.heartBtInt}s</span>
                  <span>ResetSeq: {activeProfile.resetSeqNumFlag ? "Y" : "N"}</span>
                  <span>Encrypt: {activeProfile.encryptMethod === "0" ? "None" : "TLS"}</span>
                  {activeProfile.username && <span>User: {activeProfile.username}</span>}
                  {activeProfile.accountId && <span>Acct: {activeProfile.accountId}</span>}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Message log */}
          <Card>
            <CardHeader className="py-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs">FIX Message Log ({connection?.session.messages.length ?? 0})</CardTitle>
              {connection?.state === "LOGGED_IN" && (
                <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => setConnection(prev => prev ? sendHeartbeat(prev) : prev)}>
                  <Radio className="w-2.5 h-2.5 mr-1" /> Send Heartbeat
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-y-auto max-h-[500px] font-mono text-[10px]">
                {!connection || connection.session.messages.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-xs">
                    No messages yet. Select a broker profile and click <strong>Connect</strong> to begin a FIX session — the Logon (35=A) handshake will appear here.
                  </div>
                ) : (
                  connection.session.messages.slice().reverse().map((msg, i) => (
                    <div key={i} className="px-3 py-1.5 border-b border-border/30 hover:bg-muted/30">
                      <div className="flex items-center gap-2 mb-0.5">
                        <Badge variant="outline" className={cn("text-[9px]",
                          msg.msgType === "A" ? "bg-emerald-500/15 text-emerald-400" :
                          msg.msgType === "5" ? "bg-rose-500/15 text-rose-400" :
                          msg.msgType === "8" ? "bg-blue-500/15 text-blue-400" :
                          msg.msgType === "D" ? "bg-amber-500/15 text-amber-400" :
                          msg.msgType === "F" ? "bg-orange-500/15 text-orange-400" :
                          "bg-muted text-muted-foreground")}>
                          {msg.msgType}
                        </Badge>
                        <span className="text-foreground font-semibold">{msg.msgTypeName}</span>
                        <span className="text-muted-foreground ml-auto">Seq: {msg.tags.find(t => t.tag === 34)?.value ?? "—"}</span>
                      </div>
                      <div className="text-muted-foreground break-all">{msg.raw.replace(/\x01/g, " | ").slice(0, 220)}{msg.raw.length > 220 ? "..." : ""}</div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Broker Profiles View */}
      {view === "brokers" && (
        <BrokerProfileManager
          profiles={profiles}
          activeProfileId={activeProfileId}
          onSelect={setActiveProfileId}
          onAdd={(p) => setProfiles(addProfile(p))}
          onUpdate={(id, updates) => setProfiles(updateProfile(id, updates))}
          onRemove={(id) => setProfiles(removeProfile(id))}
          onReset={() => { resetProfiles(); setProfiles([...DEFAULT_PROFILES]); }}
        />
      )}

      {/* Message Builder View */}
      {view === "builder" && (
        <div className="space-y-3">
          <Card>
            <CardHeader className="py-2">
              <CardTitle className="text-xs flex items-center gap-2">
                <Send className="w-3.5 h-3.5" /> FIX Message Builder
                {connection && (
                  <Badge variant="outline" className={cn("text-[9px]", connectionStateBadge(connection.state))}>
                    {connection.state}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-[10px] text-muted-foreground">Message Type</Label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mt-1">
                  {MSG_TYPES.map(m => (
                    <button key={m.type} onClick={() => setSelectedMsgType(m.type)}
                      className={cn("p-2 rounded-md border text-left",
                        selectedMsgType === m.type ? "bg-primary/15 border-primary/30" : "border-border hover:bg-muted/40")}>
                      <div className="text-xs font-mono font-semibold">{m.type} — {m.name}</div>
                      <div className="text-[9px] text-muted-foreground">{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {(selectedMsgType === "D" || selectedMsgType === "F") && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Symbol</Label>
                    <Input value={orderSymbol} onChange={e => setOrderSymbol(e.target.value)} className="h-8 text-xs font-mono mt-0.5" />
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Side</Label>
                    <select value={orderSide} onChange={e => setOrderSide(e.target.value as "BUY" | "SELL")}
                      className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
                      <option value="BUY">BUY (1)</option>
                      <option value="SELL">SELL (2)</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Qty</Label>
                    <Input type="number" value={orderQty} onChange={e => setOrderQty(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
                  </div>
                  {selectedMsgType === "D" && (
                    <>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Order Type</Label>
                        <select value={orderType} onChange={e => setOrderType(e.target.value as any)}
                          className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
                          <option value="MARKET">MARKET (1)</option>
                          <option value="LIMIT">LIMIT (2)</option>
                          <option value="STOP">STOP (3)</option>
                          <option value="STOP_LIMIT">STOP_LIMIT (4)</option>
                        </select>
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">{orderType === "MARKET" ? "TIF" : "Price"}</Label>
                        {orderType === "MARKET" ? (
                          <select value={orderTif} onChange={e => setOrderTif(e.target.value as any)}
                            className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
                            <option value="DAY">DAY (0)</option>
                            <option value="GTC">GTC (1)</option>
                            <option value="IOC">IOC (3)</option>
                            <option value="FOK">FOK (4)</option>
                          </select>
                        ) : (
                          <Input type="number" value={orderPrice} onChange={e => setOrderPrice(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" />
                        )}
                      </div>
                    </>
                  )}
                  <div>
                    <Label className="text-[10px] text-muted-foreground">ClOrdID</Label>
                    <Input value={clOrdId} onChange={e => setClOrdId(e.target.value)} className="h-8 text-xs font-mono mt-0.5" />
                  </div>
                </div>
              )}

              <Button className="w-full" onClick={handleSendBuiltMessage} disabled={!connection || connection.state !== "LOGGED_IN"}>
                <Send className="w-3 h-3 mr-1" />
                {connection?.state === "LOGGED_IN"
                  ? `Send ${MSG_TYPES.find(m => m.type === selectedMsgType)?.name} (${selectedMsgType}) via ${activeProfile?.name}`
                  : "Connect to a broker first"}
              </Button>
              {connection?.state !== "LOGGED_IN" && (
                <div className="text-[10px] text-amber-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> No active FIX session. Go to <strong>Active Session</strong> to connect.
                </div>
              )}
            </CardContent>
          </Card>

          {lastMsg && (
            <Card>
              <CardHeader className="py-2 flex flex-row items-center justify-between">
                <CardTitle className="text-xs">Last Message — {lastMsg.msgTypeName} ({lastMsg.msgType})</CardTitle>
                <Badge variant="outline" className="text-[9px]">Checksum: {lastMsg.checksum}</Badge>
              </CardHeader>
              <CardContent>
                <table className="w-full text-xs font-mono">
                  <thead className="bg-muted/40 border-y border-border">
                    <tr className="text-muted-foreground text-[10px] uppercase">
                      <th className="text-left py-1.5 px-3">Tag</th>
                      <th className="text-left py-1.5 px-3">Name</th>
                      <th className="text-left py-1.5 px-3">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastMsg.tags.map((t, i) => (
                      <tr key={i} className="border-b border-border/30">
                        <td className="py-1 px-3 text-amber-400">{t.tag}</td>
                        <td className="py-1 px-3 text-muted-foreground">{t.name}</td>
                        <td className="py-1 px-3">{t.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 p-2 bg-card/50 rounded">
                  <div className="text-[9px] uppercase text-muted-foreground mb-1">Wire Format (SOH-delimited)</div>
                  <div className="text-[10px] font-mono break-all text-muted-foreground">{lastMsg.raw.replace(/\x01/g, " | ")}</div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tag Reference View */}
      {view === "reference" && (
        <Card>
          <CardHeader className="py-2 flex flex-row items-center justify-between">
            <CardTitle className="text-xs">FIX 4.4 Tag Reference ({filteredTags.length} tags)</CardTitle>
            <Input placeholder="Search tags..." value={tagSearch} onChange={e => setTagSearch(e.target.value)} className="h-7 w-48 text-xs" />
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-y-auto max-h-[600px]">
              <table className="w-full text-xs font-mono">
                <thead className="bg-muted/40 border-y border-border sticky top-0">
                  <tr className="text-muted-foreground text-[10px] uppercase">
                    <th className="text-left py-2 px-3">Tag</th>
                    <th className="text-left py-2 px-3">Name</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTags.map(([tag, name]) => (
                    <tr key={tag} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-1 px-3 text-amber-400">{tag}</td>
                      <td className="py-1 px-3">{name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// Broker Profile Manager
// ============================================================
function BrokerProfileManager({
  profiles, activeProfileId, onSelect, onAdd, onUpdate, onRemove, onReset,
}: {
  profiles: BrokerProfile[];
  activeProfileId: string;
  onSelect: (id: string) => void;
  onAdd: (p: Omit<BrokerProfile, "id" | "createdAt" | "custom"> & Partial<Pick<BrokerProfile, "id" | "custom" | "createdAt">>) => void;
  onUpdate: (id: string, updates: Partial<BrokerProfile>) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-3 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div><div className="text-[10px] uppercase text-muted-foreground">Total Profiles</div><div className="text-lg font-mono font-semibold">{profiles.length}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Paper</div><div className="text-lg font-mono font-semibold text-emerald-400">{profiles.filter(p => p.environment === "PAPER").length}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Live</div><div className="text-lg font-mono font-semibold text-rose-400">{profiles.filter(p => p.environment === "LIVE").length}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Enabled</div><div className="text-lg font-mono font-semibold text-blue-400">{profiles.filter(p => p.enabled).length}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Custom</div><div className="text-lg font-mono font-semibold text-orange-400">{profiles.filter(p => p.custom).length}</div></div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="w-3 h-3 mr-1" /> Add Custom Broker
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { if (confirm("Reset all broker profiles to defaults? This will discard custom profiles.")) onReset(); }}>
          <RefreshCw className="w-3 h-3 mr-1" /> Reset to Defaults
        </Button>
      </div>

      {showAdd && <AddProfileForm onAdd={(p) => { onAdd(p); setShowAdd(false); }} onCancel={() => setShowAdd(false)} />}

      <Card>
        <CardHeader className="py-2"><CardTitle className="text-xs flex items-center gap-2"><Plug className="w-3.5 h-3.5" /> Broker Profiles ({profiles.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 border-y border-border sticky top-0">
                <tr className="text-muted-foreground text-[10px] uppercase">
                  <th className="text-center py-2 px-2 w-10">Default</th>
                  <th className="text-left py-2 px-3">Broker / Profile</th>
                  <th className="text-center py-2 px-2 w-10">Env</th>
                  <th className="text-left py-2 px-3">Sender → Target</th>
                  <th className="text-left py-2 px-3">Endpoint</th>
                  <th className="text-center py-2 px-2 w-10">On</th>
                  <th className="text-left py-2 px-3">Last Connected</th>
                  <th className="text-center py-2 px-2 w-20">Action</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map(p => {
                  const isActive = p.id === activeProfileId;
                  const isEdit = editId === p.id;
                  return (
                    <tr key={p.id} className={cn("border-b border-border/30", isActive && "bg-primary/5")}>
                      <td className="py-1.5 px-2 text-center">
                        <input type="radio" name="default-profile" checked={p.isDefault} onChange={() => onUpdate(p.id, { isDefault: true })} className="w-3 h-3 accent-primary cursor-pointer" />
                      </td>
                      <td className="py-1.5 px-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className={cn("text-[9px] h-4 px-1", KIND_BADGE[p.kind])}>{p.kind}</Badge>
                          <span className="font-medium">{p.name}</span>
                          {p.custom && <Badge variant="outline" className="text-[9px] h-4 px-1 bg-orange-500/15 text-orange-400">CUSTOM</Badge>}
                          {isActive && <Badge variant="outline" className="text-[9px] h-4 px-1 bg-primary/15 text-primary">SELECTED</Badge>}
                        </div>
                        {BROKER_KIND_INFO[p.kind].description && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">{BROKER_KIND_INFO[p.kind].description}</div>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <Badge variant="outline" className={cn("text-[9px] h-4 px-1", ENV_BADGE[p.environment])}>{p.environment}</Badge>
                      </td>
                      <td className="py-1.5 px-3 font-mono text-[10px]">{p.senderCompId} → {p.targetCompId}</td>
                      <td className="py-1.5 px-3 font-mono text-[10px]">{p.host}:{p.port}{p.useTls ? " (TLS)" : ""}</td>
                      <td className="py-1.5 px-2 text-center">
                        <input type="checkbox" checked={p.enabled} onChange={e => onUpdate(p.id, { enabled: e.target.checked })} className="w-3.5 h-3.5 accent-primary cursor-pointer" />
                      </td>
                      <td className="py-1.5 px-3 text-[10px] font-mono text-muted-foreground">
                        {p.lastConnectedAt ? new Date(p.lastConnectedAt).toLocaleString("en-US", { hour12: false }) : "—"}
                      </td>
                      <td className="py-1.5 px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => onSelect(p.id)} className={cn("p-1 rounded", isActive ? "text-primary" : "text-muted-foreground hover:text-primary")} title="Select as active">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setEditId(isEdit ? null : p.id)} className="p-1 text-muted-foreground hover:text-amber-400" title="Edit credentials">
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                          {p.id !== "sim-default" && (
                            <button onClick={() => { if (confirm(`Remove profile "${p.name}"?`)) onRemove(p.id); }} className="p-1 text-muted-foreground hover:text-rose-400" title="Remove profile">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {editId && (
            <ProfileEditForm
              profile={profiles.find(p => p.id === editId)!}
              onSave={(updates) => { onUpdate(editId, updates); setEditId(null); }}
              onCancel={() => setEditId(null)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AddProfileForm({ onAdd, onCancel }: {
  onAdd: (p: Omit<BrokerProfile, "id" | "createdAt" | "custom"> & Partial<Pick<BrokerProfile, "id" | "custom" | "createdAt">>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<BrokerKind>("CUSTOM");
  const [environment, setEnvironment] = useState<Environment>("PAPER");
  const [senderCompId, setSenderCompId] = useState("TWG-TRADER");
  const [targetCompId, setTargetCompId] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(443);
  const [useTls, setUseTls] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accountId, setAccountId] = useState("");
  const [heartBtInt, setHeartBtInt] = useState(30);

  const handleSubmit = () => {
    if (!name.trim() || !targetCompId.trim() || !host.trim()) {
      alert("Name, TargetCompID, and Host are required.");
      return;
    }
    onAdd({
      name: name.trim(), kind, environment,
      senderCompId, targetCompId, host, port, useTls,
      username: username || undefined, password: password || undefined,
      apiKey: apiKey || undefined, accountId: accountId || undefined,
      heartBtInt, resetSeqNumFlag: true, encryptMethod: useTls ? "0" : "0",
      enabled: true, isDefault: false,
    });
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-2 flex flex-row items-center justify-between">
        <CardTitle className="text-xs flex items-center gap-2"><Plus className="w-3.5 h-3.5" /> Add Custom Broker Profile</CardTitle>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div><Label className="text-[10px] text-muted-foreground">Name *</Label><Input value={name} onChange={e => setName(e.target.value)} className="h-8 text-xs mt-0.5" placeholder="My Broker Paper" /></div>
          <div><Label className="text-[10px] text-muted-foreground">Broker Kind</Label>
            <select value={kind} onChange={e => setKind(e.target.value as BrokerKind)} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
              {Object.entries(BROKER_KIND_INFO).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
            </select>
          </div>
          <div><Label className="text-[10px] text-muted-foreground">Environment</Label>
            <select value={environment} onChange={e => setEnvironment(e.target.value as Environment)} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs h-8">
              <option value="PAPER">PAPER (simulated)</option>
              <option value="LIVE">LIVE (real money)</option>
            </select>
          </div>
          <div><Label className="text-[10px] text-muted-foreground">HeartBtInt (s)</Label><Input type="number" value={heartBtInt} onChange={e => setHeartBtInt(Number(e.target.value))} className="h-8 text-xs mt-0.5" /></div>
          <div><Label className="text-[10px] text-muted-foreground">SenderCompID</Label><Input value={senderCompId} onChange={e => setSenderCompId(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
          <div><Label className="text-[10px] text-muted-foreground">TargetCompID *</Label><Input value={targetCompId} onChange={e => setTargetCompId(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
          <div><Label className="text-[10px] text-muted-foreground">Host *</Label><Input value={host} onChange={e => setHost(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" placeholder="fix.example.com" /></div>
          <div><Label className="text-[10px] text-muted-foreground">Port</Label><Input type="number" value={port} onChange={e => setPort(Number(e.target.value))} className="h-8 text-xs mt-0.5 font-mono" /></div>
          <div><Label className="text-[10px] text-muted-foreground">Username</Label><Input value={username} onChange={e => setUsername(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
          <div><Label className="text-[10px] text-muted-foreground">Password</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
          <div><Label className="text-[10px] text-muted-foreground">API Key</Label><Input value={apiKey} onChange={e => setApiKey(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
          <div><Label className="text-[10px] text-muted-foreground">Account ID</Label><Input value={accountId} onChange={e => setAccountId(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer"><input type="checkbox" checked={useTls} onChange={e => setUseTls(e.target.checked)} className="w-3 h-3 accent-primary" /> Use TLS (recommended for production brokers)</label>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSubmit}><ShieldCheck className="w-3 h-3 mr-1" /> Save Profile</Button>
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Credentials are stored only in your browser's localStorage. They never leave your machine.</span>
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileEditForm({ profile, onSave, onCancel }: {
  profile: BrokerProfile;
  onSave: (updates: Partial<BrokerProfile>) => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState(profile.username ?? "");
  const [password, setPassword] = useState(profile.password ?? "");
  const [apiKey, setApiKey] = useState(profile.apiKey ?? "");
  const [accountId, setAccountId] = useState(profile.accountId ?? "");
  const [senderCompId, setSenderCompId] = useState(profile.senderCompId);
  const [targetCompId, setTargetCompId] = useState(profile.targetCompId);
  const [host, setHost] = useState(profile.host);
  const [port, setPort] = useState(profile.port);
  const [useTls, setUseTls] = useState(profile.useTls);
  const [heartBtInt, setHeartBtInt] = useState(profile.heartBtInt);

  return (
    <div className="border-t border-border bg-muted/20 p-3">
      <div className="text-xs font-semibold mb-2">Edit Credentials / Session — {profile.name}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div><Label className="text-[10px] text-muted-foreground">SenderCompID</Label><Input value={senderCompId} onChange={e => setSenderCompId(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
        <div><Label className="text-[10px] text-muted-foreground">TargetCompID</Label><Input value={targetCompId} onChange={e => setTargetCompId(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
        <div><Label className="text-[10px] text-muted-foreground">Host</Label><Input value={host} onChange={e => setHost(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
        <div><Label className="text-[10px] text-muted-foreground">Port</Label><Input type="number" value={port} onChange={e => setPort(Number(e.target.value))} className="h-8 text-xs mt-0.5 font-mono" /></div>
        <div><Label className="text-[10px] text-muted-foreground">Username</Label><Input value={username} onChange={e => setUsername(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
        <div><Label className="text-[10px] text-muted-foreground">Password</Label><Input type="password" value={password} onChange={e => setPassword(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
        <div><Label className="text-[10px] text-muted-foreground">API Key</Label><Input value={apiKey} onChange={e => setApiKey(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
        <div><Label className="text-[10px] text-muted-foreground">Account ID</Label><Input value={accountId} onChange={e => setAccountId(e.target.value)} className="h-8 text-xs mt-0.5 font-mono" /></div>
        <div><Label className="text-[10px] text-muted-foreground">HeartBtInt (s)</Label><Input type="number" value={heartBtInt} onChange={e => setHeartBtInt(Number(e.target.value))} className="h-8 text-xs mt-0.5 font-mono" /></div>
        <label className="flex items-end gap-1.5 text-[10px] text-muted-foreground cursor-pointer pb-1.5"><input type="checkbox" checked={useTls} onChange={e => setUseTls(e.target.checked)} className="w-3 h-3 accent-primary" /> TLS</label>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <Button size="sm" onClick={() => onSave({ username, password, apiKey, accountId, senderCompId, targetCompId, host, port, useTls, heartBtInt })}>Save</Button>
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
