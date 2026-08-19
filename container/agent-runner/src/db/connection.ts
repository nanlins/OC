/**
 * db/connection.ts —— 容器侧会话 DB 连接层（bun:sqlite）
 *
 * 职责：inbound 只读（mmap_size=0 + 轮询每次新开连接）/ outbound 写（DELETE journal）/
 *       心跳文件 touch / 启动清 stale acks / container_state 工具在飞标记。
 * 关键导出：getWorkspace, openInboundPoll, getOutboundDb, touchHeartbeat,
 *           clearStaleProcessingAcks, setContainerToolInFlight, clearContainerToolInFlight,
 *           initTestSessionDb, runNamed, allNamed
 * 承重不变量：journal_mode=DELETE；轮询读每次新开+mmap_size=0；outbound 容器单写者；心跳=文件 utimes。
 * bun:sqlite 命名参数需带 $ 前缀。
 * 借鉴：nanoclaw container/agent-runner/src/db/connection.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复 PowerShell 转码损坏
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 惰性读取（测试经 initTestSessionDb 注入 OPENCLAW_WORKSPACE） */
export function getWorkspace(): string {
  return process.env.OPENCLAW_WORKSPACE ?? "/workspace";
}

export function inboundPath(): string {
  return join(getWorkspace(), "inbound.db");
}
export function outboundPath(): string {
  return join(getWorkspace(), "outbound.db");
}
export function heartbeatFilePath(): string {
  return join(getWorkspace(), ".heartbeat");
}

/** 轮询读专用：每次新开 + mmap_size=0（承重不变量） */
export function openInboundPoll(): Database {
  const db = new Database(inboundPath(), { readonly: true });
  db.run("PRAGMA mmap_size = 0");
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

/** 长命只读句柄：仅用于主机一次性写入的表（destinations/session_routing） */
export function openInboundLongLived(): Database {
  const db = new Database(inboundPath(), { readonly: true });
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

let outbound: Database | null = null;
export function getOutboundDb(): Database {
  if (!outbound) {
    outbound = new Database(outboundPath());
    outbound.run("PRAGMA journal_mode = DELETE"); // 跨挂载可见性承重项
    outbound.run("PRAGMA busy_timeout = 5000");
    outbound.run("PRAGMA foreign_keys = ON");
  }
  return outbound;
}

export function touchHeartbeat(): void {
  const p = heartbeatFilePath();
  try {
    const now = new Date();
    utimesSync(p, now, now);
  } catch {
    try {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, "");
    } catch {
      /* 吞掉 */
    }
  }
}

/** 启动时清理上个崩溃容器留下的 processing ack */
export function clearStaleProcessingAcks(): number {
  const db = getOutboundDb();
  const r = db.prepare("DELETE FROM processing_ack WHERE status = 'processing'").run() as unknown as
    | number
    | { changes?: number };
  return typeof r === "number" ? r : (r?.changes ?? 0);
}

/** bun:sqlite 命名参数（$name）运行助手 */
export function runNamed(stmt: unknown, params: Record<string, unknown>): void {
  (stmt as { run: (p: Record<string, unknown>) => unknown }).run(params);
}

export function allNamed<T>(stmt: unknown, params: Record<string, unknown>): T[] {
  return (stmt as { all: (p: Record<string, unknown>) => T[] }).all(params);
}

/** PreToolUse/PostToolUse 联动：当前工具在飞标记（宿主 sweep 放宽卡死判定） */
export function setContainerToolInFlight(tool: string, declaredTimeoutMs: number | null): void {
  const db = getOutboundDb();
  runNamed(
    db.prepare(
      `INSERT INTO container_state (id, current_tool, tool_declared_timeout_ms, tool_started_at, updated_at)
       VALUES (1, $tool, $timeout, $started, $updated)
       ON CONFLICT (id) DO UPDATE SET current_tool=$tool, tool_declared_timeout_ms=$timeout, tool_started_at=$started, updated_at=$updated`,
    ),
    { $tool: tool, $timeout: declaredTimeoutMs, $started: new Date().toISOString(), $updated: new Date().toISOString() },
  );
}

export function clearContainerToolInFlight(): void {
  const db = getOutboundDb();
  runNamed(
    db.prepare(
      `INSERT INTO container_state (id, current_tool, tool_declared_timeout_ms, tool_started_at, updated_at)
       VALUES (1, NULL, NULL, NULL, $updated)
       ON CONFLICT (id) DO UPDATE SET current_tool=NULL, tool_declared_timeout_ms=NULL, tool_started_at=NULL, updated_at=$updated`,
    ),
    { $updated: new Date().toISOString() },
  );
}

/** 测试用：指向临时 workspace 并建双库 schema */
export function initTestSessionDb(workspace: string, inboundSchema: string, outboundSchema: string): void {
  process.env.OPENCLAW_WORKSPACE = workspace;
  mkdirSync(workspace, { recursive: true });
  const inDb = new Database(inboundPath());
  inDb.exec(inboundSchema);
  inDb.close();
  const outDb = new Database(outboundPath());
  outDb.exec(outboundSchema);
  outDb.close();
  outbound = null;
}

export function closeSessionDbsForTest(): void {
  outbound?.close();
  outbound = null;
}

export function workspaceExists(): boolean {
  return existsSync(inboundPath()) && existsSync(outboundPath());
}
