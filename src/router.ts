/**
 * router.ts —— 入站消息路由管线
 *
 * 职责：通道事件 → messaging group → 发送者解析 → 逐 wiring 扇出（engage/门控）→ 会话解析 →
 *       写 messages_in → 唤醒容器。核心零领域知识，策略全部经钩子注入。
 * 关键导出：routeInbound, setSenderResolver, setAccessGate, setSenderScopeGate,
 *           registerMessageInterceptor, setChannelRequestGate, setContainerWaker, setTypingNotifier
 * 承重不变量：结构性丢弃由核心记审计，策略性拒绝由门自己记审计；
 *           engage 了但被门拒绝的消息绝不 accumulate（安全拒绝不能变成静默落盘）。
 * 借鉴：nanoclaw src/router.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 *   2026-08-12 se-inspector 修复：AccessGate 携带 agentGroupId；审计职责切分（策略拒绝由门记）；
 *              dm/group 上下文按 isGroup；附件接入管线；事件时间戳透传；replyTo 重定向；
 *              deny 审计日志；mention-sticky 会话存在查询 + adapter.subscribe；no_agent_engaged 升 log.info
 *   2026-08-12 复检修复：subscribe 移门后 + .catch 防崩 + 群聊/线程守卫；sticky 用折叠后 threadId + DM 守卫；
 *              deliverToAgent 适配器能力参数化
 */
import { randomUUID } from "node:crypto";
import { log } from "./log.js";
import {
  createMessagingGroup,
  getMessagingGroupWithAgentCount,
  listWirings,
  recordDeniedSender,
} from "./db/messaging-groups.js";
import { findSession } from "./db/sessions.js";
import { gateCommand } from "./command-gate.js";
import { recordTrace } from "./eval/trace.js";
import { t, resolveLocaleFromEnv } from "./i18n/index.js";
import {
  resolveSession,
  writeSessionMessage,
  writeOutboundDirectFor,
  saveInboundAttachments,
} from "./session-manager.js";
import { getChannelAdapterExact } from "./channels/channel-registry.js";
import { getChannelDefaults, resolveThreadPolicy } from "./channels/channel-defaults.js";
import type { InboundEvent } from "./channels/adapter.js";
import type { MessagingGroup, MessagingGroupAgent, Session } from "./types.js";

// ---- 钩子注册表（模块经 barrel 副作用注入） ----

export type SenderResolver = (event: InboundEvent) => Promise<{ userId: string | null; displayName?: string }>;
/** P1 修复：携带 agentGroupId（基线签名），阶段 6 permissions 按组判定必需 */
export type AccessGate = (
  event: InboundEvent,
  userId: string | null,
  mg: MessagingGroup,
  agentGroupId: string,
) => Promise<{ allow: boolean; reason?: string }>;
export type SenderScopeGate = (wiring: MessagingGroupAgent, userId: string | null) => Promise<boolean>;
export type MessageInterceptor = (event: InboundEvent) => Promise<boolean>; // 首个认领(true)即终止路由
export type ChannelRequestGate = (event: InboundEvent, mg: MessagingGroup) => void;
export type ContainerWaker = (session: Session) => Promise<boolean>;
export type TypingNotifier = (session: Session, on: boolean) => void;

let senderResolver: SenderResolver | null = null;
let accessGate: AccessGate | null = null;
let senderScopeGate: SenderScopeGate | null = null;
let channelRequestGate: ChannelRequestGate | null = null;
let containerWaker: ContainerWaker | null = null;
let typingNotifier: TypingNotifier | null = null;
const messageInterceptors: MessageInterceptor[] = [];

export function setSenderResolver(fn: SenderResolver): void {
  if (senderResolver) log.warn("senderResolver overridden");
  senderResolver = fn;
}
export function setAccessGate(fn: AccessGate): void {
  if (accessGate) log.warn("accessGate overridden");
  accessGate = fn;
}
export function setSenderScopeGate(fn: SenderScopeGate): void {
  if (senderScopeGate) log.warn("senderScopeGate overridden");
  senderScopeGate = fn;
}
export function setChannelRequestGate(fn: ChannelRequestGate): void {
  if (channelRequestGate) log.warn("channelRequestGate overridden");
  channelRequestGate = fn;
}
export function setContainerWaker(fn: ContainerWaker): void {
  containerWaker = fn;
}
export function setTypingNotifier(fn: TypingNotifier): void {
  typingNotifier = fn;
}
export function registerMessageInterceptor(fn: MessageInterceptor): void {
  messageInterceptors.push(fn);
}

// ---- engage 评估 ----

