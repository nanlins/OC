/**
 * types.ts —— 全局实体类型定义（中央 DB + 会话 DB）
 *
 * 职责：与 docs/07 §9 Schema 一一对应的 TypeScript 类型；DB NOT NULL/有默认值的列在类型上标可选
 *       （借鉴 nanoclaw src/types.ts 的 "denied_at 约定"，老 fixture 无需更新）。
 * 关键导出：AgentGroup / MessagingGroup / MessagingGroupAgent / User / UserRole / Session /
 *           ContainerConfigRow / MessageIn / MessageOut 及策略联合类型。
 * 承重不变量：时间戳一律 ISO-8601 UTC 字符串（toISOString）。
 * 借鉴：nanoclaw src/types.ts（claw开源项目源码/src/types.ts）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1）
 */

// ---- 策略联合类型 ----
export type UnknownSenderPolicy = "strict" | "request_approval" | "public";
export type EngageMode = "pattern" | "mention" | "mention-sticky";
export type SenderScope = "all" | "known";
export type IgnoredMessagePolicy = "drop" | "accumulate";
export type SessionMode = "shared" | "per-thread" | "agent-shared";
export type Role = "owner" | "admin";
export type MessageKind = "chat" | "chat-sdk" | "system" | "task" | "a2a" | "question_response";
export type MessageInStatus = "pending" | "processing" | "completed" | "skipped" | "failed" | "cancelled";

// ---- 中央 DB 实体 ----
export interface AgentGroup {
  id: string;
  name: string;
  folder: string;
  agent_provider: string | null;
  created_at: string;
}

export interface MessagingGroup {
  id: string;
  channel_type: string;
  platform_id: string;
  instance: string;
  name: string | null;
  is_group: number;
  unknown_sender_policy: UnknownSenderPolicy;
  denied_at: string | null;
  created_at: string;
}

export interface MessagingGroupAgent {
  id: string;
  messaging_group_id: string;
  agent_group_id: string;
  engage_mode: EngageMode;
  engage_pattern: string | null;
  sender_scope: SenderScope;
  ignored_message_policy: IgnoredMessagePolicy;
  session_mode: SessionMode;
  priority: number;
  threads: number | null;
  created_at: string;
}

export interface User {
  id: string;
  kind: string;
  display_name: string | null;
  /** 增强（相对 nanoclaw）：跨通道 linking 键，同一自然人在多平台共享（docs 补充优化 C.10） */
  link_key: string | null;
  created_at: string;
}

export interface UserRole {
  user_id: string;
  role: Role;
  agent_group_id: string | null;
  granted_by: string | null;
  granted_at: string;
}

export interface AgentGroupMember {
  user_id: string;
  agent_group_id: string;
  added_by: string | null;
  added_at: string;
}

export interface Session {
  id: string;
  agent_group_id: string;
  messaging_group_id: string | null;
  thread_id: string | null;
  agent_provider: string | null;
  status: "active" | "closed";
  container_status: "stopped" | "running";
  last_active: string | null;
  created_at: string;
}

export interface ContainerConfigRow {
  agent_group_id: string;
  provider: string;
  assistant_name: string | null;
  model: string | null;
  effort: string | null;
  mcp_servers: string | null;
  packages: string | null;
  mounts: string | null;
  cli_scope: "disabled" | "group" | "global";
  timezone: string | null;
  cpu_limit: string | null;
  memory_limit: string | null;
  pids_limit: string | null;
  updated_at: string;
}

export interface PendingApproval {
  id: string;
  session_id: string;
  action: string;
  payload: string;
  user_id: string | null;
  approver_user_id: string | null;
  agent_group_id: string | null;
  status: "pending" | "awaiting_reason" | "approved" | "rejected";
  title: string | null;
  options_json: string | null;
  question: string | null;
  created_at: string;
  resolved_at: string | null;
}

// ---- 会话级 DB 实体 ----
export interface MessageIn {
  id: string;
  seq: number;
  kind: MessageKind;
  timestamp: string;
  status: MessageInStatus;
  process_after: string | null;
  recurrence: string | null;
  series_id: string | null;
  tries: number;
  trigger: number;
  on_wake: number;
  platform_id: string | null;
  channel_type: string | null;
  thread_id: string | null;
  content: string;
  source_session_id: string | null;
}

export interface MessageOut {
  id: string;
  seq: number;
  in_reply_to: string | null;
  timestamp: string;
  deliver_after: string | null;
  recurrence: string | null;
  kind: MessageKind;
  /** 交互操作语义：edit/reaction（阶段 5 P1-5 补入投递桥） */
  operation: string | null;
  platform_id: string | null;
  channel_type: string | null;
  thread_id: string | null;
  content: string;
}

export interface DeliveredRow {
  message_out_id: string;
  platform_message_id: string | null;
  status: "delivered" | "failed";
  delivered_at: string;
}

export interface DestinationRow {
  name: string;
  display_name: string | null;
  type: "channel" | "agent";
  channel_type: string | null;
  platform_id: string | null;
  agent_group_id: string | null;
}
