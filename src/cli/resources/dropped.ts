/**
 * cli/resources/dropped.ts —— dropped 资源（只读 CRUD）
 *
 * 职责：dropped list（unregistered_senders，复合主键无 id 列故无 get）。
 * 关键导出：registerDroppedResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/dropped-messages.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCrudResource } from "../crud.js";

export function registerDroppedResource(): void {
  registerCrudResource("dropped", {
    table: "unregistered_senders",
    columns: ["messaging_group_id", "sender_id", "display_name", "message_count", "last_seen"],
    noGet: true, // 复合主键无 id 列
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