export function evaluateEngage(
  wiring: MessagingGroupAgent,
  event: InboundEvent,
  mg: MessagingGroup,
  effectiveThreadId: string | null,
): boolean {
  switch (wiring.engage_mode) {
    case "pattern": {
      const pattern = wiring.engage_pattern ?? ".";
      try {
        return new RegExp(pattern).test(event.message.content);
      } catch (err) {
        // 可用性优先：坏正则 fail-open 并告警（安全增强见补充优化 C.2：写入时校验）
        log.warn(`bad engage_pattern fail-open: ${pattern}`, { err });
        return true;
      }
    }
    case "mention":
      return event.message.isMention === true;
    case "mention-sticky":
      return event.message.isMention === true || stickySessionExists(wiring, mg, effectiveThreadId);
    default:
      return false;
  }
}

/** mention-sticky 以"会话存在"当订阅状态（基线语义；P1 修复：真实查询而非恒 false）。
 *  P2 修复（复检）：用线程策略折叠后的 effectiveThreadId 查询；DM（is_group=0）无粘性。 */
function stickySessionExists(
  wiring: MessagingGroupAgent,
  mg: MessagingGroup,
  effectiveThreadId: string | null,
): boolean {
  if (mg.is_group === 0) return false;
  return (
    findSession({
      agentGroupId: wiring.agent_group_id,
      messagingGroupId: mg.id,
      threadId: effectiveThreadId,
      sessionMode: wiring.session_mode,
    }) !== undefined
  );
}

// ---- 主管线 ----

export async function routeInbound(event: InboundEvent): Promise<void> {
  // 0. 预路由拦截器（多步审批流捕获自由文本 DM 回复）
  for (const intercept of messageInterceptors) {
    if (await intercept(event)) return;
  }

  const instance = event.instance ?? event.channelType;
  const adapter = getChannelAdapterExact(instance);

  // 1. 线程策略折叠（非线程通道折叠 threadId；由接收实例解析）
  const threadId = adapter && !adapter.supportsThreads ? null : (event.threadId ?? null);

  // 2. 组合查询（一次 DB 读短路未接线通道）
  let combo = getMessagingGroupWithAgentCount(event.channelType, event.platformId, instance);

  // 3. 未找到 + @mention → 自动创建 messaging_group；普通闲聊不建行
  if (!combo) {
    if (event.message.isMention !== true) return;
    const mg = createMessagingGroup({
      channelType: event.channelType,
      platformId: event.platformId,
      instance,
      isGroup: event.message.isGroup,
      // P1 修复：按事件 isGroup 选 dm/group 上下文默认策略
      unknownSenderPolicy: (event.message.isGroup
        ? getChannelDefaults(instance, event.channelType).group.unknownSenderPolicy
        : getChannelDefaults(instance, event.channelType).dm.unknownSenderPolicy) as
        "strict" | "request_approval" | "public",
    });
    combo = { group: mg, agentCount: 0 };
  }
  const mg = combo.group;
  if (mg.denied_at) return; // 永久静默
  // P1 修复：上下文选择一律按 isGroup（基线"NEVER 其他派生"），DM 不拿群组策略
  const isGroup = event.message.isGroup ?? mg.is_group === 1;

  // 4. 未接线处理（结构性丢弃由核心记审计）
  if (combo.agentCount === 0) {
    if (event.message.isMention !== true) return;
    log.info(`dropped: no agent wired (${mg.id})`);
    recordDeniedSender(mg.id, event.message.senderId ?? "unknown", event.message.senderName ?? null);
    channelRequestGate?.(event, mg); // fire-and-forget 升级给 owner
    return;
  }

  // 5. 发送者解析（permissions 模块顺带 upsert users；无钩子则 null 下游容忍）
  const resolved = senderResolver ? await senderResolver(event) : { userId: null };
  const userId = resolved.userId;

  // 6. 取接线 agent 全行
  const wirings = listWirings(mg.id);

  // 8. 逐 agent 扇出独立评估
  let anyEngaged = false;
  for (const wiring of wirings) {
    const declared = getChannelDefaults(instance, event.channelType);
    const declaredThreads = isGroup ? declared.group.threads : declared.dm.threads;
    const threadsOn = resolveThreadPolicy(wiring.threads, declaredThreads, adapter?.supportsThreads ?? false);
    const effectiveThread = threadsOn ? threadId : null;

    const engaged = evaluateEngage(wiring, event, mg, effectiveThread);
    if (!engaged) {
      // ignored_message_policy=accumulate：存为上下文不唤醒；但被门拒绝的绝不 accumulate
      if (wiring.ignored_message_policy === "accumulate") {
        await deliverToAgent(
          event,
          mg,
          wiring,
          userId,
          effectiveThread,
          false,
          isGroup,
          adapter?.supportsThreads ?? false,
        );
      }
      continue;
    }

    // 访问门控 + sender_scope 门（策略性拒绝由门自己记审计，核心不代记，P1 修复）
    if (accessGate) {
      const gate = await accessGate(event, userId, mg, wiring.agent_group_id);
      if (!gate.allow) {
        continue;
      }
    }
    if (wiring.sender_scope === "known" && senderScopeGate) {
      const ok = await senderScopeGate(wiring, userId);
      if (!ok) continue;
    }

    // mention-sticky 首次真 @ → 订阅线程（基线 router.ts:436-443；复检修复：门通过后 +
    // 仅群聊有线程时订阅 + .catch 防 unhandled rejection 崩主机）
    if (wiring.engage_mode === "mention-sticky" && event.message.isMention === true && isGroup && effectiveThread) {
      adapter?.subscribe?.(event.platformId, effectiveThread)?.catch?.((err: unknown) => {
        log.warn("adapter subscribe failed", { err });
      });
    }

    anyEngaged = true;
    await deliverToAgent(event, mg, wiring, userId, effectiveThread, true, isGroup, adapter?.supportsThreads ?? false);
  }

  // 10. 全未 engage 结构性丢弃审计（P1：log.info 而非 debug）
  if (!anyEngaged) {
    log.info(`dropped: no agent engaged (${mg.id})`);
  }
}

