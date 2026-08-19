/**
 * scripts/set-group-model.ts —— 管理工具：确保 container_configs 行并设置 provider + model
 *
 * 职责：群组首建行（ensure）后显式写 provider 与 model（容器侧 provider 读 config.model）。
 * 用法：pnpm exec tsx scripts/set-group-model.ts <agent_group_id> <provider> <model>
 * 注意：与运行中主机并发写同一中央 DB；如遇 SQLITE_BUSY 请先停主机。
 * 修改记录：2026-08-13 创建（收束期真实 LLM 实测用）
 */
import { initDb, closeDb } from "../src/db/connection.js";
import { CENTRAL_DB_PATH } from "../src/config.js";
import { ensureContainerConfig, updateContainerConfig } from "../src/db/container-configs.js";

const [groupId, provider, model] = process.argv.slice(2);
if (!groupId || !provider || !model) {
  console.error("usage: set-group-model.ts <agent_group_id> <provider> <model>");
  process.exit(1);
}
initDb(CENTRAL_DB_PATH);
ensureContainerConfig(groupId, provider);
const ok = updateContainerConfig(groupId, { provider, model } as never);
console.log(`container_configs provider=${provider} model=${model} updated=${ok}`);
closeDb();
