/**
 * api/client.ts —— 控制台 API 客户端（fetch 封装 + token 注入）
 *
 * 职责：GET 投影 / POST 动作 / SSE 订阅；WEB_TOKEN 经 localStorage 注入 Bearer。
 * 关键导出：apiClient, subscribeEvents
 *
 * 修改记录：2026-08-13 创建（阶段 11）；同日阶段 14 读取服务端本地化错误体（P1-2 修复）
 */
import type { ApprovalRow, AuditRow, GroupRow, MessageRow, MessagingGroupRow, SessionRow, WebEvent, WiringRow } from "./types.js";

function headers(): Record<string, string> {
  const token = localStorage.getItem("openclaw_token") ?? "";
  const h: Record<string, string> = { "content-type": "application/json" };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

/** 阶段 14 P1-2 修复：读取服务端本地化错误体 { error, code }，不再丢弃为开发者文本 */
async function errMsg(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body && typeof body.error === "string" && body.error.length > 0) return body.error;
  } catch {
    /* 无 JSON 体 */
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

/** SSE 订阅；返回取消函数 */
export function subscribeEvents(onEvent: (ev: WebEvent) => void): () => void {
  const es = new EventSource("/events");
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data) as WebEvent);
    } catch {
      /* 忽略畸形帧 */
    }
  };
  return () => es.close();
}
