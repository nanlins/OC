/**
 * schema.ts —— 当前 schema 的【只读参考副本】
 *
 * 职责：供人阅读的 schema 快照；运行时建表一律走 migrations/，禁止 import 本文件执行 DDL
 *       （避免双份事实来源漂移，借鉴 nanoclaw src/db/schema.ts 的折中）。
 * 关键导出：CENTRAL_SCHEMA_REFERENCE（字符串常量，仅文档用途）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 */

export const CENTRAL_SCHEMA_REFERENCE = `
-- 参考副本，勿在运行时执行。真实建表见 migrations/001-initial.ts
agent_groups(id PK, name, folder UNIQUE, agent_provider, created_at)
messaging_groups(id PK, channel_type, platform_id, instance, name, is_group,
                 unknown_sender_policy, denied_at, created_at, UNIQUE(channel_type, platform_id, instance))
messaging_group_agents(id PK, messaging_group_id FK, agent_group_id FK,
                       engage_mode, engage_pattern, sender_scope, ignored_message_policy,
                       session_mode, priority, threads, created_at, UNIQUE(messaging_group_id, agent_group_id))
users(id PK, kind, display_name, link_key, created_at)
user_roles(user_id FK, role, agent_group_id FK NULL=全局, granted_by, granted_at, PK(user_id, role, agent_group_id))
agent_group_members(user_id FK, agent_group_id FK, added_by, added_at, PK(user_id, agent_group_id))
user_dms(user_id FK, channel_type, messaging_group_id FK, PK(user_id, channel_type))
sessions(id PK, agent_group_id FK, messaging_group_id FK NULL, thread_id, agent_provider,
         status, container_status, last_active, created_at)
container_configs(agent_group_id PK FK, provider, assistant_name, model, effort, mcp_servers,
                  packages, mounts, cli_scope, timezone, cpu_limit, memory_limit, pids_limit, updated_at)
pending_approvals(id PK, session_id, action, payload, user_id, approver_user_id, agent_group_id,
                  status, title, options_json, question, created_at, resolved_at)
pending_questions(id PK, session_id, question, options, status, created_at, resolved_at)
unregistered_senders(messaging_group_id FK, sender_id, display_name, message_count, first_seen, last_seen,
                     PK(messaging_group_id, sender_id))
schema_version(version PK, name UNIQUE, applied_at)

-- 会话级（每会话各一份，不走中央迁移体系；见 session-db.ts）
inbound.db:  messages_in / delivered / destinations / session_routing
outbound.db: messages_out / processing_ack / session_state / container_state
`;

/**
 * 与 docs/07 §9.1 的取舍差异说明（P2-9，se-inspector 提出）：
 * 1. pending_approvals 采用 nanoclaw 021 迁移后的最终形态（action/payload/options_json/question/approver_user_id），
 *    而非 docs/07 §9.1 的早期形态（question_id）——审批流需要卡片渲染元数据单一事实来源；
 * 2. schema_version 增加 name UNIQUE 列——迁移去重键是 name（承重不变量），docs/07 §9.1 仅有 version；
 * 3. users 增加 link_key（跨通道 linking，补充优化 C.10）；
 * 4. container_configs 增加 packages/mounts/cli_scope/timezone（cli_scope 三级执行 + 组级时区，docs/07 §10.11/§9.1 部分覆盖）。
 * 上述取舍均对齐基线 nanoclaw v2 最终形态；docs/07 后续修订时以本文件为准。
 */
export const SCHEMA_DRIFT_NOTES = "见本文件头部注释块（2026-08-12 P2-9）";
