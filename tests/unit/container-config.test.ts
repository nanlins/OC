/**
 * container-config.test.ts —— 容器配置物化测试
 *
 * 职责：验证 container-config.ts 的配置物化（DB row → JSON 文件）。
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { materializeContainerJson } from "../../src/container-config.js";
import { setupTestDb, closeTestDb } from "../fixtures/memory-db.js";
import { createAgentGroup } from "../../src/db/agent-groups.js";
import { ensureContainerConfig } from "../../src/db/container-configs.js";

beforeEach(() => {
  setupTestDb();
});

afterEach(() => {
  closeTestDb();
});

describe("container-config", () => {
  it("materializes container.json from DB row", () => {
    const group = createAgentGroup({ name: "test", folder: "test-materialize" });
    ensureContainerConfig(group.id, "claude");

    const config = materializeContainerJson(group);
    expect(config.provider).toBe("claude");
  });

  it("returns default config for new agent group", () => {
    const group = createAgentGroup({ name: "test2", folder: "test-default" });
    const config = materializeContainerJson(group);
    expect(config.provider).toBeDefined();
  });
});
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

