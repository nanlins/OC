/**
 * eval/trace.ts —— Agent 轨迹记录（JSONL 追加 + 查询）
 *
 * 职责：TraceRecorder 按 session 追加 data/traces/<sessionId>.jsonl；readTrace 查询；
 *       recordTrace 全局钩子供 router/delivery/guard 接入（知识文档 04 §4.11 全程留痕）。
 * 关键导出：recordTrace, readTrace, tracePath
 *
 * 修改记录：2026-08-13 创建（阶段 12）
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { DATA_DIR } from "../config.js";
import type { TraceEvent } from "./types.js";

function tracesDir(): string {
  return resolve(DATA_DIR, "traces");
}

export function tracePath(sessionId: string): string {
  return join(tracesDir(), `${sessionId}.jsonl`);
}

/**
 * fix-plan P0：校验 trace id 不能逃逸 DATA_DIR/traces（防 /api/traces/:id 路径穿越）。
 * 以 resolve 后的路径是否仍位于 traces 目录内为准（容纳 Windows/POSIX 分隔符与 .. 归一化）。
 */
export function isSafeTraceId(sessionId: string): boolean {
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.includes("\0")) return false;
  // session id 不得含任何路径分隔符（拒绝子目录与穿越载体）
  if (sessionId.includes("/") || sessionId.includes("\\")) return false;
  // 纵深防御：resolve 后仍须位于 traces 目录内（容纳 .. 归一化）
  const p = resolve(tracesDir(), `${sessionId}.jsonl`);
  return p === tracesDir() || p.startsWith(tracesDir() + sep);
}

export function recordTrace(ev: Omit<TraceEvent, "ts">): void {
  try {
    if (!isSafeTraceId(ev.sessionId)) return; // 内部调用也防御，避免脏 id 落盘
    const dir = tracesDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(tracePath(ev.sessionId), JSON.stringify({ ...ev, ts: new Date().toISOString() }) + "\n");
  } catch {
    /* 轨迹失败不影响主流程 */
  }
}

export function readTrace(sessionId: string): TraceEvent[] {
  if (!isSafeTraceId(sessionId)) return [];
  const p = tracePath(sessionId);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TraceEvent);
}
