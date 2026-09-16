# syntax=docker/dockerfile:1.7
# Dockerfile —— OC 主机镜像（Node 编排器本体，不是 Agent 容器镜像）
#
# 用途：把主机（src/ + scripts/ + container/）打包成可编排镜像，供 docker-compose.yml 的
#       oc-host 服务使用。Agent 容器镜像是另一件事，由 container/Dockerfile 定义、
#       `pnpm build:container` 构建。
#
# ⚠ 承重约束（读 docker-compose.yml 头部注释前不要改这里）：
#   主机通过 docker socket 以「宿主绝对路径」bind-mount 会话目录给 Agent 容器
#   （src/config.ts 的 PROJECT_ROOT → GROUPS_DIR / STORE_DIR）。这些路径由 **宿主上的
#   Docker daemon** 解析，不是由主机进程所在容器解析。因此主机容器必须把仓库挂载到
#   **与宿主完全相同的绝对路径**，否则 daemon 会在宿主上自动创建空目录，Agent 拿到空
#   workspace（没有 inbound.db）而静默失效。compose 用 ${OC_REPO_DIR} 保证这一点。
#
# 关键取舍：运行时用 tsx 直跑 TS（与 `pnpm start` 完全一致），不引入 tsc 构建步骤——
#   镜像里的行为和本机开发行为逐字相同，少一类"只在容器里坏"的故障。
#
# 修改记录：2026-09-16 创建（修复 docker-compose.yml 引用了不存在的根 Dockerfile）

# ---- 阶段 1：依赖（含 better-sqlite3 原生构建工具链）----
FROM node:22-slim AS deps

# better-sqlite3@11.10.0 需要 node-gyp 回退路径（pnpm-workspace.yaml allowBuilds 已放行）
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# corepack 按 package.json 的 packageManager 字段钉住 pnpm 版本，避免宿主/镜像漂移
RUN corepack enable

WORKDIR /app

# 先只拷清单，最大化利用构建缓存（源码改动不触发重装依赖）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# pnpm-workspace.yaml 声明了 web/frontend 成员，缺它的清单 --frozen-lockfile 会失败
COPY web/frontend/package.json ./web/frontend/

# 装全量依赖（含 devDependencies）：tsx 是 devDependency，运行时要用
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ---- 阶段 2：运行时 ----
FROM node:22-slim AS runtime

# docker CLI：主机要 spawn Agent 容器（src/container-runtime.ts 的 CONTAINER_RUNTIME_BIN）
# git：部分技能/脚本会用到；curl：healthcheck 之外的运维探测
RUN apt-get update && apt-get install -y --no-install-recommends \
        docker.io \
        git \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# pnpm 的 node_modules 内部是相对符号链接（指向 .pnpm/），整体拷贝可保持链接有效
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/frontend/node_modules ./web/frontend/node_modules

# 源码与运行所需资产。.dockerignore 已排除 .env / data / groups / logs / .git
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY container ./container
COPY skills ./skills
COPY bin ./bin
COPY web ./web

# 非 root 运行。注意：要用 docker socket 就必须能读写 /var/run/docker.sock，
# 部署时需把 node 用户加入 docker 组或对 socket 授权——这是"主机能起容器"的固有代价，
# 也是本项目推荐主机原生运行（而非容器化）的原因之一。
RUN useradd --create-home --uid 1000 oc \
    && mkdir -p /app/data /app/groups /app/templates \
    && chown -R oc:oc /app
USER oc

# Web 控制台端口。宿主可达性还取决于 WEB_HOST=0.0.0.0（默认 127.0.0.1 只在容器内可达）
EXPOSE 8080

ENV NODE_ENV=production

# 与 `pnpm start` 逐字一致
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
