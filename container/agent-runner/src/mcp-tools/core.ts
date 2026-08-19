/**
 * mcp-tools/core.ts —— 出站四件套：send_message / send_file / edit_message / add_reaction
 *
 * 职责：destination 解析（命名→路由；同频道保线程，跨目的地新会话）；send_file 暂存 outbox/<id>/。
 * 关键导出：registerCoreTools
 * 借鉴：nanoclaw container/agent-runner/src/mcp-tools/core.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-12 ai-inspector 修复：send_file resolve 防穿越（P0）；edit/reaction 走 operation 列
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { findByName } from "../destinations.ts";
import { getWorkspace } from "../db/connection.ts";
import { writeMessageOut } from "../db/messages-out.ts";
import { getCurrentInReplyTo } from "../db/session-state.ts";
import { registerTools, type ToolContext } from "./registry.ts";

function resolveRouting(destination: string | undefined, ctx: ToolContext) {
  if (!destination) {
    return {
      channelType: ctx.routing.channelType,
      platformId: ctx.routing.platformId,
      threadId: ctx.routing.threadId,
      kind: "chat" as string,
    };
  }
  const dest = findByName(destination);
  if (!dest) throw new Error(`unknown destination: ${destination}`);
  if (dest.type === "agent") {
    return { channelType: "agent", platformId: dest.agent_group_id, threadId: null, kind: "a2a" as string };
  }
  const same = dest.channel_type === ctx.routing.channelType && dest.platform_id === ctx.routing.platformId;
  return {
    channelType: dest.channel_type,
    platformId: dest.platform_id,
    threadId: same ? ctx.routing.threadId : null,
    kind: "chat" as string,
  };
}

export function registerCoreTools(): void {
  registerTools([
    {
      name: "send_message",
      description:
        "Send a text message to a destination (channel or agent). Omit destination to reply in the current chat.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string", description: "destination name from the system prompt addendum" },
          text: { type: "string" },
          thread_id: { type: "string" },
        },
        required: ["text"],
      },
      handler: async (args, ctx) => {
        const r = resolveRouting(args.destination as string | undefined, ctx);
        const id = randomUUID();
        writeMessageOut({
          id,
          kind: r.kind,
          content: String(args.text),
          channelType: r.channelType,
          platformId: r.platformId,
          threadId: (args.thread_id as string) ?? r.threadId,
          inReplyTo: getCurrentInReplyTo(),
        });
        return { ok: true, id };
      },
    },
    {
      name: "send_file",
      description: "Send a file from the container workspace to a destination. Staged in outbox for host pickup.",
      parameters: {
        type: "object",
        properties: {
          destination: { type: "string" },
          file_path: { type: "string", description: "absolute path inside /workspace" },
          text: { type: "string" },
        },
        required: ["file_path"],
      },
      handler: async (args, ctx) => {
        const ws = getWorkspace();
        const norm = (p: string) => p.replace(/\\/g, "/"); // Windows 分隔符归一
        const filePath = resolve(String(args.file_path));
        // P0 修复（ai-inspector）：resolve 归一消除 .. 穿越后再做前缀比较
        if (!norm(filePath).startsWith(`${norm(resolve(ws))}/`)) throw new Error("file_path must be inside /workspace");
        const id = randomUUID();
        const outDir = join(ws, "outbox", id);
        mkdirSync(outDir, { recursive: true });
        copyFileSync(filePath, join(outDir, filePath.split(/[\\/]/).pop() ?? "file"));
        const r = resolveRouting(args.destination as string | undefined, ctx);
        writeMessageOut({
          id,
          kind: r.kind,
          content: String(args.text ?? ""),
          channelType: r.channelType,
          platformId: r.platformId,
          threadId: r.threadId,
        });
        return { ok: true, id };
      },
    },
    {
      name: "edit_message",
      description: "Edit a previously sent outbound message by its seq number.",
      parameters: {
        type: "object",
        properties: { seq: { type: "number" }, text: { type: "string" } },
        required: ["seq", "text"],
      },
      handler: async (args) => {
        const id = randomUUID();
        writeMessageOut({ id, kind: "chat", content: String(args.text), operation: "edit" });
        return { ok: true, id, operation: "edit", seq: args.seq };
      },
    },
    {
      name: "add_reaction",
      description: "React to a message by seq number.",
      parameters: {
        type: "object",
        properties: { seq: { type: "number" }, emoji: { type: "string" } },
        required: ["seq", "emoji"],
      },
      handler: async (args) => {
        const id = randomUUID();
        writeMessageOut({ id, kind: "chat", content: String(args.emoji), operation: "reaction" });
        return { ok: true, id, operation: "reaction", seq: args.seq };
      },
    },
  ]);
}
