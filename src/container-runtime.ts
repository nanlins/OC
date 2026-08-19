/**
 * container-runtime.ts —— 容器运行时抽象层（所有 docker CLI 细节集中于此）
 *
 * 职责：运行时二进制、host-gateway 参数、只读挂载参数、stop（名字正则防注入）、
 *       运行时存活检查（失败打 ASCII FATAL）、孤儿清理（按 install label 只收本安装）。
 * 关键导出：CONTAINER_RUNTIME_BIN, hostGatewayArgs, readonlyMountArgs, stopContainer,
 *           ensureContainerRuntimeRunning, cleanupOrphans, CONTAINER_NAME_RE
 * 核心模式：换运行时只改这一个文件；label 作用域隔离。
 * 借鉴：nanoclaw src/container-runtime.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
import { execFileSync } from "node:child_process";
import { CONTAINER_INSTALL_LABEL } from "./config.js";
import { log } from "./log.js";

export const CONTAINER_RUNTIME_BIN = process.env.OPENCLAW_CONTAINER_BIN ?? "docker";

/** 容器名白名单正则：防 stop/rm 命令注入 */
export const CONTAINER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function hostGatewayArgs(): string[] {
  // Linux 才有 host-gateway 魔法；其他平台容器经默认桥接网络
  if (process.platform === "linux") return ["--add-host=host.docker.internal:host-gateway"];
  return [];
}

export function readonlyMountArgs(host: string, container: string): string[] {
  return ["-v", `${host}:${container}:ro`];
}

export function readwriteMountArgs(host: string, container: string): string[] {
  return ["-v", `${host}:${container}`];
}

/** stop 前名字正则校验；-t 1 快速停止（SIGTERM 后 1s SIGKILL） */
export function stopContainer(name: string, timeoutSec = 1): void {
  if (!CONTAINER_NAME_RE.test(name)) {
    log.warn(`refusing to stop invalid container name: ${name}`);
    return;
  }
  try {
    execFileSync(CONTAINER_RUNTIME_BIN, ["stop", "-t", String(timeoutSec), name], { stdio: "pipe" });
  } catch (err) {
    log.warn(`container stop failed: ${name}`, { err });
  }
}

export function ensureContainerRuntimeRunning(): boolean {
  try {
    execFileSync(CONTAINER_RUNTIME_BIN, ["info", "--format", "{{.ServerVersion}}"], { stdio: "pipe" });
    return true;
  } catch (err) {
    log.fatal(
      `+----------------------------------------------------------+\n` +
        `| container runtime unavailable (${CONTAINER_RUNTIME_BIN}).              |\n` +
        `| OpenClaw cannot spawn agent containers without it.       |\n` +
        `+----------------------------------------------------------+`,
      { err },
    );
    return false;
  }
}

/** 孤儿清理：只收带本安装 label 的运行中容器 */
export function cleanupOrphans(liveSessionContainerNames: Set<string>): string[] {
  let out: string[] = [];
  try {
    const raw = execFileSync(
      CONTAINER_RUNTIME_BIN,
      ["ps", "--filter", `label=${CONTAINER_INSTALL_LABEL}`, "--format", "{{.Names}}"],
      { stdio: "pipe" },
    ).toString();
    out = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((n) => n && CONTAINER_NAME_RE.test(n) && !liveSessionContainerNames.has(n));
    for (const name of out) stopContainer(name);
    if (out.length > 0) log.warn(`orphan containers stopped: ${out.join(", ")}`);
  } catch (err) {
    log.warn("orphan cleanup failed", { err });
  }
  return out;
}
