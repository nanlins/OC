/**
 * scripts/chat.ts —— OC 聊天 TUI 客户端
 *
 * 职责：连接 CLI chat socket，终端交互：状态栏 + 消息流（打字机渲染） + 工具块 + 输入历史 + 斜杠命令。
 * 关键导出：无（CLI 脚本）
 * 用法：pnpm chat；/help 看命令；Ctrl+C 跳过打字机；Ctrl+D 退出。
 * 承重不变量：
 *   - 打字机只消费 stripMarkdown 纯文本（绝不切片 ANSI，防转义序列乱码——阶段 12 实测修复）；
 *   - end 帧是唯一重绘输入行的时机（防 prompt 重复叠加）；
 *   - 打字机期间忽略普通输入（仅 Ctrl+C 跳过），防消息与输入行互相穿插；
 *   - 退出时恢复终端（raw mode off + 光标显示）。
 * 借鉴：opencode TUI 布局（状态栏/消息流/输入行）+ aichat REPL 命令集；渲染逻辑复用 channels/cli-render.ts。
 *
 * 修改记录：
 *   2026-08-24 创建（演示版：逐行 JSON 打印）
 *   2026-08-25 阶段 12 重写：TUI 交互（raw mode + 历史 + 打字机 + meta/tool/end 帧）
 *   2026-08-25 阶段 12 实测修复：打字机切 ANSI 乱码 → 纯文本块；prompt 重复 → end 唯一重绘；
 *             用户消息回显；打字机期间禁输入；meta 灰色行；状态栏不再依赖 meta
 */
import { connect } from "node:net";
import { createHash } from "node:crypto";
import { join } from "node:path";
import kleur from "kleur";
import {
  renderChat,
  renderError,
  renderFrame,
  stripMarkdown,
  AGENT_PREFIX,
  type CliFrame,
} from "../src/channels/cli-render.js";
import { DATA_DIR } from "../src/config.js";

const INSTALL_SLUG = createHash("sha1").update(process.cwd()).digest("hex").slice(0, 8);
const CHAT_PATH =
  process.platform === "win32" ? `\\\\.\\pipe\\oc-chat-${INSTALL_SLUG}` : join(DATA_DIR, "cli-chat.sock");

const out = process.stdout;
const write = (s: string) => out.write(s);
const interactive = process.stdin.isTTY === true && !process.env.CI;

// ---- 终端状态 ----
let connected = false;

// ---- 输入状态 ----
let inputBuf = "";
const history: string[] = [];
let historyIdx = -1;
let typewriterActive = false;
let typewriterSkip = false;

// ---- 渲染 ----
function redrawPrompt(): void {
  if (!interactive) return;
  write("\n" + kleur.dim("›") + " " + inputBuf);
}

function renderStatusBar(): void {
  write(kleur.inverse(" OC chat · " + (connected ? "就绪（输入 /help 看命令）" : "连接中…") + " ") + "\n");
}

/** 清掉当前输入行（光标回行首 + 擦除整行），供发送/消息插入前调用 */
function clearInputLine(): void {
  write("\r\x1b[2K");
}

/**
 * 打字机：消费 stripMarkdown 纯文本，按 4 字符块输出（绝不切片 ANSI）。
 * 行首打印一次 agent 前缀；Ctrl+C 跳过剩余；非交互环境整段直出。
 * onDone 在打字机结束（含跳过）时回调，由帧队列驱动下一条消息。
 */
function typewriterPrint(rawText: string, onDone: () => void): void {
  const text = stripMarkdown(rawText);
  if (!interactive) {
    write(renderChat(text) + "\n");
    onDone();
    return;
  }
  typewriterActive = true;
  typewriterSkip = false;
  const CHUNK = 4;
  let pos = 0;
  const step = () => {
    if (typewriterSkip) {
      // 跳过：整段直出（此时屏幕上可能已有部分块——先补全剩余，不做清行重绘，保证无乱码）
      write(text.slice(pos));
      write("\n");
      typewriterActive = false;
      onDone();
      return;
    }
    if (pos >= text.length) {
      write("\n");
      typewriterActive = false;
      onDone();
      return;
    }
    // 行首补 agent 前缀
    if (pos === 0 || text[pos - 1] === "\n") {
      write(AGENT_PREFIX + " ");
    }
    const chunk = text.slice(pos, pos + CHUNK);
    write(chunk);
    pos += CHUNK;
    setTimeout(step, 7);
  };
  step();
}

