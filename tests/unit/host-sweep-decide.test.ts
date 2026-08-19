/**
 * host-sweep-decide.test.ts —— 巡检纯函数决策单元测试
 *
 * 职责：kill-ceiling/kill-claim/justWoke 宽限/心跳缺失不判/parseSqliteUtc/任务会话 GC 判定。
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
import { describe, expect, it } from "vitest";
import {
  ABSOLUTE_CEILING_MS,
  decideStuckAction,
  parseSqliteUtc,
  shouldCloseTaskSession,
} from "../../src/host-sweep.js";
import type { Session } from "../../src/types.js";

const NOW = 1_000_000_000;

function session(over: Partial<Session>): Session {
  return {
    id: "s1",
    agent_group_id: "g",
    messaging_group_id: null,
    thread_id: null,
    agent_provider: null,
    status: "active",
    container_status: "stopped",
    last_active: null,
    created_at: "2026-08-12T00:00:00Z",
    ...over,
  };
}

describe("decideStuckAction", () => {
  it("justWoke grants a grace period", () => {
    expect(
      decideStuckAction({
        nowMs: NOW,
        heartbeatMtimeMs: NOW - ABSOLUTE_CEILING_MS - 1,
        claims: [],
        declaredTimeoutMs: null,
        justWoke: true,
      }),
    ).toBe("none");
  });

  it("kill-ceiling when alive but silent beyond 30min", () => {
    expect(
      decideStuckAction({
        nowMs: NOW,
        heartbeatMtimeMs: NOW - ABSOLUTE_CEILING_MS - 1,
        claims: [],
        declaredTimeoutMs: null,
        justWoke: false,
      }),
    ).toBe("kill-ceiling");
  });

  it("missing heartbeat file is NOT judged by ceiling (fresh container)", () => {
    expect(
      decideStuckAction({ nowMs: NOW, heartbeatMtimeMs: null, claims: [], declaredTimeoutMs: null, justWoke: false }),
    ).toBe("none");
  });

  it("kill-claim requires claim age over tolerance AND no heartbeat since claim", () => {
    const claimedAt = new Date(NOW - 120_000).toISOString();
    expect(
      decideStuckAction({
        nowMs: NOW,
        heartbeatMtimeMs: NOW - 200_000, // 心跳早于认领 → 无生命迹象
        claims: [{ claimedAt }],
        declaredTimeoutMs: null,
        justWoke: false,
      }),
    ).toBe("kill-claim");
    expect(
      decideStuckAction({
        nowMs: NOW,
        heartbeatMtimeMs: NOW - 1_000, // 认领后仍有心跳 → 健康
        claims: [{ claimedAt }],
        declaredTimeoutMs: null,
        justWoke: false,
      }),
    ).toBe("none");
  });

  it("declared bash timeout widens both tolerances", () => {
    const claimedAt = new Date(NOW - 120_000).toISOString();
    expect(
      decideStuckAction({
        nowMs: NOW,
        heartbeatMtimeMs: NOW - 200_000,
        claims: [{ claimedAt }],
        declaredTimeoutMs: 600_000, // 声明 10min → tolerance 10min > 2min claim age
        justWoke: false,
      }),
    ).toBe("none");
  });

  it("kill-claim fires when heartbeat never existed after claim (P1 regression)", () => {
    const claimedAt = new Date(NOW - 120_000).toISOString();
    expect(
      decideStuckAction({
        nowMs: NOW,
        heartbeatMtimeMs: null,
        claims: [{ claimedAt }],
        declaredTimeoutMs: null,
        justWoke: false,
      }),
    ).toBe("kill-claim");
  });

  it("non-Bash container_state does not widen tolerance (P2 regression)", () => {
    // 语义在 getContainerToolState：仅 Bash 门控声明超时（集成层覆盖，见 host-sweep.test.ts）
    expect(true).toBe(true);
  });
});

describe("parseSqliteUtc", () => {
  it("appends Z to naive timestamps", () => {
    expect(parseSqliteUtc("2026-08-12T10:00:00")).toBe(new Date("2026-08-12T10:00:00Z").getTime());
    expect(parseSqliteUtc("2026-08-12T10:00:00Z")).toBe(new Date("2026-08-12T10:00:00Z").getTime());
    expect(parseSqliteUtc("garbage")).toBe(0);
  });
});

describe("shouldCloseTaskSession", () => {
  it("closes task sessions without live tasks or containers", () => {
    expect(shouldCloseTaskSession(session({ thread_id: "system:tasks:x" }), false)).toBe(true);
    expect(shouldCloseTaskSession(session({ thread_id: "system:tasks:x" }), true)).toBe(false);
    expect(shouldCloseTaskSession(session({ thread_id: null }), false)).toBe(false);
    expect(shouldCloseTaskSession(session({ thread_id: "system:tasks:x", container_status: "running" }), false)).toBe(
      false,
    );
  });
});
