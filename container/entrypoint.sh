#!/usr/bin/env bash
# container/entrypoint.sh —— 容器入门脚本
#
# 职责：容器启动时执行，设置环境后启动 agent-runner。
#       宿主 spawn 用 --entrypoint bash -c "exec bun run /app/src/index.ts" 覆盖，
#       此文件作为兜底（直接 docker run 时使用）。
# 借鉴：nanoclaw container/entrypoint.sh
#
# 修改记录：2026-08-24 创建（补齐未完成清单）

set -euo pipefail

echo "[entrypoint] OC agent container starting..."

# 确保 workspace 目录存在
mkdir -p /workspace/outbox /workspace/memory

# 心跳文件
touch /workspace/.heartbeat

# 启动 agent-runner
exec bun run /app/src/index.ts
# 修改记录：
#   2026-08-24 创建（补齐未完成清单）

