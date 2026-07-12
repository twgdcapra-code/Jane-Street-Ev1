/** FIX Protocol Adapter Engine — based on research/fix_protocol.md */
import type { Side, OrderType, TimeInForce } from "./types";

export interface FixTag { tag: number; name: string; value: string; }
export interface FixMessage { msgType: string; msgTypeName: string; tags: FixTag[]; raw: string; checksum: string; }

const SOH = "\x01";

export function computeBodyLength(tags: FixTag[]): number {
  const body = tags.map(t => `${t.tag}=${t.value}`).join(SOH) + SOH;
  return body.length;
}

export function computeChecksum(tags: FixTag[]): string {
  const body = tags.map(t => `${t.tag}=${t.value}`).join(SOH) + SOH + "10=";
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += body.charCodeAt(i);
  return String(sum % 256).padStart(3, "0");
}

export function buildFixMessage(msgType: string, msgTypeName: string, tags: FixTag[]): FixMessage {
  const allTags = [
    { tag: 8, name: "BeginString", value: "FIX.4.4" },
    { tag: 9, name: "BodyLength", value: String(computeBodyLength(tags)) },
    ...tags,
  ];
  const checksum = computeChecksum(allTags);
  const finalTags = [...allTags, { tag: 10, name: "CheckSum", value: checksum }];
  const raw = finalTags.map(t => `${t.tag}=${t.value}`).join(SOH) + SOH;
  return { msgType, msgTypeName, tags: finalTags, raw, checksum };
}

export function parseFixMessage(raw: string): FixMessage | null {
  const parts = raw.split(SOH).filter(p => p.length > 0);
  const tags: FixTag[] = [];
  let msgType = ""; let msgTypeName = "";
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx < 0) continue;
    const tag = parseInt(part.substring(0, eqIdx));
    const value = part.substring(eqIdx + 1);
    const name = FIX_TAG_NAMES[tag] ?? `Tag${tag}`;
    tags.push({ tag, name, value });
    if (tag === 35) { msgType = value; msgTypeName = FIX_MSG_TYPES[value] ?? value; }
  }
  if (!msgType) return null;
  const checksum = tags.find(t => t.tag === 10)?.value ?? "000";
  return { msgType, msgTypeName, tags, raw, checksum };
}

export function buildLogon(senderCompId: string, targetCompId: string, heartBtInt: number = 30, resetSeqNum: boolean = true, username?: string, password?: string): FixMessage {
  const tags: FixTag[] = [
    { tag: 35, name: "MsgType", value: "A" },
    { tag: 49, name: "SenderCompID", value: senderCompId },
    { tag: 56, name: "TargetCompID", value: targetCompId },
    { tag: 34, name: "MsgSeqNum", value: "1" },
    { tag: 52, name: "SendingTime", value: formatFixTime() },
    { tag: 98, name: "EncryptMethod", value: "0" },
    { tag: 108, name: "HeartBtInt", value: String(heartBtInt) },
    { tag: 141, name: "ResetSeqNumFlag", value: resetSeqNum ? "Y" : "N" },
  ];
  if (username) tags.push({ tag: 553, name: "Username", value: username });
  if (password) tags.push({ tag: 554, name: "Password", value: password });
  return buildFixMessage("A", "Logon", tags);
}

export function buildLogout(senderCompId: string, targetCompId: string, seqNum: number, text?: string): FixMessage {
  const tags: FixTag[] = [
    { tag: 35, name: "MsgType", value: "5" },
    { tag: 49, name: "SenderCompID", value: senderCompId },
    { tag: 56, name: "TargetCompID", value: targetCompId },
    { tag: 34, name: "MsgSeqNum", value: String(seqNum) },
    { tag: 52, name: "SendingTime", value: formatFixTime() },
  ];
  if (text) tags.push({ tag: 58, name: "Text", value: text });
  return buildFixMessage("5", "Logout", tags);
}

export function buildHeartbeat(senderCompId: string, targetCompId: string, seqNum: number, testReqId?: string): FixMessage {
  const tags: FixTag[] = [
    { tag: 35, name: "MsgType", value: "0" },
    { tag: 49, name: "SenderCompID", value: senderCompId },
    { tag: 56, name: "TargetCompID", value: targetCompId },
    { tag: 34, name: "MsgSeqNum", value: String(seqNum) },
    { tag: 52, name: "SendingTime", value: formatFixTime() },
  ];
  if (testReqId) tags.push({ tag: 112, name: "TestReqID", value: testReqId });
  return buildFixMessage("0", "Heartbeat", tags);
}

