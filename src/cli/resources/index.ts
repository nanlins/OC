/**
 * cli/resources/index.ts —— 资源命令注册桶（R-6 拆分后）
 *
 * 职责：registerAllResources 编排全部资源注册（幂等，web 与 cli 双入口共用）。
 * 各资源的 CRUD 与自定义动词已拆到同目录 <name>.ts，本文件只做编排。
 * 借鉴：nanoclaw src/cli/resources/index.ts
 *
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变，纯目录/模块拆分）
 */
import { registerEvalResource } from "../eval-resource.js";
import { registerAllCommands } from "../commands/index.js";
import { registerKbResource } from "./kb.js";
import { registerGroupsResource } from "./groups.js";
import { registerMessagingGroupsResource } from "./messaging-groups.js";
import { registerWiringsResource } from "./wirings.js";
import { registerUsersResource } from "./users.js";
import { registerRolesResource } from "./roles.js";
import { registerMembersResource } from "./members.js";
import { registerSessionsResource } from "./sessions.js";
import { registerTasksResource } from "./tasks.js";
import { registerApprovalsResource } from "./approvals.js";
import { registerDroppedResource } from "./dropped.js";
import { registerStatusResource } from "./status.js";
import { registerDestinationsResource } from "./destinations.js";

let resourcesRegistered = false;

/** 幂等（web 与 cli 双入口共用） */
export function registerAllResources(): void {
  if (resourcesRegistered) return;
  resourcesRegistered = true;
  registerEvalResource();
  registerAllCommands();
  registerKbResource();
  registerGroupsResource();
  registerMessagingGroupsResource();
  registerWiringsResource();
  registerUsersResource();
  registerRolesResource();
  registerMembersResource();
  registerSessionsResource();
  registerTasksResource();
  registerApprovalsResource();
  registerDroppedResource();
  registerStatusResource();
  registerDestinationsResource();
}

/*
 * 修改记录：
 *   2026-10-06 R-6：创建（拆分编排桶）
 */
