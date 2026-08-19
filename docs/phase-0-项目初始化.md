# 阶段 0 记录：项目初始化

> 用途：记录阶段 0（骨架+配置+自验）的重要决策、问题修复、对标完成度与扩展度。

## 一、重要决策
1. **目录结构**对齐 docs/07 §8，并预置 `web/`（Web 管理控制台，阶段 9）与 `src/guard/`、`src/modules/memory-kb` 等扩展位。
2. **包管理 pnpm 11** + 供应链门禁：`minimumReleaseAge: 4320`（3 天）、`allowBuilds` 人工批准制（借鉴 nanoclaw pnpm-workspace.yaml 纪律）。
3. **双测试树**：主机 vitest（Node）+ 容器 bun:test（Bun），互不混跑（借鉴 nanoclaw 双运行时纪律）。
4. **测试数据隔离**：vitest `test.env.OPENCLAW_DATA_DIR` 指向系统 temp，避免污染项目 data/。

## 二、所遇问题与修复方案
1. pnpm 11 移除 `onlyBuiltDependencies` → 改用 `allowBuilds` 映射（esbuild: true，用户批准）。
2. npmmirror 简化元数据缺 per-version time，`minimumReleaseAge` 将 2024 旧版误判"刚发布" → registry 固定 npmjs 官方源 + `minimumReleaseAgeIgnoreMissingTime: true`。
3. esbuild@0.28.2（发布 2 天）被年龄门禁拦截 → 精确钉版豁免 `esbuild@0.28.2` + `@esbuild/*`（用户批准，记录在 pnpm-workspace.yaml）。
4. better-sqlite3 postinstall 被 allowBuilds 拦截 → 用户批准后放行（原生绑定必需）。

## 三、对标 claw 开源源码完成度（nanoclaw v2.1.54）
- 目录骨架/脚本位：已复刻（src/container/tests/setup/scripts/config-examples/docs/.github 位）。
- 构建配置：tsconfig/eslint/prettier/vitest 已对齐；CI 工作流延后至阶段 10。
- 缺失：launchd/systemd 服务模板（延后）。

## 四、扩展度
- 全目录 README 注释体系 + 代码头注释块 + 修改备注约定（AGENTS.md 永久规则）。
- 检查员 agent（se-inspector/ai-inspector）建立并纳入每阶段流程。
- 行数预算从设计文档 25k 提升至 100k+ 的板块规划（14 板块 ≈119k）。

## 修改记录
- 2026-08-12 创建。
