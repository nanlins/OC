/**
 * cli/client.ts —— oc 命令行客户端
 *
 * 职责：argv 拼 cmd → 连接控制 socket → 发帧 → 打印 human/data；非 ok 退出码 1。
 * 关键导出：main
 * 用法：pnpm oc -- groups list / pnpm oc -- approvals resolve <id> --decision approve
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 7）
 *   2026-08-13 阶段 14：客户端传输错误（cli error/timeout）接入 i18n
 */
import { connect } from "node:net";
import { cliControlPath } from "./socket-server.js";
import type { ResponseFrame } from "./frame.js";
import { t, resolveLocaleFromEnv } from "../i18n/index.js";

export function main(argv: string[]): Promise<void> {
  const cmd = argv.join(" ");
  const locale = resolveLocaleFromEnv();
  return new Promise((resolve, reject) => {
    const socket = connect(cliControlPath());
    let buf = "";
    socket.on("connect", () => {
      socket.write(JSON.stringify({ cmd }) + "\n");
    });
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf("\n");
      if (idx < 0) return;
      const res = JSON.parse(buf.slice(0, idx)) as ResponseFrame;
      if (res.human) console.log(res.human);
      else console.log(JSON.stringify(res.data ?? res.error, null, 2));
      socket.destroy();
      if (res.ok) resolve();
      else reject(new Error(res.error ?? t("cli.error", locale, { msg: "unknown" })));
    });
    socket.on("error", (err) => reject(err));
    setTimeout(() => {
      socket.destroy();
      reject(new Error(t("cli.timeout", locale)));
    }, 10_000);
  });
}

// P1 修复：import.meta.main 在 Node/tsx 下为 undefined，改用入口文件名判定（与 index.ts 同构）
import { basename } from "node:path";
const entry = process.argv[1] ? basename(process.argv[1]) : "";
if (entry === "client.ts" || entry === "client.js") {
  main(process.argv.slice(2)).catch((err) => {
    console.error(String(err));
    process.exit(1);
  });
}
