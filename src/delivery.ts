/**
 * delivery.ts —— 出站投递：双轮询 outbound.db → 适配器投递 + 系统动作注册表
 *
 * 职责：startActiveDeliveryPoll(1s, running) / startSweepDeliveryPoll(60s, active)；
 *       deliverSessionMessages（inflight 去重/到期过滤/delivered 过滤/outbox 附件/runGuarded/
 *       markDelivered|Failed 重试≤3/clearOutbox）；registerDeliveryAction（guard|unguarded 二选一）；
 *       适配器桥接（channel-registry exact 键）。
 * 关键导出：startActiveDeliveryPoll, startSweepDeliveryPoll, stopDeliveryPolls,
 *           deliverSessionMessages, registerDeliveryAction, getDeliveryAction,
 *           reenterGuardedDeliveryAction, onDeliveryAdapterReady, setDeliveryAdapter
 * 承重不变量：投递状态写 inbound.delivered（主机拥有），永不写 outbound（单写者）；
 *           出站 exact 键查找，绝不回退同平台兄弟实例（#2995）；失败抛错走重试，不静默误标已投递。
 * 借鉴：nanoclaw src/delivery.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 5）
 */
import { onHostStart, onHostShutdown } from "./host-lifecycle.js";
import { recordTrace } from "./eval/trace.js";
import { log } from "./log.js";
import { getRunningSessions, listActiveSessions } from "./db/sessions.js";
import {
  getDeliveredIds,
  getDeliveredPlatformMessageId,
  getDueOutboundMessages,
  markDelivered,
  markDeliveryFailed,
  openInboundDb,
  openOutboundDb,
  openOutboundDbRw,
} from "./db/session-db.js";
import { inboundDbPath, outboundDbPath, readOutboxFiles, clearOutbox, type OutboxFile } from "./session-manager.js";
import { requireDeliveryAdapter } from "./channels/channel-registry.js";
import { runGuarded, isUnguarded, type DeliveryActionRegistration } from "./delivery-guard.js";
import { configFromDb } from "./container-config.js";
import type { MessageOut, PendingApproval, Session } from "./types.js";

export const MAX_DELIVERY_ATTEMPTS = 3;
const ACTIVE_POLL_MS = 1000;
const SWEEP_POLL_MS = 60_000;

// ---- 适配器桥接 ----

export interface DeliveryResult {
  platformMessageId?: string;
}

/** 通过 channel-registry exact 键投递（绝不回退；缺适配器抛 MissingChannelAdapterError，P1-7 修复） */
async function deliverViaAdapter(
  session: Session,
  out: MessageOut,
  files: OutboxFile[],
  inbound: ReturnType<typeof openInboundDb>,
): Promise<DeliveryResult> {
  const key = out.channel_type ?? "cli"; // 缺省仅 CLI-trunk 有效（P2-2 记录在案）
  const adapter = requireDeliveryAdapter(key);
  // fix-plan 流式：operation=edit 时从 delivered 解析目标平台消息 id（in_reply_to = 首条流式消息的 outbound id）
  const editTarget =
    out.operation === "edit" && out.in_reply_to ? getDeliveredPlatformMessageId(inbound, out.in_reply_to) : null;
  const platformMessageId = await adapter.deliver(out.platform_id ?? "", out.thread_id ?? null, {
    kind: out.kind,
    content: out.content,
    files,
    operation: out.operation ?? null, // P1-5 修复：operation 透传
    editTarget, // fix-plan 流式：编辑目标
    inReplyTo: out.in_reply_to ?? null, // 阶段 12：流式消息链 id（CLI 客户端合并增量）
    streamFinal: (out.stream_final ?? 0) === 1, // 阶段 12：流式结束标记（CLI 通道立即冲刷）
    // 阶段 12 CLI TUI：会话元数据帧（仅 CLI 通道消费；其他通道忽略未知字段）
    meta:
      key === "cli"
        ? {
            agent: session.agent_group_id,
            model: configFromDb(session.agent_group_id).model ?? undefined,
            provider: session.agent_provider ?? undefined,
          }
        : null,
  });
  return { platformMessageId };
}

// ---- 系统动作注册表（特权安全核心） ----

const deliveryActions = new Map<string, DeliveryActionRegistration>();

export function registerDeliveryAction(name: string, reg: DeliveryActionRegistration): void {
  const existing = deliveryActions.get(name);
  if (existing && !isUnguarded(existing.guard) && isUnguarded(reg.guard)) {
    // guard-wrapped 动作拒绝被"解除武装"重注册
    throw new Error(`refusing to re-register guarded delivery action as unguarded: ${name}`);
  }
  deliveryActions.set(name, reg);
}

/**
 * 查询投递动作的【唯一】安全入口（P1-2 修复）：guarded 条目返回 runGuarded 包裹后的 callable，
 * 不存在绕过 guard 直接执行 handler 的路径。
 */
export function getDeliveryAction(
  name: string,
): ((out: MessageOut, session: Session, grant?: PendingApproval) => Promise<void>) | undefined {
  const reg = deliveryActions.get(name);
  if (!reg) return undefined;
  if (isUnguarded(reg.guard)) {
    return (out, session) => reg.handler(out, session);
  }
  const spec = reg.guard;
  return (out, session, grant) => runGuarded(spec, reg.handler, out, session, grant);
}

/** 批准后回放：携带审批行作为 grant 重入同一入口（结构检查重跑，P1-1 修复）。
 *  动作缺失是配置错误，不得静默（阶段 6 复检 P0 修复）。 */
export function reenterGuardedDeliveryAction(
  name: string,
): (out: MessageOut, session: Session, grant: PendingApproval) => Promise<void> {
  return async (out, session, grant) => {
    const wrapped = getDeliveryAction(name);
    if (!wrapped) throw new Error(`reenter: unknown delivery action: ${name}`);
    await wrapped(out, session, grant);
  };
}

// ---- 投递主流程 ----

const inflightDeliveries = new Set<string>();
const deliveryAttempts = new Map<string, number>(); // 进程重启清零（给失败消息新机会）

export async function deliverSessionMessages(session: Session): Promise<number> {
  if (inflightDeliveries.has(session.id)) return 0;
  inflightDeliveries.add(session.id);
  let delivered = 0;
  const inPath = inboundDbPath(session.agent_group_id, session.id);
  const outPath = outboundDbPath(session.agent_group_id, session.id);
  let inbound: ReturnType<typeof openInboundDb> | null = null;
  let outbound: ReturnType<typeof openOutboundDb> | null = null;
  try {
    // P1-3 修复：open 移入 try，失败不毒化 inflight 去重表
    inbound = openInboundDb(inPath);
    // 阶段 12 实测修复：容器崩溃残留 hot journal 时，只读打开会因"恢复需写"抛 readonly。
    // 恢复可能发生在 open 或首个 SELECT 两个时机——两处都回退 RW（此时容器必已死，无并发写者，安全）。
    try {
      outbound = openOutboundDb(outPath);
    } catch {
      outbound = openOutboundDbRw(outPath);
    }
    const now = new Date().toISOString();
    let due: MessageOut[];
    try {
      due = getDueOutboundMessages(outbound, now);
    } catch {
      outbound.close();
      outbound = openOutboundDbRw(outPath);
      due = getDueOutboundMessages(outbound, now);
    }
    const doneIds = getDeliveredIds(inbound);
    for (const out of due) {
      if (doneIds.has(out.id)) continue;
      const files = readOutboxFiles(session, out.id);
      try {
        if (out.kind === "system") {
          await handleSystemAction(out, session, inbound);
        } else if (out.channel_type === "agent") {
          // a2a：不经过通道适配器，路由到目标 Agent 会话 inbound（阶段 6）
          const { routeAgentMessage } = await import("./modules/agent-to-agent.js");
          await routeAgentMessage(out, session);
        } else {
          const res = await deliverViaAdapter(session, out, files, inbound);
          markDelivered(inbound, out.id, res.platformMessageId); // P2-1 修复：记录 platformMessageId
          deliveryAttempts.delete(out.id);
          delivered += 1;
          recordTrace({ sessionId: session.id, kind: "delivery", detail: { outId: out.id, kind: out.kind } });
          clearOutbox(session, out.id);
          continue;
        }
        markDelivered(inbound, out.id, undefined);
        deliveryAttempts.delete(out.id);
        delivered += 1;
        recordTrace({ sessionId: session.id, kind: "delivery", detail: { outId: out.id, kind: out.kind } });
      } catch (err) {
        const n = (deliveryAttempts.get(out.id) ?? 0) + 1;
        deliveryAttempts.set(out.id, n);
        log.warn(`delivery failed (${n}/${MAX_DELIVERY_ATTEMPTS}): ${out.id}`, { err });
        if (n >= MAX_DELIVERY_ATTEMPTS) {
          markDeliveryFailed(inbound, out.id);
          deliveryAttempts.delete(out.id);
        }
        continue; // 不 clearOutbox，下轮重试
      }
      clearOutbox(session, out.id); // 失败必须吞（已在 catch），成功才清
    }
  } catch (err) {
    log.warn(`deliverSessionMessages open/scan failed: ${session.id}`, { err });
  } finally {
    inbound?.close();
    outbound?.close();
    inflightDeliveries.delete(session.id);
    if (delivered > 0) {
      for (const cb of deliveryCompleteCbs) {
        try {
          cb(session, delivered);
        } catch (err) {
          log.warn("delivery complete cb failed", { err });
        }
      }
    }
  }
  return delivered;
}

