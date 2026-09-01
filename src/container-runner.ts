/**
 * container-runner.ts —— 容器运行器：spawn Docker + 挂载 + 唤醒 + 生命周期跟踪
 *
 * 职责：wakeContainer（永不抛/布尔返回/in-flight 去重）、spawnContainer 十步、
 *       buildMounts（顺序即语义）、hardeningArgs、killContainer(onExit 接力)。
 * 关键导出：wakeContainer, killContainer, isContainerRunning, getActiveContainerCount,
 *           buildMounts, buildContainerArgs, hardeningArgs, containerNameFor, VolumeMount
 *
 * 承重不变量：
 *   - wakeContainer 永不抛：true=成功，false=瞬态失败（host-sweep 重试）；调用方零防御代码；
 *   - in-flight Promise Map 防异步构建窗口内二次 spawn（双容器双回复）；
 *   - spawn 前删除孤儿心跳文件（否则 sweep 用陈旧 mtime 秒杀新容器）；
 *   - --init 非可选（--entrypoint 绕过镜像 tini 时 SIGTERM 会被 PID 1 丢弃）。
 * 借鉴：nanoclaw src/container-runner.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 *   2026-08-12 复检修复：--shm-size 无条件附加；pids-limit floor+finite 校验
 *   2026-08-28 阶段 12 P0 修复：新增 ensureSessionDbFiles（docker run 前确保双库为文件），
 *              恢复块 rmSync 加 recursive——修复 outbound.db 被 bind-mount 误建目录致 SQLITE_CANTOPEN_ISDIR 永久卡死
 */
import { spawn as defaultSpawn, type ChildProcess } from "node:child_process";
import { rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTAINER_CPU_LIMIT,
  CONTAINER_IMAGE,
  CONTAINER_INSTALL_LABEL,
  CONTAINER_MEMORY_LIMIT,
  CONTAINER_PIDS_LIMIT,
  DATA_DIR,
  EGRESS_LOCKDOWN,
} from "./config.js";
import { materializeContainerJson, type ContainerConfig } from "./container-config.js";
import {
  CONTAINER_RUNTIME_BIN,
  CONTAINER_NAME_RE,
  hostGatewayArgs,
  readwriteMountArgs,
  readonlyMountArgs,
  stopContainer,
} from "./container-runtime.js";
import { egressNetworkArgs, ensureEgressNetwork, EgressLockdownError } from "./egress-lockdown.js";
import { getAgentGroup } from "./db/agent-groups.js";
import { initGroupFilesystem } from "./group-init.js";
import { resolveGroupFolderPath } from "./group-folder.js";
import {
  resolveProviderContribution,
  type ProviderContainerContribution,
  type VolumeMount,
} from "./providers/provider-container-registry.js";
import {
  heartbeatPath,
  inboundDbPath,
  initSessionFolder,
  markContainerRunning,
  markContainerStopped,
  outboundDbPath,
  sessionDir,
} from "./session-manager.js";
import { openOutboundDbRw } from "./db/session-db.js";
import { validateAdditionalMounts } from "./modules/mount-security.js";
import { log } from "./log.js";
import type { Session } from "./types.js";

export type { VolumeMount };

interface ActiveContainer {
  name: string;
  proc: ChildProcess;
  onExit: Array<() => void>;
}

const activeContainers = new Map<string, ActiveContainer>();
const wakePromises = new Map<string, Promise<boolean>>();

/** 可注入 spawner（测试用） */
type Spawner = (bin: string, args: string[]) => ChildProcess;
let spawner: Spawner = defaultSpawn;
export function setContainerSpawnerForTest(fn: Spawner): void {
  spawner = fn;
}
export function resetContainerSpawnerForTest(): void {
  spawner = defaultSpawn;
  activeContainers.clear();
  wakePromises.clear();
}

export function containerNameFor(session: Session): string {
  const slug = session.agent_group_id.slice(0, 8);
  return `oc-${slug}-${Date.now()}`;
}

