/**
 * session-db.ts —— 会话级双 DB（inbound.db / outbound.db）全部 SQL 操作
 *
 * 职责：双库 schema 建立、主机侧消息写入（偶数 seq）、到期计数、ack 同步、投递簿记。
 * 关键导出：ensureInboundSchema, ensureOutboundSchema, openInboundDb, openOutboundDb,
 *           nextEvenSeq, insertSessionMessage, countDueMessages, syncProcessingAcks,
 *           getDeliveredIds, markDelivered, markDeliveryFailed, getUndeliveredOutbound, writeOutboundDirect
 *
 * 承重不变量（逐字遵守，借鉴 nanoclaw src/db/session-db.ts + container/agent-runner/src/db/connection.ts）：
 *   1. journal_mode=DELETE —— WAL 的 mmap -shm 不跨挂载传播，容器会静默丢失新消息；
 *   2. 主机每次操作 open-write-CLOSE —— close 使容器页缓存失效，长连接会冻结视图；
 *   3. 每文件恰好一个写者 —— inbound 主机写，outbound 容器写。主机对 outbound 的写是成文例外，
 *      登记两处：① writeOutboundDirect（系统消息）；② host-sweep 维护写（孤儿 ack 删除/ack 清理）。
 *      两处均用 openOutboundDbRw，且不与容器写同字段竞争（ack 表主机只删、容器只插）。
 *   4. 心跳是文件 touch，不是 DB 写（见 session-manager，阶段 2）。
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 *   2026-08-12 修正 writeOutboundDirect seq 偶数对齐（MAX 为奇数时 +1）
 *   2026-08-12 阶段 3：sweep 操作（claims/reset/prune/toolState）；复检 P0 修复：认领源改 processing_ack；
 *              单写者例外文档登记两处；countLiveTasks；getContainerToolState Bash 门控+容错
 *   2026-08-12 se-inspector P1/P2 修复：syncProcessingAcks 白名单+终态守卫；series_id 默认=消息 id + series 索引；
 *              markDelivered/markDeliveryFailed 先写为准；writeOutboundDirect seq+INSERT 同事务；
 *              新增 withInboundDb（open-write-CLOSE 助手）与 getDueOutboundMessages
 */
import Database from "better-sqlite3";
import type { DeliveredRow, MessageIn, MessageOut } from "../types.js";

export const INBOUND_SCHEMA = `
  CREATE TABLE IF NOT EXISTS messages_in (
    id                TEXT PRIMARY KEY,
    seq               INTEGER UNIQUE,
    kind              TEXT NOT NULL,
    timestamp         TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'pending',
    process_after     TEXT,
    recurrence        TEXT,
    series_id         TEXT,
    tries             INTEGER NOT NULL DEFAULT 0,
    trigger           INTEGER NOT NULL DEFAULT 1,
    on_wake           INTEGER NOT NULL DEFAULT 0,
    platform_id       TEXT,
    channel_type      TEXT,
    thread_id         TEXT,
    content           TEXT NOT NULL,
    source_session_id TEXT
  );
  CREATE TABLE IF NOT EXISTS delivered (
    message_out_id      TEXT PRIMARY KEY,
    platform_message_id TEXT,
    status              TEXT NOT NULL DEFAULT 'delivered',
    delivered_at        TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS destinations (
    name           TEXT PRIMARY KEY,
    display_name   TEXT,
    type           TEXT NOT NULL,
    channel_type   TEXT,
    platform_id    TEXT,
    agent_group_id TEXT
  );
  CREATE TABLE IF NOT EXISTS session_routing (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    channel_type TEXT,
    platform_id  TEXT,
    thread_id    TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_messages_in_series ON messages_in (series_id);
`;

