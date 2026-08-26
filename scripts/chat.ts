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

/** 计算输入行（含 "› " 提示符）在终端折成几行 */
function inputLineCount(): number {
  const cols = process.stdout.columns || 80;
  const width = inputBuf.length + 2; // "› " 视觉宽度约 2
  return Math.max(1, Math.ceil(width / cols));
}

/** 清掉当前输入行（含折行）：上移到输入起始行，逐行擦除后回到行首 */
function clearInputLine(): void {
  const n = inputLineCount();
  if (n <= 1) {
    write("\r\x1b[2K");
    return;
  }
  write(`\x1b[${n - 1}A`); // 上移到输入第一行
  for (let i = 0; i < n; i++) {
    write("\x1b[2K");
    if (i < n - 1) write("\x1b[1B");
  }
  write("\r");
}

/**
 * 打字机：消费 stripMarkdown 纯文本，按 4 字符块输出（绝不切片 ANSI）。
 * 每个换行符后立即补 agent 前缀（块内换行同样处理），保证多段 Markdown 每行前缀正确。
 * Ctrl+C 跳过剩余；非交互环境整段直出；onDone 在结束（含跳过）时回调。
 */
function prefixNewlines(text: string, from: number): string {
  let out = "";
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    out += ch;
    if (ch === "\n" && i + 1 < text.length) out += AGENT_PREFIX + " ";
  }
  return out;
}

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
      // 跳过：剩余部分整段直出（含换行前缀，无乱码）
      write(prefixNewlines(text, pos));
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
    // 块开始处若为行首则补前缀
    if (pos === 0 || text[pos - 1] === "\n") {
      write(AGENT_PREFIX + " ");
    }
    // 输出 chunk；块内每个换行符后补前缀（阶段 12 实测修复：Markdown 多段每行前缀正确）
    let out = "";
    for (let i = 0; i < CHUNK && pos + i < text.length; i++) {
      const ch = text[pos + i]!;
      out += ch;
      if (ch === "\n" && pos + i + 1 < text.length) out += AGENT_PREFIX + " ";
    }
    write(out);
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

/**
 * 流式合并（阶段 12 二次修复）：poll-loop 对同一回复写多条 outbound（首增量 + 每 400ms edit + 最终 edit），
 * 全部带相同 inReplyTo。CLI 客户端以 inReplyTo 为键合并：同一消息链的帧只保留最新文本，
 * 500ms 无新帧后一次性渲染 → 只显示最终完整回复（中间 edit 不闪现）。
 */
const PENDING_FLUSH_MS = 500;
let pendingGroup: { key: string; meta: CliFrame | null; text: string } | null = null;
let pendingTimer: NodeJS.Timeout | null = null;

let pendingMeta: CliFrame | null = null;

function queueChatFrame(frame: CliFrame & { kind: "chat" }): void {
  const key = frame.inReplyTo ?? `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  // 同链更新：沿用已存的 meta；新链：消费暂存的 meta（若 key 匹配）
  let meta: CliFrame | null = null;
  if (pendingGroup && pendingGroup.key === key) {
    meta = pendingGroup.meta;
  } else if (pendingMeta && (pendingMeta.inReplyTo ?? null) === frame.inReplyTo) {
    meta = pendingMeta;
    pendingMeta = null;
  }
  pendingGroup = { key, meta, text: frame.text };
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(flushPendingGroup, PENDING_FLUSH_MS);
}

function queueMetaFrame(frame: CliFrame & { kind: "meta" }): void {
  const key = frame.inReplyTo ?? null;
  // meta 属于其后的 chat：同链 chat 未达则暂存，chat 到达时消费
  if (pendingGroup && pendingGroup.key === key) {
    pendingGroup.meta = frame;
    return;
  }
  pendingMeta = frame;
}

function flushPendingGroup(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  if (!pendingGroup) return;
  const { meta, text } = pendingGroup;
  pendingGroup = null;
  if (meta) enqueueFrame(meta);
  enqueueFrame({ kind: "chat", text });
}

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
  if (frame.kind === "chat") {
    queueChatFrame(frame);
    return;
  }
  if (frame.kind === "meta") {
    queueMetaFrame(frame);
    return;
  }
  if (frame.kind === "end") {
    // end 表示该消息链投递完毕；若 pending 同链未 flush，立即 flush（不等 500ms）
    if (pendingGroup) {
      const sameKey = frame.inReplyTo !== null && pendingGroup.key === frame.inReplyTo;
      if (sameKey) flushPendingGroup();
    }
    enqueueFrame(frame);
    return;
  }
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
      queueChatFrame({ kind: "chat", text: line }); // 纯文本兜底（老主机）
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
  // 用户消息回显：清输入行 → 蓝色 you 前缀 → 时间线（内容单行化，防粘贴换行/折行错乱）
  clearInputLine();
  const oneLine = stripMarkdown(cmd).replace(/\s+/g, " ");
  write(kleur.blue(" you  ") + oneLine + "\n");
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
