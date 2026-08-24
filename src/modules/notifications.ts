/**
 * modules/notifications.ts —— 通知系统
 *
 * 职责：任务完成/审批等待/错误告警推送。支持多通道通知（CLI/Telegram/Discord/Email）。
 *       通过 outbound DB 投递通知消息，复用现有投递管线。
 * 关键导出：sendNotification, notifyOnTaskComplete, notifyOnApprovalNeeded, notifyOnError
 * 知识文档映射：04-Agent应用详解 §4.12 Human-in-the-Loop
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */
import { randomUUID } from "node:crypto";
import { getDb } from "../db/connection.js";
import { log } from "../log.js";

export type NotificationChannel = "cli" | "telegram" | "discord" | "slack" | "email" | "webhook";
export type NotificationPriority = "info" | "warning" | "critical";

export interface Notification {
  id: string;
  userId: string | null;
  agentGroupId: string | null;
  channel: NotificationChannel;
  platformId: string | null;
  title: string;
  body: string;
  priority: NotificationPriority;
  action: string | null;
  actionPayload: string | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

function ensureNotificationTable(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      agent_group_id TEXT,
      channel TEXT NOT NULL,
      platform_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'info',
      action TEXT,
      action_payload TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);
    CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at);
  `);
}

export function sendNotification(opts: {
  userId?: string | null;
  agentGroupId?: string | null;
  channel: NotificationChannel;
  platformId?: string | null;
  title: string;
  body: string;
  priority?: NotificationPriority;
  action?: string | null;
  actionPayload?: string | null;
}): Notification {
  ensureNotificationTable();
  const row: Notification = {
    id: randomUUID(),
    userId: opts.userId ?? null,
    agentGroupId: opts.agentGroupId ?? null,
    channel: opts.channel,
    platformId: opts.platformId ?? null,
    title: opts.title,
    body: opts.body,
    priority: opts.priority ?? "info",
    action: opts.action ?? null,
    actionPayload: opts.actionPayload ?? null,
    createdAt: new Date().toISOString(),
    deliveredAt: null,
    readAt: null,
  };
  getDb()
    .prepare(
      `INSERT INTO notifications (id, user_id, agent_group_id, channel, platform_id, title, body, priority, action, action_payload, created_at, delivered_at, read_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(row.id, row.userId, row.agentGroupId, row.channel, row.platformId, row.title, row.body, row.priority, row.action, row.actionPayload, row.createdAt, row.deliveredAt, row.readAt);
  log.info("notification sent", { id: row.id, title: row.title, priority: row.priority });
  return row;
}

export function notifyOnTaskComplete(taskName: string, agentGroupId: string, result: string): Notification {
  return sendNotification({
    agentGroupId,
    channel: "cli",
    title: `任务完成：${taskName}`,
    body: result.slice(0, 500),
    priority: "info",
  });
}

export function notifyOnApprovalNeeded(approvalId: string, agentGroupId: string, action: string): Notification {
  return sendNotification({
    agentGroupId,
    channel: "cli",
    title: `审批等待：${action}`,
    body: `审批 ID: ${approvalId}，请使用 oc approvals resolve --id ${approvalId} --decision approve|reject`,
    priority: "warning",
    action: "approvals/resolve",
    actionPayload: JSON.stringify({ approvalId }),
  });
}

export function notifyOnError(error: string, agentGroupId: string | null): Notification {
  return sendNotification({
    agentGroupId,
    channel: "cli",
    title: "错误告警",
    body: error.slice(0, 500),
    priority: "critical",
  });
}

export function markDelivered(id: string): void {
  ensureNotificationTable();
  getDb()
    .prepare("UPDATE notifications SET delivered_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function markRead(id: string): void {
  ensureNotificationTable();
  getDb()
    .prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL")
    .run(new Date().toISOString(), id);
}

export function listNotifications(userId: string | null, limit: number = 20): Notification[] {
  ensureNotificationTable();
  return getDb()
    .prepare(
      "SELECT * FROM notifications WHERE (user_id = ? OR user_id IS NULL) ORDER BY created_at DESC LIMIT ?",
    )
    .all(userId, limit) as Notification[];
}

export function unreadCount(userId: string | null): number {
  ensureNotificationTable();
  const row = getDb()
    .prepare("SELECT COUNT(*) as cnt FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND read_at IS NULL")
    .get(userId) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}