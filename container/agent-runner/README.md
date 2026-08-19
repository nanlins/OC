# agent-runner

> 用途：Agent Runner：容器内 Agent 执行引擎（Bun 运行时，独立包树）

## 内容清单
- `package.json`：独立包树依赖清单（不属 pnpm workspace，用 `bun install` 管理；供应链无 minimumReleaseAge 策略，升级依赖须人工核对发布日期）
- `tsconfig.json`：容器侧独立 TS 配置（moduleResolution=bundler，types=bun）
- `src/`：Agent Runner 源码

## 修改记录
- 2026-08-12 创建（阶段 0 骨架）
- 2026-08-12 补充 package.json/tsconfig.json 用途说明（不可注释文件约定）

## 修改记录
- 2026-08-12 创建（阶段 0 骨架）