export const OUTBOUND_SCHEMA = `
  CREATE TABLE IF NOT EXISTS messages_out (
    id            TEXT PRIMARY KEY,
    seq           INTEGER UNIQUE,
    in_reply_to   TEXT,
    timestamp     TEXT NOT NULL,
    deliver_after TEXT,
    recurrence    TEXT,
    kind          TEXT NOT NULL,
    operation     TEXT,
    stream_final  INTEGER NOT NULL DEFAULT 0,
    platform_id   TEXT,
    channel_type  TEXT,
    thread_id     TEXT,
    content       TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS processing_ack (
    message_id     TEXT PRIMARY KEY,
    status         TEXT NOT NULL,
    status_changed TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session_state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS container_state (
    id                       INTEGER PRIMARY KEY CHECK (id = 1),
    current_tool             TEXT,
    tool_declared_timeout_ms INTEGER,
    tool_started_at          TEXT,
    current_tool_args        TEXT,
    updated_at               TEXT NOT NULL
  );
`;

/** 打开会话库：DELETE journal 是跨挂载可见性的承重项。
 *  只读连接不可执行 journal_mode（写 pragma），否则抛 readonly——journal 模式只由写者设置（阶段 12 实测修复）。
 *  阶段 12 实测修复：VirtioFS 概率性 disk I/O error——打开+pragma 失败时同步退避重试 3 次。 */
function openSessionDb(path: string, readonly: boolean): Database.Database {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const db = new Database(path, { readonly });
      if (!readonly) db.pragma("journal_mode = DELETE");
      db.pragma("busy_timeout = 5000");
      return db;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) {
        const waitMs = 200 * attempt;
        const t0 = Date.now();
        while (Date.now() - t0 < waitMs) {
          /* 同步忙等退避（打开路径为同步 API） */
        }
      }
    }
  }
  throw lastErr;
}

/** 主机写 inbound：读写打开（主机是唯一写者） */
export function openInboundDb(path: string): Database.Database {
  return openSessionDb(path, false);
}

/** 主机读 outbound：只读打开（容器是唯一写者） */
export function openOutboundDb(path: string): Database.Database {
  return openSessionDb(path, true);
}

/** 主机写 outbound 的受控例外入口（例外① writeOutboundDirect；例外② host-sweep 维护写） */
export function openOutboundDbRw(path: string): Database.Database {
  return openSessionDb(path, false);
}

export function ensureInboundSchema(db: Database.Database): void {
  db.exec(INBOUND_SCHEMA);
}

export function ensureOutboundSchema(db: Database.Database): void {
  db.exec(OUTBOUND_SCHEMA);
  // 阶段 12：旧会话库迁移——补 stream_final 列（流式结束信号，容器/主机增量合并用）
  const cols = db.prepare("PRAGMA table_info(messages_out)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "stream_final")) {
    db.exec("ALTER TABLE messages_out ADD COLUMN stream_final INTEGER NOT NULL DEFAULT 0");
  }
  // 阶段 12：旧会话库迁移——补 container_state.current_tool_args 列（命令可视化）
  const csCols = db.prepare("PRAGMA table_info(container_state)").all() as Array<{ name: string }>;
  if (csCols.length > 0 && !csCols.some((c) => c.name === "current_tool_args")) {
    db.exec("ALTER TABLE container_state ADD COLUMN current_tool_args TEXT");
  }
}

/** 主机 seq 发号：偶数步长（容器用奇数，双方可交错不冲突） */
export function nextEvenSeq(db: Database.Database): number {
  const row = db.prepare("SELECT MAX(seq) AS m FROM messages_in").get() as { m: number | null };
  const max = row.m ?? 0;
  return max % 2 === 0 ? max + 2 : max + 1;
}

export interface InsertSessionMessageOpts {
  id: string;
  kind: MessageIn["kind"];
  content: string;
  /** 事件原始时间（ISO-UTC）；缺省用写入时刻（P2 修复：透传事件时间） */
  timestamp?: string;
  trigger?: number;
  onWake?: number;
  processAfter?: string | null;
  recurrence?: string | null;
  seriesId?: string | null;
  platformId?: string | null;
  channelType?: string | null;
  threadId?: string | null;
  sourceSessionId?: string | null;
}

/**
 * 主机写入 inbound.db 的 messages_in。
 * ⚠ 调用方必须 open-write-CLOSE（不要重构成复用长连接，见文件头不变量 2）。
 */
