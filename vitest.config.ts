// vitest.config.ts —— 测试运行器配置
// 说明：只跑 tests/ 下的 Node 侧测试；容器侧 agent-runner 测试用 bun:test，不在此运行（借鉴 nanoclaw 双测试树纪律）。
// 修改记录：
//   2026-08-12 创建（阶段 0）
//   2026-08-12 阶段 2：test.env 注入 OC_DATA_DIR 隔离测试数据目录
//   2026-09-29 单 fork 串行化，修复并行 worker 共享测试数据目录导致的偶发崩溃
//   2026-10-06 T1-4：修正注释里写错的变量名（实际注入的一直是 OC_DATA_DIR，不是 OPENCLAW_DATA_DIR）
//   2026-10-06 T1-5：接入 @vitest/coverage-v8，只统计宿主 src/（容器侧由 bun test 覆盖）
//   2026-10-06 P1-3：移除 pool/poolOptions.forks.singleFork —— Vitest 4 已删除该键，旧写法被静默忽略
//              （实测导致测试文件并行、共享 SQLite/命名管道竞争）；改用顶层 fileParallelism:false
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "container/**"],
    testTimeout: 10000,
    // 必须串行执行测试文件，两个原因（都在本仓真实发生过）：
    //  1. 多个测试文件共享 OC_DATA_DIR 的 better-sqlite3 文件，并行时锁竞争曾让 fork worker 意外退出；
    //  2. 两个测试文件曾同时绑定同一个 Windows 命名管道，第二次 bind 报 EADDRINUSE。
    // Vitest 4 已移除 poolOptions.forks.singleFork（保留旧写法会被静默忽略，等于没串行），
    // 正确写法是顶层 fileParallelism:false。保留 pool:"forks"（子进程隔离），仅去掉被忽略的 singleFork。
    pool: "forks",
    fileParallelism: false,
    // 测试数据目录与项目 data/ 隔离（config.ts 加载期读取）；WEB_TOKEN 固定供测试鉴权（fix-plan P0 fail-closed）
    env: {
      OC_DATA_DIR: `${process.env.TEMP ?? "/tmp"}/oc-test-data`,
      WEB_TOKEN: "test-web-token",
    },
    // T1-5：覆盖率经 @vitest/coverage-v8（唯一为此新增的 devDependency）。
    // 只统计宿主 src/——容器侧 agent-runner 由 bun test 单独覆盖，两棵树不共享模块。
    // 不设 thresholds：本项目目标是"修到真实可用"，覆盖率是观测信号而非合并门禁，
    // 硬性阈值会诱使为达标而写空测试。
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/README.md", "src/**/*.d.ts"],
      all: true,
    },
  },
});
