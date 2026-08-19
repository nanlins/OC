/**
 * setup/status.ts —— 三级输出契约之 L2 状态块
 *
 * 职责：emitStatus 打印 `=== OPENCLAW SETUP: TYPE ===` KEY: value `=== END ===` 块，
 *       供 runner 解析；步骤与编排器之间无内存共享（可单独重跑）。
 * 关键导出：emitStatus, STATUS_BEGIN, STATUS_END
 * 借鉴：nanoclaw setup/status.ts + docs/setup-flow.md 三级输出契约
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 8）
 */
export const STATUS_BEGIN = (type: string) => `=== OPENCLAW SETUP: ${type} ===`;
export const STATUS_END = "=== END ===";

export function emitStatus(type: string, kv: Record<string, string | number | boolean>): void {
  const lines = [STATUS_BEGIN(type)];
  for (const [k, v] of Object.entries(kv)) lines.push(`${k}: ${String(v)}`);
  lines.push(STATUS_END);
  process.stdout.write(lines.join("\n") + "\n");
}
