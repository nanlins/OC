/**
 * channels/cli-render.ts —— CLI TUI 渲染纯函数层（帧 → ANSI 文本）
 *
 * 职责：把主机投递帧渲染为终端文本；不碰 stdin/raw mode，可单测。
 * 关键导出：CliFrame, renderFrame, renderTool, renderError, PREFIX 常量
 * 承重不变量：渲染函数无副作用、不读环境；颜色标记用 kleur（测试环境自动禁用）。
 * 借鉴：opencode TUI 角色配色 / glamour 排版规则（自实现 ANSI 子集，不引第三方）
 *
 * 修改记录：2026-08-25 创建（阶段 12：CLI 聊天界面）
 */
import kleur from "kleur";
import { brand, accentGreen, dim } from "../theme.js";

export type CliFrame =
  | { kind: "chat"; text: string; operation?: string | null; inReplyTo?: string | null }
  | { kind: "meta"; agent?: string | null; model?: string | null; provider?: string | null; inReplyTo?: string | null }
  | { kind: "tool"; tool: string; status: "running" | "done" | "error"; elapsedMs?: number; args?: string | null }
  | { kind: "end"; inReplyTo?: string | null }
  | { kind: "error"; text: string };

export const USER_PREFIX = brand(" you  ");
export const AGENT_PREFIX = accentGreen(" agent");
/** Indent matching " agent" display width for message continuation alignment */
export const AGENT_INDENT = " ".repeat(6);
export const TOOL_PREFIX = kleur.yellow("  \u25b8  ");
export const SYSTEM_PREFIX = dim("  \u00b7  ");
export const ERROR_PREFIX = kleur.red("  !  ");

/** 工具状态符：运行中 spinner（调用方按 tick 轮换传入），完成 ✓，失败 ✗ */
export function toolStatusGlyph(status: "running" | "done" | "error", tick: number = 0): string {
  if (status === "done") return kleur.green("✓");
  if (status === "error") return kleur.red("✗");
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  return kleur.yellow(frames[tick % frames.length] ?? "·");
}

/** 简单 Markdown 子集：`code` → 反色，**bold** → 加粗；行首列表/引用保留缩进 */
export function renderMarkdownInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_m, c: string) => kleur.inverse(c))
    .replace(/\*\*([^*]+)\*\*/g, (_m, b: string) => kleur.bold(b));
}

/** 助手消息：首行 agent 前缀一次，后续段落等宽缩进对齐（opencode 风格；空行不缩进）。
 *  阶段 12 实测修复：此前每行重复 agent 前缀导致 "agent agent" 碎碎念。 */
export function renderChat(text: string): string {
  const lines = text.split(/\r?\n/);
  return lines
    .map((line, i) => {
      if (i === 0) return `${AGENT_PREFIX} ${renderMarkdownInline(line)}`;
      if (line === "") return "";
      return `${AGENT_INDENT}${renderMarkdownInline(line)}`;
    })
    .join("\n");
}

/**
 * 打字机安全纯文本：剥离 markdown 标记（`code`、**bold**、*italic*、# 标题、- 列表符号）。
 * 重要：打字机必须消费本函数输出——纯文本不含 ANSI，按字符切片绝不会切碎转义序列（阶段 12 修复乱码根因）。
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, "$1$2")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "· ")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*/g, "") // 未闭合粗体残留（如 "**知识管理"）
    .replace(/\*/g, ""); // 其余孤立星号（闭合对已处理，剩余均为装饰性残留）
}

/** 工具帧渲染：阶段 12 命令可视化——args 携带命令摘要（如 bash 命令），单行截断展示 */
export function renderTool(
  tool: string,
  status: "running" | "done" | "error",
  elapsedMs?: number,
  tick: number = 0,
  args?: string | null,
): string {
  const suffix = status !== "running" && elapsedMs !== undefined ? dim(`  ${(elapsedMs / 1000).toFixed(1)}s`) : "";
  const cmd = args ? kleur.cyan(`  $ ${args}`) : "";
  return `${TOOL_PREFIX}${toolStatusGlyph(status, tick)} ${dim(tool)}${suffix}${cmd}`;
}

export function renderError(text: string): string {
  return `${ERROR_PREFIX}${kleur.red(text)}`;
}

/** Frame -> terminal line array (end frame returns empty, caller controls prompt) */
export function renderFrame(frame: CliFrame, tick: number = 0): string[] {
  switch (frame.kind) {
    case "chat":
      return renderChat(frame.text).split("\n");
    case "tool":
      return [renderTool(frame.tool, frame.status, frame.elapsedMs, tick, frame.args)];
    case "error":
      return [renderError(frame.text)];
    case "meta":
      return [
        dim(
          ` \u2500\u2500 ${frame.agent ?? "agent"} \u00b7 ${frame.model ?? "?"} \u00b7 ${frame.provider ?? "?"} ` +
            "\u2500".repeat(Math.max(0, 40 - (frame.agent ?? "").length)),
        ),
      ];
    case "end":
      return [];
  }
}

/*
 * 修改记录：
 *   2026-08-25 阶段 12：CLI 聊天界面（meta/tool/end 帧协议 + TUI 渲染）
 *   2026-10-04 P0-1：硬编码 kleur 颜色替换为统一主题 API (src/theme.ts)
 */
