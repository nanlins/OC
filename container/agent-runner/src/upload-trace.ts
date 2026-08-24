/**
 * upload-trace.ts —— Agent 轨迹上传
 *
 * 职责：将 Agent 执行轨迹（tool calls、LLM 响应、错误）序列化为 JSONL 并上传到
 *       宿主侧 outbox（通过 outbound DB 的 messages_out 表）。供 poll-loop 在每次
 *       LLM 查询结束后调用。
 * 关键导出：uploadTrace, TraceEvent
 * 借鉴：nanoclaw container/agent-runner/src/upload-trace.ts
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { writeMessageOut } from "./db/messages-out.js";
import { randomUUID } from "node:crypto";

export interface TraceEvent {
  type: "agent_start" | "agent_end" | "tool_call" | "tool_result" | "error";
  timestamp: string;
  sessionId?: string;
  model?: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
  error?: string;
  tokenUsage?: { input: number; output: number };
  durationMs?: number;
}

export function uploadTrace(events: TraceEvent[]): void {
  if (events.length === 0) return;
  const lines = events.map((e) => JSON.stringify(e)).join("\n");
  writeMessageOut({
    id: randomUUID(),
    kind: "trace",
    timestamp: new Date().toISOString(),
    content: lines,
  });
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

