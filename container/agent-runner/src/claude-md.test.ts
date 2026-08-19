/**
 * claude-md.test.ts —— CLAUDE.md 加载与注入测试（fix-plan P0）
 *
 * 修改记录：2026-08-14 创建（fix-plan P0：Agent 加载 CLAUDE.md 回归）
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadClaudeMd, renderClaudeMdSection, CLAUDE_MD_MAX_CHARS } from "./claude-md.ts";

let ws: string;
beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "oc-claudemd-"));
  mkdirSync(join(ws, "agent"), { recursive: true });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

describe("loadClaudeMd", () => {
  it("reads agent/CLAUDE.md from workspace", () => {
    writeFileSync(join(ws, "agent", "CLAUDE.md"), "You are a helpful agent.\nBe concise.");
    expect(loadClaudeMd(ws)).toContain("You are a helpful agent.");
  });
  it("returns empty when missing", () => {
    expect(loadClaudeMd(ws)).toBe("");
  });
  it("caps oversized CLAUDE.md with truncation marker", () => {
    writeFileSync(join(ws, "agent", "CLAUDE.md"), "x".repeat(CLAUDE_MD_MAX_CHARS + 100));
    const out = loadClaudeMd(ws);
    expect(out.length).toBeLessThanOrEqual(CLAUDE_MD_MAX_CHARS + 60);
    expect(out).toContain("truncated by budget");
  });
});

describe("renderClaudeMdSection", () => {
  it("wraps content under Group Instructions header", () => {
    const s = renderClaudeMdSection("persona text");
    expect(s).toContain("# Group Instructions");
    expect(s).toContain("persona text");
  });
  it("empty content renders empty (not injected)", () => {
    expect(renderClaudeMdSection("")).toBe("");
  });
});
