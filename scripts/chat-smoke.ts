// scripts/chat-smoke.ts —— 临时冒烟：非交互连 chat socket 发一条消息收帧（CI/脚本用）
// 修改记录：2026-08-25 创建（阶段 12 冒烟验证）
import { connect } from "node:net";
import { createHash } from "node:crypto";

const slug = createHash("sha1").update(process.cwd()).digest("hex").slice(0, 8);
const path = `\\\\.\\pipe\\oc-chat-${slug}`;
const s = connect(path);
let buf = "";
s.on("connect", () => {
  s.write(JSON.stringify({ text: process.argv[2] ?? "你好，用一句话介绍你自己" }) + "\n");
});
s.on("data", (c) => {
  buf += c.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    try {
      const f = JSON.parse(line) as { kind?: string; text?: string; tool?: string; status?: string; agent?: string; model?: string };
      if (f.kind === "meta") console.log(`[meta] agent=${f.agent} model=${f.model}`);
      else if (f.kind === "tool") console.log(`[tool] ${f.tool} ${f.status}`);
      else if (f.kind === "end") console.log("[end]");
      else if (f.text) console.log(`[chat] ${f.text.slice(0, 200)}`);
    } catch {
      /* skip */
    }
  }
});
s.on("error", (e) => {
  console.error("connect error:", e.message);
  process.exit(1);
});
setTimeout(() => {
  console.log("[timeout] exit");
  process.exit(0);
}, 25000);

/*
 * 修改记录：
 *   2026-08-25 阶段 12：CLI 聊天 TUI 冒烟（meta/chat/end 帧验证，非交互模式）
 */

