/**
 * container-runtime.ts ?”â€?å®¹å™¨è¿è??¶æŠ½è±¡å?ï¼ˆæ???docker CLI ç»†è??†ä¸­äºæ­¤ï¼? *
 * ?Œè´£ï¼šè?è¡Œæ—¶äºŒè??¶ã€host-gateway ?‚æ•°?åªè¯»æ?è½½å??°ã€stopï¼ˆå?å­—æ­£?™é˜²æ³¨å…¥ï¼‰ã€? *       è¿è??¶å?æ´»æ??¥ï?å¤±è´¥??ASCII FATALï¼‰ã€å­¤?¿æ??†ï???install label ?ªæ”¶?¬å?è£…ï??? * ?³é”®å¯¼å‡ºï¼šCONTAINER_RUNTIME_BIN, hostGatewayArgs, readonlyMountArgs, stopContainer,
 *           ensureContainerRuntimeRunning, cleanupOrphans, CONTAINER_NAME_RE
 * ?¸å?æ¨¡å?ï¼šæ¢è¿è??¶åª?¹è?ä¸€ä¸ªæ?ä»¶ï?label ä½œç”¨?Ÿé?ç¦»ã€? * ?Ÿé‰´ï¼šnanoclaw src/container-runtime.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?3ï¼? */
import { execFileSync } from "node:child_process";
import { CONTAINER_INSTALL_LABEL } from "./config.js";
import { log } from "./log.js";

export const CONTAINER_RUNTIME_BIN = process.env.OC_CONTAINER_BIN ?? "docker";

/** å®¹å™¨?ç™½?å?æ­??ï¼šé˜² stop/rm ?½ä»¤æ³¨å…¥ */
export const CONTAINER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function hostGatewayArgs(): string[] {
  // Linux ?æ? host-gateway é­”æ?ï¼›å…¶ä»–å¹³?°å®¹?¨ç?é»˜è®¤æ¡¥æ¥ç½‘ç?
  if (process.platform === "linux") return ["--add-host=host.docker.internal:host-gateway"];
  return [];
}

export function readonlyMountArgs(host: string, container: string): string[] {
  return ["-v", `${host}:${container}:ro`];
}

export function readwriteMountArgs(host: string, container: string): string[] {
  return ["-v", `${host}:${container}`];
}

/** stop ?å?å­—æ­£?™æ ¡éªŒï?-t 1 å¿«é€Ÿå?æ­¢ï?SIGTERM ??1s SIGKILLï¼?*/
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
        `| OC cannot spawn agent containers without it.       |\n` +
        `+----------------------------------------------------------+`,
      { err },
    );
    return false;
  }
}

/** å­¤å„¿æ¸…ç?ï¼šåª?¶å¸¦?¬å?è£?label ?„è?è¡Œä¸­å®¹å™¨ */
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
