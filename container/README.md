# container

> 用途：容器工程——Dockerfile、构建脚本、Agent Runner 源码、容器技能

## 内容清单
- `Dockerfile`：Agent 容器镜像构建（oven/bun:debian + bun install + 源码/技能烘焙）
- `build.ts`：跨平台构建脚本（import config.CONTAINER_IMAGE 保证镜像名一致）
- `agent-runner/`：容器内 Agent 执行引擎（Bun，独立包树）
- `skills/`：20 个容器技能（SKILL.md）

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 Dockerfile + build.ts