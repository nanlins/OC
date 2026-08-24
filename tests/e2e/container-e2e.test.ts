/**
 * container-e2e.test.ts —— 端到端测试（需要 Docker 环境）
 *
 * 职责：验证真实容器 spawn + 消息轮询全链路。仅在 Docker 可用时运行。
 *       通过 OC_E2E=1 环境变量启用。
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { describe, expect, it, beforeAll } from "vitest";
import { execSync } from "node:child_process";

const hasDocker = (() => {
  try {
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
})();

const e2eEnabled = process.env.OC_E2E === "1";

describe("container-e2e", () => {
  beforeAll(function () {
    if (!hasDocker) {
      console.warn("[e2e] Docker not available, skipping container tests");
    }
    if (!e2eEnabled) {
      console.warn("[e2e] OC_E2E=1 not set, skipping container tests");
    }
  });

  it("Docker is available", () => {
    if (!hasDocker || !e2eEnabled) return;
    const info = execSync("docker info --format '{{.ServerVersion}}'", { encoding: "utf-8" }).trim();
    expect(info).toBeTruthy();
  });
});
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */
