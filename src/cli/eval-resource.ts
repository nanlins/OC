/**
 * cli/eval-resource.ts —— eval 命令（run/report）
 *
 * 职责：oc eval run --kb <name>：语料扩展 → memory-kb 检索 → MockJudge 判分 → 报告落盘；
 *       oc eval report：最近报告路径列表。host scope。
 * 关键导出：registerEvalResource
 * 借鉴：知识文档 03 §3.9 评估流程
 *
 * 修改记录：2026-08-13 创建（阶段 12）
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerCommand } from "./registry.js";
import { expandCorpus } from "../eval/corpus-generator.js";
import { runRagEval, writeReport } from "../eval/runner.js";
import { MockJudge } from "../eval/judge.js";
import { searchKb } from "../modules/memory-kb.js";
import { DATA_DIR } from "../config.js";

export function registerEvalResource(): void {
  registerCommand({
    resource: "eval",
    verb: "run",
    scope: "host",
    handler: async (args) => {
      const kb = args.flags.kb ?? "kb";
      const cases = expandCorpus();
      const report = await runRagEval({
        cases,
        search: (q, k) => searchKb(kb, q, k).map((h) => ({ title: h.title, content: h.content })),
        answer: (q, hits) => (hits.length === 0 ? "根据现有资料无法回答" : hits.map((h) => h.content).join("\n")),
        judge: new MockJudge(),
      });
      const path = writeReport(report);
      return {
        reportPath: path,
        summary: { retrieval: report.retrieval, judge: report.judge, refusal: report.refusal },
      };
    },
  });
  registerCommand({
    resource: "eval",
    verb: "report",
    scope: "host",
    handler: async () => {
      const dir = join(DATA_DIR, "eval");
      try {
        const files = readdirSync(dir)
          .filter((f) => f.startsWith("report-"))
          .sort()
          .reverse();
        return files
          .slice(0, 10)
          .map((f) => ({ path: join(dir, f), report: JSON.parse(readFileSync(join(dir, f), "utf8")) }));
      } catch {
        return [];
      }
    },
  });
}
