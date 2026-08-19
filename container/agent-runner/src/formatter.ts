/**
 * formatter.ts —— 消息→prompt 格式化（XML 提示协议）
 *
 * 职责：formatMessages（<context/> 头 + <message>/<task>/<system_response> 块）、
 *       categorizeMessage、isClearCommand、isRunnerCommand、extractRouting、stripInternalTags。
 * 关键导出：formatMessages, categorizeMessage, isClearCommand, isRunnerCommand, extractRouting, stripInternalTags
 * 承重不变量：不用外层 <messages> 包裹标签（曾触发 synthetic stub bug #2555）。
 * 借鉴：nanoclaw container/agent-runner/src/formatter.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 */
import type { MessageInRow } from "./db/messages-in.ts";

export type CommandCategory = "admin" | "filtered" | "passthrough" | "none";

export interface RoutingContext {
  platformId: string | null;
  channelType: string | null;
  threadId: string | null;
}

export function isClearCommand(content: string): boolean {
  return content.trim() === "/clear";
}

export function isRunnerCommand(content: string): boolean {
  const t = content.trim();
  return t === "/clear" || t.startsWith("/upload-trace");
}

export function categorizeMessage(kind: string): "chat" | "task" | "system" {
  if (kind === "task") return "task";
  if (kind === "system" || kind === "a2a") return "system";
  return "chat";
}

export function extractRouting(msgs: MessageInRow[]): RoutingContext {
  const last = msgs[msgs.length - 1];
  return {
    platformId: last?.platform_id ?? null,
    channelType: last?.channel_type ?? null,
    threadId: last?.thread_id ?? null,
  };
}

/** 去除内部标签（<internal> 剥离；<attachments> 保留给 agent） */
export function stripInternalTags(content: string): string {
  return content.replace(/<internal>[\s\S]*?<\/internal>/g, "").trim();
}

/** XML 提示协议：每消息一块，含时序与来源元数据；无外层包裹 */
export function formatMessages(
  msgs: MessageInRow[],
  opts: { timezone: string; assistantName?: string | null },
): string {
  const header = `<context timezone="${escapeAttr(opts.timezone)}"${opts.assistantName ? ` assistant="${escapeAttr(opts.assistantName)}"` : ""} />`;
  const blocks = msgs.map((m) => {
    const cat = categorizeMessage(m.kind);
    const tag = cat === "task" ? "task" : cat === "system" ? "system_response" : "message";
    const attrs = [
      `from="${escapeAttr(m.platform_id ?? "unknown")}"`,
      `at="${m.timestamp}"`,
      m.thread_id ? `thread="${escapeAttr(m.thread_id)}"` : "",
      m.source_session_id ? `source_session="${escapeAttr(m.source_session_id)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `<${tag} ${attrs}>${escapeXml(stripInternalTags(m.content))}</${tag}>`;
  });
  return [header, ...blocks].join("\n");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
