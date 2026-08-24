/**
 * scripts/demo-setup.ts —— 演示环境一键初始化
 *
 * 职责：创建 Demo agent + CLI 消息群组 + wiring，使 oc chat 即可对话。
 * 用法：在主机启动后运行：tsx scripts/demo-setup.ts
 *
 * 修改记录：2026-08-24 创建
 */
import { createAgentGroup, listAgentGroups } from "../src/db/agent-groups.js";
import { createMessagingGroup, createWiring, getMessagingGroup } from "../src/db/messaging-groups.js";
import { ensureContainerConfig, updateContainerConfig } from "../src/db/container-configs.js";
import { initDb, closeDb, getDb, hasTable } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations/index.js";
import { migration001 } from "../src/db/migrations/001-initial.js";
import { CENTRAL_DB_PATH } from "../src/config.js";
import { randomUUID } from "node:crypto";

const DEMO_GROUP = "demo";
const DEMO_NAME = "Demo";

initDb(CENTRAL_DB_PATH);
if (!hasTable("agent_groups")) {
  runMigrations(getDb(), [migration001]);
}

// 创建 agent group（幂等）
const existing = listAgentGroups().find((g) => g.folder === DEMO_GROUP);
const groupId = existing?.id ?? createAgentGroup({ name: DEMO_NAME, folder: DEMO_GROUP, agentProvider: "openai" }).id;
ensureContainerConfig(groupId, "openai");
updateContainerConfig(groupId, { model: "deepseek-chat" });
console.log(`[setup] agent group: ${groupId} (${DEMO_NAME})`);

// 创建 CLI 消息群组（幂等——唯一键 channel_type+platform_id+instance）
let mg = getMessagingGroup("cli-demo");
if (!mg) {
  mg = createMessagingGroup({
    channelType: "cli",
    platformId: "cli-demo",
    instance: "default",
    name: "CLI Demo Chat",
  });
}
console.log(`[setup] messaging group: ${mg.id} (CLI Demo Chat)`);

// 创建 wiring（幂等——唯一键 messaging_group_id + agent_group_id）
try {
  createWiring({
    messagingGroupId: mg.id,
    agentGroupId: groupId,
    engageMode: "mention",
    sessionMode: "shared",
  });
  console.log(`[setup] wiring: ${mg.id} -> ${groupId}`);
} catch {
  console.log("[setup] wiring already exists, skipping");
}

closeDb();
console.log("[setup] done! Run: pnpm dev  (in one terminal)");
console.log("[setup] then: pnpm oc chat Demo  (in another terminal)");