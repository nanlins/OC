/**
 * messaging-groups.test.ts —— 群组绑定集成测试
 *
 * 职责：验证 messaging_groups CRUD 与 wiring 操作。
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { setupTestDb, closeTestDb } from "../fixtures/memory-db.js";
import { createAgentGroup } from "../../src/db/agent-groups.js";
import { createMessagingGroup, getMessagingGroup, createWiring, listWirings } from "../../src/db/messaging-groups.js";

beforeEach(() => {
  setupTestDb();
});

afterEach(() => {
  closeTestDb();
});

describe("messaging-groups", () => {
  it("creates and retrieves a messaging group", () => {
    const mg = createMessagingGroup({
      channelType: "telegram",
      platformId: "chat-123",
      instance: "default",
      name: "Test Chat",
    });
    expect(mg.channel_type).toBe("telegram");
    expect(mg.platform_id).toBe("chat-123");

    const fetched = getMessagingGroup(mg.id);
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe("Test Chat");
  });

  it("creates wiring between messaging group and agent group", () => {
    const group = createAgentGroup({ name: "test", folder: "test" });
    const mg = createMessagingGroup({
      channelType: "cli",
      platformId: "dm-1",
      instance: "default",
    });
    const wiring = createWiring({
      messagingGroupId: mg.id,
      agentGroupId: group.id,
      engageMode: "mention",
    });
    expect(wiring.messaging_group_id).toBe(mg.id);
    expect(wiring.agent_group_id).toBe(group.id);

    const wirings = listWirings(mg.id);
    expect(wirings.length).toBe(1);
    expect(wirings[0]!.id).toBe(wiring.id);
  });

  it("enforces unique (channel_type, platform_id, instance)", () => {
    createMessagingGroup({
      channelType: "telegram",
      platformId: "chat-dup",
      instance: "default",
    });
    expect(() =>
      createMessagingGroup({
        channelType: "telegram",
        platformId: "chat-dup",
        instance: "default",
      }),
    ).toThrow();
  });
});
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */
