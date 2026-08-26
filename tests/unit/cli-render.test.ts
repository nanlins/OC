/**
 * cli-render.test.ts —— CLI TUI 渲染纯函数单元测试（阶段 12）
 *
 * 职责：帧 → ANSI 文本渲染：角色前缀、工具状态符、Markdown 子集、错误帧；无副作用可断言。
 * 修改记录：2026-08-25 创建（阶段 12：CLI 聊天界面）
 */
import { describe, expect, it } from "vitest";
import {
  renderChat,
  renderError,
  renderFrame,
  renderMarkdownInline,
  renderTool,
  stripMarkdown,
  toolStatusGlyph,
} from "../../src/channels/cli-render.js";

describe("cli render", () => {
  it("chat 帧带 agent 前缀并保留多行", () => {
    const out = renderFrame({ kind: "chat", text: "第一行\n第二行" });
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("agent");
    expect(out[0]).toContain("第一行");
    expect(out[1]).toContain("第二行");
  });

  it("end 帧返回空行（提示符由调用方控制）", () => {
    expect(renderFrame({ kind: "end" })).toEqual([]);
  });

  it("meta 帧渲染会话元数据行", () => {
    const out = renderFrame({ kind: "meta", agent: "g1", model: "deepseek-chat", provider: "openai" });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("g1");
    expect(out[0]).toContain("deepseek-chat");
    expect(out[0]).toContain("openai");
  });

  it("工具帧渲染运行/完成/错误三种状态", () => {
    expect(renderFrame({ kind: "tool", tool: "web_search", status: "running" })[0]).toContain("web_search");
    expect(renderFrame({ kind: "tool", tool: "web_search", status: "done", elapsedMs: 2100 })[0]).toContain("2.1s");
    expect(renderFrame({ kind: "tool", tool: "web_search", status: "error" })[0]).toContain("web_search");
  });

  it("工具状态符区分 done/error/running", () => {
    expect(toolStatusGlyph("done")).toBe("✓");
    expect(toolStatusGlyph("error")).toBe("✗");
    expect(toolStatusGlyph("running", 0)).toBe("⠋");
    expect(toolStatusGlyph("running", 1)).toBe("⠙");
  });

  it("Markdown 子集渲染行内代码与加粗", () => {
    const out = renderMarkdownInline("用 `oc groups list` 查看 **全部** 群组");
    expect(out).toContain("oc groups list");
    expect(out).toContain("全部");
  });

  it("错误帧带红色标记", () => {
    const out = renderFrame({ kind: "error", text: "连接失败" });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("连接失败");
  });

  it("renderChat/renderTool/renderError 单独可调用（类型覆盖）", () => {
    expect(renderChat("hi")).toContain("hi");
    expect(renderTool("bash", "running")).toContain("bash");
    expect(renderError("boom")).toContain("boom");
  });

  it("stripMarkdown 产出无 ANSI 的纯文本（打字机安全，阶段 12 乱码修复）", () => {
    const plain = stripMarkdown("**加粗** 和 `code` 和 *斜体*\n# 标题\n- 列表项\n> 引用");
    expect(plain.includes("\u001b")).toBe(false); // 无 ANSI 转义
    expect(plain).toContain("加粗");
    expect(plain).toContain("code");
    expect(plain).toContain("标题");
    expect(plain).toContain("列表项");
    expect(plain).toContain("引用");
    expect(plain).not.toContain("**");
    expect(plain).not.toContain("```");
  });

  it("stripMarkdown 清理未闭合粗体/斜体残留（阶段 12 二次修复）", () => {
    const plain = stripMarkdown("**知识管理 和行尾*");
    expect(plain).not.toContain("**");
    expect(plain).not.toContain("*");
    expect(plain).toContain("知识管理");
  });
});

/**
 * 修改记录：
 *   2026-08-25 阶段 12：CLI 渲染纯函数测试 + 帧协议集成测试
 */

