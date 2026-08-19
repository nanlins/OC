/**
 * egress-lockdown.ts —— 出口网络隔离（agent 容器无互联网，仅网关可达）
 *
 * 职责：幂等自愈建立 --internal Docker 网络；建立失败抛 EgressLockdownError（fail-fast：
 *       宁可不 spawn 也不开放出口）；sweep 每 tick 自愈一次。
 * 关键导出：ensureEgressNetwork, egressNetworkArgs, EgressLockdownError
 * 借鉴：nanoclaw src/egress-lockdown.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
import { execFileSync } from "node:child_process";
import { EGRESS_LOCKDOWN, EGRESS_NETWORK } from "./config.js";
import { CONTAINER_RUNTIME_BIN } from "./container-runtime.js";
import { log } from "./log.js";

export class EgressLockdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgressLockdownError";
  }
}

/** 关闭返回 false；开启且建立失败抛错（调用方拒绝 spawn） */
export function ensureEgressNetwork(): boolean {
  if (!EGRESS_LOCKDOWN) return false;
  try {
    const exists = execFileSync(CONTAINER_RUNTIME_BIN, ["network", "inspect", EGRESS_NETWORK], { stdio: "pipe" })
      .toString()
      .includes(`"name": "${EGRESS_NETWORK}"`);
    if (!exists) {
      execFileSync(CONTAINER_RUNTIME_BIN, ["network", "create", "--internal", EGRESS_NETWORK], { stdio: "pipe" });
      log.info(`egress network created: ${EGRESS_NETWORK}`);
    }
    return true;
  } catch (err) {
    throw new EgressLockdownError(`egress network setup failed: ${String(err)}`);
  }
}

export function egressNetworkArgs(): string[] {
  return EGRESS_LOCKDOWN ? ["--network", EGRESS_NETWORK] : [];
}
