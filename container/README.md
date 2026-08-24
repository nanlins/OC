# container

> 用途：容器工程——Dockerfile、构建脚本、Agent Runner 源码、容器技能

## 内容清单
- `Dockerfile`：Agent 容器镜像构建（oven/bun:debian + bun install + 源码/技能烘焙）
- `build.ts`：跨平台构建脚本（import config.CONTAINER_IMAGE 保证镜像名一致）
- `entrypoint.sh`：容器兜底启动脚本（宿主 spawn 非 bash 入口时使用）
- `install-cli-tools.sh`：容器构建时 CLI 工具安装（git/curl/jq/ripgrep 等）
- `cli-tools.json`：纯 JSON 清单，列出 apt 安装的 CLI 工具（不可注释文件）
- `pull.sh`：预构建镜像拉取脚本（OC_REGISTRY 环境变量控制）
- `agent-runner/`：容器内 Agent 执行引擎（Bun，独立包树）
- `skills/`：20 个容器技能（SKILL.md）

## 修改记录
- 2026-08-12 创建
- 2026-08-14 fix-plan：补 Dockerfile + build.ts
- 2026-08-24 补齐未完成清单：entrypoint.sh + install-cli-tools.sh + cli-tools.json + pull.sh