export function insertSessionMessage(db: Database.Database, opts: InsertSessionMessageOpts): void {
  const seq = nextEvenSeq(db);
  db.prepare(
    `INSERT INTO messages_in
      (id, seq, kind, timestamp, status, process_after, recurrence, series_id, tries, trigger, on_wake,
       platform_id, channel_type, thread_id, content, source_session_id)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    seq,
    opts.kind,
    opts.timestamp ?? new Date().toISOString(),
    opts.processAfter ?? null,
    opts.recurrence ?? null,
    // P2-2 修复：对齐基线，series_id 默认 = 消息自身 id（阶段 6 recurrence 依赖 series 聚合）
    opts.seriesId ?? opts.id,
    opts.trigger ?? 1,
    opts.onWake ?? 0,
    opts.platformId ?? null,
    opts.channelType ?? null,
    opts.threadId ?? null,
    opts.content,
    opts.sourceSessionId ?? null,
  );
}

/** 到期且待处理的消息数（process_after <= now；trigger=0 的纯上下文不计入冷唤醒门控） */
export function countDueMessages(db: Database.Database, nowIso: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages_in
       WHERE status = 'pending' AND trigger = 1 AND (process_after IS NULL OR process_after <= ?)`,
    )
    .get(nowIso) as { c: number };
  return row.c;
}

/**
 * 把 outbound.db 的 processing_ack 同步回 inbound.db 的 messages_in 状态。
 * 跨库簿记：主机写 inbound（自己拥有），永不写 outbound（保住单写者）。
 * 白名单 + 终态守卫（P1-2 修复，对齐 nanoclaw src/db/session-db.ts）：
 *   只同步 completed/failed/script-skip:error；已处终态（completed/failed）的行不被回退。
 */
export function syncProcessingAcks(inbound: Database.Database, outbound: Database.Database): number {
  const acks = outbound
    .prepare("SELECT * FROM processing_ack WHERE status IN ('completed', 'failed', 'script-skip:error')")
    .all() as Array<{ message_id: string; status: string; status_changed: string }>;
  let n = 0;
  for (const ack of acks) {
    const status = ack.status === "script-skip:error" ? "failed" : ack.status;
    const r = inbound
      .prepare("UPDATE messages_in SET status = ? WHERE id = ? AND status NOT IN ('completed', 'failed')")
      .run(status, ack.message_id);
    n += r.changes;
  }
  return n;
}

export function getDeliveredIds(inbound: Database.Database): Set<string> {
  const rows = inbound.prepare("SELECT message_out_id FROM delivered").all() as Array<{ message_out_id: string }>;
  return new Set(rows.map((r) => r.message_out_id));
}

/** 先写为准（P2-3 修复：对齐基线 INSERT OR IGNORE，投递状态不可被后写覆盖） */
export function markDelivered(inbound: Database.Database, messageOutId: string, platformMessageId?: string): void {
  inbound
    .prepare(
      "INSERT OR IGNORE INTO delivered (message_out_id, platform_message_id, status, delivered_at) VALUES (?, ?, 'delivered', ?)",
    )
    .run(messageOutId, platformMessageId ?? null, new Date().toISOString());
}

export function markDeliveryFailed(inbound: Database.Database, messageOutId: string): void {
  inbound
    .prepare(
      "INSERT OR IGNORE INTO delivered (message_out_id, platform_message_id, status, delivered_at) VALUES (?, NULL, 'failed', ?)",
    )
    .run(messageOutId, new Date().toISOString());
}

export function getDeliveredRows(inbound: Database.Database): DeliveredRow[] {
  return inbound.prepare("SELECT * FROM delivered").all() as DeliveredRow[];
}

/** fix-plan 流式：按 message_out_id 查已投递消息的平台消息 id（供 operation=edit 解析编辑目标） */
export function getDeliveredPlatformMessageId(inbound: Database.Database, messageOutId: string): string | null {
  const row = inbound
    .prepare("SELECT platform_message_id FROM delivered WHERE message_out_id = ? AND status = 'delivered'")
    .get(messageOutId) as { platform_message_id: string | null } | undefined;
  return row?.platform_message_id ?? null;
}

