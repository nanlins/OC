// vitest.config.ts —— 测试运行器配置
// 说明：只跑 tests/ 下的 Node 侧测试；容器侧 agent-runner 测试用 bun:test，不在此运行（借鉴 nanoclaw 双测试树纪律）。
// 修改记录：
//   2026-08-12 创建（阶段 0）
//   2026-08-12 阶段 2：test.env 注入 OPENCLAW_DATA_DIR 隔离测试数据目录
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "container/**"],
    testTimeout: 10000,
    // 测试数据目录与项目 data/ 隔离（config.ts 加载期读取）；WEB_TOKEN 固定供测试鉴权（fix-plan P0 fail-closed）
    env: {
      OPENCLAW_DATA_DIR: `${process.env.TEMP ?? "/tmp"}/openclaw-test-data`,
      WEB_TOKEN: "test-web-token",
    },
  },
});
