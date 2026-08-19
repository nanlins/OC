/**
 * circuit-breaker.ts —— 启动退避熔断器（防崩溃循环烧资源）
 *
 * 职责：连续崩溃时按时间表延迟启动；干净关闭重置。
 * 关键导出：enforceStartupBackoff, resetCircuitBreaker, recordStartupAttempt
 * 核心模式：文件持久化状态机 data/circuit-breaker.json {attempt, timestamp}；
 *           退避表 [0,0,10,30,120,300,900] 秒，6+ 次封顶 15min；1 小时窗口自动重置。
 *           运行在 initDb 之前（自建 DATA_DIR）。
 * 借鉴：nanoclaw src/circuit-breaker.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./log.js";

export const BACKOFF_SCHEDULE_SEC = [0, 0, 10, 30, 120, 300, 900];
const WINDOW_MS = 60 * 60 * 1000; // 1 小时无崩溃视为健康，重置计数

interface BreakerState {
  attempt: number;
  timestamp: number;
}

function statePath(dataDir: string): string {
  return join(dataDir, "circuit-breaker.json");
}

function readState(path: string): BreakerState | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as BreakerState;
    if (typeof parsed.attempt !== "number" || typeof parsed.timestamp !== "number") return null;
    return parsed;
  } catch {
    return null; // 损坏状态视为无（fail-open 于启动，但计数重来）
  }
}

/** 记录一次启动尝试；若处于崩溃循环则返回应退避的毫秒数（0 = 立即启动） */
export function recordStartupAttempt(dataDir: string, nowMs: number): number {
  mkdirSync(dataDir, { recursive: true });
  const path = statePath(dataDir);
  const prev = readState(path);
  const attempt = prev && nowMs - prev.timestamp < WINDOW_MS ? prev.attempt + 1 : 0;
  // P2 修复：原子写（tmp+rename），崩溃窗口不留半截 JSON
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ attempt, timestamp: nowMs }));
  renameSync(tmp, path);
  if (attempt === 0) return 0;
  const sec = BACKOFF_SCHEDULE_SEC[Math.min(attempt, BACKOFF_SCHEDULE_SEC.length - 1)] ?? 900;
  return sec * 1000;
}

/** 启动入口调用：计算退避并（可注入）睡眠 */
export async function enforceStartupBackoff(
  dataDir: string,
  opts?: { nowMs?: number; sleep?: (ms: number) => Promise<void> },
): Promise<void> {
  const nowMs = opts?.nowMs ?? Date.now();
  const delay = recordStartupAttempt(dataDir, nowMs);
  if (delay > 0) {
    log.warn(`circuit breaker: backing off ${delay / 1000}s before startup`);
    const sleep = opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    await sleep(delay);
  }
}

/** 干净关闭时调用：删除状态文件（SIGTERM 到达即非崩溃） */
export function resetCircuitBreaker(dataDir: string): void {
  try {
    rmSync(statePath(dataDir), { force: true });
  } catch (err) {
    log.warn("circuit breaker reset failed", { err });
  }
}
