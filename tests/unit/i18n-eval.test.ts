/**
 * i18n-eval.test.ts —— i18n 与评估/RAG 交集回归（阶段 14 ai-inspector P1-2/P1-1 修复）
 *
 * 职责：tokenize 日文假名分词；MockJudge 多语拒答检测；LlmJudge 域外拒答分支。
 *
 * 修改记录：2026-08-13 创建（阶段 14）
 */
import { describe, expect, it } from "vitest";
import { tokenize } from "../../src/modules/memory-kb.js";
import { MockJudge, LlmJudge, JUDGE_REFUSAL_RUBRIC } from "../../src/eval/judge.js";
import type { EvalCase } from "../../src/eval/types.js";

const ood = (id: string): EvalCase => ({ id, domain: "x", question: "q", outOfDomain: true });

describe("tokenize 日文假名（P1-2 修复）", () => {
  it("假名不再被丢弃（bigram 化）", () => {
    const toks = tokenize("返金はどうすればいいですか");
    expect(toks.length).toBeGreaterThan(1);
    expect(toks).toContain("返金");
    expect(toks.some((t) => t.includes("どう"))).toBe(true);
  });
  it("中文/英文分词不受影响", () => {
    expect(tokenize("如何申请退款")).toContain("申请");
    expect(tokenize("hello world")).toEqual(["hello", "world"]);
  });
});

describe("MockJudge 多语拒答检测（P1-2 修复）", () => {
  const judge = new MockJudge();
  it.each([
    "根据现有资料无法回答",
    "Cannot answer based on available sources",
    "I'm unable to find relevant information",
    "申し訳ありませんが、回答できません",
    "わかりません",
  ])("判定为拒答：%s", async (ans) => {
    const r = await judge.judge(ood("c"), ans);
    expect(r.passed).toBe(true);
  });
  it("尝试作答不算拒答", async () => {
    const r = await judge.judge(ood("c"), "退款流程是三个工作日");
    expect(r.passed).toBe(false);
  });
});

describe("LlmJudge 域外拒答分支（P1-1 修复）", () => {
  it("outOfDomain 用例使用拒答 rubric 且隔离答案", async () => {
    let seenPrompt = "";
    const judge = new LlmJudge(async (p) => {
      seenPrompt = p;
      return '{"score": 1, "reason": "refused"}';
    });
    const r = await judge.judge(ood("c"), "无法回答");
    expect(r.passed).toBe(true);
    expect(seenPrompt).toContain(JUDGE_REFUSAL_RUBRIC);
    expect(seenPrompt).toContain("<answer>"); // 外部内容分隔隔离
  });
  it("正常用例仍用要点 rubric", async () => {
    let seenPrompt = "";
    const judge = new LlmJudge(async (p) => {
      seenPrompt = p;
      return '{"score": 0.8, "reason": "ok"}';
    });
    const c: EvalCase = { id: "n", domain: "d", question: "q", expectedAnswer: "要点" };
    await judge.judge(c, "答案");
    expect(seenPrompt).not.toContain(JUDGE_REFUSAL_RUBRIC);
    expect(seenPrompt).toContain("要点");
  });
});