/** 主机读 outbound 的未投递消息（调用方用 delivered 集合过滤） */
export function getUndeliveredOutbound(outbound: Database.Database): MessageOut[] {
  return outbound.prepare("SELECT * FROM messages_out ORDER BY seq").all() as MessageOut[];
}

/**
 * 主机直写 outbound 的唯一成文例外（系统消息，如命令门拒绝回复）。
 * 偶数 seq 步长（COALESCE(MAX(seq),0)+2）与容器奇数 seq 隔离；DELETE journal + busy_timeout 下并发安全。
 * 借鉴：nanoclaw src/session-manager.ts writeOutboundDirect。
 */
export function writeOutboundDirect(
  db: Database.Database,
  opts: {
    id: string;
    kind: MessageOut["kind"];
    content: string;
    platformId?: string | null;
    channelType?: string | null;
    threadId?: string | null;
  },
): void {
  // P2-1 修复：seq 读取与 INSERT 同事务，消除与容器并发写的竞态窗口
  const tx = db.transaction(() => {
    const row = db.prepare("SELECT MAX(seq) AS m FROM messages_out").get() as { m: number | null };
    const max = row.m ?? 0;
    const seq = max % 2 === 0 ? max + 2 : max + 1; // 偶数对齐：容器奇数 seq 存在时跳到下一个偶数
    db.prepare(
      `INSERT INTO messages_out (id, seq, in_reply_to, timestamp, deliver_after, recurrence, kind, platform_id, channel_type, thread_id, content)
       VALUES (?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?)`,
    ).run(
      opts.id,
      seq,
      new Date().toISOString(),
      opts.kind,
      opts.platformId ?? null,
      opts.channelType ?? null,
      opts.threadId ?? null,
      opts.content,
    );
  });
  tx();
}

