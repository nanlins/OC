/**
 * modules/typing.ts —— 打字指示器模块
 *
 * 职责：Agent 处理消息时定期经适配器发送"正在输入"；refresh 4s；投递后由 router 调 stop。
 * 关键导出：setTypingAdapter, startTypingRefresh, stopTypingForSession
 * 核心模式：模块导入期经 router.setTypingNotifier 注册（核心零领域知识）。
 * 借鉴：nanoclaw src/modules/typing/
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 6）
 *   2026-08-12 复检修复：onDeliveryComplete 投递成功后停止刷新（防永久 interval 泄漏）
 */
import { getMessagingGroup } from "../db/messaging-groups.js";
import { getChannelAdapterExact } from "../channels/channel-registry.js";
import { setTypingNotifier } from "../router.js";
import { onDeliveryComplete } from "../delivery.js";
import { log } from "../log.js";
import type { Session } from "../types.js";

type TypingFn = (channelType: string, platformId: string, threadId: string | null) => Promise<void>;

let typingAdapter: TypingFn | null = null;
export function setTypingAdapter(fn: TypingFn): void {
  typingAdapter = fn;
}

const REFRESH_MS = 4000;
const refreshers = new Map<string, NodeJS.Timeout>();

function routingOf(session: Session): { channelType: string; platformId: string; threadId: string | null } | null {
  if (!session.messaging_group_id) return null;
  const mg = getMessagingGroup(session.messaging_group_id);
  if (!mg) return null;
  return { channelType: mg.channel_type, platformId: mg.platform_id, threadId: session.thread_id };
}

export function startTypingRefresh(session: Session): void {
  if (refreshers.has(session.id)) return;
  const routing = routingOf(session);
  if (!routing) return;
  const fire = () => {
    const adapter = typingAdapter ? null : getChannelAdapterExact(routing.channelType);
    void (async () => {
      try {
        if (typingAdapter) await typingAdapter(routing.channelType, routing.platformId, routing.threadId);
        else await adapter?.setTyping?.(routing.platformId, routing.threadId);
      } catch (err) {
        log.warn("typing refresh failed", { err });
      }
    })();
  };
  fire();
  const t = setInterval(fire, REFRESH_MS);
  t.unref();
  refreshers.set(session.id, t);
}

export function stopTypingForSession(session: Session): void {
  const t = refreshers.get(session.id);
  if (t) clearInterval(t);
  refreshers.delete(session.id);
}

// 副作用注册：router 的 typing 钩子
setTypingNotifier((session, on) => {
  if (on) startTypingRefresh(session);
  else stopTypingForSession(session);
});

// 投递成功后停止打字指示（阶段 6 复检 P1 修复：永不停止的 4s interval 泄漏）
onDeliveryComplete((session) => stopTypingForSession(session));
