/**
 * session-manager.ts —— 会话生命周期：文件夹/双 DB/消息写入/附件落盘/容器状态
 *
 * 职责：resolveSession（三模式）→ 初始化会话文件夹（outbox + 双库 schema）→
 *       writeSessionMessage（open-write-CLOSE）→ outbox 读写（对称 symlink 防御）→ 容器状态标记。
 * 关键导出：sessionDir, inboundDbPath, outboundDbPath, heartbeatPath, initSessionFolder,
 *           resolveSession, writeSessionMessage, writeOutboundDirectFor, writeSessionRoutingFor,
 *           readOutboxFiles, clearOutbox, saveInboundAttachments, markContainerRunning/Stopped/Idle
 *
 * 承重不变量（见 src/db/session-db.ts 头部）：
 *   1. journal_mode=DELETE；2. 每次操作 open-write-CLOSE；3. 每文件单写者；4. 心跳=文件 touch。
 * 借鉴：nanoclaw src/session-manager.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 *   2026-08-12 se-inspector 修复：clearOutbox 三层防御（P0）；writeSessionMessage 重供给先于 open（P1）；
 *              readOutboxFiles readdir 入 try（P1）
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { STORE_DIR } from "./config.js";
import { log } from "./log.js";
import { createSession, findSession, getSession, markContainerStatus, touchSession } from "./db/sessions.js";
import {
  ensureInboundSchema,
  ensureOutboundSchema,
  insertSessionMessage,
  openInboundDb,
  openOutboundDbRw,
  withInboundDb,
  writeOutboundDirect,
  writeSessionRouting,
  type InsertSessionMessageOpts,
} from "./db/session-db.js";
import { isSafeAttachmentName } from "./attachment-safety.js";
import { deriveAttachmentName } from "./attachment-naming.js";
import { ensureContainedInboxDir, isPathInside } from "./inbox-safety.js";
import type { MessageOut, Session, SessionMode } from "./types.js";

// ---- 路径 ----

export function sessionDir(agentGroupId: string, sessionId: string): string {
  return join(STORE_DIR, agentGroupId, sessionId);
}
export function inboundDbPath(agentGroupId: string, sessionId: string): string {
  return join(sessionDir(agentGroupId, sessionId), "inbound.db");
}
export function outboundDbPath(agentGroupId: string, sessionId: string): string {
  return join(sessionDir(agentGroupId, sessionId), "outbound.db");
}
export function heartbeatPath(agentGroupId: string, sessionId: string): string {
  return join(sessionDir(agentGroupId, sessionId), ".heartbeat");
}
export function outboxDir(agentGroupId: string, sessionId: string): string {
  return join(sessionDir(agentGroupId, sessionId), "outbox");
}

// ---- 生命周期 ----

/** 幂等初始化会话文件夹：目录 + outbox + 双库 schema（open-write-CLOSE） */
export function initSessionFolder(session: Session): void {
  const dir = sessionDir(session.agent_group_id, session.id);
  mkdirSync(join(dir, "outbox"), { recursive: true });
  const inDb = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
  try {
    ensureInboundSchema(inDb);
  } finally {
    inDb.close();
  }
  const outDb = openOutboundDbRw(outboundDbPath(session.agent_group_id, session.id));
  try {
    ensureOutboundSchema(outDb);
  } finally {
    outDb.close();
  }
}

/** 三模式解析/创建会话（shared / per-thread / agent-shared） */
export function resolveSession(opts: {
  agentGroupId: string;
  messagingGroupId?: string | null;
  threadId?: string | null;
  sessionMode: SessionMode;
  agentProvider?: string | null;
}): Session {
  const existing = findSession(opts);
  if (existing) {
    // 阶段 12：命中旧会话也幂等 ensure（CREATE IF NOT EXISTS + ALTER 迁移补 stream_final 列），
    // 否则旧会话库缺列，容器侧 INSERT 带 stream_final 会崩（实测 fatal: no column named stream_final）
    initSessionFolder(existing);
    return existing;
  }
  const created = createSession({
    agentGroupId: opts.agentGroupId,
    messagingGroupId: opts.sessionMode === "agent-shared" ? null : (opts.messagingGroupId ?? null),
    threadId: opts.sessionMode === "shared" ? null : (opts.threadId ?? null),
    agentProvider: opts.agentProvider ?? null,
  });
  initSessionFolder(created);
  log.info(`session created: ${created.id} (${opts.sessionMode})`);
  return created;
}

// ---- 消息写入（open-write-CLOSE） ----

export function writeSessionMessage(
  session: Session,
  opts: Omit<InsertSessionMessageOpts, "id"> & { id?: string },
): string {
  const id = opts.id ?? cryptoRandomId();
  // P1 修复：重供给检查必须在 open 之前（基线 session-manager.ts:249-251）；
  // 文档化重置手段（rm -rf 会话目录）后自动重新供给，不杀死聊天。
  if (!existsSync(inboundDbPath(session.agent_group_id, session.id))) {
    initSessionFolder(session);
  }
  // ⚠ withInboundDb = open-write-CLOSE，不要重构成复用长连接（承重不变量 2）
  withInboundDb(inboundDbPath(session.agent_group_id, session.id), (db) => {
    insertSessionMessage(db, { ...opts, id });
  });
  touchSession(session.id);
  return id;
}

