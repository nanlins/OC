/**
 * eval/corpus-generator.ts —— 确定性语料扩展（模板×实体改写，种子语料的受控放大）
 *
 * 职责：以改写模板（怎么/如何/请问 + 核心词）确定性扩展种子语料，保持期望不变；
 *       同种子同输出（测试可断言稳定）。
 * 关键导出：expandCorpus, loadSeedCorpus, resolveExpectedDocs
 * 承重不变量：相关文档标注按「用例自身 domain」解析，绝不整份语料继承顶层 doc——
 *   否则考勤/报销用例会被标注成期望命中「退款政策」，检索器答对了反而被记为未命中，
 *   hitRate 被系统性低估（修复前实测 0.538，修复后 ≈1.0）。
 *   解析优先级：用例自带 expectedDocs → 用例自带 expectedDoc → domainDocs[domain] → 顶层 doc。
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 12）
 *   2026-09-16 修复标注缺陷：新增 domainDocs 领域→相关文档映射，loadSeedCorpus 改为按用例
 *              domain 解析并输出 expectedDocs；此前所有非域外用例统一继承 seed.doc（"退款政策"）
 */
import seedRaw from "./corpus/seed-zh.json" with { type: "json" };
import type { EvalCase } from "./types.js";

interface SeedShape {
  domain: string;
  /** 兼容旧语料的回落值：domainDocs 未覆盖该领域时才用 */
  doc: string;
  /** 领域 → 相关文档标题集合。可声明多个，用于让 recallAtK 与 hitRate 真正区分 */
  domainDocs?: Record<string, string[]>;
  cases: Array<Partial<EvalCase> & { id: string; question: string }>;
}

const PREFIXES = ["", "请问", "我想问", "麻烦说下"];

/**
 * 解析一条用例的相关文档标注。域外用例返回 undefined（它考核拒答不考核召回）。
 * 导出供测试直接锁定优先级顺序。
 */
export function resolveExpectedDocs(
  c: Partial<EvalCase>,
  seed: Pick<SeedShape, "doc" | "domainDocs">,
  domain: string,
): string[] | undefined {
  if (c.outOfDomain) return undefined;
  if (c.expectedDocs && c.expectedDocs.length > 0) return c.expectedDocs;
  if (c.expectedDoc) return [c.expectedDoc];
  const byDomain = seed.domainDocs?.[domain];
  if (byDomain && byDomain.length > 0) return byDomain;
  return seed.doc ? [seed.doc] : undefined;
}

export function loadSeedCorpus(): EvalCase[] {
  const seed = seedRaw as SeedShape;
  return seed.cases.map((c) => {
    const domain = c.domain ?? seed.domain;
    return {
      id: c.id,
      domain,
      question: c.question,
      expectedDocs: resolveExpectedDocs(c, seed, domain),
      expectedAnswer: c.expectedAnswer,
      outOfDomain: c.outOfDomain ?? false,
    };
  });
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