export function buildResendRequest(senderCompId: string, targetCompId: string, seqNum: number, beginSeqNo: number, endSeqNo: number = 0): FixMessage {
  const tags: FixTag[] = [
    { tag: 35, name: "MsgType", value: "2" },
    { tag: 49, name: "SenderCompID", value: senderCompId },
    { tag: 56, name: "TargetCompID", value: targetCompId },
    { tag: 34, name: "MsgSeqNum", value: String(seqNum) },
    { tag: 52, name: "SendingTime", value: formatFixTime() },
    { tag: 7, name: "BeginSeqNo", value: String(beginSeqNo) },
    { tag: 16, name: "EndSeqNo", value: String(endSeqNo) },
  ];
  return buildFixMessage("2", "ResendRequest", tags);
}

export function buildNewOrderSingle(params: {
  senderCompId: string; targetCompId: string; clOrdId: string; symbol: string;
  side: Side; orderType: OrderType; qty: number; price?: number; stopPrice?: number;
  tif?: TimeInForce; account?: string; maturityMonthYear?: string; seqNum: number;
}): FixMessage {
  const sideMap: Record<Side, string> = { BUY: "1", SELL: "2" };
  const typeMap: Record<OrderType, string> = { MARKET: "1", LIMIT: "2", STOP: "3", STOP_LIMIT: "4", MIT: "J", ICEBERG: "2", TWAP: "2", VWAP: "2" };
  const tifMap: Record<TimeInForce, string> = { DAY: "0", GTC: "1", IOC: "3", FOK: "4", GTD: "6" };
  const tags: FixTag[] = [
    { tag: 35, name: "MsgType", value: "D" },
    { tag: 49, name: "SenderCompID", value: params.senderCompId },
    { tag: 56, name: "TargetCompID", value: params.targetCompId },
    { tag: 34, name: "MsgSeqNum", value: String(params.seqNum) },
    { tag: 52, name: "SendingTime", value: formatFixTime() },
    { tag: 11, name: "ClOrdID", value: params.clOrdId },
    { tag: 55, name: "Symbol", value: params.symbol },
    { tag: 54, name: "Side", value: sideMap[params.side] },
    { tag: 38, name: "OrderQty", value: String(params.qty) },
    { tag: 40, name: "OrdType", value: typeMap[params.orderType] },
    { tag: 59, name: "TimeInForce", value: tifMap[params.tif ?? "DAY"] },
    { tag: 60, name: "TransactTime", value: formatFixTime() },
  ];
  if (params.price !== undefined) tags.push({ tag: 44, name: "Price", value: String(params.price) });
  if (params.stopPrice !== undefined) tags.push({ tag: 99, name: "StopPx", value: String(params.stopPrice) });
  if (params.account) tags.push({ tag: 1, name: "Account", value: params.account });
  if (params.maturityMonthYear) tags.push({ tag: 200, name: "MaturityMonthYear", value: params.maturityMonthYear });
  return buildFixMessage("D", "NewOrderSingle", tags);
}

export function buildOrderCancel(params: {
  senderCompId: string; targetCompId: string; clOrdId: string; origClOrdId: string;
  symbol: string; side: Side; qty: number; seqNum: number;
}): FixMessage {
  const sideMap: Record<Side, string> = { BUY: "1", SELL: "2" };
  const tags: FixTag[] = [
    { tag: 35, name: "MsgType", value: "F" },
    { tag: 49, name: "SenderCompID", value: params.senderCompId },
    { tag: 56, name: "TargetCompID", value: params.targetCompId },
    { tag: 34, name: "MsgSeqNum", value: String(params.seqNum) },
    { tag: 52, name: "SendingTime", value: formatFixTime() },
    { tag: 41, name: "OrigClOrdID", value: params.origClOrdId },
    { tag: 11, name: "ClOrdID", value: params.clOrdId },
    { tag: 55, name: "Symbol", value: params.symbol },
    { tag: 54, name: "Side", value: sideMap[params.side] },
    { tag: 38, name: "OrderQty", value: String(params.qty) },
    { tag: 60, name: "TransactTime", value: formatFixTime() },
  ];
  return buildFixMessage("F", "OrderCancelRequest", tags);
}

