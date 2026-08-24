/**
 * upgrade-state.ts —— 升级标记（tripwire）
 *
 * 职责：记录安装版本到达记录（data/upgrade-state.json）。启动时 enforceUpgradeTripwire
 *       拒绝非 sanctioned 路径（setup/update/migrate）的代码更新。
 * 关键导出：readUpgradeState, writeUpgradeState, enforceUpgradeTripwire, getCodeVersion
 * 承重不变量：标记缺失或版本不匹配 → 进程退出（fail-closed）
 * 借鉴：nanoclaw src/upgrade-state.ts（简化：去 CLI 修复命令提示）
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, PROJECT_ROOT } from "./config.js";
import { log } from "./log.js";

export interface UpgradeState {
  version: string;
  updatedAt: string;
  via: string;
}

const MARKER_PATH = join(DATA_DIR, "upgrade-state.json");

export function getCodeVersion(): string {
  const pkgPath = join(PROJECT_ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
  if (!pkg.version) throw new Error(`No version field in ${pkgPath}`);
  return pkg.version;
}

export function readUpgradeState(): UpgradeState | null {
  try {
    if (!existsSync(MARKER_PATH)) return null;
    return JSON.parse(readFileSync(MARKER_PATH, "utf-8")) as UpgradeState;
  } catch (err) {
    log.warn("upgrade marker read failed, treating as absent", { err });
    return null;
  }
}

export function writeUpgradeState(opts: { version?: string; via: string }): UpgradeState {
  const state: UpgradeState = {
    version: opts.version ?? getCodeVersion(),
    updatedAt: new Date().toISOString(),
    via: opts.via,
  };
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(MARKER_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
  return state;
}

export function isUpgradeCurrent(): boolean {
  const state = readUpgradeState();
  return state !== null && state.version === getCodeVersion();
}

export function enforceUpgradeTripwire(): void {
  if (isUpgradeCurrent()) return;
  const code = getCodeVersion();
  const recorded = readUpgradeState()?.version ?? "none";
  log.error("upgrade tripwire: version mismatch", { code, recorded });
  console.error(`OC 升级检查失败：代码版本 ${code}，记录版本 ${recorded}。请通过 setup 或 /update 流程升级。`);
  process.exit(1);
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