export function isContainerRunning(sessionId: string): boolean {
  return activeContainers.has(sessionId);
}

export function getActiveContainerCount(): number {
  return activeContainers.size;
}

// ---- 挂载构建（顺序即语义，借鉴 nanoclaw buildMounts） ----

export function buildMounts(
  session: Session,
  config: ContainerConfig,
  provider: ProviderContainerContribution,
): VolumeMount[] {
  const sDir = sessionDir(session.agent_group_id, session.id);
  const groupDir = resolveGroupFolderPath(getAgentGroup(session.agent_group_id)?.folder ?? "");
  const mounts: VolumeMount[] = [
    { host: sDir, container: "/workspace" },
    { host: inboundDbPath(session.agent_group_id, session.id), container: "/workspace/inbound.db", readonly: true },
    { host: outboundDbPath(session.agent_group_id, session.id), container: "/workspace/outbound.db" },
    { host: groupDir, container: "/workspace/agent" },
    { host: join(groupDir, "container.json"), container: "/workspace/agent/container.json", readonly: true },
    { host: join(groupDir, "CLAUDE.md"), container: "/workspace/agent/CLAUDE.md", readonly: true },
  ];
  // 额外挂载经 mount-security 校验（白名单在项目根之外）
  for (const m of validateAdditionalMounts(config.mounts)) mounts.push(m);
  // provider 贡献挂载最后
  for (const m of provider.mounts) mounts.push(m);
  return mounts;
}

export function hardeningArgs(): string[] {
  return ["--cap-drop=ALL", "--security-opt=no-new-privileges", "--init"];
}

export function buildContainerArgs(
  mounts: VolumeMount[],
  name: string,
  config: ContainerConfig,
  env: Record<string, string>,
  envFilePath?: string | null,
): string[] {
  const args: string[] = ["run", "--rm", "--name", name, "--label", CONTAINER_INSTALL_LABEL];
  // 资源限制：空值=不加参数=不限制（保护存量工作负载）
  const cpu = config.cpuLimit ?? CONTAINER_CPU_LIMIT;
  const mem = config.memoryLimit ?? CONTAINER_MEMORY_LIMIT;
  const pids = config.pidsLimit ?? CONTAINER_PIDS_LIMIT;
  if (cpu) args.push("--cpus", cpu);
  if (mem) args.push("--memory", mem);
  args.push("--shm-size=1g"); // 无条件附加（P2 修复：Docker 默认 64m 会静默短写）
  const pidsNum = Math.floor(Number(pids)); // P2 修复：非整数不传（对齐基线 floor）
  if (Number.isFinite(pidsNum) && pidsNum > 0) args.push("--pids-limit", String(pidsNum));
  args.push(...hardeningArgs());
  args.push(...(EGRESS_LOCKDOWN ? egressNetworkArgs() : hostGatewayArgs()));
  for (const m of mounts) {
    args.push(...(m.readonly ? readonlyMountArgs(m.host, m.container) : readwriteMountArgs(m.host, m.container)));
  }
  // fix-plan P1：密钥优先经 --env-file（0600 临时文件）注入，避免出现在 docker run argv（ps 可见）；
  // 无文件时回退 -e（测试/无密钥场景）。
  if (envFilePath) {
    args.push("--env-file", envFilePath);
  } else {
    for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
  }
  args.push("--entrypoint", "bash", CONTAINER_IMAGE, "-c", "exec bun run /app/src/index.ts"); // exec 保证信号透传
  return args;
}

// ---- 唤醒 / spawn ----

export async function wakeContainer(session: Session): Promise<boolean> {
  if (activeContainers.has(session.id)) return true;
  const inflight = wakePromises.get(session.id);
  if (inflight) return inflight; // 防双 spawn
  const p = spawnContainer(session).finally(() => wakePromises.delete(session.id));
  wakePromises.set(session.id, p);
  return p;
}