export function buildExecutionReport(params: {
  senderCompId: string; targetCompId: string; orderId: string; clOrdId: string;
  execId: string; symbol: string; side: Side; ordStatus: string; execType: string;
  cumQty: number; avgPx: number; leavesQty: number; lastQty?: number; lastPx?: number; seqNum: number;
}): FixMessage {
  const sideMap: Record<Side, string> = { BUY: "1", SELL: "2" };
  const tags: FixTag[] = [
    { tag: 35, name: "MsgType", value: "8" },
    { tag: 49, name: "SenderCompID", value: params.senderCompId },
    { tag: 56, name: "TargetCompID", value: params.targetCompId },
    { tag: 34, name: "MsgSeqNum", value: String(params.seqNum) },
    { tag: 52, name: "SendingTime", value: formatFixTime() },
    { tag: 37, name: "OrderID", value: params.orderId },
    { tag: 11, name: "ClOrdID", value: params.clOrdId },
    { tag: 17, name: "ExecID", value: params.execId },
    { tag: 55, name: "Symbol", value: params.symbol },
    { tag: 54, name: "Side", value: sideMap[params.side] },
    { tag: 150, name: "ExecType", value: params.execType },
    { tag: 39, name: "OrdStatus", value: params.ordStatus },
    { tag: 14, name: "CumQty", value: String(params.cumQty) },
    { tag: 6, name: "AvgPx", value: String(params.avgPx) },
    { tag: 151, name: "LeavesQty", value: String(params.leavesQty) },
  ];
  if (params.lastQty !== undefined) tags.push({ tag: 32, name: "LastQty", value: String(params.lastQty) });
  if (params.lastPx !== undefined) tags.push({ tag: 31, name: "LastPx", value: String(params.lastPx) });
  return buildFixMessage("8", "ExecutionReport", tags);
}

export function buildMarketDataRequest(params: {
  senderCompId: string; targetCompId: string; mdReqId: string; symbol: string;
  subscriptionType: string; marketDepth: number; seqNum: number;
}): FixMessage {
  const tags: FixTag[] = [
    { tag: 35, name: "MsgType", value: "V" },
    { tag: 49, name: "SenderCompID", value: params.senderCompId },
    { tag: 56, name: "TargetCompID", value: params.targetCompId },
    { tag: 34, name: "MsgSeqNum", value: String(params.seqNum) },
    { tag: 52, name: "SendingTime", value: formatFixTime() },
    { tag: 262, name: "MDReqID", value: params.mdReqId },
    { tag: 263, name: "SubscriptionRequestType", value: params.subscriptionType },
    { tag: 264, name: "MarketDepth", value: String(params.marketDepth) },
    { tag: 267, name: "NoMDEntryTypes", value: "2" },
    { tag: 269, name: "MDEntryType", value: "0" }, // Bid
    { tag: 269, name: "MDEntryType", value: "1" }, // Offer
    { tag: 146, name: "NoRelatedSym", value: "1" },
    { tag: 55, name: "Symbol", value: params.symbol },
  ];
  return buildFixMessage("V", "MarketDataRequest", tags);
}

export interface FixSession {
  senderCompId: string;
  targetCompId: string;
  incomingSeqNum: number;
  outgoingSeqNum: number;
  heartBtInt: number;
  state: "DISCONNECTED" | "LOGGING_IN" | "LOGGED_IN" | "LOGGING_OUT" | "RESENDING";
  messages: FixMessage[];
  lastHeartbeat: number;
}

export function createSession(senderCompId: string, targetCompId: string, heartBtInt: number = 30): FixSession {
  return { senderCompId, targetCompId, incomingSeqNum: 1, outgoingSeqNum: 1, heartBtInt, state: "DISCONNECTED", messages: [], lastHeartbeat: 0 };
}

export function sendSessionMessage(session: FixSession, message: FixMessage): FixSession {
  session.messages.push(message);
  session.outgoingSeqNum++;
  session.lastHeartbeat = Date.now();
  return { ...session };
}

export function receiveMessage(session: FixSession, message: FixMessage): FixSession {
  session.messages.push(message);
  if (message.msgType === "A") session.state = "LOGGED_IN";
  if (message.msgType === "5") session.state = "DISCONNECTED";
  session.incomingSeqNum++;
  return { ...session };
}

