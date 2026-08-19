/**
 * container-runner.ts ?”â€?å®¹å™¨è¿è??¨ï?spawn Docker + ?‚è½½ + ?¤é? + ?Ÿå‘½?¨æ?è·Ÿè¸ª
 *
 * ?Œè´£ï¼šwakeContainerï¼ˆæ°¸ä¸æ?/å¸ƒå?è¿”å?/in-flight ?»é?ï¼‰ã€spawnContainer ?æ­¥?? *       buildMountsï¼ˆé¡ºåºå³è¯­ä?ï¼‰ã€hardeningArgs?killContainer(onExit ?¥å?)?? * ?³é”®å¯¼å‡ºï¼šwakeContainer, killContainer, isContainerRunning, getActiveContainerCount,
 *           buildMounts, buildContainerArgs, hardeningArgs, containerNameFor, VolumeMount
 *
 * ?¿é?ä¸å??ï?
 *   - wakeContainer æ°¸ä??›ï?true=?å?ï¼Œfalse=?¬æ€å¤±è´¥ï?host-sweep ?è?ï¼‰ï?è°ƒç”¨?¹é›¶?²å¾¡ä»??ï¼? *   - in-flight Promise Map ?²å?æ­¥æ?å»ºç????äºŒæ¬¡ spawnï¼ˆå?å®¹å™¨?Œå?å¤ï?ï¼? *   - spawn ?å??¤å­¤?¿å?è·³æ?ä»¶ï??¦å? sweep ?¨é???mtime ç§’æ??°å®¹?¨ï?ï¼? *   - --init ?å¯?‰ï?--entrypoint ç»•è??œå? tini ??SIGTERM ä¼šè¢« PID 1 ä¸¢å?ï¼‰ã€? * ?Ÿé‰´ï¼šnanoclaw src/container-runner.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?3ï¼? *   2026-08-12 å¤æ?ä¿®å?ï¼?-shm-size ? æ¡ä»¶é?? ï?pids-limit floor+finite ?¡é?
 */
import { spawn as defaultSpawn, type ChildProcess } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
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
  markContainerRunning,
  markContainerStopped,
  outboundDbPath,
  sessionDir,
} from "./session-manager.js";
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

/** ?¯æ³¨??spawnerï¼ˆæ?è¯•ç”¨ï¼?*/
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
  return `OC-${slug}-${Date.now()}`;
}

export function isContainerRunning(sessionId: string): boolean {
  return activeContainers.has(sessionId);
}

export function getActiveContainerCount(): number {
  return activeContainers.size;
}

// ---- ?‚è½½?„å»ºï¼ˆé¡ºåºå³è¯­ä?ï¼Œå€Ÿé‰´ nanoclaw buildMountsï¼?----

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
  // é¢å??‚è½½ç»?mount-security ?¡é?ï¼ˆç™½?å??¨é¡¹?®æ ¹ä¹‹å?ï¼?  for (const m of validateAdditionalMounts(config.mounts)) mounts.push(m);
  // provider è´¡çŒ®?‚è½½?€??  for (const m of provider.mounts) mounts.push(m);
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
  // èµ„æ??åˆ¶ï¼šç©º??ä¸å??‚æ•°=ä¸é??¶ï?ä¿æŠ¤å­˜é?å·¥ä?è´Ÿè½½ï¼?  const cpu = config.cpuLimit ?? CONTAINER_CPU_LIMIT;
  const mem = config.memoryLimit ?? CONTAINER_MEMORY_LIMIT;
  const pids = config.pidsLimit ?? CONTAINER_PIDS_LIMIT;
  if (cpu) args.push("--cpus", cpu);
  if (mem) args.push("--memory", mem);
  args.push("--shm-size=1g"); // ? æ¡ä»¶é?? ï?P2 ä¿®å?ï¼šDocker é»˜è®¤ 64m ä¼šé?é»˜çŸ­?™ï?
  const pidsNum = Math.floor(Number(pids)); // P2 ä¿®å?ï¼šé??´æ•°ä¸ä?ï¼ˆå¯¹é½åŸºçº?floorï¼?  if (Number.isFinite(pidsNum) && pidsNum > 0) args.push("--pids-limit", String(pidsNum));
  args.push(...hardeningArgs());
  args.push(...(EGRESS_LOCKDOWN ? egressNetworkArgs() : hostGatewayArgs()));
  for (const m of mounts) {
    args.push(...(m.readonly ? readonlyMountArgs(m.host, m.container) : readwriteMountArgs(m.host, m.container)));
  }
  // fix-plan P1ï¼šå??¥ä??ˆç? --env-fileï¼?600 ä¸´æ—¶?‡ä»¶ï¼‰æ³¨?¥ï??¿å??ºç°??docker run argvï¼ˆps ?¯è?ï¼‰ï?
  // ? æ?ä»¶æ—¶?é€€ -eï¼ˆæ?è¯?? å??¥åœº?¯ï???  if (envFilePath) {
    args.push("--env-file", envFilePath);
  } else {
    for (const [k, v] of Object.entries(env)) args.push("-e", `${k}=${v}`);
  }
  args.push("--entrypoint", "bash", CONTAINER_IMAGE, "-c", "exec bun run /app/src/index.ts"); // exec ä¿è?ä¿¡å·?ä?
  return args;
}