// ---- 扇出落库 ----

async function deliverToAgent(
  event: InboundEvent,
  mg: MessagingGroup,
  wiring: MessagingGroupAgent,
  userId: string | null,
  threadId: string | null,
  wake: boolean,
  isGroup: boolean,
  adapterSupportsThreads: boolean,
): Promise<void> {
  // 11. 群聊 + 线程启用 + 非 agent-shared → 强制 per-thread（上下文按 isGroup，P1 修复；
  //     复检修复：适配器能力由调用方传入，不再硬编码 true）
  const declared = getChannelDefaults(event.instance ?? mg.instance, mg.channel_type);
  const declaredThreads = isGroup ? declared.group.threads : declared.dm.threads;
  const threadsOn = resolveThreadPolicy(wiring.threads, declaredThreads, adapterSupportsThreads);
  const effectiveMode =
    wiring.session_mode === "agent-shared"
      ? "agent-shared"
      : threadsOn && isGroup && threadId
        ? "per-thread"
        : "shared";

  const session = resolveSession({
    agentGroupId: wiring.agent_group_id,
    messagingGroupId: mg.id,
    threadId,
    sessionMode: effectiveMode,
  });

  // 命令门：deny 直写 outbound 拒绝回复 + 审计日志，不唤醒容器（P2 修复：补审计日志）
  const gate = gateCommand(event.message.content, userId, wiring.agent_group_id);
  if (gate.action === "deny") {
    log.info("admin command denied by gate", { userId, agentGroupId: wiring.agent_group_id, reason: gate.reason });
    // 渠道拒绝回复按宿主 locale 本地化（阶段 14）；审计仍记英文 reason
    const locale = resolveLocaleFromEnv();
    const inner = gate.reasonKey ? t(gate.reasonKey, locale, gate.params) : gate.reason;
    writeOutboundDirectFor(session, {
      kind: "system",
      content: t("channel.command_denied", locale, { reason: inner }),
      channelType: event.replyTo?.channelType ?? event.channelType,
      platformId: event.replyTo?.platformId ?? event.platformId,
      threadId: event.replyTo?.threadId ?? threadId,
    });
    return;
  }

  // 入站附件落盘（四层防御），并在内容中回写引用（P1 修复：附件接入管线）
  const msgId = `${event.message.id}:${wiring.agent_group_id}`;
  const saved = saveInboundAttachments(session, msgId, event.message.attachments ?? []);
  const content =
    saved.length > 0
      ? `${event.message.content}\n<attachments>${saved.join(",")}</attachments>`
      : event.message.content;

  // 10'. 写 messages_in（id 以 :agentGroupId 命名空间化防扇出主键碰撞；地址列按 replyTo 重定向，P2 修复）
  writeSessionMessage(session, {
    id: msgId,
    kind: event.message.kind === "chat-sdk" ? "chat-sdk" : "chat",
    content,
    trigger: wake ? 1 : 0,
    timestamp: event.message.timestamp,
    platformId: event.replyTo?.platformId ?? event.platformId,
    channelType: event.replyTo?.channelType ?? event.channelType,
    threadId: event.replyTo?.threadId ?? threadId,
  });
  // 轨迹留痕（阶段 12，知识文档 04 §4.11 全程留痕）
  recordTrace({
    sessionId: session.id,
    kind: "inbound",
    detail: { messageId: event.message.id, channel: event.channelType, wake },
  });

  // 11'. 唤醒 + 打字指示（wake=false 时仅累积上下文）
  if (wake) {
    typingNotifier?.(session, true);
    if (containerWaker) {
      const ok = await containerWaker(session);
      if (!ok) typingNotifier?.(session, false); // 瞬态失败交 sweep 重试
    }
  }
}

/** 仅供测试：重置钩子 */
export function resetRouterHooksForTest(): void {
  senderResolver = null;
  accessGate = null;
  senderScopeGate = null;
  channelRequestGate = null;
  containerWaker = null;
  typingNotifier = null;
  messageInterceptors.length = 0;
}

export const newEventId = (): string => randomUUID();
