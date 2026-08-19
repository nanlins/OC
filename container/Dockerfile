# OpenClaw Agent 容器镜像（Bun 运行时）
#
# 宿主 spawn 契约（src/container-runner.ts buildContainerArgs）：
#   docker run ... --entrypoint bash <image> -c "exec bun run /app/src/index.ts"
#   挂载：/workspace（会话目录）、/workspace/inbound.db(RO)、/workspace/outbound.db、
#         /workspace/agent（群组目录）、container.json(RO)、CLAUDE.md(RO)
#   宿主已传 --init（hardeningArgs），故镜像无需 tini。
#
# 与 nanoclaw 差异（借鉴 claw开源项目源码/container/Dockerfile 的分层/入口思路）：
#   nanoclaw 运行时 RO 挂载 /app/src；OpenClaw buildMounts 只挂 /workspace，
#   故 agent-runner 源码 + 依赖 + 技能全部烘焙进镜像。源码改动需重建镜像。
#
# 修改记录：2026-08-13 创建（收束期补容器打包，支撑端到端实测）

FROM oven/bun:debian

# HTTPS 访问 LLM 端点所需根证书
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依赖分层缓存：先 lockfile 再源码
COPY agent-runner/package.json agent-runner/bun.lock ./
RUN bun install --frozen-lockfile

# 烘焙源码 + 容器技能（index.ts 从 /app/skills 或 OPENCLAW_SKILLS_DIR 加载）
COPY agent-runner/tsconfig.json ./tsconfig.json
COPY agent-runner/src ./src
COPY skills ./skills

# 仅兜底；宿主 spawn 会以 --entrypoint bash 覆盖
CMD ["bun", "run", "/app/src/index.ts"]
