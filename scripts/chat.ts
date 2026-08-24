/**
 * scripts/chat.ts —— OC 聊天客户端
 *
 * 职责：连接 CLI chat socket，发送消息，接收流式回复。类似终端聊天。
 * 用法：tsx scripts/chat.ts
 * 修改记录：2026-08-24 创建
 */
import { connect } from "node:net";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DATA_DIR } from "../src/config.js";

const INSTALL_SLUG = createHash("sha1").update(process.cwd()).digest("hex").slice(0, 8);
const CHAT_PATH =
  process.platform === "win32"
    ? `\\\\.\\pipe\\openclaw-chat-${INSTALL_SLUG}`
    : join(DATA_DIR, "cli-chat.sock");

const socket = connect(CHAT_PATH);
let buf = "";

socket.on("connect", () => {
  console.log("[OC] 已连接。输入消息后回车发送，Ctrl+C 退出。\n");
});

socket.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    try {
      const msg = JSON.parse(line) as { text?: string; kind?: string };
      if (msg.text) process.stdout.write(msg.text);
      if (msg.kind === "end") process.stdout.write("\n\n> ");
    } catch {
      process.stdout.write(line);
    }
  }
});

socket.on("error", (err) => {
  console.error("连接失败:", err.message);
  process.exit(1);
});

socket.on("close", () => {
  console.log("\n[OC] 连接断开");
  process.exit(0);
});

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  socket.write(JSON.stringify({ text: line }) + "\n");
});

rl.on("SIGINT", () => {
  socket.destroy();
  process.exit(0);
});