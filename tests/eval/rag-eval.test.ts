/**
 * rag-eval.test.ts —— memory-kb RAG 评估集（知识文档 03 §3.9：≥20 条测试问题 + 拒答场景）
 *
 * 职责：种子 KB（3 文档）+ 21 条（问题,期望标题）+ 3 条无答案拒答 + 失败 case 分析留档。
 * 失败 case 分析（2026-08-12 基线）：BM25-lite 无中文分词，口语同义改述（"怎么退钱"→退款）
 *   召回失败——属预期限制，后续接入分词器或 pgvector embedding 时回归本评估集验证提升。
 * 修改记录：
 *   2026-08-12 创建（阶段 6，ai-inspector P1-9 修复）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { closeDb, initTestDb, runMigrations } from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";
import { addDocument, searchKb } from "../../src/modules/memory-kb.js";
import "../../src/modules/index.js";

beforeEach(() => {
  runMigrations(initTestDb(), [migration001]);
  addDocument(
    "kb",
    "退款政策",
    "如何申请退款：请在设置页提交退款申请。退款金额原路退回。退款流程需要三个工作日。",
    "docs/refund.md",
  );
  addDocument(
    "kb",
    "考勤制度",
    "员工考勤：上下班打卡时间。迟到三次按旷工一天处理。请假需提前一天申请。",
    "docs/attendance.md",
  );
  addDocument(
    "kb",
    "报销制度",
    "差旅报销：发票必填。报销审批链为直属上级到财务。报销上限按职级划分。",
    "docs/expense.md",
  );
});

afterEach(() => closeDb());

const CASES: Array<[string, string]> = [
  ["退款 申请", "退款政策"],
  ["如何 退款", "退款政策"],
  ["退款 流程", "退款政策"],
  ["退款 金额", "退款政策"],
  ["退款 工作日", "退款政策"],
  ["设置页 退款", "退款政策"],
  ["原路 退回", "退款政策"],
  ["考勤 打卡", "考勤制度"],
  ["迟到 旷工", "考勤制度"],
  ["请假 申请", "考勤制度"],
  ["上下班 打卡", "考勤制度"],
  ["迟到 三次", "考勤制度"],
  ["旷工 一天", "考勤制度"],
  ["报销 发票", "报销制度"],
  ["差旅 报销", "报销制度"],
  ["报销 审批", "报销制度"],
  ["报销 上限", "报销制度"],
  ["职级 报销", "报销制度"],
  ["财务 报销", "报销制度"],
  ["员工 考勤", "考勤制度"],
  ["申请 退款 提交", "退款政策"],
];

describe("RAG eval (21 questions + refusal + known-limit)", () => {
  it.each(CASES)("hit: %s -> %s", (q, expected) => {
    const hits = searchKb("kb", q, 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.title).toBe(expected);
    expect(hits[0]!.source).toBeTruthy(); // 引用溯源可回链
  });

  it("refuses out-of-domain questions (empty result)", () => {
    expect(searchKb("kb", "今天天气怎么样")).toEqual([]);
    expect(searchKb("kb", "量子计算原理")).toEqual([]);
    expect(searchKb("kb", "xyzzy plugh")).toEqual([]);
  });

  it("known-limit: colloquial synonym rephrase misses (documented failure case)", () => {
    // 失败 case 留档：无分词/无 embedding 的预期限制；接入 pgvector 后应转绿
    expect(searchKb("kb", "怎么退钱")).toEqual([]);
  });
});
