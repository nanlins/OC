/**
 * command-gate.test.ts —— 命令门控单元测试
 *
 * 职责：非斜杠透传/runner 命令透传/管理命令鉴权/未知斜杠交 SDK。
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { gateCommand } from "../../src/command-gate.js";
import { closeDb, createAgentGroup, grantRole, initTestDb, runMigrations, upsertUser } from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";

beforeEach(() => {
  runMigrations(initTestDb(), [migration001]);
});

afterEach(() => {
  closeDb();
});

describe("command gate", () => {
  it("passes non-slash content", () => {
    expect(gateCommand("hello world", null, "g")).toEqual({ action: "pass" });
  });

  it("passes runner commands regardless of privilege", () => {
    expect(gateCommand("/clear", null, "g")).toEqual({ action: "pass" });
  });

  it("passes unknown slash commands to SDK", () => {
    expect(gateCommand("/some-skill-thing", null, "g")).toEqual({ action: "pass" });
  });

  it("denies admin commands without privilege and allows owner", () => {
    const g = createAgentGroup({ name: "A", folder: "a" });
    const stranger = upsertUser("cli:nobody", "cli");
    const owner = upsertUser("cli:owner", "cli");
    grantRole(owner.id, "owner", null);
    const denied = gateCommand("/manage-channels", stranger.id, g.id);
    expect(denied.action).toBe("deny");
    expect(gateCommand("/manage-channels", owner.id, g.id)).toEqual({ action: "pass" });
    expect(gateCommand("/manage-channels", null, g.id).action).toBe("deny");
  });
});
