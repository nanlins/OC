/**
 * scripts/delete-wiring.ts —— 管理工具：按 id 删除接线（messaging_group_agents）
 * 用法：pnpm exec tsx scripts/delete-wiring.ts <wiring_id>
 * 修改记录：2026-08-13 创建（收束期实测：切换 cli 通道所接 agent）
 */
import { initDb, getDb, closeDb } from "../src/db/connection.js";
import { CENTRAL_DB_PATH } from "../src/config.js";

const wiringId = process.argv[2];
if (!wiringId) {
  console.error("usage: delete-wiring.ts <wiring_id>");
  process.exit(1);
}
initDb(CENTRAL_DB_PATH);
const r = getDb().prepare("DELETE FROM messaging_group_agents WHERE id = ?").run(wiringId);
console.log(`wiring deleted changes=${r.changes}`);
closeDb();
