/**
 * scripts/demo-setup.ts —— 演示环境一键初始化
 *
 * 职责：创建 Demo agent 组 + 把 CLI 通道接线到它，使 pnpm chat 即可对话。
 * 用法：tsx scripts/demo-setup.ts（主机启动前后均可，只写中央库）
 *
 * 承重不变量：CLI 通道的身份（channel_type/platform_id/instance）与准入策略一律由
 *   channels/cli.ts 的 ensureCliWiring 决定，本脚本不得自行拼 messaging_groups 行——
 *   历史上这里把 instance 写成 "default"（router 查的是 "cli"）并沿用
 *   createMessagingGroup 的 strict 默认策略（cli:local 不是成员），两个错误叠加导致
 *   首次安装后发消息被静默丢弃（T2 根因）。
 *
 * 修改记录：
 *   2026-08-24 创建
 *   2026-08-25 阶段 12：修复 CLI messaging group platformId 必须为 local
 *   2026-10-06 T2：接线改走 ensureCliWiring（修正 instance 与 unknown_sender_policy），
 *              补 migration002，模型默认改 deepseek-flash
 */
import { mkdirSync } from "node:fs";
import { createAgentGroup, listAgentGroups } from "../src/db/agent-groups.js";
import { ensureContainerConfig, updateContainerConfig } from "../src/db/container-configs.js";
import { initDb, closeDb, getDb, hasTable } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations/index.js";
import { migration001 } from "../src/db/migrations/001-initial.js";
import { migration002 } from "../src/db/migrations/002-destinations.js";
import { ensureCliWiring } from "../src/channels/cli.js";
import { CENTRAL_DB_PATH, DATA_DIR } from "../src/config.js";

const DEMO_GROUP = "demo";
const DEMO_NAME = "Demo";
const DEMO_MODEL = "deepseek-flash";

// 克隆后全新环境 data/ 目录不存在——先建目录再开库（否则 better-sqlite3 报 Cannot open database）
mkdirSync(DATA_DIR, { recursive: true });
initDb(CENTRAL_DB_PATH);
if (!hasTable("agent_groups")) {
  runMigrations(getDb(), [migration001, migration002]);
}

// 创建 agent group（幂等）
const existing = listAgentGroups().find((g) => g.folder === DEMO_GROUP);
const groupId = existing?.id ?? createAgentGroup({ name: DEMO_NAME, folder: DEMO_GROUP, agentProvider: "openai" }).id;
ensureContainerConfig(groupId, "openai");
updateContainerConfig(groupId, { provider: "openai", model: DEMO_MODEL } as never);
console.log(`[setup] agent group: ${groupId} (${DEMO_NAME}) provider=openai model=${DEMO_MODEL}`);

// 接线 CLI 通道（幂等；身份与准入策略由 channels/cli.ts 单点决定）
const wired = ensureCliWiring(groupId);
console.log(
  `[setup] messaging group: ${wired.messagingGroupId} (cli/local/instance=cli) ` +
    `${wired.createdMessagingGroup ? "created" : "existing"}`,
);
console.log(`[setup] wiring: ${wired.wiringId} ${wired.createdWiring ? "created" : "existing"}`);
for (const r of wired.repaired) console.log(`[setup] repaired: ${r}`);

// CLI 通道是广播通道：同一群组挂多个 agent 的 wiring 会让一条消息扇出给所有 agent（串台）。
// 收敛为只保留 Demo 的接线，并清掉早期 cli-demo 群组残留。
const staleWirings = getDb()
  .prepare("SELECT id, agent_group_id FROM messaging_group_agents WHERE messaging_group_id = ? AND agent_group_id <> ?")
  .all(wired.messagingGroupId, groupId) as Array<{ id: string; agent_group_id: string }>;
for (const w of staleWirings) {
  getDb().prepare("DELETE FROM messaging_group_agents WHERE id = ?").run(w.id);
  console.log(`[setup] removed stale wiring: ${w.id} (agent ${w.agent_group_id} 占用 CLI 群组)`);
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
console.log("[setup] done! Next:");
console.log("  pnpm build:container   # build the agent image");
console.log("  pnpm dev               # start the host (terminal A)");
console.log("  pnpm chat              # talk to the agent (terminal B)");
/*
 * 修改记录：
 *   2026-08-25 阶段 12：修复 CLI messaging group platformId 必须为 local（对齐 channels/cli.ts 入站回调）
 *   2026-10-06 T2：接线改走 ensureCliWiring；补 migration002；模型默认 deepseek-flash
 */
