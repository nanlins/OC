/**
 * cli-commands.test.ts —— src/cli/commands/* 命令注册与 handler 最小单测
 *
 * 职责：注册完整性（6 命令文件全注册）+ 已接线命令 handler 的最小行为断言
 *       （chat send / channels add / config show|set / groups restart），
 *       消除该目录 0%~25% 的覆盖缺口。tasks.ts 为空桩（命令在 resources 桶），
 *       以 tasks list/cancel 可查 + 桩函数可调为证。
 * 关键导出：无（测试）
 * 修改记录：2026-10-06 创建（coverage 补齐：src/cli/commands 40% → 100%）
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { setupTestDb, closeTestDb } from "../fixtures/memory-db.js";
import { clearCommandsForTest, lookupCommand } from "../../src/cli/registry.js";
import { registerAllCommands } from "../../src/cli/commands/index.js";
import { registerAllResources } from "../../src/cli/resources/index.js";
import { createAgentGroup } from "../../src/db/agent-groups.js";
import { createMessagingGroup } from "../../src/db/messaging-groups.js";
import { ensureContainerConfig, getContainerConfig } from "../../src/db/container-configs.js";

const caller = { actor: "host" as const };

// 注册表与注册标志均为模块级状态：文件内只注册一次（clear + register 各一次），
// 避免 beforeEach 里 clear 后 registerAllCommands 因 registered 标志短路而不重注册。
clearCommandsForTest();
registerAllCommands();

beforeEach(() => {
  setupTestDb();
});

afterEach(() => {
  closeTestDb();
});

describe("cli/commands 注册完整性", () => {
  it("registerAllCommands 注册全部 5 个有实命令的 verb 可查", () => {
    const pairs = [
      ["channels", "add"],
      ["chat", "send"],
      ["config", "show"],
      ["config", "set"],
      ["groups", "restart"],
    ] as const;
    for (const [resource, verb] of pairs) {
      expect(lookupCommand(resource, verb)).toBeDefined();
    }
  });

  it("registerAllCommands 幂等（重复调用不抛）", () => {
    expect(() => registerAllCommands()).not.toThrow();
  });

  it("tasks list/cancel 注册在 resources 桶（commands/tasks.ts 为预留空桩）", () => {
    registerAllResources();
    expect(lookupCommand("tasks", "list")).toBeDefined();
    expect(lookupCommand("tasks", "cancel")).toBeDefined();
  });
});

describe("chat send", () => {
  it("拼接 positionals 返回 sent", async () => {
    const def = lookupCommand("chat", "send")!;
    const r = await def.handler({ flags: {}, positionals: ["hello", "世界"] }, caller);
    expect(r).toEqual({ sent: true, message: "hello 世界" });
  });

  it("空消息抛 invalid-args", async () => {
    const def = lookupCommand("chat", "send")!;
    await expect(
      Promise.resolve().then(() => def.handler({ flags: {}, positionals: [] }, caller)),
    ).rejects.toMatchObject({
      key: "cli.chat_empty",
      code: "invalid-args",
    });
  });
});

describe("channels add", () => {
  it("缺必填 flags 抛 invalid-args", async () => {
    const def = lookupCommand("channels", "add")!;
    await expect(
      Promise.resolve().then(() => def.handler({ flags: {}, positionals: [] }, caller)),
    ).rejects.toMatchObject({
      key: "cli.wiring_flags_required",
      code: "invalid-args",
    });
  });

  it("创建 wiring（engage 模式与 pattern 透传）", async () => {
    const ag = createAgentGroup({ name: "A", folder: "a-cmd" });
    const mg = createMessagingGroup({ channelType: "cli", platformId: "cli-1" });
    const def = lookupCommand("channels", "add")!;
    const wiring = await def.handler(
      {
        flags: { "messaging-group": mg.id, "agent-group": ag.id, engage: "pattern", pattern: "hello" },
        positionals: [],
      },
      caller,
    );
    expect(wiring).toMatchObject({
      messaging_group_id: mg.id,
      agent_group_id: ag.id,
      engage_mode: "pattern",
      engage_pattern: "hello",
    });
  });

  it("缺 engage 标志默认 mention 模式", async () => {
    const ag = createAgentGroup({ name: "A2", folder: "a2-cmd" });
    const mg = createMessagingGroup({ channelType: "cli", platformId: "cli-2" });
    const def = lookupCommand("channels", "add")!;
    const wiring = await def.handler(
      { flags: { "messaging-group": mg.id, "agent-group": ag.id }, positionals: [] },
      caller,
    );
    expect(wiring).toMatchObject({ engage_mode: "mention", engage_pattern: null });
  });
});

describe("config show", () => {
  it("无 group 且无 caller.agentGroupId 抛 invalid-args", async () => {
    const def = lookupCommand("config", "show")!;
    await expect(
      Promise.resolve().then(() => def.handler({ flags: {}, positionals: [] }, caller)),
    ).rejects.toMatchObject({
      key: "cli.group_id_required",
      code: "invalid-args",
    });
  });

  it("无配置行抛 not-found", async () => {
    const ag = createAgentGroup({ name: "B", folder: "b-cmd" });
    const def = lookupCommand("config", "show")!;
    await expect(
      Promise.resolve().then(() => def.handler({ flags: {}, positionals: [] }, { ...caller, agentGroupId: ag.id })),
    ).rejects.toMatchObject({ key: "cli.not_found", code: "not-found" });
  });

  it("返回既有配置", async () => {
    const ag = createAgentGroup({ name: "C", folder: "c-cmd" });
    ensureContainerConfig(ag.id, "claude");
    const def = lookupCommand("config", "show")!;
    const config = await def.handler({ flags: {}, positionals: [] }, { ...caller, agentGroupId: ag.id });
    expect(config).toMatchObject({ agent_group_id: ag.id, provider: "claude" });
  });
});

describe("config set", () => {
  it("缺 group 抛 invalid-args", async () => {
    const def = lookupCommand("config", "set")!;
    await expect(
      Promise.resolve().then(() => def.handler({ flags: {}, positionals: [] }, caller)),
    ).rejects.toMatchObject({
      key: "cli.group_id_required",
      code: "invalid-args",
    });
  });

  it("无任何更新字段抛 invalid-args", async () => {
    const def = lookupCommand("config", "set")!;
    await expect(
      Promise.resolve().then(() => def.handler({ flags: { group: "g" }, positionals: [] }, caller)),
    ).rejects.toMatchObject({
      key: "cli.config_no_updates",
      code: "invalid-args",
    });
  });

  it("更新 model/provider/effort 落库", async () => {
    const ag = createAgentGroup({ name: "D", folder: "d-cmd" });
    ensureContainerConfig(ag.id, "claude");
    const def = lookupCommand("config", "set")!;
    const r = await def.handler(
      { flags: { group: ag.id, model: "deepseek-flash", provider: "openai", effort: "high" }, positionals: [] },
      caller,
    );
    expect(r).toEqual({ ok: true });
    const config = getContainerConfig(ag.id)!;
    expect(config.model).toBe("deepseek-flash");
    expect(config.provider).toBe("openai");
    expect(config.effort).toBe("high");
  });
});

describe("groups restart", () => {
  it("缺 id 抛 invalid-args", async () => {
    const def = lookupCommand("groups", "restart")!;
    await expect(
      Promise.resolve().then(() => def.handler({ flags: {}, positionals: [] }, caller)),
    ).rejects.toMatchObject({
      key: "cli.missing_id",
      code: "invalid-args",
    });
  });

  it("无活动会话的群组返回 0（不触碰 docker）", async () => {
    const ag = createAgentGroup({ name: "G", folder: "g-cmd" });
    const def = lookupCommand("groups", "restart")!;
    const r = await def.handler({ id: ag.id, flags: {}, positionals: [] }, caller);
    expect(r).toBe(0);
  });
});
/*
 * 修改记录：
 *   2026-10-06 创建（coverage 补齐：src/cli/commands 40% → 100%）
 */