// ---- ?¤é? / spawn ----

export async function wakeContainer(session: Session): Promise<boolean> {
  if (activeContainers.has(session.id)) return true;
  const inflight = wakePromises.get(session.id);
  if (inflight) return inflight; // ?²å? spawn
  const p = spawnContainer(session).finally(() => wakePromises.delete(session.id));
  wakePromises.set(session.id, p);
  return p;
}

async function spawnContainer(session: Session): Promise<boolean> {
  try {
    const group = getAgentGroup(session.agent_group_id);
    if (!group) return false;

    // ?ºå£å°é?ï¼šå»ºç«‹å¤±è´¥æ?ç»?spawnï¼ˆfail-fastï¼?    try {
      ensureEgressNetwork();
    } catch (err) {
      if (err instanceof EgressLockdownError) {
        log.error("egress lockdown failed; refusing spawn", { err });
        return false;
      }
      throw err;
    }

    const config = materializeContainerJson(group); // DB?’æ?ä»¶ï?å¯¹è±¡è´¯ç©¿?ç»­
    initGroupFilesystem(group, { provider: config.provider });

    // fix-planï¼šå®¿ä¸»â?å®¹å™¨ KB ?Œæ­¥?”â€”æ?ç¾¤ç? KBï¼ˆå?=ç¾¤ç? folderï¼Œå??€ "kb"ï¼‰ç‰©?–åˆ°ç¾¤ç? kb/ ?®å?ï¼ˆå®¹??kb_search è¯»å?å¤„ï?
    try {
      const { exportKbToDir } = await import("./modules/memory-kb.js");
      const kbDir = join(resolveGroupFolderPath(group.folder), "kb");
      let synced = exportKbToDir(group.folder, kbDir);
      if (synced === 0 && group.folder !== "kb") synced = exportKbToDir("kb", kbDir);
      if (synced > 0) log.info(`kb synced -> ${group.folder}/kb (${synced} doc(s))`);
    } catch (err) {
      log.warn("kb sync failed", { err });
    }

    // ?¶æ®µ 6ï¼šspawn ?¶åˆ·??destinations ?•å½±ï¼ˆa2a è·¯ç”±è¡?+ å®¹å™¨?¯è? ACLï¼?    try {
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
    // fix-plan P1ï¼šprovider å¯†é’¥?™å…¥ 0600 ä¸´æ—¶?‡ä»¶ç»?--env-file æ³¨å…¥ï¼ˆä?è¿?argvï¼‰ï?å®¹å™¨?€?ºæ—¶æ¸…ç?
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

    // ? é™¤å­¤å„¿å¿ƒè·³?‡ä»¶ï¼ˆå¦??sweep ?¨é???mtime ç§’æ??°å®¹?¨ï?
    try {
      rmSync(heartbeatPath(session.agent_group_id, session.id), { force: true });
    } catch {
      /* ?æ? */
    }

    const proc = spawner(CONTAINER_RUNTIME_BIN, args);
    const entry: ActiveContainer = { name, proc, onExit: [] };
    if (envFilePath) {
      const envFile = envFilePath;
      entry.onExit.push(() => rmSync(envFile, { force: true })); // fix-plan P1ï¼šå®¹?¨é€€?ºå³? å??¥æ?ä»?    }
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
    // æ°¸ä??›ï??¬æ€å¤±è´¥äº¤ sweep ?è?
    log.error("spawnContainer failed (transient)", { err });
    return false;
  }
}

/** kill + onExit ?è?ï¼ˆå?è°ƒåœ¨è¿›ç??€?ºå?è§¦å?ï¼Œä?è¯æ—§å®¹å™¨æ­»é€æ?èµ·æ–°å®¹å™¨ï¼?*/
export function killContainer(session: Session, opts?: { onExit?: () => void }): void {
  const entry = activeContainers.get(session.id);
  if (!entry) {
    opts?.onExit?.();
    return;
  }
  if (opts?.onExit) entry.onExit.push(opts.onExit);
  stopContainer(entry.name);
}
