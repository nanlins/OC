/**
 * kb-search.test.ts ?”â€?kb_search å·¥å…·?å?ï¼ˆfix-planï¼škb_search ?¥å…¥ agentï¼? *
 * ä¿®æ”¹è®°å?ï¼?026-08-14 ?›å»º
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
  process.env.OC_KB_DIR = dir;
  clearToolsForTest();
  registerKbSearchTool();
});
afterEach(() => {
  delete process.env.OC_KB_DIR;
  rmSync(dir, { recursive: true, force: true });
  clearToolsForTest();
});

describe("kb_search tool", () => {
  it("retrieves relevant chunk with source citation", async () => {
    writeFileSync(join(dir, "refund.md"), "å¦‚ä??³è¯·?€æ¬¾ï?è¯·åœ¨è®¾ç½®é¡µæ?äº¤é€€æ¬¾ç”³è¯·ã€‚é€€æ¬¾é?é¢å?è·¯é€€?ã€?);
    const tool = getTool("kb_search")!;
    const out = (await tool.handler({ query: "å¦‚ä??³è¯·?€æ¬? }, ctx)) as {
      hits: Array<{ title: string; source: string; score: number }>;
    };
    expect(out.hits.length).toBeGreaterThan(0);
    expect(out.hits[0]!.title).toBe("refund");
    expect(out.hits[0]!.source).toBe("refund.md");
  });

  it("irrelevant query returns empty hits (refusal signal)", async () => {
    writeFileSync(join(dir, "refund.md"), "å¦‚ä??³è¯·?€æ¬¾ï?è¯·åœ¨è®¾ç½®é¡µæ?äº¤é€€æ¬¾ç”³è¯·ã€?);
    const tool = getTool("kb_search")!;
    const out = (await tool.handler({ query: "quantum physics entanglement" }, ctx)) as { hits: unknown[] };
    expect(out.hits).toEqual([]);
  });

  it("missing kb dir returns empty hits + note", async () => {
    process.env.OC_KB_DIR = join(dir, "nonexistent");
    const tool = getTool("kb_search")!;
    const out = (await tool.handler({ query: "x" }, ctx)) as { hits: unknown[]; note?: string };
    expect(out.hits).toEqual([]);
    expect(out.note).toContain("not found");
  });

  it("tokenizeKb bigrams CJK and keeps latin words", () => {
    expect(tokenizeKb("?³è¯·?€æ¬?)).toContain("?³è¯·");
    expect(tokenizeKb("hello world")).toEqual(["hello", "world"]);
  });

  it("chunkKbText respects size with overlap", () => {
    const chunks = chunkKbText("æ®µè½ä¸€?‚\n\næ®µè½äºŒã€‚\n\næ®µè½ä¸‰ã€?, 12, 3);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
