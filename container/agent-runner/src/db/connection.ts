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
    // 阶段 12 实测修复：主机在 spawn 前对损坏库重建（删除文件）——容器打开后自愈建表
    outbound.run(`CREATE TABLE IF NOT EXISTS messages_out (
      id TEXT PRIMARY KEY, seq INTEGER UNIQUE, in_reply_to TEXT, timestamp TEXT NOT NULL,
      deliver_after TEXT, recurrence TEXT, kind TEXT NOT NULL, operation TEXT,
      stream_final INTEGER NOT NULL DEFAULT 0,
      platform_id TEXT, channel_type TEXT, thread_id TEXT, content TEXT NOT NULL
    )`);
    outbound.run(
      "CREATE TABLE IF NOT EXISTS processing_ack (message_id TEXT PRIMARY KEY, status TEXT NOT NULL, status_changed TEXT NOT NULL)",
    );
    outbound.run(
      "CREATE TABLE IF NOT EXISTS session_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
    );
    outbound.run(
      "CREATE TABLE IF NOT EXISTS container_state (id INTEGER PRIMARY KEY CHECK (id = 1), current_tool TEXT, tool_declared_timeout_ms INTEGER, tool_started_at TEXT, current_tool_args TEXT, updated_at TEXT NOT NULL)",
    );
    // 阶段 12：旧库补 current_tool_args 列（命令可视化），PRAGMA 守卫幂等
    const csCols = outbound.prepare("PRAGMA table_info(container_state)").all() as Array<{ name: string }>;
    if (!csCols.some((c) => c.name === "current_tool_args")) {
      outbound.run("ALTER TABLE container_state ADD COLUMN current_tool_args TEXT");
    }
  }
  return outbound;
}

/** 阶段 12 实测修复：强制重开 outbound 连接——VirtioFS 概率性 disk I/O error 的重试前奏 */
export function closeOutboundDb(): void {
  try {
    outbound?.close();
  } catch {
    /* 已坏 */
  }
  outbound = null;
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

/** PreToolUse/PostToolUse 联动：当前工具在飞标记（宿主 sweep 放宽卡死判定）。
 *  阶段 12：argsSummary 携带命令摘要（如 bash 命令），供宿主 TUI 实时展示"执行了哪些命令"。 */
export function setContainerToolInFlight(tool: string, declaredTimeoutMs: number | null, argsSummary?: string): void {
  const db = getOutboundDb();
  runNamed(
    db.prepare(
      `INSERT INTO container_state (id, current_tool, tool_declared_timeout_ms, tool_started_at, current_tool_args, updated_at)
       VALUES (1, $tool, $timeout, $started, $args, $updated)
       ON CONFLICT (id) DO UPDATE SET current_tool=$tool, tool_declared_timeout_ms=$timeout, tool_started_at=$started, current_tool_args=$args, updated_at=$updated`,
    ),
    {
      $tool: tool,
      $timeout: declaredTimeoutMs,
      $args: argsSummary ?? null,
      $started: new Date().toISOString(),
      $updated: new Date().toISOString(),
    },
  );
}

export function clearContainerToolInFlight(): void {
  const db = getOutboundDb();
  runNamed(
    db.prepare(
      `INSERT INTO container_state (id, current_tool, tool_declared_timeout_ms, tool_started_at, current_tool_args, updated_at)
       VALUES (1, NULL, NULL, NULL, NULL, $updated)
       ON CONFLICT (id) DO UPDATE SET current_tool=NULL, tool_declared_timeout_ms=NULL, tool_started_at=NULL, current_tool_args=NULL, updated_at=$updated`,
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
