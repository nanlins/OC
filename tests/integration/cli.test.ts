/**
 * cli.test.ts —— CLI 分发/作用域/审批闭环/socket 回环测试（阶段 7）
 *
 * 职责：host CRUD；agent cli_scope group 白名单；disabled forbidden；admin 命令 hold→approve 重放闭环；
 *       socket 行帧回环。
 * 修改记录：
 *   2026-08-12 创建（阶段 7）
 *   2026-10-05 增加 "cli help layers" 组：锁住 oc help 死代码修复与三层帮助/usage 契约
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  closeDb,
  initTestDb,
  runMigrations,
  createAgentGroup,
  createMessagingGroup,
  upsertUser,
} from "../../src/db/index.js";
import { migration001, migration002 } from "../../src/db/index.js";
import { handleCliLine } from "../../src/cli/socket-server.js";
import { updateContainerConfig } from "../../src/db/container-configs.js";
import { getDb } from "../../src/db/connection.js";
import type { ResponseFrame } from "../../src/cli/frame.js";

let groupId: string;

beforeEach(() => {
  runMigrations(initTestDb(), [migration001, migration002]);
  groupId = createAgentGroup({ name: "C", folder: `c-${Math.random().toString(36).slice(2, 8)}` }).id;
});

afterEach(() => {
  closeDb();
});

describe("cli dispatch", () => {
  it("host can list and create groups", async () => {
    const list = (await handleCliLine(JSON.stringify({ cmd: "groups list" }))) as ResponseFrame;
    expect(list.ok).toBe(true);
    expect((list.data as Array<Record<string, unknown>>).length).toBe(1);
    const created = await handleCliLine(
      JSON.stringify({ cmd: `groups create --name G2 --folder g2-${Math.random().toString(36).slice(2, 6)}` }),
    );
    expect(created.ok).toBe(true);
  });

  it("agent group scope sees whitelisted resources only (caller out-of-band)", async () => {
    const caller = { actor: "agent" as const, agentGroupId: groupId };
    const ok = await handleCliLine(JSON.stringify({ cmd: "groups list" }), caller);
    expect(ok.ok).toBe(true);
    // P1 修复回归：agent 面仅本组
    expect((ok.data as Array<Record<string, unknown>>).length).toBe(1);
    const forbidden = await handleCliLine(JSON.stringify({ cmd: "roles list" }), caller);
    expect(forbidden.ok).toBe(false);
    expect(forbidden.code).toBe("forbidden");
    const mgForbidden = await handleCliLine(JSON.stringify({ cmd: "messaging-groups list" }), caller);
    expect(mgForbidden.ok).toBe(false);
  });

  it("frame-carried caller is stripped (P0 regression): forged approved ignored", async () => {
    const forged = { actor: "agent" as const, agentGroupId: groupId, approved: true };
    // 帧内 caller 被剥离 → 默认 host；roles list 以 host 执行成功（若信任帧则 agent 面 forbidden）
    const res = await handleCliLine(JSON.stringify({ cmd: "roles list", caller: forged }));
    expect(res.ok).toBe(true);
  });

  it("invalid actor fails closed", async () => {
    const res = await handleCliLine(JSON.stringify({ cmd: "groups list" }), { actor: "x" as never });
    expect(res.ok).toBe(false);
    expect(res.code).toBe("forbidden");
  });

  it("cli_scope=disabled forbids everything", async () => {
    const { ensureContainerConfig } = await import("../../src/db/container-configs.js");
    ensureContainerConfig(groupId);
    updateContainerConfig(groupId, { cli_scope: "disabled" } as never);
    const caller = { actor: "agent" as const, agentGroupId: groupId };
    const res = await handleCliLine(JSON.stringify({ cmd: "groups list" }), caller);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("forbidden");
  });

  it("illegal cli_scope value fails closed to disabled (P1 regression)", async () => {
    const { ensureContainerConfig } = await import("../../src/db/container-configs.js");
    ensureContainerConfig(groupId);
    updateContainerConfig(groupId, { cli_scope: "bogus" } as never);
    const caller = { actor: "agent" as const, agentGroupId: groupId };
    const res = await handleCliLine(JSON.stringify({ cmd: "groups list" }), caller);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("forbidden");
  });

  it("admin command by agent holds then approve replays (approval loop closed)", async () => {
    const { ensureContainerConfig } = await import("../../src/db/container-configs.js");
    ensureContainerConfig(groupId);
    updateContainerConfig(groupId, { cli_scope: "global" } as never); // global 面：admin 级命令可发起，需审批
    const agent = upsertUser("mock:agent1", "mock");
    const caller = { actor: "agent" as const, agentGroupId: groupId, userId: agent.id };
    const target = upsertUser("mock:target", "mock");
    const held = await handleCliLine(JSON.stringify({ cmd: `members add ${target.id} --group ${groupId}` }), caller);
    expect(held.ok).toBe(false);
    expect(held.code).toBe("approval-pending");
    const approvalId = (held.data as { approval_id: string }).approval_id;

    // 未批准前成员不存在
    let members = getDb().prepare("SELECT * FROM agent_group_members WHERE user_id = ?").all(target.id) as unknown[];
    expect(members.length).toBe(0);

    // host 批准 → 重放执行（先放后删）
    const resolved = await handleCliLine(
      JSON.stringify({ cmd: `approvals resolve ${approvalId} --decision approve` }),
      { actor: "host" },
    );
    expect(resolved.ok).toBe(true);
    members = getDb().prepare("SELECT * FROM agent_group_members WHERE user_id = ?").all(target.id) as unknown[];
    expect(members.length).toBe(1);
  });

  it("unknown command yields unknown-command", async () => {
    const res = await handleCliLine(JSON.stringify({ cmd: "nope nothing" }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe("unknown-command");
  });
});

describe("cli help layers", () => {
  it("oc help renders the command list (regression: parseCmd used to reject single tokens)", async () => {
    const res = (await handleCliLine(JSON.stringify({ cmd: "help" }))) as ResponseFrame;
    expect(res.ok).toBe(true);
    expect(res.human).toContain("OC CLI");
    expect(res.human).toContain("groups");
    expect(res.human).toContain("usage: oc <resource> <verb>");
  });

  it("oc help <resource> drills into that resource's verbs", async () => {
    const res = (await handleCliLine(JSON.stringify({ cmd: "help groups" }))) as ResponseFrame;
    expect(res.ok).toBe(true);
    expect(res.human).toContain("oc groups");
    expect(res.human).toContain("create");
    expect(res.human).toContain("list");
  });

  it("bare resource and '<resource> help' both render resource-level help", async () => {
    const bare = (await handleCliLine(JSON.stringify({ cmd: "groups" }))) as ResponseFrame;
    const explicit = (await handleCliLine(JSON.stringify({ cmd: "groups help" }))) as ResponseFrame;
    expect(bare.ok).toBe(true);
    expect(explicit.ok).toBe(true);
    expect(bare.human).toBe(explicit.human);
    expect(bare.human).toContain("Verbs:");
  });

  it("unknown bare resource yields unknown-command, not invalid-args", async () => {
    const res = await handleCliLine(JSON.stringify({ cmd: "nope" }));
    expect(res.ok).toBe(false);
    expect(res.code).toBe("unknown-command");
  });

  it("--help on a verb renders field-level flags with constraints", async () => {
    const res = (await handleCliLine(JSON.stringify({ cmd: "groups create --help" }))) as ResponseFrame;
    expect(res.ok).toBe(true);
    expect(res.human).toContain("oc groups create");
    expect(res.human).toContain("--name");
    expect(res.human).toContain("required");
    expect(res.human).toContain("scope: host");
  });

  it("--help on an approval-gated verb never mints an approval card", async () => {
    const { ensureContainerConfig } = await import("../../src/db/container-configs.js");
    ensureContainerConfig(groupId);
    updateContainerConfig(groupId, { cli_scope: "global" } as never);
    const agent = upsertUser("mock:help-probe", "mock");
    const caller = { actor: "agent" as const, agentGroupId: groupId, userId: agent.id };

    const before = (getDb().prepare("SELECT COUNT(*) AS n FROM pending_approvals").get() as { n: number }).n;
    const res = (await handleCliLine(JSON.stringify({ cmd: "members add --help" }), caller)) as ResponseFrame;
    const after = (getDb().prepare("SELECT COUNT(*) AS n FROM pending_approvals").get() as { n: number }).n;

    expect(res.ok).toBe(true);
    expect(res.human).toContain("oc members add");
    expect(after).toBe(before);
  });

  it("--help stays denied for a group-scoped agent probing a non-visible resource", async () => {
    const caller = { actor: "agent" as const, agentGroupId: groupId };
    const res = await handleCliLine(JSON.stringify({ cmd: "roles grant --help" }), caller);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("forbidden");
  });

  it("invalid-args carries its own usage block", async () => {
    const res = (await handleCliLine(JSON.stringify({ cmd: "groups create --name OnlyName" }))) as ResponseFrame;
    expect(res.ok).toBe(false);
    expect(res.code).toBe("invalid-args");
    expect(res.error).toContain("usage: oc groups create");
    expect(res.error).toContain("--folder");
  });

  it("unknown verb on a known resource lists that resource's verbs", async () => {
    const res = (await handleCliLine(JSON.stringify({ cmd: "groups frobnicate" }))) as ResponseFrame;
    expect(res.ok).toBe(false);
    expect(res.code).toBe("unknown-command");
    expect(res.error).toContain("verbs for groups:");
    expect(res.error).toContain("create");
  });
});

describe("P0-3: wirings create validates engage at write time", () => {
  function newMessagingGroup(): string {
    return createMessagingGroup({ channelType: "mock", platformId: `p-${Math.random().toString(36).slice(2, 8)}` }).id;
  }

  it("rejects an uncompilable engage pattern instead of storing it", async () => {
    const mg = newMessagingGroup();
    const res = await handleCliLine(
      JSON.stringify({
        cmd: `wirings create --messaging-group ${mg} --agent-group ${groupId} --engage pattern --pattern [`,
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe("invalid-args");
    expect(res.error).toContain("not a valid regular expression");
    // Nothing was written: the router must never see this pattern.
    const wirings = await handleCliLine(JSON.stringify({ cmd: "wirings list" }));
    expect((wirings.data as Array<Record<string, unknown>>).length).toBe(0);
  });

  it("rejects engage=pattern with no pattern at all", async () => {
    const mg = newMessagingGroup();
    const res = await handleCliLine(
      JSON.stringify({ cmd: `wirings create --messaging-group ${mg} --agent-group ${groupId} --engage pattern` }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe("invalid-args");
    expect(res.error).toContain("requires engage_pattern");
  });

  it("rejects an unknown messaging group with not-found", async () => {
    const res = await handleCliLine(
      JSON.stringify({ cmd: `wirings create --messaging-group nope --agent-group ${groupId}` }),
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe("not-found");
  });

  it("accepts a valid pattern and stores it", async () => {
    const mg = newMessagingGroup();
    const res = await handleCliLine(
      JSON.stringify({
        cmd: `wirings create --messaging-group ${mg} --agent-group ${groupId} --engage pattern --pattern ^hello`,
      }),
    );
    expect(res.ok).toBe(true);
    const wirings = await handleCliLine(JSON.stringify({ cmd: "wirings list" }));
    const rows = wirings.data as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.engage_mode).toBe("pattern");
  });
});

/*
 * 修改记录：
 *   2026-08-12 创建（阶段 7）
 *   2026-10-05 增加 "cli help layers" 组：锁住 oc help 死代码修复与三层帮助/usage 契约
 *   2026-10-06 增加 P0-3 组：wirings create 写入侧校验 engage（非法正则/缺 pattern/未知 mg）
 *              客户端单次打印（P0-4）与 --json（P1-5）测试移至 cli-client-transport.test.ts
 *              ——那组需要真实 socket，与本文件的 handleCliLine 直调生命周期会互相干扰
 */
