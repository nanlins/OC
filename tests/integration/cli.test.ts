/**
 * cli.test.ts —— CLI 分发/作用域/审批闭环/socket 回环测试（阶段 7）
 *
 * 职责：host CRUD；agent cli_scope group 白名单；disabled forbidden；admin 命令 hold→approve 重放闭环；
 *       socket 行帧回环。
 * 修改记录：
 *   2026-08-12 创建（阶段 7）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { connect } from "node:net";
import { closeDb, initTestDb, runMigrations, createAgentGroup, upsertUser } from "../../src/db/index.js";
import { migration001 } from "../../src/db/index.js";
import { handleCliLine, startCliServer, stopCliServer, cliControlPath } from "../../src/cli/socket-server.js";
import { updateContainerConfig } from "../../src/db/container-configs.js";
import { getDb } from "../../src/db/connection.js";
import type { ResponseFrame } from "../../src/cli/frame.js";

let groupId: string;

beforeEach(() => {
  runMigrations(initTestDb(), [migration001]);
  groupId = createAgentGroup({ name: "C", folder: `c-${Math.random().toString(36).slice(2, 8)}` }).id;
});

afterEach(() => {
  stopCliServer();
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

describe("cli socket roundtrip", () => {
  it("serves line frames over the control socket", async () => {
    startCliServer();
    const res = await new Promise<ResponseFrame>((resolve, reject) => {
      const s = connect(cliControlPath(), () => {
        s.write(JSON.stringify({ cmd: "groups list" }) + "\n");
      });
      let buf = "";
      s.on("data", (c) => {
        buf += c.toString();
        const idx = buf.indexOf("\n");
        if (idx >= 0) {
          s.destroy();
          resolve(JSON.parse(buf.slice(0, idx)) as ResponseFrame);
        }
      });
      s.on("error", reject);
      setTimeout(() => reject(new Error("socket timeout")), 3000);
    });
    expect(res.ok).toBe(true);
    expect((res.data as Array<Record<string, unknown>>).length).toBe(1);
  });
});
