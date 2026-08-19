/**
 * host-sweep.ts —— 60 秒主机巡检
 *
 * 职责（每会话）：1 ack 同步 → 2 到期唤醒（先于崩溃清理，防死锁）→ 3 运行中 SLA
 * （decideStuckAction 纯函数：kill-ceiling 30min / kill-claim 60s+心跳印证；justWoke 宽限）→
 * 4 崩溃清理（指数退避/tries≥5 failed/孤儿 ack 删除）→ 5 循环任务钩子（MODULE-HOOK，阶段 6）→
 * 6 任务会话 GC。tick 级：egress 自愈。
 * 关键导出：startHostSweep, stopHostSweep, decideStuckAction, parseSqliteUtc,
 *           ABSOLUTE_CEILING_MS, CLAIM_STUCK_MS, shouldCloseTaskSession
 * 承重不变量：心跳文件不存在【不判】ceiling（新容器还没产生心跳，判则秒杀）；
 *           parseSqliteUtc 无时区标记补 'Z'（否则非 UTC 主机误杀新认领消息）。
 * 借鉴：nanoclaw src/host-sweep.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 *   2026-08-12 复检修复：kill-claim 心跳缺失分支；任务 GC 实查 countLiveTasks；outbound 维护写登记第二例外
 */
import { existsSync, statSync } from "node:fs";
import { onHostStart, onHostShutdown } from "./host-lifecycle.js";
import { listActiveSessions, markSessionClosed, TASKS_SYSTEM_THREAD_PREFIX } from "./db/sessions.js";
import {
  countDueMessages,
  countLiveTasks,
  getContainerToolState,
  getProcessingClaims,
  openInboundDb,
  openOutboundDbRw,
  pruneSyncedProcessingAcks,
  resetStuckProcessingRows,
  syncProcessingAcks,
} from "./db/session-db.js";
import { heartbeatPath, inboundDbPath, outboundDbPath } from "./session-manager.js";
import { wakeContainer, killContainer, isContainerRunning } from "./container-runner.js";
import { ensureEgressNetwork, EgressLockdownError } from "./egress-lockdown.js";
import { handleRecurrence } from "./modules/scheduling.js";
import { log } from "./log.js";
import type { Session } from "./types.js";

export const SWEEP_INTERVAL_MS = 60_000;
export const ABSOLUTE_CEILING_MS = 30 * 60 * 1000; // 活着但沉默 30 分钟
export const CLAIM_STUCK_MS = 60 * 1000; // 认领后无生命迹象 60s（或声明超时）

export type StuckAction = "none" | "kill-ceiling" | "kill-claim";

