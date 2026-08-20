/**
 * kb-search.test.ts —— kb_search 工具回归（fix-plan：kb_search 接入 agent）
 *
 * 修改记录：2026-08-14 创建
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearToolsForTest, getTool, type ToolContext } from "./registry.ts";
import { registerKbSearchTool, tokenizeKb, chunkKbText } from "./kb-search.ts";

const ctx: ToolContext = { routing: { platformId: null, channelType: null, threadId: null }, assistantName: null };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-kb-"));
  process.env.OPENCLAW_KB_DIR = dir;
  clearToolsForTest();
  registerKbSearchTool();
});
afterEach(() => {
  delete process.env.OPENCLAW_KB_DIR;
  rmSync(dir, { recursive: true, force: true });
  clearToolsForTest();
});

describe("kb_search tool", () => {
  it("retrieves relevant chunk with source citation", async () => {
    writeFileSync(join(dir, "refund.md"), "如何申请退款：请在设置页提交退款申请。退款金额原路退回。");
    const tool = getTool("kb_search")!;
    const out = (await tool.handler({ query: "如何申请退款" }, ctx)) as {
      hits: Array<{ title: string; source: string; score: number }>;
    };
    expect(out.hits.length).toBeGreaterThan(0);
    expect(out.hits[0]!.title).toBe("refund");
    expect(out.hits[0]!.source).toBe("refund.md");
  });

  it("irrelevant query returns empty hits (refusal signal)", async () => {
    writeFileSync(join(dir, "refund.md"), "如何申请退款：请在设置页提交退款申请。");
    const tool = getTool("kb_search")!;
    const out = (await tool.handler({ query: "quantum physics entanglement" }, ctx)) as { hits: unknown[] };
    expect(out.hits).toEqual([]);
  });

  it("missing kb dir returns empty hits + note", async () => {
    process.env.OPENCLAW_KB_DIR = join(dir, "nonexistent");
    const tool = getTool("kb_search")!;
    const out = (await tool.handler({ query: "x" }, ctx)) as { hits: unknown[]; note?: string };
    expect(out.hits).toEqual([]);
    expect(out.note).toContain("not found");
  });

  it("tokenizeKb bigrams CJK and keeps latin words", () => {
    expect(tokenizeKb("申请退款")).toContain("申请");
    expect(tokenizeKb("hello world")).toEqual(["hello", "world"]);
  });

  it("chunkKbText respects size with overlap", () => {
    const chunks = chunkKbText("段落一。\n\n段落二。\n\n段落三。", 12, 3);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
