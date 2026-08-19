/**
 * scripts/chat.ts —— 经 CLI 通道（命名管道）与已接线 agent 对话
 *
 * 职责：连接 cliSocketPath() 命名管道 → 发 {text} → 打印回复行；首条回复后静默一段时间退出。
 * 关键导出：无（CLI 脚本）
 * 用法：pnpm exec tsx scripts/chat.ts <message...>
 * 前置：主机运行中，且目标 agent 已接线到 cli 通道（messaging_group + wiring）。
 * 借鉴：nanoclaw scripts/chat.ts（静默退出/硬超时语义）
 *
 * 修改记录：2026-08-13 创建（收束期端到端实测用）
 */
import net from "node:net";
import { cliSocketPath } from "../src/channels/cli.js";

const SILENCE_MS = 3000; // 首条回复后静默多久退出
const HARD_TIMEOUT_MS = 90_000; // 硬超时（容器冷启动可能较久）

const text = process.argv.slice(2).join(" ");
if (!text) {
  console.error("usage: tsx scripts/chat.ts <message...>");
  process.exit(1);
}

const sock = net.connect(cliSocketPath());
let buf = "";
let sawReply = false;
let silenceTimer: NodeJS.Timeout | null = null;

function scheduleExit(): void {
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    sock.end();
    process.exit(0);
  }, SILENCE_MS);
}

sock.on("connect", () => {
  sock.write(JSON.stringify({ text }) + "\n");
});
sock.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const m = JSON.parse(line) as { text?: string; kind?: string };
      console.log(`[${m.kind ?? "chat"}] ${m.text ?? line}`);
    } catch {
      console.log(`[raw] ${line}`);
    }
    sawReply = true;
    scheduleExit();
  }
});
sock.on("error", (err) => {
  console.error(`cli pipe error: ${(err as Error).message}（主机是否运行？路径 ${cliSocketPath()}）`);
  process.exit(2);
});
setTimeout(() => {
  if (!sawReply) console.error("(no reply within hard timeout)");
  process.exit(sawReply ? 0 : 3);
}, HARD_TIMEOUT_MS);
