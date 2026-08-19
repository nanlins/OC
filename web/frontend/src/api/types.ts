/**
 * api/types.ts —— 控制台 API 投影类型（与 src/web/api.ts 投影列对齐）
 *
 * 修改记录：2026-08-13 创建（阶段 11）
 */
export interface GroupRow {
  id: string;
  name: string;
  folder: string;
  agent_provider: string | null;
  created_at: string;
}

export interface MessagingGroupRow {
  id: string;
  channel_type: string;
  platform_id: string;
  instance: string;
  unknown_sender_policy: string;
  denied_at: string | null;
  created_at: string;
}

export interface WiringRow {
  id: string;
  messaging_group_id: string;
  agent_group_id: string;
  engage_mode: string;
  sender_scope: string;
  session_mode: string;
  priority: number;
}

export interface SessionRow {
  id: string;
  agent_group_id: string;
  messaging_group_id: string | null;
  thread_id: string | null;
  status: string;
  container_status: string;
  last_active: string | null;
}

export interface MessageRow {
  id: string;
  kind: string;
  status: string;
  trigger: number;
  content: string;
  timestamp: string;
}

export interface ApprovalRow {
  id: string;
  action: string;
  status: string;
  title: string | null;
  agent_group_id: string | null;
  created_at: string;
}

export interface AuditRow {
  id: number;
  action: string;
  actor: string;
  decision: string;
  reason: string | null;
}

export interface WebEvent {
  type: string;
  payload: unknown;
  at?: string;
}
