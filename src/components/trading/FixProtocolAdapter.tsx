"use client";
import { useState, useMemo } from "react";
import { createSession, buildLogon, buildLogout, buildHeartbeat, buildResendRequest, buildNewOrderSingle, buildOrderCancel, buildExecutionReport, buildMarketDataRequest, parseFixMessage, FIX_TAG_NAMES, FIX_MSG_TYPES, ORD_STATUS_VALUES, EXEC_TYPE_VALUES, type FixSession, type FixMessage } from "@/lib/trading/fix-protocol";
import { fmtTime } from "@/lib/trading/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Activity, Send, Terminal } from "lucide-react";

type View = "session" | "builder" | "reference";
const VIEWS: { id: View; name: string }[] = [{ id: "session", name: "Session Manager" }, { id: "builder", name: "Message Builder" }, { id: "reference", name: "Tag Reference" }];

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
  const [session, setSession] = useState<FixSession>(() => createSession("TWG-TRADER", "CME-FCM"));
  const [selectedMsgType, setSelectedMsgType] = useState("D");
  // Message builder params
  const [symbol, setSymbol] = useState("ES");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(5000);
  const [clOrdId, setClOrdId] = useState("TWG-001");
  const [customMsg, setCustomMsg] = useState<FixMessage | null>(null);
  const [tagSearch, setTagSearch] = useState("");

  const sendMsg = (msg: FixMessage) => {
    setSession(prev => { const s = { ...prev, messages: [...prev.messages, msg] }; s.outgoingSeqNum++; return s; });
  };

  const handleSend = () => {
    let msg: FixMessage;
    switch (selectedMsgType) {
      case "A": msg = buildLogon(session.senderCompId, session.targetCompId, session.heartBtInt, true); break;
      case "5": msg = buildLogout(session.senderCompId, session.targetCompId, session.outgoingSeqNum); break;
      case "0": msg = buildHeartbeat(session.senderCompId, session.targetCompId, session.outgoingSeqNum); break;
      case "2": msg = buildResendRequest(session.senderCompId, session.targetCompId, session.outgoingSeqNum, 1); break;
      case "D": msg = buildNewOrderSingle({ senderCompId: session.senderCompId, targetCompId: session.targetCompId, clOrdId, symbol, side, orderType: "LIMIT", qty, price, tif: "DAY", seqNum: session.outgoingSeqNum }); break;
      case "F": msg = buildOrderCancel({ senderCompId: session.senderCompId, targetCompId: session.targetCompId, clOrdId: `CANCEL-${Date.now()}`, origClOrdId: clOrdId, symbol, side, qty, seqNum: session.outgoingSeqNum }); break;
      case "8": msg = buildExecutionReport({ senderCompId: session.targetCompId, targetCompId: session.senderCompId, orderId: `ORD-${Date.now()}`, clOrdId, execId: `EXEC-${Date.now()}`, symbol, side, ordStatus: "2", execType: "2", cumQty: qty, avgPx: price, leavesQty: 0, lastQty: qty, lastPx: price, seqNum: session.outgoingSeqNum }); break;
      case "V": msg = buildMarketDataRequest({ senderCompId: session.senderCompId, targetCompId: session.targetCompId, mdReqId: `MD-${Date.now()}`, symbol, subscriptionType: "1", marketDepth: 10, seqNum: session.outgoingSeqNum }); break;
      default: return;
    }
    sendMsg(msg); setCustomMsg(msg);
  };

  const filteredTags = Object.entries(FIX_TAG_NAMES).filter(([tag, name]) => !tagSearch || name.toLowerCase().includes(tagSearch.toLowerCase()) || tag.includes(tagSearch)).slice(0, 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 flex-wrap">{VIEWS.map(v => <button key={v.id} onClick={() => setView(v.id)} className={cn("px-3 py-1.5 rounded-md text-xs border transition-colors", view === v.id ? "bg-primary/15 text-primary border-primary/30" : "border-border text-muted-foreground hover:bg-muted/40")}>{v.name}</button>)}</div>

      {view === "session" && (
        <div className="space-y-3">
          <Card className="border-primary/20">
            <CardContent className="p-3 flex items-center gap-4">
              <div className="w-10 h-10 rounded-md bg-primary/20 flex items-center justify-center"><Terminal className="w-5 h-5 text-primary" /></div>
              <div><div className="text-sm font-semibold">FIX Session: {session.senderCompId} → {session.targetCompId}</div><div className="text-xs text-muted-foreground">HeartBtInt: {session.heartBtInt}s · OutSeq: {session.outgoingSeqNum} · InSeq: {session.incomingSeqNum} · Messages: {session.messages.length}</div></div>
              <div className="ml-auto"><Badge variant="outline" className={cn("text-[10px]", session.state === "LOGGED_IN" ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground")}>{session.state}</Badge></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="py-2"><CardTitle className="text-xs">Message Log ({session.messages.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-y-auto max-h-[500px] font-mono text-[10px]">
                {session.messages.length === 0 ? <div className="text-center py-8 text-muted-foreground text-xs">No messages sent yet. Use Message Builder to construct and send FIX messages.</div> : session.messages.slice().reverse().map((msg, i) => (
                  <div key={i} className="px-3 py-1.5 border-b border-border/30 hover:bg-muted/30">
                    <div className="flex items-center gap-2 mb-0.5"><Badge variant="outline" className="text-[9px] bg-blue-500/15 text-blue-400">{msg.msgType}</Badge><span className="text-foreground font-semibold">{msg.msgTypeName}</span><span className="text-muted-foreground ml-auto">SeqNum: {msg.tags.find(t => t.tag === 34)?.value ?? "—"}</span></div>
                    <div className="text-muted-foreground break-all">{msg.raw.replace(/\x01/g, " | ").slice(0, 200)}{msg.raw.length > 200 ? "..." : ""}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {view === "builder" && (
        <div className="space-y-3">
          <Card>
            <CardHeader className="py-2"><CardTitle className="text-xs">FIX Message Builder</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label className="text-[10px] text-muted-foreground">Message Type</Label><div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mt-1">{MSG_TYPES.map(m => <button key={m.type} onClick={() => setSelectedMsgType(m.type)} className={cn("p-2 rounded-md border text-left", selectedMsgType === m.type ? "bg-primary/15 border-primary/30" : "border-border hover:bg-muted/40")}><div className="text-xs font-mono font-semibold">{m.type} — {m.name}</div><div className="text-[9px] text-muted-foreground">{m.desc}</div></button>)}</div></div>
              {(selectedMsgType === "D" || selectedMsgType === "F" || selectedMsgType === "8" || selectedMsgType === "V") && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div><Label className="text-[10px] text-muted-foreground">Symbol</Label><Input value={symbol} onChange={e => setSymbol(e.target.value)} className="h-8 text-xs font-mono mt-0.5" /></div>
                  <div><Label className="text-[10px] text-muted-foreground">Side</Label><select value={side} onChange={e => setSide(e.target.value as "BUY" | "SELL")} className="w-full mt-0.5 bg-muted/50 border border-border rounded px-2 py-1.5 text-xs"><option value="BUY">BUY (1)</option><option value="SELL">SELL (2)</option></select></div>
                  <div><Label className="text-[10px] text-muted-foreground">Quantity</Label><Input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" /></div>
                  <div><Label className="text-[10px] text-muted-foreground">Price</Label><Input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} className="h-8 text-xs font-mono mt-0.5" /></div>
                  <div><Label className="text-[10px] text-muted-foreground">ClOrdID</Label><Input value={clOrdId} onChange={e => setClOrdId(e.target.value)} className="h-8 text-xs font-mono mt-0.5" /></div>
                </div>
              )}
              <Button className="w-full" onClick={handleSend}><Send className="w-3 h-3 mr-1" /> Build & Send {MSG_TYPES.find(m => m.type === selectedMsgType)?.name} ({selectedMsgType})</Button>
            </CardContent>
          </Card>
          {customMsg && (
            <Card>
              <CardHeader className="py-2 flex flex-row items-center justify-between"><CardTitle className="text-xs">Last Message — {customMsg.msgTypeName} ({customMsg.msgType})</CardTitle><Badge variant="outline" className="text-[9px]">Checksum: {customMsg.checksum}</Badge></CardHeader>
              <CardContent>
                <table className="w-full text-xs font-mono"><thead className="bg-muted/40 border-y border-border"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-1.5 px-3">Tag</th><th className="text-left py-1.5 px-3">Name</th><th className="text-left py-1.5 px-3">Value</th></tr></thead>
                  <tbody>{customMsg.tags.map((t, i) => <tr key={i} className="border-b border-border/30"><td className="py-1 px-3 text-amber-400">{t.tag}</td><td className="py-1 px-3 text-muted-foreground">{t.name}</td><td className="py-1 px-3">{t.value}</td></tr>)}</tbody>
                </table>
                <div className="mt-2 p-2 bg-card/50 rounded"><div className="text-[9px] uppercase text-muted-foreground mb-1">Wire Format (SOH-delimited)</div><div className="text-[10px] font-mono break-all text-muted-foreground">{customMsg.raw.replace(/\x01/g, " | ")}</div></div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {view === "reference" && (
        <Card>
          <CardHeader className="py-2 flex flex-row items-center justify-between"><CardTitle className="text-xs">FIX 4.4 Tag Reference ({filteredTags.length} tags)</CardTitle><Input placeholder="Search tags..." value={tagSearch} onChange={e => setTagSearch(e.target.value)} className="h-7 w-48 text-xs" /></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-y-auto max-h-[600px]">
              <table className="w-full text-xs font-mono"><thead className="bg-muted/40 border-y border-border sticky top-0"><tr className="text-muted-foreground text-[10px] uppercase"><th className="text-left py-2 px-3">Tag</th><th className="text-left py-2 px-3">Name</th></tr></thead>
                <tbody>{filteredTags.map(([tag, name]) => <tr key={tag} className="border-b border-border/30 hover:bg-muted/30"><td className="py-1 px-3 text-amber-400">{tag}</td><td className="py-1 px-3">{name}</td></tr>)}</tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
