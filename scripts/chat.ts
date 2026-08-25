/**
 * scripts/chat.ts —— OC 聊天 TUI 客户端
 *
 * 职责：连接 CLI chat socket，终端交互：状态栏 + 消息流（打字机渲染） + 工具块 + 输入历史 + 斜杠命令。
 * 关键导出：无（CLI 脚本）
 * 用法：pnpm chat；/help 看命令；Ctrl+C 跳过打字机；Ctrl+D 退出。
 * 承重不变量：帧解析失败降级为纯文本行（不崩溃）；退出时恢复终端（raw mode off + 光标显示）。
 * 借鉴：opencode TUI 布局（状态栏/消息流/输入行）+ aichat REPL 命令集；渲染逻辑复用 channels/cli-render.ts。
 *
 * 修改记录：
 *   2026-08-24 创建（演示版：逐行 JSON 打印）
 *   2026-08-25 阶段 12 重写：TUI 交互（raw mode + 历史 + 打字机 + meta/tool/end 帧）
 */
import { connect } from "node:net";
import { createHash } from "node:crypto";
import { join } from "node:path";
import kleur from "kleur";
import { renderChat, renderError, renderFrame, renderTool, USER_PREFIX, type CliFrame } from "../src/channels/cli-render.js";
import { DATA_DIR } from "../src/config.js";

const INSTALL_SLUG = createHash("sha1").update(process.cwd()).digest("hex").slice(0, 8);
const CHAT_PATH =
  process.platform === "win32" ? `\\\\.\\pipe\\oc-chat-${INSTALL_SLUG}` : join(DATA_DIR, "cli-chat.sock");

const out = process.stdout;
const write = (s: string) => out.write(s);

// ---- 终端状态 ----
let connected = false;
let meta: { agent?: string | null; model?: string | null; provider?: string | null } | null = null;

// ---- 输入状态 ----
let inputBuf = "";
const history: string[] = [];
let historyIdx = -1;
let typewriterActive = false;
let typewriterSkip = false;

// ---- 渲染 ----
const interactive = process.stdin.isTTY === true && !process.env.CI;

function redrawPrompt(): void {
  if (!interactive) return;
  write("\n" + kleur.dim("›") + " " + inputBuf);
}

function renderStatusBar(): void {
  if (!connected) {
    write(kleur.inverse(" OC chat · connecting… ") + "\n");
    return;
  }
  const agent = meta?.agent ?? "?";
  const model = meta?.model ?? "?";
  const provider = meta?.provider ?? "?";
  write(kleur.inverse(` OC chat · ${agent.slice(0, 8)} · ${model} · ${provider} `) + "\n");
}

/** 打字机渲染：按块输出 chat 文本，Ctrl+C 跳过；非交互环境整段直出 */
function typewriterPrint(text: string): void {
  if (!interactive) {
    write(renderChat(text) + "\n");
    return;
  }
  typewriterActive = true;
  typewriterSkip = false;
  const rendered = renderChat(text);
  let printed = 0;
  const step = () => {
    if (typewriterSkip || printed >= rendered.length) {
      write(rendered.slice(printed));
      write("\n");
      typewriterActive = false;
      redrawPrompt();
      return;
    }
    const chunk = rendered.slice(printed, printed + 2);
    write(chunk);
    printed += 2;
    setTimeout(step, 6);
  };
  step();
}

function handleFrame(frame: CliFrame): void {
  switch (frame.kind) {
    case "meta":
      meta = frame;
      break;
    case "chat":
      typewriterPrint(frame.text);
      break;
    case "tool":
      write(renderFrame(frame).join("\n") + "\n");
      redrawPrompt();
      break;
    case "error":
      write(renderError(frame.text) + "\n");
      redrawPrompt();
      break;
    case "end":
      if (!typewriterActive) redrawPrompt();
      break;
  }
}

// ---- socket ----
const socket = connect(CHAT_PATH);
let buf = "";

socket.on("connect", () => {
  connected = true;
  renderStatusBar();
  write(kleur.gray(" 输入消息后回车发送 · /help 帮助 · /exit 退出") + "\n");
  redrawPrompt();
});

socket.on("data", (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      handleFrame(JSON.parse(line) as CliFrame);
    } catch {
      // 纯文本兜底（老主机）：当 chat 帧处理
      typewriterPrint(line);
    }
  }
});