/**
 * 帧渲染队列（阶段 12 实测修复核心）：
 * 服务端是"广播所有会话投递"的通道，多条消息的帧可能同时到达。
 * 若来一帧打一帧，打字机消息会被另一条消息的 meta/chat 穿插成碎片。
 * 方案：全部帧进 FIFO 队列，打字机完成（当前消息 end 帧处理完）后才取下一条 →
 * 多条消息顺序显示、零穿插。
 */
const frameQueue: CliFrame[] = [];
let messageBusy = false; // 当前正在打字机渲染一条 chat 消息

function enqueueFrame(frame: CliFrame): void {
  frameQueue.push(frame);
  drainQueue();
}

function drainQueue(): void {
  if (messageBusy || frameQueue.length === 0) return;
  const frame = frameQueue.shift()!;
  switch (frame.kind) {
    case "meta": {
      const agent = frame.agent ?? "?";
      const model = frame.model ?? "?";
      write(kleur.gray(` · 会话 ${agent.slice(0, 8)} · ${model}`) + "\n");
      drainQueue(); // meta 瞬时渲染，继续处理下一条
      break;
    }
    case "chat":
      messageBusy = true;
      typewriterPrint(frame.text, () => {
        messageBusy = false;
        drainQueue();
      });
      break;
    case "tool":
      write(renderFrame(frame).join("\n") + "\n");
      drainQueue();
      break;
    case "error":
      write(renderError(frame.text) + "\n");
      drainQueue();
      break;
    case "end":
      redrawPrompt(); // 一条消息渲染完毕：唯一重绘输入行的时机
      drainQueue();
      break;
  }
}

function handleFrame(frame: CliFrame): void {
  enqueueFrame(frame);
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
      enqueueFrame({ kind: "chat", text: line }); // 纯文本兜底（老主机）
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

// ---- 输入管线 ----
function sendUserMessage(text: string): void {
  if (!text.trim()) {
    redrawPrompt();
    return;
  }
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
  // 用户消息回显：清输入行 → 蓝色 you 前缀 → 时间线
  clearInputLine();
  write(kleur.blue(" you  ") + stripMarkdown(cmd) + "\n");
  write(kleur.gray(" " + "─".repeat(8) + " " + new Date().toLocaleTimeString()) + "\n");
  socket.write(JSON.stringify({ text: cmd }) + "\n");
}

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

if (!interactive) {
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

  process.stdin.on(
    "keypress",
    (_str: string | undefined, key: { name?: string; ctrl?: boolean; sequence?: string }) => {
      if (!connected) return;

      // 打字机期间：仅允许 Ctrl+C 跳过，其余按键忽略（防消息与输入穿插）
      if (typewriterActive) {
        if (key.ctrl && key.name === "c") {
          typewriterSkip = true;
        }
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        const text = inputBuf;
        inputBuf = "";
        historyIdx = -1;
        if (text.trim()) {
          history.push(text);
          if (history.length > 100) history.shift();
        }
        sendUserMessage(text);
        return;
      }

      if (key.name === "up") {
        if (historyIdx === -1) historyIdx = history.length - 1;
        else if (historyIdx > 0) historyIdx--;
        if (historyIdx >= 0) {
          clearInputLine();
          write(kleur.dim("›") + " ");
          inputBuf = history[historyIdx] ?? "";
          write(inputBuf);
        }
        return;
      }

      if (key.name === "down") {
        if (historyIdx === -1) return;
        historyIdx++;
        clearInputLine();
        write(kleur.dim("›") + " ");
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
        write("\n" + kleur.gray("(输入 /exit 退出)") + "\n");
        redrawPrompt();
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
    },
  );
}
