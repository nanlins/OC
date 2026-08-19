/**
 * modules/mount-security.ts ?”â€?é¢å??‚è½½å®‰å…¨?¡é?
 *
 * ?Œè´£ï¼šç™½?å?ï¼ˆé¡¹?®æ ¹ä¹‹å?ï¼Œé˜²å®¹å™¨?ªæ”¹è§„å?ï¼? é»˜è®¤ blocked patterns + containerPath æ³¨å…¥?²å¾¡ +
 *       RW ?Œé??¡ä»¶ï¼ˆæ?è½½æ˜¾å¼è¯·æ±????¹å?è®¸ï??¦å?å¼ºåˆ¶?ªè¯»ï¼‰ã€? * ?³é”®å¯¼å‡ºï¼švalidateAdditionalMounts, MountConfig
 * ?¸å?æ¨¡å?ï¼šmtime ç¼“å?ä½†è§£?é?è¯¯ä?ç¼“å?ï¼ˆä¿®å¥½å³?¢å?ï¼‰ã€? * ?Ÿé‰´ï¼šnanoclaw src/modules/mount-security/
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?3ï¼Œæ??ä??¶æ®µ 6 ??container-runner ä¾è?ï¼? *   2026-08-12 å¤æ?ä¿®å?ï¼šrealpath ?¡é?å¹¶æ?è½?realpathï¼›å®¹?¨è·¯å¾„æ?ç®?/workspace/extra/ï¼›blocked æ¸…å??©å?ï¼›Windows ?†é?ç¬¦å?ä¸€
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_ALLOWLIST_PATH } from "../config.js";
import { log } from "../log.js";
import type { VolumeMount } from "../providers/provider-container-registry.js";

export interface MountConfig {
  host: string;
  /** ?¸å¯¹å®¹å™¨æ²™ç®±?¹ç?è·¯å?ï¼›ç?å¯¹è·¯å¾?.. ä¸€å¾‹æ?ç»ï?P1 ä¿®å?ï¼šæ?ç®±åˆ° /workspace/extra/ï¼Œé˜²?®è”½ RO ?‚è½½ï¼?*/
  container: string;
  readonly?: boolean;
}

interface Allowlist {
  roots: Array<{ path: string; allowReadWrite?: boolean }>;
  blockedPatterns: string[];
}

const DEFAULT_BLOCKED = [
  ".ssh",
  ".aws",
  ".env",
  ".config/OC",
  ".local/bin",
  ".gnupg",
  ".netrc",
  ".npmrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519",
  "credentials",
  "private_key",
  ".secret",
  ".kube",
  ".docker",
];

let cache: { mtime: number; list: Allowlist } | null = null;
let allowlistPathOverride: string | null = null;

/** ä»…ä?æµ‹è?ï¼šè??–ç™½?å?è·¯å? */
export function setMountAllowlistPathForTest(p: string | null): void {
  allowlistPathOverride = p;
  cache = null;
}

function allowlistPath(): string {
  return allowlistPathOverride ?? MOUNT_ALLOWLIST_PATH;
}

function loadAllowlist(): Allowlist {
  const path = allowlistPath();
  if (!existsSync(path)) return { roots: [], blockedPatterns: DEFAULT_BLOCKED };
  const mtime = statSync(path).mtimeMs;
  if (cache && cache.mtime === mtime) return cache.list;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Allowlist>;
    const list: Allowlist = {
      roots: Array.isArray(parsed.roots) ? parsed.roots : [],
      blockedPatterns: Array.isArray(parsed.blockedPatterns) ? parsed.blockedPatterns : DEFAULT_BLOCKED,
    };
    cache = { mtime, list }; // è§???å??ç?å­?    return list;
  } catch (err) {
    log.warn("mount allowlist parse error (not cached)", { err });
    return { roots: [], blockedPatterns: DEFAULT_BLOCKED };
  }
}

function containerPathSafe(p: string): boolean {
  // P1 ä¿®å?ï¼šå®¹?¨è·¯å¾„å?é¡»æ˜¯?¸å¯¹è·¯å?ï¼ˆæ?ç®±åˆ° /workspace/extra/ï¼‰ï?
  // ?’ç?å¯¹æ?å½¢æ€ï?ç»å¯¹è·¯å?/.. /?’å· ?”â€??²é®??/workspace/inbound.db ç­‰å…³??RO ?‚è½½
  if (p.startsWith("/")) return false;
  if (p.includes("..") || p.includes(":") || p.includes("\0")) return false;
  return p.length > 0;
}

/** ?¡é??ç½®?‚è½½ï¼›ä?å®‰å…¨?„ä¸¢å¼ƒå¹¶?Šè­¦ï¼›RW ä¸æ»¡è¶³å??æ¡ä»¶å??çº§?ªè¯»?? *  P1 ä¿®å?ï¼ˆse-inspectorï¼‰ï?realpath ?¡é?å¹¶æ?è½?realpathï¼ˆç¬¦?·é“¾?¥ä?å¾—ç??½å??•ï???*/
export function validateAdditionalMounts(mounts: MountConfig[]): VolumeMount[] {
  const list = loadAllowlist();
  const out: VolumeMount[] = [];
  for (const m of mounts) {
    if (!containerPathSafe(m.container)) {
      log.warn(`mount rejected: unsafe container path ${m.container}`);
      continue;
    }
    let host: string;
    try {
      host = realpathSync(m.host); // ä¸å??¨å??????’ç?
    } catch {
      log.warn(`mount rejected: host path unresolvable ${m.host}`);
      continue;
    }
    const norm = host.replace(/\\/g, "/"); // Windows ?†é?ç¬¦å?ä¸€ï¼ˆP2 ä¿®å?ï¼?    const root = list.roots.find((r) => {
      const rr = resolve(r.path).replace(/\\/g, "/");
      return norm === rr || norm.startsWith(rr + "/");
    });
    if (!root) {
      log.warn(`mount rejected: host path outside allowlist ${m.host}`);
      continue;
    }
    if (list.blockedPatterns.some((bp) => norm.includes(`/${bp}/`) || norm.endsWith(`/${bp}`))) {
      log.warn(`mount rejected: blocked pattern ${m.host}`);
      continue;
    }
    // RW ?€"?‚è½½?¾å?è¯·æ? ???¹å?è®?ï¼Œå¦?™å¼º?¶åªè¯?    const rw = m.readonly === false && root.allowReadWrite === true;
    out.push({ host, container: `/workspace/extra/${m.container}`, readonly: !rw });
  }
  return out;
}

/** ä»…ä?æµ‹è?ï¼šæ?ç¼“å? */
export function clearMountSecurityCacheForTest(): void {
  cache = null;
}
