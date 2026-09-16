/**
 * eval.test.ts —— 评估体系测试（指标/判分/runner/语料确定性/trace/CLI eval）
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 12）
 *   2026-09-16 补 recallAtK 语义测试：多相关文档下与 hitRate 区分、单文档下数学退化、hits 去重、
 *              域外用例不计入；补语料按 domain 标注的回归测试；runner 断言随标注修复收紧到 hitRate=1
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { closeDb, initTestDb, runMigrations } from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";
import { computeRetrievalMetrics } from "../../src/eval/retrieval-metrics.js";
import { MockJudge, LlmJudge } from "../../src/eval/judge.js";
import { runRagEval } from "../../src/eval/runner.js";
import { expandCorpus, loadSeedCorpus } from "../../src/eval/corpus-generator.js";
import { recordTrace, readTrace } from "../../src/eval/trace.js";
import { addDocument, searchKb } from "../../src/modules/memory-kb.js";
import { dispatch } from "../../src/cli/dispatch.js";
import { registerAllResources } from "../../src/cli/resources.js";

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

describe("retrieval metrics", () => {
  it("computes hitRate/mrr", () => {
    const cases = [
      { id: "a", domain: "d", question: "q1", expectedDoc: "退款政策" },
      { id: "b", domain: "d", question: "q2", expectedDoc: "报销制度" },
    ];
    const m = computeRetrievalMetrics(
      cases,
      [
        { caseId: "a", hits: ["退款政策", "考勤制度"] },
        { caseId: "b", hits: ["考勤制度"] },
      ],
      3,
    );
    expect(m.hitRate).toBe(0.5);
    expect(m.mrr).toBeCloseTo((1 + 0) / 2);
  });

  it("多相关文档标注下 recallAtK 与 hitRate 区分", () => {
    // m1 相关文档 {退款政策, 考勤制度}，top-3 只捞回退款政策 → hitRate 记 1（至少命中一个），recall 记 1/2
    // m2 相关文档 {报销制度}，top-3 未命中 → 两者都记 0
    const cases = [
      { id: "m1", domain: "d", question: "q1", expectedDocs: ["退款政策", "考勤制度"] },
      { id: "m2", domain: "d", question: "q2", expectedDocs: ["报销制度"] },
    ];
    const m = computeRetrievalMetrics(
      cases,
      [
        { caseId: "m1", hits: ["退款政策", "报销制度"] },
        { caseId: "m2", hits: ["考勤制度"] },
      ],
      3,
    );
    expect(m.hitRate).toBe(0.5); // (1 + 0) / 2
    expect(m.recallAtK).toBe(0.25); // (1/2 + 0/1) / 2
    expect(m.mrr).toBe(0.5); // (1/1 + 0) / 2
    expect(m.recallAtK).not.toBe(m.hitRate);
  });

  it("单相关文档标注时 recallAtK 退化为 hitRate（数学等价，非缺陷）", () => {
    const cases = [
      { id: "s1", domain: "d", question: "q1", expectedDoc: "退款政策" },
      { id: "s2", domain: "d", question: "q2", expectedDoc: "考勤制度" },
    ];
    const m = computeRetrievalMetrics(
      cases,
      [
        { caseId: "s1", hits: ["退款政策"] },
        { caseId: "s2", hits: ["报销制度"] },
      ],
      3,
    );
    expect(m.hitRate).toBe(0.5);
    expect(m.recallAtK).toBe(m.hitRate);
  });

  it("hits 去重后再算交集，重复返回同一文档不虚增召回", () => {
    const cases = [{ id: "d1", domain: "d", question: "q", expectedDocs: ["退款政策", "考勤制度"] }];
    const m = computeRetrievalMetrics(cases, [{ caseId: "d1", hits: ["退款政策", "退款政策", "退款政策"] }], 3);
    expect(m.recallAtK).toBe(0.5); // 只捞回 1/2，不是 3/2
    expect(m.hitRate).toBe(1);
  });

  it("域外用例不参与检索指标（考核拒答而非召回）", () => {
    const cases = [
      { id: "o1", domain: "d", question: "q", expectedDocs: ["退款政策"], outOfDomain: true },
      { id: "o2", domain: "d", question: "q", expectedDoc: "考勤制度" },
    ];
    const m = computeRetrievalMetrics(cases, [{ caseId: "o2", hits: ["考勤制度"] }], 3);
    expect(m.hitRate).toBe(1); // 分母只有 o2
    expect(m.recallAtK).toBe(1);
  });
});

describe("judges", () => {
  it("MockJudge coverage scoring", async () => {
    const j = new MockJudge();
    const r = await j.judge(
      { id: "x", domain: "d", question: "q", expectedAnswer: "退款 工作日" },
      "退款需要三个工作日",
    );
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
  });

  it("MockJudge refusal scoring", async () => {
    const j = new MockJudge();
    const ok = await j.judge({ id: "y", domain: "d", question: "天气", outOfDomain: true }, "根据现有资料无法回答");
    expect(ok.passed).toBe(true);
    const bad = await j.judge({ id: "z", domain: "d", question: "天气", outOfDomain: true }, "今天晴天");
    expect(bad.passed).toBe(false);
  });

  it("LlmJudge parses injected completion", async () => {
    const j = new LlmJudge(async () => '{"score": 0.5, "reason": "partial"}');
    const r = await j.judge({ id: "l", domain: "d", question: "q", expectedAnswer: "x" }, "ans");
    expect(r.score).toBe(0.5);
    expect(r.passed).toBe(true);
  });
});

describe("corpus generator", () => {
  it("deterministic expansion", () => {
    const a = expandCorpus();
    const b = expandCorpus();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(loadSeedCorpus().length);
  });

  it("按用例自身 domain 标注相关文档，不再整份继承顶层 doc", () => {
    const cases = loadSeedCorpus();
    expect(cases.find((c) => c.id === "rf-01")?.expectedDocs).toEqual(["退款政策"]);
    expect(cases.find((c) => c.id === "at-01")?.expectedDocs).toEqual(["考勤制度"]);
    expect(cases.find((c) => c.id === "ex-01")?.expectedDocs).toEqual(["报销制度"]);
  });

  it("跨领域用例携带多相关文档标注（让 recallAtK 可与 hitRate 区分）", () => {
    const cross = loadSeedCorpus().find((c) => c.id === "cr-01");
    expect(cross?.expectedDocs?.length).toBeGreaterThan(1);
  });

  it("域外用例不带相关文档标注", () => {
    const od = loadSeedCorpus().find((c) => c.id === "od-01");
    expect(od?.outOfDomain).toBe(true);
    expect(od?.expectedDocs).toBeUndefined();
  });

  it("扩展后的改写用例继承原用例的相关文档标注", () => {
    const expanded = expandCorpus();
    const base = expanded.find((c) => c.id === "at-01");
    const rewrite = expanded.find((c) => c.id === "at-01-p1");
    expect(rewrite?.expectedDocs).toEqual(base?.expectedDocs);
  });
});

describe("rag eval runner", () => {
  it("runs end-to-end with memory-kb search + MockJudge + refusal", async () => {
    const cases = expandCorpus();
    const report = await runRagEval({
      cases,
      search: (q, k) => searchKb("kb", q, k).map((h) => ({ title: h.title, content: h.content })),
      answer: (q, hits) => (hits.length === 0 ? "根据现有资料无法回答" : hits.map((h) => h.content).join("\n")),
      judge: new MockJudge(),
    });
    expect(report.corpusSize).toBe(cases.length);
    // 语料标注按 domain 解析后，检索器对这个 3 文档 KB 应全命中（修复前因标注错误只有 0.538）
    expect(report.retrieval.hitRate).toBe(1);
    expect(report.retrieval.mrr).toBeGreaterThan(0.9);
    expect(report.refusal.total).toBeGreaterThan(0);
    expect(report.refusal.correct).toBe(report.refusal.total); // 域外全拒答
    expect(report.failures).toEqual([]);
  });
});

describe("trace recorder", () => {
  it("records and reads JSONL traces", () => {
    const sid = `s-trace-${Math.random().toString(36).slice(2, 8)}`; // temp 目录跨运行持久，id 需唯一
    recordTrace({ sessionId: sid, kind: "inbound", detail: { a: 1 } });
    recordTrace({ sessionId: sid, kind: "delivery", detail: { b: 2 } });
    const events = readTrace(sid);
    expect(events.length).toBe(2);
    expect(events[0]!.kind).toBe("inbound");
    expect(events[1]!.kind).toBe("delivery");
    expect(events[0]!.ts).toBeTruthy();
  });
});

describe("cli eval command", () => {
  it("eval run produces report with retrieval + judge summary", async () => {
    registerAllResources();
    const out = await dispatch({ cmd: "eval run --kb kb" }, { actor: "host" });
    expect(out.ok).toBe(true);
    const data = out.data as { summary: { retrieval: { hitRate: number }; refusal: { total: number } } };
    expect(data.summary.retrieval.hitRate).toBeGreaterThan(0);
    expect(data.summary.refusal.total).toBeGreaterThan(0);
  });
});