function formatFixTime(): string {
  return new Date().toISOString().replace(/[-:T]/g, "").replace(/\.\d+Z$/, "");
}

// FIX Tag Reference (top 100+)
export const FIX_TAG_NAMES: Record<number, string> = {
  1: "Account", 6: "AvgPx", 7: "BeginSeqNo", 8: "BeginString", 9: "BodyLength",
  10: "CheckSum", 11: "ClOrdID", 14: "CumQty", 15: "Currency", 16: "EndSeqNo",
  17: "ExecID", 18: "ExecInst", 19: "ExecRefID", 20: "ExecTransType", 21: "HandlInst",
  22: "SecurityIDSource", 23: "IOIid", 25: "IOIQltyInd", 26: "IOIRefID", 27: "IOIShares",
  28: "IOITransType", 29: "LastCapacity", 31: "LastPx", 32: "LastQty", 34: "MsgSeqNum",
  35: "MsgType", 37: "OrderID", 38: "OrderQty", 39: "OrdStatus", 40: "OrdType",
  41: "OrigClOrdID", 44: "Price", 45: "RefSeqNum", 47: "Rule80A", 48: "SecurityID",
  49: "SenderCompID", 50: "SenderSubID", 52: "SendingTime", 54: "Side", 55: "Symbol",
  56: "TargetCompID", 57: "TargetSubID", 58: "Text", 59: "TimeInForce", 60: "TransactTime",
  61: "Urgency", 62: "ValidUntilTime", 63: "SettlType", 64: "SettlDate", 65: "SymbolSfx",
  66: "ListID", 67: "ListSeqNo", 68: "TotalNumReports", 69: "ListExecInst", 70: "AllocID",
  71: "AllocTransType", 72: "RefAllocID", 73: "NoOrders", 74: "AvgPxPrecision", 75: "TradeDate",
  77: "PositionEffect", 78: "NoAllocs", 79: "AllocAccount", 80: "Qty", 81: "ProcessCode",
  82: "NoRpts", 83: "RptSeq", 84: "CxlQty", 85: "NoDlvyInst", 86: "AllocStatus",
  87: "AllocRejCode", 88: "AllocText", 90: "IndividualAllocID", 91: "IndividualAllocRejCode",
  93: "Signature", 94: "SecureDataLen", 95: "RawDataLength", 96: "RawData", 98: "EncryptMethod",
  99: "StopPx", 100: "ExDestination", 102: "CxlRejReason", 103: "OrdRejReason",
  104: "IOIQualifier", 106: "Issuer", 107: "SecurityDesc", 108: "HeartBtInt",
  109: "MinQty", 110: "MaxFloor", 111: "MaxPrice", 112: "TestReqID", 113: "ReportToExch",
  114: "LocateReqd", 115: "OnBehalfOfCompID", 116: "OnBehalfOfSubID", 117: "QuoteID",
  118: "NetMoney", 119: "SettlCurrAmt", 120: "SettlCurrency", 121: "ForexReq",
  122: "OrigSendingTime", 123: "GapFillFlag", 124: "NoExecs", 125: "ExpireTime",
  126: "DKReason", 127: "DeliverToCompID", 128: "DeliverToSubID", 129: "DKReason",
  130: "DeliverToLocationID", 131: "DeleteReason", 132: "NoAllocs", 133: "AllocAccount",
  135: "AllocPrice", 136: "AllocSettlCurrAmt", 137: "AllocSettlCurrency",
  138: "SettlCurrFxRate", 139: "SettlCurrFxRateCalc", 140: "AllocSettlInstType",
  141: "ResetSeqNumFlag", 142: "SenderLocationID", 143: "TargetLocationID",
  144: "OnBehalfOfLocationID", 145: "DeliverToLocationID", 146: "NoRelatedSym",
  147: "QuoteAckStatus", 148: "QuoteReqID", 149: "QuoteID", 150: "ExecType",
  151: "LeavesQty", 152: "CashOrderQty", 153: "AllocAvgPx", 154: "AllocNetMoney",
  155: "SettlCurrFxRate", 156: "SettlCurrFxRateCalc", 157: "NumDaysInterest",
  158: "AccruedInterestRate", 159: "SecurityType", 160: "SettlDate2", 161: "OrderQty2",
  162: "LastForwardPoints", 163: "AllocLinkID", 164: "AllocLinkType", 165: "SecondaryOrderID",
  167: "BookingType", 168: "IndividualAllocType", 169: "EndDate", 170: "OrderQty2",
  171: "PutOrCall", 172: "StrikePrice", 173: "SettlType", 174: "SettlDate",
  175: "InvestmentDecisionMaker", 176: "FAComponentType", 177: "FAComponentID",
  178: "FAComponentType", 179: "FAComponentSubType", 180: "AllocLinkType",
  181: "AllocLinkID", 182: "IndividualAllocType", 183: "OrigClOrdID",
  184: "NoOrders", 185: "NoAllocs", 186: "NoRpts", 187: "QuoteReqID",
  188: "QuoteID", 189: "NoQuoteEntries", 190: "NoQuoteSets", 191: "QuoteSetID",
  192: "QuoteEntryID", 193: "QuoteRequestType", 194: "QuoteResponseLevel",
  195: "NoQuoteEntries", 196: "NoQuoteSets", 197: "QuoteSetID", 198: "QuoteEntryID",
  199: "QuoteRequestType", 200: "MaturityMonthYear", 201: "PutOrCall", 202: "StrikePrice",
  203: "ContractMultiplier", 204: "CouponRate", 205: "SecurityExchange",
  206: "SecurityDesc", 207: "SecurityType", 208: "NoSecurityAltID",
  209: "SecurityAltID", 210: "SecurityAltIDSource", 211: "NoLegs", 212: "LegSymbol",
  213: "LegSymbolSfx", 214: "LegSecurityID", 215: "LegSecurityIDSource",
  216: "LegSecurityType", 217: "LegMaturityMonthYear", 218: "LegCouponRate",
  219: "LegStrikePrice", 220: "LegOptionRatio", 221: "LegContractMultiplier",
  222: "LegPutOrCall", 223: "LegSecurityExchange", 224: "LegSecurityDesc",
  225: "LegSecurityType", 226: "NoLegs", 227: "NoLegSecurityAltID",
  228: "LegSecurityAltID", 229: "LegSecurityAltIDSource", 230: "LegStrikePrice",
  231: "LegOptionRatio", 232: "LegContractMultiplier", 233: "LegPutOrCall",
  234: "LegSecurityExchange", 235: "LegSecurityDesc", 236: "LegSecurityType",
  237: "LegMaturityMonthYear", 238: "LegCouponRate", 239: "NoLegSecurityAltID",
  240: "LegSecurityAltID", 241: "LegSecurityAltIDSource", 242: "LegStrikePrice",
  243: "LegOptionRatio", 244: "LegContractMultiplier", 245: "LegPutOrCall",
  246: "LegSecurityExchange", 247: "LegSecurityDesc", 248: "LegSecurityType",
  249: "LegMaturityMonthYear", 250: "LegCouponRate", 251: "LegStrikePrice",
  252: "LegOptionRatio", 253: "LegContractMultiplier", 254: "LegPutOrCall",
  255: "LegSecurityExchange", 256: "LegSecurityDesc", 257: "LegSecurityType",
  258: "LegMaturityMonthYear", 259: "LegCouponRate", 260: "LegStrikePrice",
  261: "LegOptionRatio", 262: "MDReqID", 263: "SubscriptionRequestType",
  264: "MarketDepth", 265: "MDPriceLevel", 266: "NoMDEntries", 267: "NoMDEntryTypes",
  268: "MDEntryType", 269: "MDEntryType", 270: "MDEntryPx", 271: "MDEntrySize",
  272: "MDEntryDate", 273: "MDEntryTime", 274: "TickDirection", 275: "QuoteCondition",
  276: "TradeCondition", 277: "MDEntryOriginator", 278: "LocationID", 279: "DeskID",
  280: "DeleteReason", 281: "MDEntryBuyer", 282: "MDEntrySeller", 283: "MDEntryPositionNo",
  284: "MDEntryPositionNo", 285: "MDInsertType", 286: "MDInsertType", 287: "MDInsertType",
  288: "MDInsertType", 289: "MDInsertType", 290: "MDInsertType", 291: "MDInsertType",
  292: "MDInsertType", 293: "MDInsertType", 294: "MDInsertType", 295: "MDInsertType",
  296: "MDInsertType", 297: "MDInsertType", 298: "MDInsertType", 299: "MDInsertType",
  300: "MDInsertType", 301: "MDInsertType", 302: "MDInsertType", 303: "MDInsertType",
  304: "MDInsertType", 305: "MDInsertType", 306: "MDInsertType", 307: "MDInsertType",
  308: "MDInsertType", 309: "MDInsertType", 310: "MDInsertType", 311: "MDInsertType",
  312: "MDInsertType", 313: "MDInsertType", 314: "MDInsertType", 315: "MDInsertType",
  316: "MDInsertType", 317: "MDInsertType", 318: "MDInsertType", 319: "MDInsertType",
  320: "MDInsertType", 321: "MDInsertType", 322: "MDInsertType", 323: "MDInsertType",
  324: "MDInsertType", 325: "MDInsertType", 326: "MDInsertType", 327: "MDInsertType",
  328: "MDInsertType", 329: "MDInsertType", 330: "MDInsertType", 331: "MDInsertType",
  332: "MDInsertType", 333: "MDInsertType", 334: "MDInsertType", 335: "MDInsertType",
  336: "MDInsertType", 337: "MDInsertType", 338: "MDInsertType", 339: "MDInsertType",
  340: "MDInsertType", 341: "MDInsertType", 342: "MDInsertType", 343: "MDInsertType",
  344: "MDInsertType", 345: "MDInsertType", 346: "MDInsertType", 347: "MDInsertType",
  348: "MDInsertType", 349: "MDInsertType", 350: "MDInsertType", 351: "MDInsertType",
  352: "MDInsertType", 353: "MDInsertType", 354: "MDInsertType", 355: "MDInsertType",
  356: "MDInsertType", 357: "MDInsertType", 358: "MDInsertType", 359: "MDInsertType",
  360: "MDInsertType", 361: "MDInsertType", 362: "MDInsertType", 363: "MDInsertType",
  364: "MDInsertType", 365: "MDInsertType", 366: "MDInsertType", 367: "MDInsertType",
  368: "MDInsertType", 369: "MDInsertType", 370: "MDInsertType", 371: "MDInsertType",
  372: "MDInsertType", 373: "MDInsertType", 374: "MDInsertType", 375: "MDInsertType",
  376: "MDInsertType", 377: "MDInsertType", 378: "MDInsertType", 379: "MDInsertType",
  380: "MDInsertType", 381: "MDInsertType", 382: "MDInsertType", 383: "MDInsertType",
  384: "MDInsertType", 385: "MDInsertType", 386: "MDInsertType", 387: "MDInsertType",
  388: "MDInsertType", 389: "MDInsertType", 390: "MDInsertType", 391: "MDInsertType",
  392: "MDInsertType", 393: "MDInsertType", 394: "MDInsertType", 395: "MDInsertType",
  396: "MDInsertType", 397: "MDInsertType", 398: "MDInsertType", 399: "MDInsertType",
  400: "MDInsertType", 401: "MDInsertType", 402: "MDInsertType", 403: "MDInsertType",
  404: "MDInsertType", 405: "MDInsertType", 406: "MDInsertType", 407: "MDInsertType",
  408: "MDInsertType", 409: "MDInsertType", 410: "MDInsertType", 411: "MDInsertType",
  412: "MDInsertType", 413: "MDInsertType", 414: "MDInsertType", 415: "MDInsertType",
  416: "MDInsertType", 417: "MDInsertType", 418: "MDInsertType", 419: "MDInsertType",
  420: "MDInsertType", 421: "MDInsertType", 422: "MDInsertType", 423: "MDInsertType",
  424: "MDInsertType", 425: "MDInsertType", 426: "MDInsertType", 427: "MDInsertType",
  428: "MDInsertType", 429: "MDInsertType", 430: "MDInsertType", 431: "MDInsertType",
  432: "MDInsertType", 433: "MDInsertType", 434: "MDInsertType", 435: "MDInsertType",
  436: "MDInsertType", 437: "MDInsertType", 438: "MDInsertType", 439: "MDInsertType",
  440: "MDInsertType", 441: "MDInsertType", 442: "MDInsertType", 443: "MDInsertType",
  444: "MDInsertType", 445: "MDInsertType", 446: "MDInsertType", 447: "MDInsertType",
  448: "MDInsertType", 449: "MDInsertType", 450: "MDInsertType", 451: "MDInsertType",
  452: "MDInsertType", 453: "MDInsertType", 454: "MDInsertType", 455: "MDInsertType",
  456: "MDInsertType", 457: "MDInsertType", 458: "MDInsertType", 459: "MDInsertType",
  460: "MDInsertType", 461: "MDInsertType", 462: "MDInsertType", 463: "MDInsertType",
  464: "MDInsertType", 465: "MDInsertType", 466: "MDInsertType", 467: "MDInsertType",
  468: "MDInsertType", 469: "MDInsertType", 470: "MDInsertType", 471: "MDInsertType",
  472: "MDInsertType", 473: "NoAllocs", 474: "AllocAccount", 475: "AllocPrice",
  476: "AllocSettlCurrAmt", 477: "AllocSettlCurrency", 478: "SettlCurrFxRate",
  479: "SettlCurrFxRateCalc", 480: "AllocSettlInstType", 481: "AllocSettlInstType",
  482: "AllocSettlInstType", 483: "AllocSettlInstType", 484: "AllocSettlInstType",
  485: "AllocSettlInstType", 486: "AllocSettlInstType", 487: "AllocSettlInstType",
  488: "AllocSettlInstType", 489: "AllocSettlInstType", 490: "AllocSettlInstType",
  491: "AllocSettlInstType", 492: "AllocSettlInstType", 493: "AllocSettlInstType",
  494: "AllocSettlInstType", 495: "AllocSettlInstType", 496: "AllocSettlInstType",
  497: "AllocSettlInstType", 498: "AllocSettlInstType", 499: "AllocSettlInstType",
  500: "AllocSettlInstType", 501: "AllocSettlInstType", 502: "AllocSettlInstType",
  503: "AllocSettlInstType", 504: "AllocSettlInstType", 505: "AllocSettlInstType",
  506: "AllocSettlInstType", 507: "AllocSettlInstType", 508: "AllocSettlInstType",
  509: "AllocSettlInstType", 510: "AllocSettlInstType", 511: "AllocSettlInstType",
  512: "AllocSettlInstType", 513: "AllocSettlInstType", 514: "AllocSettlInstType",
  515: "AllocSettlInstType", 516: "AllocSettlInstType", 517: "AllocSettlInstType",
  518: "AllocSettlInstType", 519: "AllocSettlInstType", 520: "AllocSettlInstType",
  521: "AllocSettlInstType", 522: "AllocSettlInstType", 523: "AllocSettlInstType",
  524: "AllocSettlInstType", 525: "AllocSettlInstType", 526: "AllocSettlInstType",
  527: "AllocSettlInstType", 528: "AllocSettlInstType", 529: "AllocSettlInstType",
  530: "AllocSettlInstType", 531: "AllocSettlInstType", 532: "AllocSettlInstType",
  533: "AllocSettlInstType", 534: "AllocSettlInstType", 535: "AllocSettlInstType",
  536: "AllocSettlInstType", 537: "AllocSettlInstType", 538: "AllocSettlInstType",
  539: "AllocSettlInstType", 540: "AllocSettlInstType", 541: "AllocSettlInstType",
  542: "AllocSettlInstType", 543: "AllocSettlInstType", 544: "AllocSettlInstType",
  545: "AllocSettlInstType", 546: "AllocSettlInstType", 547: "AllocSettlInstType",
  548: "AllocSettlInstType", 549: "AllocSettlInstType", 550: "AllocSettlInstType",
  551: "AllocSettlInstType", 552: "AllocSettlInstType", 553: "Username",
  554: "Password", 555: "NoTradingSessions", 556: "TradingSessionID",
  557: "TradingSessionSubID", 558: "TradSesMethod", 559: "TradSesMode",
  560: "TradSesStatus", 561: "TradSesStartTime", 562: "TradSesEndTime",
  563: "TradSesOpenTime", 564: "TradSesCloseTime", 565: "TradSesPreOpenTime",
};

