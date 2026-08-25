/**
 * scripts/demo-setup.ts —— 演示环境一键初始化
 *
 * 职责：创建 Demo agent + CLI 消息群组 + wiring，使 oc chat 即可对话。
 * 用法：在主机启动后运行：tsx scripts/demo-setup.ts
 *
 * 修改记录：2026-08-24 创建
 */
import { createAgentGroup, listAgentGroups } from "../src/db/agent-groups.js";
import { createMessagingGroup, createWiring } from "../src/db/messaging-groups.js";
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
updateContainerConfig(groupId, { model: "deepseek-v4-flash" });
console.log(`[setup] agent group: ${groupId} (${DEMO_NAME})`);

// 创建 CLI 消息群组（幂等——唯一键 channel_type+platform_id+instance）。
// platformId 必须为 "local"：channels/cli.ts 入站回调固定用 platformId="local"（阶段 12 修复）。
let mg = getDb()
  .prepare("SELECT * FROM messaging_groups WHERE channel_type = ? AND platform_id = ?")
  .get("cli", "local") as { id: string } | undefined;
if (!mg) {
  mg = createMessagingGroup({
    channelType: "cli",
    platformId: "local",
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

// 阶段 12 实测修复：CLI 通道是广播通道，若同一 CLI 群组挂多个 agent 的 wiring，
// 一条消息会扇出给所有 agent（串台）。收敛：删掉 local 群组上的非 Demo wiring，
// 以及残留的 cli-demo 旧群组及其 wiring。
const staleWirings = getDb()
  .prepare(
    "SELECT id FROM messaging_group_agents WHERE messaging_group_id = ? AND agent_group_id <> ?",
  )
  .all(mg.id, groupId) as Array<{ id: string }>;
for (const w of staleWirings) {
  getDb().prepare("DELETE FROM messaging_group_agents WHERE id = ?").run(w.id);
  console.log(`[setup] removed stale wiring: ${w.id} (非 Demo agent 占用 CLI 群组)`);
}
const staleMg = getDb()
  .prepare("SELECT id FROM messaging_groups WHERE channel_type = ? AND platform_id = ?")
  .get("cli", "cli-demo") as { id: string } | undefined;
if (staleMg) {
  getDb().prepare("DELETE FROM messaging_group_agents WHERE messaging_group_id = ?").run(staleMg.id);
  getDb().prepare("DELETE FROM messaging_groups WHERE id = ?").run(staleMg.id);
  console.log(`[setup] removed stale messaging group: ${staleMg.id} (cli-demo)`);
}

closeDb();
console.log("[setup] done! Run: pnpm dev  (in one terminal)");
console.log("[setup] then: pnpm oc chat Demo  (in another terminal)");
/*
 * 修改记录：
 *   2026-08-25 阶段 12：修复 CLI messaging group platformId 必须为 local（对齐 channels/cli.ts 入站回调）
 */

