/**
 * db/connection.ts ?”â€?å®¹å™¨ä¾§ä?è¯?DB è¿æ¥å±‚ï?bun:sqliteï¼? *
 * ?Œè´£ï¼šinbound ?ªè¯»ï¼ˆmmap_size=0 + è½®è¯¢æ¯æ¬¡?°å?è¿æ¥ï¼? outbound ?™ï?DELETE journalï¼?
 *       å¿ƒè·³?‡ä»¶ touch / ?¯åŠ¨æ¸?stale acks / container_state å·¥å…·?¨é??‡è®°?? * ?³é”®å¯¼å‡ºï¼šgetWorkspace, openInboundPoll, getOutboundDb, touchHeartbeat,
 *           clearStaleProcessingAcks, setContainerToolInFlight, clearContainerToolInFlight,
 *           initTestSessionDb, runNamed, allNamed
 * ?¿é?ä¸å??ï?journal_mode=DELETEï¼›è½®è¯¢è¯»æ¯æ¬¡?°å?+mmap_size=0ï¼›outbound å®¹å™¨?•å??…ï?å¿ƒè·³=?‡ä»¶ utimes?? * bun:sqlite ?½å??‚æ•°?€å¸?$ ?ç??? * ?Ÿé‰´ï¼šnanoclaw container/agent-runner/src/db/connection.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?4ï¼‰ï??å?ä¿®å? PowerShell è½¬ç??Ÿå?
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** ?°æ€§è¯»?–ï?æµ‹è?ç»?initTestSessionDb æ³¨å…¥ OC_WORKSPACEï¼?*/
export function getWorkspace(): string {
  return process.env.OC_WORKSPACE ?? "/workspace";
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

/** è½®è¯¢è¯»ä??¨ï?æ¯æ¬¡?°å? + mmap_size=0ï¼ˆæ‰¿?ä??˜é?ï¼?*/
export function openInboundPoll(): Database {
  const db = new Database(inboundPath(), { readonly: true });
  db.run("PRAGMA mmap_size = 0");
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

/** ?¿å‘½?ªè¯»?¥æ?ï¼šä??¨ä?ä¸»æœºä¸€æ¬¡æ€§å??¥ç?è¡¨ï?destinations/session_routingï¼?*/
export function openInboundLongLived(): Database {
  const db = new Database(inboundPath(), { readonly: true });
  db.run("PRAGMA busy_timeout = 5000");
  return db;
}

let outbound: Database | null = null;
export function getOutboundDb(): Database {
  if (!outbound) {
    outbound = new Database(outboundPath());
    outbound.run("PRAGMA journal_mode = DELETE"); // è·¨æ?è½½å¯è§æ€§æ‰¿?é¡¹
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
      /* ?æ? */
    }
  }
}

/** ?¯åŠ¨?¶æ??†ä?ä¸ªå´©æºƒå®¹?¨ç?ä¸‹ç? processing ack */
export function clearStaleProcessingAcks(): number {
  const db = getOutboundDb();
  const r = db.prepare("DELETE FROM processing_ack WHERE status = 'processing'").run() as unknown as
    | number
    | { changes?: number };
  return typeof r === "number" ? r : (r?.changes ?? 0);
}

/** bun:sqlite ?½å??‚æ•°ï¼?nameï¼‰è?è¡ŒåŠ©??*/
export function runNamed(stmt: unknown, params: Record<string, unknown>): void {
  (stmt as { run: (p: Record<string, unknown>) => unknown }).run(params);
}

export function allNamed<T>(stmt: unknown, params: Record<string, unknown>): T[] {
  return (stmt as { all: (p: Record<string, unknown>) => T[] }).all(params);
}

/** PreToolUse/PostToolUse ?”åŠ¨ï¼šå??å·¥?·åœ¨é£æ?è®°ï?å®¿ä¸» sweep ?¾å®½?¡æ­»?¤å?ï¼?*/
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

/** æµ‹è??¨ï??‡å?ä¸´æ—¶ workspace å¹¶å»º?Œå? schema */
export function initTestSessionDb(workspace: string, inboundSchema: string, outboundSchema: string): void {
  process.env.OC_WORKSPACE = workspace;
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