export const FIX_MSG_TYPES: Record<string, string> = {
  "0": "Heartbeat", "1": "TestRequest", "2": "ResendRequest", "3": "Reject",
  "4": "SequenceReset", "5": "Logout", "6": "IndicationOfInterest",
  "7": "Advertisement", "8": "ExecutionReport", "9": "OrderCancelReject",
  "A": "Logon", "B": "News", "C": "Email", "D": "NewOrderSingle",
  "E": "NewOrderList", "F": "OrderCancelRequest", "G": "OrderCancelReplaceRequest",
  "H": "OrderStatusRequest", "J": "AllocationInstruction", "K": "ListCancelRequest",
  "L": "ListExecute", "M": "ListStatusRequest", "N": "ListStatus",
  "P": "AllocationInstructionAck", "Q": "DontKnowTrade", "R": "QuoteRequest",
  "S": "Quote", "T": "SettlementInstructions", "V": "MarketDataRequest",
  "W": "MarketDataSnapshotFullRefresh", "X": "MarketDataIncrementalRefresh",
  "Y": "MarketDataRequestReject", "Z": "QuoteCancel", "a": "QuoteStatusRequest",
  "b": "QuoteAcknowledgement", "c": "SecurityDefinitionRequest",
  "d": "SecurityDefinition", "e": "SecurityStatusRequest", "f": "SecurityStatus",
  "g": "TradingSessionStatusRequest", "h": "TradingSessionStatus",
  "i": "MassQuote", "j": "BusinessMessageReject", "k": "BidRequest",
  "l": "BidResponse", "m": "ListStrikePrice", "n": "XMLnonFIX",
  "o": "RegistrationInstructions", "p": "RegistrationInstructionsResponse",
  "q": "OrderMassCancelRequest", "r": "OrderMassCancelReport",
  "s": "NewOrderCross", "t": "CrossOrderCancelReplaceRequest",
  "u": "CrossOrderCancelRequest", "v": "SecurityTypeRequest", "w": "SecurityTypes",
  "x": "SecurityListRequest", "y": "SecurityList", "z": "DerivativeSecurityListRequest",
  "AB": "NewOrderMultileg", "AC": "MultilegOrderCancelReplace",
  "AD": "TradeCaptureReportRequest", "AE": "TradeCaptureReport",
  "AF": "TradeCaptureReportAck", "AG": "AllocationReport",
  "AH": "AllocationReportAck", "AI": "Confirmation", "AJ": "PositionMaintenanceRequest",
  "AK": "PositionMaintenanceReport", "AL": "RequestForPositions",
  "AM": "RequestForPositionsAck", "AN": "PositionReport",
  "AO": "TradeCaptureReportRequestAck", "AP": "TradeCaptureReportAck",
  "AQ": "AllocationReportAlert", "AR": "AssignmentReport",
  "AS": "CollateralRequest", "AT": "CollateralAssignment",
  "AU": "CollateralResponse", "AV": "CollateralReport",
  "AW": "CollateralInquiry", "AX": "NetworkCounterpartySystemStatusRequest",
  "AY": "NetworkCounterpartySystemStatusResponse", "AZ": "UserRequest",
  "BA": "UserResponse", "BB": "CollateralInquiryAck",
  "BC": "ConfirmationAck", "BD": "SecurityListUpdateReport",
  "BE": "AdjustedPositionReport", "BF": "AllocationInstructionAlert",
  "BG": "ExecutionAck", "BH": "ContraryIntentionReport",
  "BI": "SecurityDefinitionUpdateReport", "BJ": "SettlementInstructionRequest",
  "BK": "AssignmentReport", "BL": "CollateralInquiryAck",
  "BM": "ConfirmationRequest",
};

export const ORD_STATUS_VALUES: Record<string, string> = {
  "0": "New", "1": "PartiallyFilled", "2": "Filled", "3": "DoneForDay",
  "4": "Canceled", "5": "Replaced", "6": "PendingCancel", "7": "Stopped",
  "8": "Rejected", "9": "Suspended", "A": "PendingNew", "B": "Calculated",
  "C": "Expired", "D": "AcceptedForBidding", "E": "PendingReplace",
};

export const EXEC_TYPE_VALUES: Record<string, string> = {
  "0": "New", "1": "PartialFill", "2": "Fill", "3": "DoneForDay",
  "4": "Canceled", "5": "Replaced", "6": "PendingCancel", "7": "Stopped",
  "8": "Rejected", "9": "Suspended", "A": "PendingNew", "B": "Calculated",
  "C": "Expired", "D": "Trade", "E": "OrderStatus", "F": "TradeCorrection",
  "G": "TradeCancel", "H": "OrderStatus",
};
