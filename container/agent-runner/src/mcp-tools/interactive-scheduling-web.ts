/**
 * mcp-tools/interactive-scheduling-web.ts —— 交互问题/定时任务/web 工具
 *
 * 职责：ask_user_question（阻塞轮询 inbound 的 question_response，300s 超时）；send_card；
 *       schedule_task/list_tasks/cancel_task（宿主 scheduling 模块阶段 6 消费）；web_fetch/web_search（桩）。
 * 关键导出：registerInteractiveSchedulingWebTools
 * 借鉴：nanoclaw container/agent-runner/src/mcp-tools/{interactive,scheduling}.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-12 ai-inspector 修复：应答消费后 markCompleted；web_fetch 10s 超时+untrusted 标注
 */
import { randomUUID } from "node:crypto";
import { openInboundPoll } from "../db/connection.ts";
import { markCompleted } from "../db/messages-in.ts";
import { writeMessageOut } from "../db/messages-out.ts";
import { registerTools } from "./registry.ts";

const ASK_TIMEOUT_MS = 300_000;
const POLL_MS = 1000;

/** 轮询 inbound 的 question_response 专用 kind（阶段 6 复检 P1-4 修复：精确等值匹配，禁 JSON LIKE）。
 *  消费后 markCompleted 防双消费。 */
async function waitForAnswer(questionId: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const db = openInboundPoll();
    try {
      const rows = db
        .prepare(`SELECT id, content FROM messages_in WHERE kind = 'question_response' AND status = 'pending'`)
        .all() as Array<{ id: string; content: string }>;
      for (const row of rows) {
        let parsed: { questionId?: string; answer?: string } | null = null;
        try {
          parsed = JSON.parse(row.content) as { questionId?: string; answer?: string };
        } catch {
          continue;
        }
        if (parsed?.questionId === questionId) {
          markCompleted([row.id]);
          return parsed.answer ?? "";
        }
      }
    } finally {
      db.close();
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return null;
}

export function registerInteractiveSchedulingWebTools(): void {
  registerTools([
    {
      name: "ask_user_question",
      description: "Ask the user a question with optional options; blocks until answered or timeout (300s).",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          destination: { type: "string" },
        },
        required: ["question"],
      },
      handler: async (args) => {
        const questionId = randomUUID();
        writeMessageOut({
          id: questionId,
          kind: "system",
          content: JSON.stringify({
            type: "ask_question",
            questionId,
            question: args.question,
            options: args.options ?? [],
          }),
        });
        const answer = await waitForAnswer(questionId, ASK_TIMEOUT_MS);
        if (!answer) return { ok: false, error: "timeout waiting for answer" };
        return { ok: true, answer };
      },
    },
    {
      name: "send_card",
      description: "Send a non-interactive display card (fire-and-forget).",
      parameters: {
        type: "object",
        properties: { title: { type: "string" }, body: { type: "string" } },
        required: ["title"],
      },
      handler: async (args) => {
        writeMessageOut({ id: randomUUID(), kind: "system", content: JSON.stringify({ type: "card", ...args }) });
        return { ok: true };
      },
    },
    {
      name: "schedule_task",
      description: "Schedule a recurring or one-shot task (cron). Host sweep wakes the agent when due.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "prompt delivered to the agent when due" },
          cron: { type: "string", description: "cron expression (group timezone)" },
          process_after: { type: "string", description: "ISO UTC for one-shot" },
        },
        required: ["message"],
      },
      handler: async (args) => {
        const id = randomUUID();
        writeMessageOut({
          id,
          kind: "system",
          content: JSON.stringify({
            type: "schedule_task",
            message: args.message,
            cron: args.cron ?? null,
            process_after: args.process_after ?? null,
          }),
        });
        return { ok: true, id };
      },
    },
    {
      name: "list_tasks",
      description: "List this agent group's scheduled task rows.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        const db = openInboundPoll();
        try {
          return db
            .prepare("SELECT id, content, status, process_after, recurrence FROM messages_in WHERE kind = 'task'")
            .all();
        } finally {
          db.close();
        }
      },
    },
    {
      name: "cancel_task",
      description: "Request cancellation of a scheduled task by id (host applies).",
      parameters: { type: "object", properties: { task_id: { type: "string" } }, required: ["task_id"] },
      handler: async (args) => {
        writeMessageOut({
          id: randomUUID(),
          kind: "system",
          content: JSON.stringify({ type: "cancel_task", task_id: args.task_id }),
        });
        return { ok: true };
      },
    },
    {
      name: "web_fetch",
      description: "Fetch a URL and return its text (max 100KB).",
      parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
      handler: async (args) => {
        // P2-11 修复：10s 超时（AbortSignal）；返回内容宿主侧标注不可信（阶段 5 投递层）
        const res = await fetch(String(args.url), { redirect: "follow", signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const text = await res.text();
        return { ok: true, text: text.slice(0, 100_000), untrusted: true };
      },
    },
    {
      name: "web_search",
      description: "Web search (stub until a search backend is wired in phase 6 RAG).",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      handler: async () => ({ ok: false, error: "web_search backend not wired yet; use web_fetch with a known URL" }),
    },
  ]);
}