/** 覆写 session_routing 单行表（容器用此保持当前通道/线程） */
export function writeSessionRouting(
  db: Database.Database,
  routing: {
    channelType: string | null;
    platformId: string | null;
    threadId: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO session_routing (id, channel_type, platform_id, thread_id) VALUES (1, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET channel_type=excluded.channel_type, platform_id=excluded.platform_id, thread_id=excluded.thread_id`,
  ).run(routing.channelType, routing.platformId, routing.threadId);
}

/**
 * open-write-CLOSE 助手（P2-8 修复，借鉴 nanoclaw session-manager.ts withInboundDb）：
 * 每次操作新开连接、finally 必 close，使容器页缓存失效（承重不变量 2 的落地工具）。
 */
export function withInboundDb<T>(path: string, fn: (db: Database.Database) => T): T {
  const db = openInboundDb(path);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** 到期出站消息（deliver_after 为空或 <= now；阶段 5 投递环使用，P2-4 修复） */
export function getDueOutboundMessages(outbound: Database.Database, nowIso: string): MessageOut[] {
  return outbound
    .prepare("SELECT * FROM messages_out WHERE deliver_after IS NULL OR deliver_after <= ? ORDER BY seq")
    .all(nowIso) as MessageOut[];
}

// ---- host-sweep 所需（阶段 3） ----

export interface ProcessingClaim {
  id: string;
  tries: number;
  claimedAt: string | null;
}

/**
 * 认领判定源 = outbound 的 processing_ack WHERE status='processing'（P0 修复，se-inspector）：
 * 容器从不写 inbound，messages_in.status 在生产中不会被置 'processing'；
 * 按 id 回查 inbound 取 tries（消息不存在/已终态则不视为认领）。
 * 借鉴：nanoclaw src/db/session-db.ts:199-203。
 */
export function getProcessingClaims(inbound: Database.Database, outbound: Database.Database): ProcessingClaim[] {
  const acks = outbound
    .prepare("SELECT message_id, status_changed FROM processing_ack WHERE status = 'processing'")
    .all() as Array<{ message_id: string; status_changed: string }>;
  const claims: ProcessingClaim[] = [];
  for (const ack of acks) {
    const msg = inbound.prepare("SELECT tries, status FROM messages_in WHERE id = ?").get(ack.message_id) as
      { tries: number; status: string } | undefined;
    if (!msg || msg.status === "completed" || msg.status === "failed" || msg.status === "cancelled") continue;
    claims.push({ id: ack.message_id, tries: msg.tries, claimedAt: ack.status_changed });
  }
  return claims;
}

/**
 * 崩溃/卡死清理（认领源 = processing_ack，P0 修复）：
 * tries>=5 → failed；否则指数退避 5s×2^tries 重排为 pending；处理完删除该 ack 行
 * （不删则下一 tick 用旧 status_changed 判定新容器卡死并 SIGKILL）。
 * 返回处理的行数。
 */
export function resetStuckProcessingRows(
  inbound: Database.Database,
  outbound: Database.Database,
  nowIso: string,
): number {
  const claims = getProcessingClaims(inbound, outbound);
  let n = 0;
  for (const c of claims) {
    if (c.tries >= 5) {
      inbound.prepare("UPDATE messages_in SET status = 'failed' WHERE id = ?").run(c.id);
    } else {
      const delaySec = 5 * 2 ** c.tries;
      const after = new Date(new Date(nowIso).getTime() + delaySec * 1000).toISOString();
      inbound
        .prepare("UPDATE messages_in SET status = 'pending', tries = tries + 1, process_after = ? WHERE id = ?")
        .run(after, c.id);
    }
    outbound.prepare("DELETE FROM processing_ack WHERE message_id = ? AND status = 'processing'").run(c.id);
    n += 1;
  }
  return n;
}

/** 删除 outbound 中已同步完成的 processing_ack（防无界增长，补充优化 C.4） */
export function pruneSyncedProcessingAcks(inbound: Database.Database, outbound: Database.Database): number {
  const terminal = inbound
    .prepare("SELECT id FROM messages_in WHERE status IN ('completed', 'failed', 'skipped', 'cancelled')")
    .all() as Array<{ id: string }>;
  let n = 0;
  for (const t of terminal) {
    n += outbound.prepare("DELETE FROM processing_ack WHERE message_id = ?").run(t.id).changes;
  }
  return n;
}

/** 存活任务计数（任务会话 GC 实查，P1 修复；阶段 6 复检：paused 计入，防自动暂停系列被 GC 永久销毁） */
export function countLiveTasks(inbound: Database.Database): number {
  const row = inbound
    .prepare(
      "SELECT COUNT(*) AS c FROM messages_in WHERE kind = 'task' AND status IN ('pending', 'processing', 'paused')",
    )
    .get() as { c: number };
  return row.c;
}

/** 容器当前工具状态（sweep 放宽卡死判定用；仅 current_tool='Bash' 时声明超时生效，P2 修复）。
 *  阶段 12：current_tool_args 携带命令摘要（旧库无此列时 SELECT 抛错→catch 返回 null，容错）。 */
export function getContainerToolState(outbound: Database.Database): {
  current_tool: string | null;
  tool_declared_timeout_ms: number | null;
  current_tool_args: string | null;
} {
  try {
    const row = outbound
      .prepare("SELECT current_tool, tool_declared_timeout_ms, current_tool_args FROM container_state WHERE id = 1")
      .get() as
      | { current_tool: string | null; tool_declared_timeout_ms: number | null; current_tool_args: string | null }
      | undefined;
    if (!row) return { current_tool: null, tool_declared_timeout_ms: null, current_tool_args: null };
    const bashTimeout = row.current_tool === "Bash" ? row.tool_declared_timeout_ms : null;
    return { current_tool: row.current_tool, tool_declared_timeout_ms: bashTimeout, current_tool_args: row.current_tool_args ?? null };
  } catch {
    return { current_tool: null, tool_declared_timeout_ms: null, current_tool_args: null };
  }
}
