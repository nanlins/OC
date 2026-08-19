/**
 * circuit-breaker.test.ts —— 启动退避熔断器单元测试
 *
 * 职责：退避表/1 小时窗口/干净关闭重置。
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKOFF_SCHEDULE_SEC, enforceStartupBackoff, resetCircuitBreaker } from "../../src/circuit-breaker.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-cb-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("circuit breaker", () => {
  it("first startup has no backoff", async () => {
    let slept = 0;
    await enforceStartupBackoff(dir, { nowMs: 1_000_000, sleep: async (ms) => void (slept = ms) });
    expect(slept).toBe(0);
  });

  it("consecutive crashes escalate along the schedule", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);
    let t = 1_000_000;
    for (let i = 0; i < 4; i++) {
      t += 1000; // 同一窗口内连续崩溃
      await enforceStartupBackoff(dir, { nowMs: t, sleep });
    }
    // attempt 序列 0,1,2,3 → 退避 0,0,10s,30s；delay=0 不触发 sleep
    expect(sleeps).toEqual([BACKOFF_SCHEDULE_SEC[2] ?? 0, BACKOFF_SCHEDULE_SEC[3] ?? 0].map((s) => s * 1000));
  });

  it("1h healthy window resets the counter", async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => void sleeps.push(ms);
    await enforceStartupBackoff(dir, { nowMs: 1_000_000, sleep });
    await enforceStartupBackoff(dir, { nowMs: 1_001_000, sleep });
    await enforceStartupBackoff(dir, { nowMs: 1_001_000 + 3_600_001, sleep }); // 超窗口 → attempt 0
    expect(sleeps).toEqual([]);
  });

  it("resetCircuitBreaker removes state file", async () => {
    await enforceStartupBackoff(dir, { nowMs: 1 });
    expect(existsSync(join(dir, "circuit-breaker.json"))).toBe(true);
    resetCircuitBreaker(dir);
    expect(existsSync(join(dir, "circuit-breaker.json"))).toBe(false);
  });
});
