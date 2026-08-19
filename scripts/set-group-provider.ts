/**
 * scripts/set-group-provider.ts —— 管理工具：直接改 container_configs.provider
 *
 * 职责：绕过 ensure 的 INSERT OR IGNORE，显式改写既有群组的 provider（运维/纠错用）。
 * 用法：pnpm exec tsx scripts/set-group-provider.ts <agent_group_id> <provider>
 * 注意：主机运行时勿并发写（SQLite 锁）；建议先停主机。
 * 修改记录：2026-08-13 创建（收束期实测纠错用）
 */
import { initDb, getDb, closeDb } from "../src/db/connection.js";
import { CENTRAL_DB_PATH } from "../src/config.js";

const [groupId, provider] = process.argv.slice(2);
if (!groupId || !provider) {
  console.error("usage: set-group-provider.ts <agent_group_id> <provider>");
  process.exit(1);
}
initDb(CENTRAL_DB_PATH);
const r = getDb().prepare("UPDATE container_configs SET provider = ?, updated_at = ? WHERE agent_group_id = ?").run(
  provider,
  new Date().toISOString(),
  groupId,
);
console.log(`container_configs provider=${provider} changes=${r.changes}`);
closeDb();
