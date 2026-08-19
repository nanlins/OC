/**
 * scripts/send-once.ts —— 向 CLI 通道发一条消息即退出（不等回复）
 * 用途：触发 messaging_group 自动创建等只需入站的场景。
 * 用法：pnpm exec tsx scripts/send-once.ts <text>
 * 修改记录：2026-08-13 创建（收束期端到端实测用）
 */
import net from "node:net";
import { cliSocketPath } from "../src/channels/cli.js";

const text = process.argv.slice(2).join(" ") || "init";
const s = net.connect(cliSocketPath(), () => {
  s.write(JSON.stringify({ text }) + "\n");
  setTimeout(() => process.exit(0), 1500);
});
s.on("error", (e) => {
  console.error(`pipe error: ${e.message}（主机是否运行？${cliSocketPath()}）`);
  process.exit(2);
});
