/**
 * db/session-routing.ts —— 会话路由读取（inbound 单行表）
 *
 * 职责：只读 session_routing 表，供容器侧确定当前 channel_type / platform_id / thread_id。
 *       阶段 12 重写：原实现误用 bun:sqlite API（openInboundPoll 传参 / db.run 展开参数）
 *       且 setSessionRouting 违反"容器不写 inbound"单写者不变量，故移除写入、仅保留读取。
 *       路由写入由主机侧负责（见主机 session-routing）。
 * 关键导出：getSessionRouting, SessionRouting
 * 借鉴：nanoclaw container/agent-runner/src/db/session-routing.ts（仅读侧）
 *
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 *   2026-08-27 阶段 12 重写：修复 bun:sqlite API 误用；移除违反单写者不变量的写入函数
 */
import { openInboundPoll } from "./connection.ts";

export interface SessionRouting {
  channel_type: string | null;
  platform_id: string | null;
  thread_id: string | null;
}

export function getSessionRouting(): SessionRouting | null {
  const db = openInboundPoll();
  try {
    const row = db
      .query("SELECT channel_type, platform_id, thread_id FROM session_routing WHERE id = 1")
      .get() as SessionRouting | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 *   2026-08-27 阶段 12 重写：修复 bun:sqlite API 误用；移除违反单写者不变量的写入函数
 */