/** 无时区标记的 SQLite 时间戳补 'Z'（承重：防非 UTC 主机误判） */
export function parseSqliteUtc(value: string): number {
  const iso = /Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export interface StuckInput {
  nowMs: number;
  heartbeatMtimeMs: number | null; // null = 心跳文件不存在
  claims: Array<{ claimedAt: string | null }>;
  declaredTimeoutMs: number | null;
  justWoke: boolean;
}

/** 纯函数决策（可单测，借鉴 nanoclaw decideStuckAction） */
export function decideStuckAction(input: StuckInput): StuckAction {
  if (input.justWoke) return "none"; // 宽限期防 spawn-kill 循环
  const ceiling = Math.max(ABSOLUTE_CEILING_MS, input.declaredTimeoutMs ?? 0);
  // 心跳不存在不判 ceiling（新容器还没产生心跳）
  if (input.heartbeatMtimeMs !== null && input.nowMs - input.heartbeatMtimeMs > ceiling) {
    return "kill-ceiling";
  }
  for (const claim of input.claims) {
    if (!claim.claimedAt) continue;
    const claimedMs = parseSqliteUtc(claim.claimedAt);
    const tolerance = Math.max(CLAIM_STUCK_MS, input.declaredTimeoutMs ?? 0);
    const claimAge = input.nowMs - claimedMs;
    // 认领后再无生命迹象才 kill；心跳【缺失】同样视为无生命迹象（P1 修复，对齐基线 host-sweep.ts:114）
    const noLifeSinceClaim = input.heartbeatMtimeMs === null || input.heartbeatMtimeMs <= claimedMs;
    if (claimAge > tolerance && noLifeSinceClaim) {
      return "kill-claim";
    }
  }
  return "none";
}

/** 任务会话 GC：per-task 会话无存活任务且无容器 → closed */
export function shouldCloseTaskSession(session: Session, hasLiveTasks: boolean): boolean {
  const isTaskSession = (session.thread_id ?? "").startsWith(TASKS_SYSTEM_THREAD_PREFIX);
  return isTaskSession && !hasLiveTasks && session.container_status !== "running";
}

async function sweepSession(session: Session, nowIso: string, nowMs: number): Promise<void> {
  const inPath = inboundDbPath(session.agent_group_id, session.id);
  const outPath = outboundDbPath(session.agent_group_id, session.id);
  if (!existsSync(inPath) || !existsSync(outPath)) return;
  const inbound = openInboundDb(inPath);
  // 主机对 outbound 的维护写（孤儿 ack 删除/ack 清理）是第二成文例外
  // （第一例外为 writeOutboundDirect）；open-write-CLOSE 语义由 sweep tick 边界保证。
  const outbound = openOutboundDbRw(outPath);
  let justWoke = false;
  try {
    // 1. ack 同步 + 清理已同步 ack（防无界增长）
    syncProcessingAcks(inbound, outbound);
    pruneSyncedProcessingAcks(inbound, outbound);

    // 2. 到期唤醒【先于】崩溃清理（否则 reset 不断推后 process_after 造成死锁）
    const running = isContainerRunning(session.id);
    if (!running && countDueMessages(inbound, nowIso) > 0) {
      justWoke = await wakeContainer(session);
    }

    // 3. 运行中 SLA
    if (isContainerRunning(session.id)) {
      const hb = heartbeatPath(session.agent_group_id, session.id);
      const heartbeatMtime = existsSync(hb) ? statSync(hb).mtimeMs : null;
      const claims = getProcessingClaims(inbound, outbound);
      const toolState = getContainerToolState(outbound);
      const action = decideStuckAction({
        nowMs,
        heartbeatMtimeMs: heartbeatMtime,
        claims,
        declaredTimeoutMs: toolState.tool_declared_timeout_ms,
        justWoke,
      });
      if (action !== "none") {
        log.warn(`sweep killing stuck container: ${session.id} (${action})`);
        killContainer(session);
        resetStuckProcessingRows(inbound, outbound, nowIso);
      }
    } else {
      // 4. 崩溃清理：遗留 processing → 退避重排/failed + 孤儿 ack 删除
      const claims = getProcessingClaims(inbound, outbound);
      if (claims.length > 0) {
        resetStuckProcessingRows(inbound, outbound, nowIso);
      }
    }

    // 5. 循环任务钩子（MODULE-HOOK:scheduling-recurrence，阶段 6 接入）
    try {
      handleRecurrence(session);
    } catch (err) {
      log.warn(`recurrence handling failed: ${session.id}`, { err });
    }
    // 6. 任务会话 GC（recurrence 之后跑，刚触发的系列不被误收；P1 修复：实查存活任务）
    if (shouldCloseTaskSession(session, countLiveTasks(inbound) > 0)) {
      markSessionClosed(session.id);
      log.info(`task session closed: ${session.id}`);
    }
  } finally {
    inbound.close();
    outbound.close();
  }
}

export async function sweepOnce(nowMs: number = Date.now()): Promise<void> {
  const nowIso = new Date(nowMs).toISOString();
  // tick 级：egress 自愈（尽力而为，失败不是泄漏）
  try {
    ensureEgressNetwork();
  } catch (err) {
    if (!(err instanceof EgressLockdownError)) log.warn("egress self-heal failed", { err });
  }
  for (const session of listActiveSessions()) {
    try {
      await sweepSession(session, nowIso, nowMs);
    } catch (err) {
      log.error(`sweep session failed: ${session.id}`, { err });
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startHostSweep(): void {
  if (timer) return;
  timer = setInterval(() => void sweepOnce(), SWEEP_INTERVAL_MS);
  timer.unref();
  log.info("host sweep started (60s)");
}

export function stopHostSweep(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

// 副作用注册到主机生命周期（index.ts import 本模块即接入）
onHostStart("host-sweep", () => startHostSweep());
onHostShutdown("host-sweep", () => stopHostSweep());
