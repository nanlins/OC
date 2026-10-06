/**
 * container-runtime.ts —— 容器运行时抽象层（所有 docker CLI 细节集中于此）
 *
 * 职责：运行时二进制、host-gateway 参数、只读挂载参数、stop（名字正则防注入）、
 *       运行时存活检查（失败打 ASCII FATAL）、孤儿清理（按 install label 只收本安装）。
 * 关键导出：CONTAINER_RUNTIME_BIN, resolveRuntimeBin, hostGatewayArgs, readonlyMountArgs,
 *           stopContainer, ensureContainerRuntimeRunning, cleanupOrphans, CONTAINER_NAME_RE
 * 核心模式：换运行时只改这一个文件；label 作用域隔离。
 * 借鉴：nanoclaw src/container-runtime.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 *   2026-10-06 P2-2：OPENCLAW_CONTAINER_BIN → OC_CONTAINER_BIN；新增 resolveRuntimeBin
 *              （docker/podman 白名单 + 路径字符校验，非法回落 docker）；
 *              ensureContainerRuntimeRunning 区分 ENOENT（二进制缺失）与守护进程不可达
 */
import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { CONTAINER_INSTALL_LABEL } from "./config.js";
import { log } from "./log.js";

/**
 * 容器运行时二进制解析（P2-2）。
 *
 * 环境变量由 OPENCLAW_CONTAINER_BIN 更名为 OC_CONTAINER_BIN（项目已改名，旧名不再读取）。
 * 白名单 + 形状校验：只接受 docker / podman（含 .exe 后缀与显式路径），其余一律拒绝并回落
 * "docker"。虽然 execFileSync 不经 shell、argv[0] 里的元字符不会被解释，但把"能 exec 什么"
 * 收敛成白名单是纵深防御：配置被污染时最多回落到默认运行时，不会变成任意程序执行入口。
 *
 * 真正的可执行性校验在 ensureContainerRuntimeRunning（跑 `<bin> info`）——那里能区分
 * "二进制不存在"与"守护进程没起"，模块加载期不做 I/O（保持纯函数可单测）。
 */
const RUNTIME_ALLOWLIST = new Set(["docker", "podman"]);
/**
 * 拒绝 shell 元字符与控制字符。execFileSync 不经 shell，argv[0] 里的元字符本就不会被解释，
 * 所以这层是纵深防御（万一将来有人改成 execSync 也不会变成命令注入）。
 * 空格是允许的：Windows 上 "C:\Program Files\Docker\docker.exe" 是合法且常见的路径。
 */
const UNSAFE_BIN_RE = /[\r\n;|&$<>"'`*\0]/;

export function resolveRuntimeBin(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "docker";
  if (UNSAFE_BIN_RE.test(value)) {
    log.warn(`OC_CONTAINER_BIN refused (shell metacharacter), falling back to docker: ${JSON.stringify(value)}`);
    return "docker";
  }
  const base = basename(value)
    .replace(/\.exe$/i, "")
    .toLowerCase();
  if (!RUNTIME_ALLOWLIST.has(base)) {
    log.warn(`OC_CONTAINER_BIN refused (not in allowlist ${[...RUNTIME_ALLOWLIST].join("|")}): ${value}`);
    return "docker";
  }
  return value;
}

export const CONTAINER_RUNTIME_BIN = resolveRuntimeBin(process.env.OC_CONTAINER_BIN);

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
    // P2-2：区分"二进制不可执行"与"守护进程没起"——两者的处置完全不同
    // （前者要装/改 OC_CONTAINER_BIN，后者要启动 Docker Desktop / dockerd）。
    const code = (err as NodeJS.ErrnoException)?.code;
    const hint =
      code === "ENOENT"
        ? `runtime binary not found or not executable: ${CONTAINER_RUNTIME_BIN} (set OC_CONTAINER_BIN to docker or podman)`
        : `runtime binary ran but the daemon is unreachable: ${CONTAINER_RUNTIME_BIN}`;
    log.fatal(
      `+----------------------------------------------------------+\n` +
        `| container runtime unavailable (${CONTAINER_RUNTIME_BIN}).\n` +
        `| ${hint}\n` +
        `| OC cannot spawn agent containers without it.\n` +
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
