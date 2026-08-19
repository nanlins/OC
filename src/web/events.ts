/**
 * web/events.ts —— Web 事件总线（SSE 推送源）
 *
 * 职责：publishWebEvent(type, payload)；订阅者注册（SSE hub）；delivery/audit 钩子接入。
 * 关键导出：publishWebEvent, subscribeWebEvents, registerWebHooks
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 9）
 */
import { onDeliveryComplete } from "../delivery.js";

export interface WebEvent {
  type: string;
  payload: unknown;
  at: string;
}

type Subscriber = (ev: WebEvent) => void;
const subscribers = new Set<Subscriber>();

export function publishWebEvent(type: string, payload: unknown): void {
  const ev: WebEvent = { type, payload, at: new Date().toISOString() };
  for (const s of subscribers) {
    try {
      s(ev);
    } catch {
      /* 单订阅者失败不影响其他 */
    }
  }
}

export function subscribeWebEvents(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** 接入 delivery 完成事件（副作用注册；P2-4 修复：重复 start 不重复注册） */
let hooksRegistered = false;
export function registerWebHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onDeliveryComplete((session, count) => {
    publishWebEvent("delivery", { sessionId: session.id, count });
  });
}
