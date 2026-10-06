/**
 * cli/resources/users.ts —— users 资源（只读 CRUD）
 *
 * 职责：users list/get（CRUD 生成）。
 * 关键导出：registerUsersResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/users.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCrudResource } from "../crud.js";

export function registerUsersResource(): void {
  registerCrudResource("users", {
    table: "users",
    columns: ["id", "kind", "display_name", "link_key", "created_at"],
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
