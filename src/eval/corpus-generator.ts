/**
 * eval/corpus-generator.ts —— 确定性语料扩展（模板×实体改写，种子语料的受控放大）
 *
 * 职责：以改写模板（怎么/如何/请问 + 核心词）确定性扩展种子语料，保持期望不变；
 *       同种子同输出（测试可断言稳定）。
 * 关键导出：expandCorpus, loadSeedCorpus
 *
 * 修改记录：2026-08-13 创建（阶段 12）
 */
import seedRaw from "./corpus/seed-zh.json" with { type: "json" };
import type { EvalCase } from "./types.js";

interface SeedShape {
  domain: string;
  doc: string;
  cases: Array<Partial<EvalCase> & { id: string; question: string }>;
}

const PREFIXES = ["", "请问", "我想问", "麻烦说下"];

export function loadSeedCorpus(): EvalCase[] {
  const seed = seedRaw as SeedShape;
  return seed.cases.map((c) => ({
    id: c.id,
    domain: c.domain ?? seed.domain,
    question: c.question,
    expectedDoc: c.outOfDomain ? undefined : seed.doc,
    expectedAnswer: c.expectedAnswer,
    outOfDomain: c.outOfDomain ?? false,
  }));
}

/** 确定性扩展：每条非域外用例 ×4 前缀改写（id 加后缀 p0..p3） */
export function expandCorpus(seedCases: EvalCase[] = loadSeedCorpus()): EvalCase[] {
  const out: EvalCase[] = [];
  for (const c of seedCases) {
    out.push(c);
    if (c.outOfDomain) continue;
    PREFIXES.slice(1).forEach((p, i) => {
      out.push({ ...c, id: `${c.id}-p${i + 1}`, question: `${p}${c.question}` });
    });
  }
  return out;
}
