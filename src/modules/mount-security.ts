/**
 * modules/mount-security.ts —— 额外挂载安全校验
 *
 * 职责：白名单（项目根之外，防容器自改规则）+ 默认 blocked patterns + containerPath 注入防御 +
 *       RW 双重条件（挂载显式请求 ∧ 根允许，否则强制只读）。
 * 关键导出：validateAdditionalMounts, MountConfig
 * 核心模式：mtime 缓存但解析错误不缓存（修好即恢复）。
 * 借鉴：nanoclaw src/modules/mount-security/
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3，提前于阶段 6 因 container-runner 依赖）
 *   2026-08-12 复检修复：realpath 校验并挂载 realpath；容器路径沙箱 /workspace/extra/；blocked 清单扩充；Windows 分隔符归一
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_ALLOWLIST_PATH } from "../config.js";
import { log } from "../log.js";
import type { VolumeMount } from "../providers/provider-container-registry.js";

export interface MountConfig {
  host: string;
  /** 相对容器沙箱根的路径；绝对路径/.. 一律拒绝（P1 修复：沙箱到 /workspace/extra/，防遮蔽 RO 挂载） */
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
  ".config/openclaw",
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

/** 仅供测试：覆盖白名单路径 */
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
    cache = { mtime, list }; // 解析成功才缓存
    return list;
  } catch (err) {
    log.warn("mount allowlist parse error (not cached)", { err });
    return { roots: [], blockedPatterns: DEFAULT_BLOCKED };
  }
}

function containerPathSafe(p: string): boolean {
  // P1 修复：容器路径必须是相对路径（沙箱到 /workspace/extra/），
  // 拒绝对抗形态：绝对路径/.. /冒号 —— 防遮蔽 /workspace/inbound.db 等关键 RO 挂载
  if (p.startsWith("/")) return false;
  if (p.includes("..") || p.includes(":") || p.includes("\0")) return false;
  return p.length > 0;
}

/** 校验配置挂载；不安全的丢弃并告警；RW 不满足双重条件则降级只读。
 *  P1 修复（se-inspector）：realpath 校验并挂载 realpath（符号链接不得绕白名单）。 */
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
      host = realpathSync(m.host); // 不存在则抛 → 拒绝
    } catch {
      log.warn(`mount rejected: host path unresolvable ${m.host}`);
      continue;
    }
    const norm = host.replace(/\\/g, "/"); // Windows 分隔符归一（P2 修复）
    const root = list.roots.find((r) => {
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
    // RW 需"挂载显式请求 ∧ 根允许"，否则强制只读
    const rw = m.readonly === false && root.allowReadWrite === true;
    out.push({ host, container: `/workspace/extra/${m.container}`, readonly: !rw });
  }
  return out;
}

/** 仅供测试：清缓存 */
export function clearMountSecurityCacheForTest(): void {
  cache = null;
}