/**
 * spawn 前确保 inbound.db/outbound.db 以"文件"形式存在（P0 修复，阶段 12 实测）。
 * Docker bind-mount 挂载【不存在】的文件路径时会自动创建【目录】，better-sqlite3 之后打开
 * 报 SQLITE_CANTOPEN_ISDIR；且非递归 rmSync 无法清除该目录 → 后台循环每分钟重复失败、永久卡死。
 * 触发点：下方恢复逻辑（完整性检查失败）rmSync 删除 outbound.db 文件后未重建即 docker run。
 * 故 docker run 前：先递归清除任何误生成目录的路径，再经 initSessionFolder 重建双库文件+schema。
 */
function ensureSessionDbFiles(session: Session): void {
  for (const p of [
    inboundDbPath(session.agent_group_id, session.id),
    outboundDbPath(session.agent_group_id, session.id),
  ]) {
    const st = statSync(p, { throwIfNoEntry: false });
    if (st?.isDirectory()) {
      rmSync(p, { recursive: true, force: true });
    }
  }
  initSessionFolder(session);
}

async function spawnContainer(session: Session): Promise<boolean> {
  try {
    const group = getAgentGroup(session.agent_group_id);
    if (!group) return false;

    // 出口封锁：建立失败拒绝 spawn（fail-fast）
    try {
      ensureEgressNetwork();
    } catch (err) {
      if (err instanceof EgressLockdownError) {
        log.error("egress lockdown failed; refusing spawn", { err });
        return false;
      }
      throw err;
    }

    const config = materializeContainerJson(group); // DB→文件，对象贯穿后续
    initGroupFilesystem(group, { provider: config.provider });

    // fix-plan：宿主→容器 KB 同步——把群组 KB（名=群组 folder，回退 "kb"）物化到群组 kb/ 目录（容器 kb_search 读取处）
    try {
      const { exportKbToDir } = await import("./modules/memory-kb.js");
      const kbDir = join(resolveGroupFolderPath(group.folder), "kb");
      let synced = exportKbToDir(group.folder, kbDir);
      if (synced === 0 && group.folder !== "kb") synced = exportKbToDir("kb", kbDir);
      if (synced > 0) log.info(`kb synced -> ${group.folder}/kb (${synced} doc(s))`);
    } catch (err) {
      log.warn("kb sync failed", { err });
    }

    // 阶段 6：spawn 时刷新 destinations 投影（a2a 路由表 + 容器可见 ACL）
    try {
      const { writeDestinations } = await import("./modules/agent-to-agent.js");
      writeDestinations(session);
    } catch (err) {
      log.warn("writeDestinations failed", { err });
    }

    const provider = resolveProviderContribution(config.provider, {
      sessionDir: sessionDir(session.agent_group_id, session.id),
      agentGroupId: session.agent_group_id,
      groupDir: resolveGroupFolderPath(group.folder),
      hostEnv: {},
    });

    const mounts = buildMounts(session, config, provider);
    const name = containerNameFor(session);
    if (!CONTAINER_NAME_RE.test(name)) return false;
    // fix-plan P1：provider 密钥写入 0600 临时文件经 --env-file 注入（不进 argv），容器退出时清理
    let envFilePath: string | null = null;
    const envEntries = Object.entries(provider.env);
    if (envEntries.length > 0) {
      envFilePath = join(DATA_DIR, `.container-env-${name}`);
      try {
        writeFileSync(envFilePath, envEntries.map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
      } catch (err) {
        log.warn("container env file write failed; falling back to -e", { err });
        envFilePath = null;
      }
    }
    const args = buildContainerArgs(mounts, name, config, provider.env, envFilePath);

    // 阶段 12 实测修复：上次容器崩溃/被杀会留下 outbound.db 的 hot journal（DELETE journal 跨挂载恢复会触发
    // readonly/locked 连锁故障）。spawn 前清理残留 journal/wal/shm——崩溃恢复语义：未提交事务本就丢弃。
    try {
      const sDir = sessionDir(session.agent_group_id, session.id);
      for (const suffix of ["-journal", "-wal", "-shm"]) {
        rmSync(join(sDir, `outbound.db${suffix}`), { force: true });
        rmSync(join(sDir, `inbound.db${suffix}`), { force: true });
      }
    } catch {
      /* 清理失败不阻断 spawn（下一轮再试） */
    }

    // 阶段 12 实测修复：崩溃时页写入不完整会导致 outbound.db 物理损坏（容器打开报 disk I/O error）。
    // spawn 前 RW 打开触发恢复 + integrity_check；损坏则删除重建（容器侧 getOutboundDb 有 schema 自愈）。
    try {
      const outPath = outboundDbPath(session.agent_group_id, session.id);
      const chkDb = openOutboundDbRw(outPath);
      const integrity = chkDb.pragma("integrity_check", { simple: true }) as unknown as string;
      chkDb.close();
      if (integrity !== "ok") {
        log.warn(`outbound.db integrity check failed; rebuilding session db`, { sessionId: session.id, integrity });
        rmSync(outPath, { force: true, recursive: true });
      }
    } catch (err) {
      log.warn(`outbound.db recovery failed; rebuilding`, { sessionId: session.id, err });
      try {
        rmSync(outboundDbPath(session.agent_group_id, session.id), { force: true, recursive: true });
      } catch {
        /* 删除失败留给下一轮 */
      }
    }

    // P0 修复（阶段 12 实测）：上方恢复逻辑可能已删除 outbound.db 文件——docker run 前必须确保
    // 双库以文件形式存在，否则 bind-mount 会把缺失路径创建成目录（SQLITE_CANTOPEN_ISDIR 永久卡死）。
    try {
      ensureSessionDbFiles(session);
    } catch (err) {
      log.warn("ensureSessionDbFiles failed (transient)", { sessionId: session.id, err });
    }

    // 删除孤儿心跳文件（否则 sweep 用陈旧 mtime 秒杀新容器）
    try {
      rmSync(heartbeatPath(session.agent_group_id, session.id), { force: true });
    } catch {
      /* 吞掉 */
    }

    const proc = spawner(CONTAINER_RUNTIME_BIN, args);
    const entry: ActiveContainer = { name, proc, onExit: [] };
    if (envFilePath) {
      const envFile = envFilePath;
      entry.onExit.push(() => rmSync(envFile, { force: true })); // fix-plan P1：容器退出即删密钥文件
    }
    activeContainers.set(session.id, entry);
    markContainerRunning(session);

    let stderrTail: string[] = [];
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrTail = [...stderrTail, ...chunk.toString().split(/\r?\n/)].filter(Boolean).slice(-10);
    });

    const onClosed = (code: number | null, signal: NodeJS.Signals | null) => {
      activeContainers.delete(session.id);
      markContainerStopped(session);
      const cbs = entry.onExit.splice(0);
      for (const cb of cbs) {
        try {
          cb();
        } catch (err) {
          log.warn("onExit callback failed", { err });
        }
      }
      if (code !== 0 && code !== null && !signal) {
        log.warn(`container exited non-zero: ${name} code=${code}`, { tail: stderrTail.join("\n") });
      }
    };
    proc.on("close", onClosed);
    proc.on("error", (err) => {
      log.error(`container spawn error: ${name}`, { err });
      activeContainers.delete(session.id);
      markContainerStopped(session);
    });
    return true;
  } catch (err) {
    // 永不抛：瞬态失败交 sweep 重试
    log.error("spawnContainer failed (transient)", { err });
    return false;
  }
}

/** kill + onExit 回调（回调在进程退出后触发，保证旧容器死透才起新容器） */
export function killContainer(session: Session, opts?: { onExit?: () => void }): void {
  const entry = activeContainers.get(session.id);
  if (!entry) {
    opts?.onExit?.();
    return;
  }
  if (opts?.onExit) entry.onExit.push(opts.onExit);
  stopContainer(entry.name);
}
