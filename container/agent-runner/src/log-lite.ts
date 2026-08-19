/**
 * log-lite.ts —— 容器侧极简日志（stdout 行，宿主经 stderr tail 收尸）
 *
 * 职责：单函数 log(msg, level)。零依赖叶子。
 * 关键导出：log
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）
 */
export function log(msg: string, level: "info" | "warn" | "error" = "info"): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg });
  if (level === "info") process.stdout.write(line + "\n");
  else process.stderr.write(line + "\n");
}
