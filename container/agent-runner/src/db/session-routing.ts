/**
 * db/session-routing.ts —— 会话路由 DB 操作
 *
 * 职责：读/写 session_routing 表（inbound DB 的单行表），记录当前聊天/线程路由上下文。
 *       容器侧用此确定当前 channel_type / platform_id / thread_id。
 * 关键导出：getSessionRouting, setSessionRouting
 * 借鉴：nanoclaw container/agent-runner/src/db/session-routing.ts
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { openInboundPoll } from "./connection.js";

export interface SessionRouting {
  channel_type: string | null;
  platform_id: string | null;
  thread_id: string | null;
}

export function getSessionRouting(workspaceDir: string): SessionRouting | null {
  const db = openInboundPoll(workspaceDir);
  try {
    const row = db.query("SELECT channel_type, platform_id, thread_id FROM session_routing WHERE id = 1").get() as
      | SessionRouting
      | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

export function setSessionRouting(
  workspaceDir: string,
  routing: { channel_type?: string | null; platform_id?: string | null; thread_id?: string | null },
): void {
  const db = openInboundPoll(workspaceDir);
  const existing = db.query("SELECT id FROM session_routing WHERE id = 1").get();
  if (existing) {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (routing.channel_type !== undefined) {
      sets.push("channel_type = ?");
      params.push(routing.channel_type);
    }
    if (routing.platform_id !== undefined) {
      sets.push("platform_id = ?");
      params.push(routing.platform_id);
    }
    if (routing.thread_id !== undefined) {
      sets.push("thread_id = ?");
      params.push(routing.thread_id);
    }
    if (sets.length > 0) {
      db.run(`UPDATE session_routing SET ${sets.join(", ")} WHERE id = 1`, ...params);
    }
  } else {
    db.run(
      "INSERT INTO session_routing (id, channel_type, platform_id, thread_id) VALUES (1, ?, ?, ?)",
      routing.channel_type ?? null,
      routing.platform_id ?? null,
      routing.thread_id ?? null,
    );
  }
  db.close();
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

