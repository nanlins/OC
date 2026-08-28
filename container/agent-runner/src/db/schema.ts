/**
 * db/schema.ts —— 会话双库 DDL（容器侧参考副本，与主机 src/db/session-db.ts 同构）
 *
 * 职责：测试建库与缺表自愈；生产库由主机建立。
 * 关键导出：INBOUND_SCHEMA, OUTBOUND_SCHEMA
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）
 */
export const INBOUND_SCHEMA = `
  CREATE TABLE IF NOT EXISTS messages_in (
    id TEXT PRIMARY KEY, seq INTEGER UNIQUE, kind TEXT NOT NULL, timestamp TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', process_after TEXT, recurrence TEXT, series_id TEXT,
    tries INTEGER NOT NULL DEFAULT 0, trigger INTEGER NOT NULL DEFAULT 1, on_wake INTEGER NOT NULL DEFAULT 0,
    platform_id TEXT, channel_type TEXT, thread_id TEXT, content TEXT NOT NULL, source_session_id TEXT
  );
  CREATE TABLE IF NOT EXISTS delivered (
    message_out_id TEXT PRIMARY KEY, platform_message_id TEXT, status TEXT NOT NULL DEFAULT 'delivered', delivered_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS destinations (
    name TEXT PRIMARY KEY, display_name TEXT, type TEXT NOT NULL, channel_type TEXT, platform_id TEXT, agent_group_id TEXT
  );
  CREATE TABLE IF NOT EXISTS session_routing (
    id INTEGER PRIMARY KEY CHECK (id = 1), channel_type TEXT, platform_id TEXT, thread_id TEXT
  );
`;

export const OUTBOUND_SCHEMA = `
  CREATE TABLE IF NOT EXISTS messages_out (
    id TEXT PRIMARY KEY, seq INTEGER UNIQUE, in_reply_to TEXT, timestamp TEXT NOT NULL,
    deliver_after TEXT, recurrence TEXT, kind TEXT NOT NULL, operation TEXT,
    stream_final INTEGER NOT NULL DEFAULT 0,
    platform_id TEXT, channel_type TEXT, thread_id TEXT, content TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS processing_ack (
    message_id TEXT PRIMARY KEY, status TEXT NOT NULL, status_changed TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS session_state (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS container_state (
    id INTEGER PRIMARY KEY CHECK (id = 1), current_tool TEXT, tool_declared_timeout_ms INTEGER,
    tool_started_at TEXT, current_tool_args TEXT, updated_at TEXT NOT NULL
  );
`;
