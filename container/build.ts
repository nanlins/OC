/**
 * container/build.ts —— 构建 agent 容器镜像（跨平台，tsx 运行）
 *
 * 职责：以与宿主 spawn 完全一致的 CONTAINER_IMAGE 名，构建 container/ 目录
 *       （Dockerfile + agent-runner + skills）。直接 import config 保证镜像名与
 *       container-runner 运行时所用名一致（sha1(projectRoot)[:8] 作用域）。
 * 关键导出：无（CLI 脚本）
 * 用法：pnpm build:container   （= tsx container/build.ts）
 * 借鉴：nanoclaw container/build.sh（构建上下文/镜像名思路），改为 Node 跨平台实现以适配 Windows。
 *
 * 修改记录：2026-08-13 创建（收束期补容器打包）
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { CONTAINER_IMAGE, PROJECT_ROOT } from "../src/config.js";

const ctx = join(PROJECT_ROOT, "container");
console.log(`[build] image=${CONTAINER_IMAGE}`);
console.log(`[build] context=${ctx}`);
execSync(`docker build -t "${CONTAINER_IMAGE}" -f Dockerfile .`, { stdio: "inherit", cwd: ctx });
console.log(`[build] done: ${CONTAINER_IMAGE}`);