/** system 消息分派：解析 content JSON type → 注册表（包裹后 callable，P1-2）；无注册即直接投递（普通系统通知） */
async function handleSystemAction(
  out: MessageOut,
  session: Session,
  inbound: ReturnType<typeof openInboundDb>,
): Promise<void> {
  let type: string | null = null;
  try {
    type = (JSON.parse(out.content) as { type?: string }).type ?? null;
  } catch {
    type = null;
  }
  const wrapped = type ? getDeliveryAction(type) : undefined;
  if (wrapped) {
    await wrapped(out, session);
    return;
  }
  await deliverViaAdapter(session, out, [], inbound);
}

// ---- 轮询循环 ----

let activeTimer: NodeJS.Timeout | null = null;
let sweepTimer: NodeJS.Timeout | null = null;

export function startActiveDeliveryPoll(): void {
  if (activeTimer) return;
  activeTimer = setInterval(() => {
    void (async () => {
      for (const s of getRunningSessions()) {
        try {
          await deliverSessionMessages(s);
        } catch (err) {
          log.error(`active delivery poll error: ${s.id}`, { err });
        }
      }
    })();
  }, ACTIVE_POLL_MS);
  activeTimer.unref();
  log.info("active delivery poll started (1s)");
}

export function startSweepDeliveryPoll(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    void (async () => {
      for (const s of listActiveSessions()) {
        try {
          await deliverSessionMessages(s);
        } catch (err) {
          log.error(`sweep delivery poll error: ${s.id}`, { err });
        }
      }
    })();
  }, SWEEP_POLL_MS);
  sweepTimer.unref();
  log.info("sweep delivery poll started (60s)");
}

export function stopDeliveryPolls(): void {
  if (activeTimer) clearInterval(activeTimer);
  if (sweepTimer) clearInterval(sweepTimer);
  activeTimer = null;
  sweepTimer = null;
}

/** 适配器就绪钩子（晚注册立即补发） */
type ReadyCb = () => void;
const readyCbs: ReadyCb[] = [];
export function onDeliveryAdapterReady(cb: ReadyCb): void {
  readyCbs.push(cb);
}
export function notifyDeliveryAdapterReady(): void {
  for (const cb of readyCbs) {
    try {
      cb();
    } catch (err) {
      log.warn("delivery adapter ready cb failed", { err });
    }
  }
}

/** 投递完成钩子（typing 模块注册：成功投递后停止打字指示，阶段 6 复检 P1 修复） */
type DeliveryCompleteCb = (session: Session, deliveredCount: number) => void;
const deliveryCompleteCbs: DeliveryCompleteCb[] = [];
export function onDeliveryComplete(cb: DeliveryCompleteCb): void {
  deliveryCompleteCbs.push(cb);
}

/** 仅供测试：重置模块状态 */
export function resetDeliveryForTest(): void {
  inflightDeliveries.clear();
  deliveryAttempts.clear();
  deliveryActions.clear();
}

// 副作用注册到主机生命周期
onHostStart("delivery", () => {
  startActiveDeliveryPoll();
  startSweepDeliveryPoll();
});
onHostShutdown("delivery", () => stopDeliveryPolls());

/*
 * 修改记录：
 *   2026-08-25 阶段 12：CLI 聊天界面（meta/tool/end 帧协议 + TUI 渲染）
 */

