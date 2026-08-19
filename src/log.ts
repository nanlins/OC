/**
 * log.ts —— 结构化分级日志（零依赖叶子模块）
 *
 * 职责：debug/info/warn/error/fatal 五级；warn+ 走 stderr；err 字段特判展开 stack。
 * 关键导出：log
 * 承重不变量：本模块不得 import 任何项目内模块（防循环依赖）。
 * 借鉴：nanoclaw src/log.ts（claw开源项目源码/src/log.ts）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 1，提前于阶段 2 因迁移运行器需要）
 */

type Level = "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

function threshold(): number {
  const env = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return LEVEL_ORDER[env] ?? LEVEL_ORDER.info;
}

function stamp(): string {
  return new Date().toISOString();
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < threshold()) return;
  const line: Record<string, unknown> = { ts: stamp(), level, msg, ...fields };
  if (fields?.err instanceof Error) {
    line.err = { message: fields.err.message, stack: fields.err.stack };
  }
  const text = JSON.stringify(line);
  if (LEVEL_ORDER[level] >= LEVEL_ORDER.warn) {
    process.stderr.write(text + "\n");
  } else {
    process.stdout.write(text + "\n");
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
  fatal: (msg: string, fields?: Record<string, unknown>) => emit("fatal", msg, fields),
};
