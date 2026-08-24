#!/usr/bin/env bash
# container/install-cli-tools.sh —— 容器内 CLI 工具安装
#
# 职责：在容器构建时安装 agent 可能用到的 CLI 工具（git, curl, jq, ripgrep 等）。
#       由 Dockerfile RUN 调用。
# 借鉴：nanoclaw container/install-cli-tools.sh
#
# 修改记录：2026-08-24 创建（补齐未完成清单）

set -euo pipefail

echo "[install-cli-tools] installing CLI tools..."

apt-get update -qq
apt-get install -y --no-install-recommends \
  git \
  curl \
  wget \
  jq \
  ripgrep \
  fd-find \
  tree \
  unzip \
  ca-certificates

# fd 在 Debian 中叫 fdfind，创建别名
if [ -x "$(which fdfind 2>/dev/null)" ]; then
  ln -sf "$(which fdfind)" /usr/local/bin/fd
fi

rm -rf /var/lib/apt/lists/*
echo "[install-cli-tools] done"
# 修改记录：
#   2026-08-24 创建（补齐未完成清单）

