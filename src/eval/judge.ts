/**
 * eval/judge.ts —— LLM-as-Judge 接口 + 确定性 MockJudge
 *
 * 职责：Judge 接口（rubric 判分）；MockJudge 以关键词重叠确定性判分（测试/离线）；
 *       LlmJudge 经注入的 complete fn 调模型（rubric prompt 内置，测试不真调）。
 * 关键导出：Judge, MockJudge, LlmJudge, JUDGE_RUBRIC
 * 借鉴：知识文档 03 §3.9（LLM-as-Judge）/04 §4.11
 *
 * 修改记录：2026-08-13 创建（阶段 12）；同日阶段 14 LlmJudge 补拒答分支 + 答案分隔隔离（P1-1 修复）
 */
import type { EvalCase, JudgeResult } from "./types.js";

export interface Judge {
  judge(c: EvalCase, answer: string): Promise<JudgeResult>;
}

export const JUDGE_RUBRIC = `你是评估员。按以下 rubric 对答案打 0..1 分：
- 1.0 完全覆盖期望要点且无编造；
- 0.5 覆盖部分要点或含无关内容；
- 0.0 未覆盖或编造。
只输出 JSON：{"score": number, "reason": string}`;

/** 域外拒答 rubric（阶段 14 ai-inspector P1-1 修复：LlmJudge 补拒答分支） */
export const JUDGE_REFUSAL_RUBRIC = `你是评估员。该问题超出知识范围，正确行为是明确拒答且不编造。按以下 rubric 打 0..1 分：
- 1.0 答案明确表示无法回答/无相关资料，且未编造内容；
- 0.0 答案尝试作答或编造了内容。
判分与答案所用语言无关。
只输出 JSON：{"score": number, "reason": string}`;

import { tokenize } from "../modules/memory-kb.js";

function tokens(s: string): Set<string> {
  return new Set(tokenize(s));
}

/** 确定性判分：期望要点关键词覆盖率 */
export class MockJudge implements Judge {
  async judge(c: EvalCase, answer: string): Promise<JudgeResult> {
    if (c.outOfDomain) {
      // 多语拒答检测（阶段 14 P1-2 修复：zh/en/ja 常见拒答措辞）
      const empty =
        answer.trim().length === 0 || /无法|不知道|cannot|unable|できません|わかりません|回答でき/i.test(answer);
      return {
        caseId: c.id,
        score: empty ? 1 : 0,
        passed: empty,
        reason: empty ? "refused correctly" : "should refuse",
      };
    }
    const expected = tokens(c.expectedAnswer ?? "");
    const got = tokens(answer);
    if (expected.size === 0) return { caseId: c.id, score: 1, passed: true, reason: "no expectation" };
    let hit = 0;
    for (const t of expected) if (got.has(t)) hit += 1;
    const score = hit / expected.size;
    return { caseId: c.id, score, passed: score >= 0.5, reason: `coverage ${hit}/${expected.size}` };
  }
}

/** LLM 判分：complete fn 注入（生产注入真实 provider，测试注入 mock） */
export class LlmJudge implements Judge {
  constructor(private complete: (prompt: string) => Promise<string>) {}

  async judge(c: EvalCase, answer: string): Promise<JudgeResult> {
    // 域外用例走拒答 rubric（P1-1 修复）；答案用分隔符隔离（外部内容不混入指令，docs/02）
    const rubric = c.outOfDomain ? JUDGE_REFUSAL_RUBRIC : JUDGE_RUBRIC;
    const expected = c.outOfDomain ? "（应明确拒答）" : (c.expectedAnswer ?? "");
    const prompt = `${rubric}\n期望要点：${expected}\n答案：<answer>\n${answer}\n</answer>`;
    try {
      const raw = await this.complete(prompt);
      const parsed = JSON.parse(raw.replace(/```json|```/g, "")) as { score?: number; reason?: string };
      const score = Math.max(0, Math.min(1, Number(parsed.score ?? 0)));
      return { caseId: c.id, score, passed: score >= 0.5, reason: parsed.reason ?? "" };
    } catch {
      return { caseId: c.id, score: 0, passed: false, reason: "judge parse failure" };
    }
  }
}
