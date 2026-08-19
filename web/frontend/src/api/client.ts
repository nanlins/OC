/**
 * api/client.ts ?”â€??§åˆ¶??API å®¢æˆ·ç«¯ï?fetch å°è? + token æ³¨å…¥ï¼? *
 * ?Œè´£ï¼šGET ?•å½± / POST ?¨ä? / SSE è®¢é?ï¼›WEB_TOKEN ç»?localStorage æ³¨å…¥ Bearer?? * ?³é”®å¯¼å‡ºï¼šapiClient, subscribeEvents
 *
 * ä¿®æ”¹è®°å?ï¼?026-08-13 ?›å»ºï¼ˆé˜¶æ®?11ï¼‰ï??Œæ—¥?¶æ®µ 14 è¯»å??åŠ¡ç«¯æœ¬?°å??™è¯¯ä½“ï?P1-2 ä¿®å?ï¼? */
import type { ApprovalRow, AuditRow, GroupRow, MessageRow, MessagingGroupRow, SessionRow, WebEvent, WiringRow } from "./types.js";

function headers(): Record<string, string> {
  const token = localStorage.getItem("OC_token") ?? "";
  const h: Record<string, string> = { "content-type": "application/json" };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

/** ?¶æ®µ 14 P1-2 ä¿®å?ï¼šè¯»?–æ??¡ç«¯?¬åœ°?–é?è¯¯ä? { error, code }ï¼Œä??ä¸¢å¼ƒä¸ºå¼€?‘è€…æ???*/
async function errMsg(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body && typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    /* ??JSON ä½?*/
  }
  return fallback;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: headers() });
  if (!res.ok) throw new Error(await errMsg(res, `api ${path} -> ${res.status}`));
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await errMsg(res, `api ${path} -> ${res.status}`));
  return (await res.json()) as T;
}

export const apiClient = {
  groups: () => get<GroupRow[]>("/api/groups"),
  messagingGroups: () => get<MessagingGroupRow[]>("/api/messaging-groups"),
  wirings: () => get<WiringRow[]>("/api/wirings"),
  sessions: () => get<SessionRow[]>("/api/sessions"),
  sessionMessages: (id: string) => get<MessageRow[]>(`/api/sessions/${id}/messages`),
  approvals: () => get<ApprovalRow[]>("/api/approvals"),
  audit: () => get<AuditRow[]>("/api/audit"),
  resolveApproval: (id: string, decision: "approve" | "reject") =>
    post("/api/approvals/resolve", { id, decision }),
  createWiring: (messagingGroupId: string, agentGroupId: string) =>
    post("/api/wirings", { messagingGroupId, agentGroupId }),
};

/** SSE è®¢é?ï¼›è??å?æ¶ˆå‡½??*/
export function subscribeEvents(onEvent: (ev: WebEvent) => void): () => void {
  const es = new EventSource("/events");
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data) as WebEvent);
    } catch {
      /* å¿½ç•¥?¸å½¢å¸?*/
    }
  };
  return () => es.close();
}
