/**
 * db/user-dms.ts —— user_dms 冷 DM 缓存 CRUD
 *
 * 职责：getUserDm（缓存命中查询）/ upsertUserDm（写入或更新缓存）。
 *       user_dms 表：user_id + channel_type → messaging_group_id（主键 user_id+channel_type）。
 * 关键导出：getUserDm, upsertUserDm
 * 借鉴：nanoclaw src/modules/permissions/db/user-dms.ts（同构简化）
 *
 * 修改记录：2026-08-26 创建（阶段 12：补齐 nanoclaw user_dms 冷 DM 缓存）
 */
import { getDb } from "./connection.js";

export interface UserDmRow {
  user_id: string;
  channel_type: string;
  messaging_group_id: string;
}

export function getUserDm(userId: string, channelType: string): UserDmRow | undefined {
  return getDb()
    .prepare("SELECT user_id, channel_type, messaging_group_id FROM user_dms WHERE user_id = ? AND channel_type = ?")
    .get(userId, channelType) as UserDmRow | undefined;
}

export function upsertUserDm(row: UserDmRow): void {
  getDb()
    .prepare(
      `INSERT INTO user_dms (user_id, channel_type, messaging_group_id) VALUES (?, ?, ?)
       ON CONFLICT(user_id, channel_type) DO UPDATE SET messaging_group_id = excluded.messaging_group_id`,
    )
    .run(row.user_id, row.channel_type, row.messaging_group_id);
}
