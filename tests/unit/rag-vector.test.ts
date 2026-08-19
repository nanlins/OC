/**
 * rag-vector.test.ts —— memory-kb 向量检索测试（fix-plan：RAG embedding）
 *
 * 职责：可注入 embedder + cosine 相似度 + 阈值过滤；无 embedder 回退关键词。
 * 用确定性假 embedder（词袋哈希向量），不真调外部 embedding API。
 *
 * 修改记录：2026-08-14 创建（fix-plan：RAG embedding 回归）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, initTestDb, runMigrations, migration001 } from "../../src/db/index.js";
import "../../src/modules/index.js"; // 注册 memory-kb 迁移
import {
  indexDocument,
  searchKbVector,
  setEmbedder,
  tokenize,
  exportKbToDir,
  MIN_VECTOR_SCORE,
} from "../../src/modules/memory-kb.js";

/** 确定性词袋哈希 embedder：共享 token 的文本余弦相似度高（测试用，非真实语义向量） */
function fakeEmbed(text: string): number[] {
  const dim = 64;
  const v = new Array<number>(dim).fill(0);
  for (const tok of tokenize(text)) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
    v[h % dim] = (v[h % dim] ?? 0) + 1;
  }
  return v;
}

beforeEach(() => {
  runMigrations(initTestDb(), [migration001]);
});
afterEach(() => {
  setEmbedder(null);
  closeDb();
});

describe("memory-kb vector search", () => {
  it("indexDocument stores embeddings; searchKbVector retrieves by cosine", async () => {
    setEmbedder(async (t) => fakeEmbed(t));
    await indexDocument("kb", "退款政策", "如何申请退款：请在设置页提交退款申请，退款金额原路退回。", "refund.md");
    await indexDocument("kb", "考勤制度", "员工考勤：上下班打卡，迟到三次按旷工处理。", "attendance.md");
    const hits = await searchKbVector("kb", "怎么申请退款", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.title).toBe("退款政策");
    expect(hits[0]!.score).toBeGreaterThanOrEqual(MIN_VECTOR_SCORE);
    expect(hits[0]!.source).toBe("refund.md");
  });

  it("irrelevant query below threshold returns empty (refusal)", async () => {
    setEmbedder(async (t) => fakeEmbed(t));
    await indexDocument("kb", "退款政策", "如何申请退款：请在设置页提交退款申请。", "refund.md");
    // 完全不相干的查询（无共享 token）→ 余弦≈0 → 低于阈值 → 空
    const hits = await searchKbVector("kb", "quantum entanglement physics", 3);
    expect(hits).toEqual([]);
  });

  it("falls back to keyword search when no embedder configured", async () => {
    setEmbedder(null);
    indexDocumentSync("kb", "报销制度", "差旅报销：发票必填，报销审批链为直属上级到财务。", "expense.md");
    const hits = await searchKbVector("kb", "报销 发票", 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.title).toBe("报销制度");
  });
});

describe("memory-kb host/container sync (exportKbToDir)", () => {
  it("materializes KB docs as md files for container kb_search", () => {
    indexDocumentSync("kb", "退款政策", "如何申请退款：请在设置页提交退款申请。", "refund.md");
    const dir = mkdtempSync(join(tmpdir(), "oc-kbexport-"));
    try {
      const n = exportKbToDir("kb", dir);
      expect(n).toBe(1);
      const md = readdirSync(dir).find((f) => f.endsWith(".md"));
      expect(md).toBeDefined();
      const content = readFileSync(join(dir, md!), "utf8");
      expect(content).toContain("申请退款");
      expect(content).toContain("refund.md"); // source 溯源保留
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("empty KB returns 0 and does not wipe existing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-kbexport-"));
    try {
      writeFileSync(join(dir, "manual.md"), "user-managed file");
      const n = exportKbToDir("no-such-kb", dir);
      expect(n).toBe(0);
      expect(existsSync(join(dir, "manual.md"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// 同步写入辅助（无 embedder 场景，直接用 addDocument 等价路径）
import { addDocument } from "../../src/modules/memory-kb.js";
function indexDocumentSync(kb: string, title: string, text: string, source?: string): string {
  return addDocument(kb, title, text, source);
}
