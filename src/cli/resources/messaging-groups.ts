/**
 * cli/resources/messaging-groups.ts —— messaging-groups 资源（只读 CRUD）
 *
 * 职责：messaging-groups list/get（CRUD 生成；agent 面不可见——无按组过滤列，host-only）。
 * 关键导出：registerMessagingGroupsResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/messaging-groups.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCrudResource } from "../crud.js";

export function registerMessagingGroupsResource(): void {
  registerCrudResource("messaging-groups", {
    table: "messaging_groups",
    columns: ["id", "channel_type", "platform_id", "instance", "unknown_sender_policy", "denied_at", "created_at"],
    agentVisible: false, // P1 修复：无按组过滤列，host-only（简化记录在案）
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
