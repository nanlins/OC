/**
 * 001-initial.ts —— 初始中央 schema（v2 基线）
 *
 * 职责：建立全部中央实体表（docs/07 §9.1 + 增强 users.link_key）。
 * 关键导出：migration001
 * 承重不变量：时间戳 TEXT 存 ISO-8601 UTC；权限在用户级（user_roles）而非群组级。
 * 借鉴：nanoclaw src/db/migrations/001-initial.ts + docs/07 §9.1
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 */
import type { Migration } from "./index.js";

export const migration001: Migration = {
  version: 1,
  name: "initial-v2-schema",
  up: (db) => {
    db.exec(`
      CREATE TABLE agent_groups (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        folder         TEXT NOT NULL UNIQUE,
        agent_provider TEXT,
        created_at     TEXT NOT NULL
      );

      CREATE TABLE messaging_groups (
        id                    TEXT PRIMARY KEY,
        channel_type          TEXT NOT NULL,
        platform_id           TEXT NOT NULL,
        instance              TEXT NOT NULL,
        name                  TEXT,
        is_group              INTEGER NOT NULL DEFAULT 0,
        unknown_sender_policy TEXT NOT NULL DEFAULT 'strict',
        denied_at             TEXT,
        created_at            TEXT NOT NULL,
        UNIQUE(channel_type, platform_id, instance)
      );

      CREATE TABLE messaging_group_agents (
        id                     TEXT PRIMARY KEY,
        messaging_group_id     TEXT NOT NULL REFERENCES messaging_groups(id) ON DELETE CASCADE,
        agent_group_id         TEXT NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
        engage_mode            TEXT NOT NULL DEFAULT 'mention',
        engage_pattern         TEXT,
        sender_scope           TEXT NOT NULL DEFAULT 'all',
        ignored_message_policy TEXT NOT NULL DEFAULT 'drop',
        session_mode           TEXT NOT NULL DEFAULT 'shared',
        priority               INTEGER NOT NULL DEFAULT 0,
        threads                INTEGER,
        created_at             TEXT NOT NULL,
        UNIQUE(messaging_group_id, agent_group_id)
      );

      CREATE TABLE users (
        id           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL,
        display_name TEXT,
        link_key     TEXT,
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_users_link_key ON users (link_key) WHERE link_key IS NOT NULL;

      CREATE TABLE user_roles (
        user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role           TEXT NOT NULL,
        agent_group_id TEXT REFERENCES agent_groups(id) ON DELETE CASCADE,
        granted_by     TEXT REFERENCES users(id),
        granted_at     TEXT NOT NULL,
        PRIMARY KEY (user_id, role, agent_group_id)
      );

      CREATE TABLE agent_group_members (
        user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        agent_group_id TEXT NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
        added_by       TEXT REFERENCES users(id),
        added_at       TEXT NOT NULL,
        PRIMARY KEY (user_id, agent_group_id)
      );

      CREATE TABLE user_dms (
        user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel_type       TEXT NOT NULL,
        messaging_group_id TEXT NOT NULL REFERENCES messaging_groups(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, channel_type)
      );

      CREATE TABLE sessions (
        id                 TEXT PRIMARY KEY,
        agent_group_id     TEXT NOT NULL REFERENCES agent_groups(id) ON DELETE CASCADE,
        messaging_group_id TEXT REFERENCES messaging_groups(id) ON DELETE SET NULL,
        thread_id          TEXT,
        agent_provider     TEXT,
        status             TEXT NOT NULL DEFAULT 'active',
        container_status   TEXT NOT NULL DEFAULT 'stopped',
        last_active        TEXT,
        created_at         TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_agent ON sessions (agent_group_id, status);
      CREATE INDEX idx_sessions_active ON sessions (status, last_active);

      CREATE TABLE container_configs (
        agent_group_id TEXT PRIMARY KEY REFERENCES agent_groups(id) ON DELETE CASCADE,
        provider       TEXT NOT NULL DEFAULT 'claude',
        assistant_name TEXT,
        model          TEXT,
        effort         TEXT,
        mcp_servers    TEXT,
        packages       TEXT,
        mounts         TEXT,
        cli_scope      TEXT NOT NULL DEFAULT 'group',
        timezone       TEXT,
        cpu_limit      TEXT,
        memory_limit   TEXT,
        pids_limit     TEXT,
        updated_at     TEXT NOT NULL
      );

      CREATE TABLE pending_approvals (
        id               TEXT PRIMARY KEY,
        session_id       TEXT NOT NULL,
        action           TEXT NOT NULL,
        payload          TEXT NOT NULL DEFAULT '{}',
        user_id          TEXT,
        approver_user_id TEXT,
        agent_group_id   TEXT,
        status           TEXT NOT NULL DEFAULT 'pending',
        title            TEXT,
        options_json     TEXT,
        question         TEXT,
        created_at       TEXT NOT NULL,
        resolved_at      TEXT
      );
      CREATE INDEX idx_approvals_status ON pending_approvals (status);

      CREATE TABLE pending_questions (
        id         TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        question   TEXT NOT NULL,
        options    TEXT,
        status     TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE unregistered_senders (
        messaging_group_id TEXT NOT NULL REFERENCES messaging_groups(id) ON DELETE CASCADE,
        sender_id          TEXT NOT NULL,
        display_name       TEXT,
        message_count      INTEGER NOT NULL DEFAULT 1,
        first_seen         TEXT NOT NULL,
        last_seen          TEXT NOT NULL,
        PRIMARY KEY (messaging_group_id, sender_id)
      );
    `);
  },
};
