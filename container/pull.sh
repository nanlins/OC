#!/usr/bin/env bash
# container/pull.sh —— 预构建镜像拉取
#
# 职责：从镜像仓库拉取预构建的 agent 容器镜像，避免本地构建。
#       用法：bash container/pull.sh [tag]
# 借鉴：nanoclaw container/pull.sh
#
# 修改记录：2026-08-24 创建（补齐未完成清单）

set -euo pipefail

TAG="${1:-latest}"
IMAGE="oc-agent:${TAG}"
REGISTRY="${OC_REGISTRY:-}"

echo "[pull] pulling ${IMAGE}..."

if [ -n "${REGISTRY}" ]; then
  FULL_IMAGE="${REGISTRY}/${IMAGE}"
  docker pull "${FULL_IMAGE}"
  docker tag "${FULL_IMAGE}" "${IMAGE}"
else
  echo "[pull] no registry configured, building locally instead"
  docker build -t "${IMAGE}" -f Dockerfile .
fi

echo "[pull] done: ${IMAGE}"
# 修改记录：
#   2026-08-24 创建（补齐未完成清单）