socket.on("error", (err) => {
  restoreTerminal();
  console.error(kleur.red("连接失败：" + err.message));
  console.error(kleur.gray("请先启动主机：pnpm dev"));
  process.exit(1);
});

socket.on("close", () => {
  restoreTerminal();
  write("\n");
  process.exit(0);
});

// ---- 键盘输入（raw mode；非 TTY 降级为行模式读取） ----
import { createInterface, emitKeypressEvents } from "node:readline";

function restoreTerminal(): void {
  try {
    process.stdin.setRawMode(false);
  } catch {
    /* 已恢复 */
  }
  write("\x1b[?25h"); // 光标显示
  process.stdin.pause();
}

if (!process.stdin.isTTY || process.env.CI) {
  // 非交互降级：每行发送；收到的帧由上方主 data 监听器整段渲染（打字机自动关闭）
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (line === "/exit" || line === "/quit") {
      socket.destroy();
      return;
    }
    socket.write(JSON.stringify({ text: line }) + "\n");
  });
} else {
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");

  const HELP_TEXT = [
    "",
    kleur.bold("OC chat 命令"),
    "  Enter    发送",
    "  ↑ / ↓    历史",
    "  Ctrl+C   跳过打字机",
    "  Ctrl+D   退出（空输入时）",
    "  /help    本帮助",
    "  /clear   清空会话上下文",
    "  /exit    退出",
    "",
  ].join("\n");

  function sendLine(text: string): void {
    if (!text.trim()) {
      redrawPrompt();
      return;
    }
    write(kleur.gray(" " + "─".repeat(8) + " " + new Date().toLocaleTimeString()) + "\n");
    const cmd = text.trim();
    if (cmd === "/help") {
      write(HELP_TEXT + "\n");
      redrawPrompt();
      return;
    }
    if (cmd === "/exit" || cmd === "/quit") {
      restoreTerminal();
      write("\n");
      process.exit(0);
    }
    socket.write(JSON.stringify({ text: cmd }) + "\n");
  }

  function eraseCurrentInput(): void {
    // 光标回到输入行首并清空该行
    write("\r\x1b[2K" + kleur.dim("›") + " ");
  }

  process.stdin.on("keypress", (_str: string | undefined, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
    if (!connected) return;

    if (key.name === "return" || key.name === "enter") {
      write("\n");
      const text = inputBuf;
      inputBuf = "";
      if (text.trim()) {
        history.push(text);
        if (history.length > 100) history.shift();
      }
      historyIdx = -1;
      sendLine(text);
      return;
    }

    if (key.name === "up") {
      if (historyIdx === -1) historyIdx = history.length - 1;
      else if (historyIdx > 0) historyIdx--;
      if (historyIdx >= 0) {
        eraseCurrentInput();
        inputBuf = history[historyIdx] ?? "";
        write(inputBuf);
      }
      return;
    }

    if (key.name === "down") {
      if (historyIdx === -1) return;
      historyIdx++;
      eraseCurrentInput();
      if (historyIdx >= history.length) {
        historyIdx = -1;
        inputBuf = "";
      } else {
        inputBuf = history[historyIdx] ?? "";
        write(inputBuf);
      }
      return;
    }

    if (key.ctrl && key.name === "c") {
      if (typewriterActive) {
        typewriterSkip = true;
      } else {
        write("\n" + kleur.gray("(Ctrl+C 跳过打字机；/exit 退出)") + "\n");
        redrawPrompt();
      }
      return;
    }

    if (key.ctrl && key.name === "d") {
      if (inputBuf === "") {
        restoreTerminal();
        write("\n");
        process.exit(0);
      }
      return;
    }

    if (key.name === "backspace") {
      if (inputBuf.length > 0) {
        inputBuf = inputBuf.slice(0, -1);
        write("\b \b");
      }
      return;
    }

    if (key.sequence && key.sequence.length === 1 && key.sequence >= " ") {
      inputBuf += key.sequence;
      write(key.sequence);
    }
  });
}

/**
 * 修改记录：
 *   2026-08-25 阶段 12：CLI 聊天 TUI（raw mode + 历史 + 打字机 + 斜杠命令）
 */

