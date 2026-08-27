/**
 * destinations.ts —— 目的地映射实时查询 + 系统提示附录
 *
 * 职责：destinations 表每次查找都查库（管理端改动即时生效）；buildSystemPromptAddendum。
 * 关键导出：getAllDestinations, findByName, findByRouting, buildSystemPromptAddendum, DestinationEntry
 * 承重不变量：该表同时是路由表和容器可见 ACL；宿主投递侧权威复核。
 * 借鉴：nanoclaw container/agent-runner/src/destinations.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 */
import { openInboundLongLived } from "./db/connection.ts";

export interface DestinationEntry {
  name: string;
  display_name: string | null;
  type: "channel" | "agent";
  channel_type: string | null;
  platform_id: string | null;
  agent_group_id: string | null;
}

export function getAllDestinations(): DestinationEntry[] {
  const db = openInboundLongLived();
  try {
    return db.prepare("SELECT * FROM destinations ORDER BY name").all() as DestinationEntry[];
  } finally {
    db.close();
  }
}

export function findByName(name: string): DestinationEntry | null {
  const db = openInboundLongLived();
  try {
    return (db.prepare("SELECT * FROM destinations WHERE name = ?").get(name) as DestinationEntry | undefined) ?? null;
  } finally {
    db.close();
  }
}

export function findByRouting(channelType: string, platformId: string): DestinationEntry | null {
  const db = openInboundLongLived();
  try {
    return (
      (db
        .prepare("SELECT * FROM destinations WHERE channel_type = ? AND platform_id = ?")
        .get(channelType, platformId) as DestinationEntry | undefined) ?? null
    );
  } finally {
    db.close();
  }
}

/** 系统提示附录：名字 + 可达目的地清单（send_message 的 name 词汇表）+ 工作纪律（阶段 12 上下文治理） */
export function buildSystemPromptAddendum(assistantName: string | null): string {
  const dests = getAllDestinations();
  const lines = dests.map((d) => `- ${d.name} (${d.type}${d.display_name ? `, ${d.display_name}` : ""})`);
  return [
    assistantName ? `You are "${assistantName}".` : "",
    "You can send messages/files to these destinations with the send_message/send_file tools:",
    ...lines,
    "When replying in the current chat, no destination is needed (default routing).",
    "",
    "Work discipline:",
    "- Do not repeat previous replies or re-narrate your reasoning history in each answer. Answer the current question directly.",
    "- If the same category of tool fails 3 times in a row, STOP trying and report the current state with clear options to the user.",
    "- Keep replies concise; use lists only when the user asks for a full audit/report.",
  ]
    .filter(Boolean)
    .join("\n");
}