/** 主机直写 outbound 的受控例外（命令门拒绝回复等系统消息） */
export function writeOutboundDirectFor(
  session: Session,
  opts: {
    id?: string;
    kind: MessageOut["kind"];
    content: string;
    platformId?: string | null;
    channelType?: string | null;
    threadId?: string | null;
  },
): string {
  const id = opts.id ?? cryptoRandomId();
  const db = openOutboundDbRw(outboundDbPath(session.agent_group_id, session.id));
  try {
    ensureOutboundSchema(db);
    writeOutboundDirect(db, { ...opts, id });
  } finally {
    db.close();
  }
  return id;
}

export function writeSessionRoutingFor(
  session: Session,
  routing: {
    channelType: string | null;
    platformId: string | null;
    threadId: string | null;
  },
): void {
  const db = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
  try {
    writeSessionRouting(db, routing);
  } finally {
    db.close();
  }
}

// ---- 心跳（文件 touch，不是 DB 写） ----

export function touchHeartbeat(session: Session): void {
  const p = heartbeatPath(session.agent_group_id, session.id);
  try {
    const now = new Date();
    utimesSync(p, now, now);
  } catch {
    try {
      writeFileSync(p, "");
    } catch (err) {
      log.warn("heartbeat touch failed", { err });
    }
  }
}

// ---- outbox（出站文件，对称 symlink 防御） ----

export interface OutboxFile {
  name: string;
  buffer: Buffer;
}

export function readOutboxFiles(session: Session, messageId: string): OutboxFile[] {
  const root = outboxDir(session.agent_group_id, session.id);
  const dir = ensureContainedInboxDir(root, messageId, "outbox-read");
  if (!dir) return [];
  const files: OutboxFile[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir); // P1 修复：readdirSync 入 try（ENOTDIR 不冲投递环）
  } catch (err) {
    log.warn("outbox readdir failed", { err });
    return [];
  }
  for (const name of entries) {
    const p = join(dir, name);
    try {
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      const real = realpathSync(p);
      if (!isPathInside(realpathSync(root), real)) continue;
      files.push({ name, buffer: readFileSync(real) });
    } catch {
      continue;
    }
  }
  return files;
}

/** 清理 outbox；失败必须吞掉（消息已送达，抛出会触发重试→二次投递）。
 *  P0 修复（se-inspector）：messageId 来自容器（不可信），rmSync 前必须三层防御：
 *  basename 校验 → lstat 拒符号链接/非目录 → realpath 容纳校验。对齐基线 session-manager.ts:515-539。 */
export function clearOutbox(session: Session, messageId: string): void {
  try {
    if (!isSafeAttachmentName(messageId)) return;
    const root = outboxDir(session.agent_group_id, session.id);
    if (existsSync(root)) {
      const rootStat = lstatSync(root);
      if (rootStat.isSymbolicLink()) return;
    }
    const target = join(root, messageId);
    if (!existsSync(target)) return;
    const st = lstatSync(target);
    if (st.isSymbolicLink() || !st.isDirectory()) return;
    const real = realpathSync(target);
    if (!isPathInside(realpathSync(root), real)) return;
    rmSync(real, { recursive: true, force: true });
  } catch (err) {
    log.warn("clearOutbox failed (swallowed)", { err });
  }
}

// ---- 入站附件（四层防御） ----

export interface InboundAttachment {
  name?: string | null;
  mime?: string | null;
  kind?: string | null;
  base64: string;
}

/** 附件落盘到会话 inbox/<messageId>/；返回相对文件名列表 */
export function saveInboundAttachments(
  session: Session,
  messageId: string,
  attachments: InboundAttachment[],
): string[] {
  if (attachments.length === 0) return [];
  const inboxRoot = join(sessionDir(session.agent_group_id, session.id), "inbox");
  // messageId 可能含平台字符（如 ":"，Windows 文件名非法）→ 目录名净化
  const safeDir = messageId.replace(/[^A-Za-z0-9_-]+/g, "_") || "att";
  const dir = ensureContainedInboxDir(inboxRoot, safeDir, "inbound-attachments");
  if (!dir) return [];
  const saved: string[] = [];
  const used = new Set<string>();
  for (const att of attachments) {
    let name = deriveAttachmentName({ name: att.name, mime: att.mime, kind: att.kind });
    if (!isSafeAttachmentName(name)) continue;
    while (used.has(name)) name = `_${name}`;
    used.add(name);
    try {
      // wx 独占创建：拒覆盖、拒跟随符号链接
      writeFileSync(join(dir, name), Buffer.from(att.base64, "base64"), { flag: "wx" });
      saved.push(name);
    } catch (err) {
      log.warn("attachment write failed", { err, name });
    }
  }
  return saved;
}

// ---- 容器状态 ----

export function markContainerRunning(session: Session): void {
  markContainerStatus(session.id, "running");
}
export function markContainerStopped(session: Session): void {
  markContainerStatus(session.id, "stopped");
}
export function markContainerIdle(session: Session): void {
  // v2 语义：idle 等同 stopped（sweep 负责卡死检测，主机不做空闲超时）
  markContainerStatus(session.id, "stopped");
}

export function getSessionById(id: string): Session | undefined {
  return getSession(id);
}

function cryptoRandomId(): string {
  return crypto.randomUUID();
}
