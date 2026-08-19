/**
 * guard/types.ts ?”â€?å®ˆå«è¯æ?è¡¨ï?é¢†å?? å…³?¶å?ï¼? *
 * ?Œè´£ï¼šactor/input/decision ç±»å? + Unguarded ?ç? + GuardDenyError?? * ?³é”®å¯¼å‡ºï¼šGuardActor, GuardInput, GuardDecision, ALLOW, DENY, HOLD, unguarded, isUnguarded, GuardDenyError
 * ?¸å?æ¨¡å?ï¼??—æ?ä¸å¯è¡¨ç¤º"?”â€”æ³¨?Œå?é¡»ä??‰ä? guard spec ?–æ˜¾å¼?unguarded(reason)ï¼? *           ?ç? Symbol æ¨¡å?ç§æ?ï¼Œunguarded() ?¯ä??¸é€ ç‚¹ï¼Œgrep "unguarded(" ?³å??´æ??•ã€? * ?Ÿé‰´ï¼šnanoclaw src/guard/types.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?3ï¼? */
import type { PendingApproval } from "../types.js";

export type GuardActor = "host" | "agent" | "human" | "system";

export interface GuardInput {
  actor: GuardActor;
  resource?: string;
  payload?: unknown;
  /** ?¹å??æ”¾?ºå¸¦?„å®¡?¹è?ï¼ˆresolve ?å?è¡????°å¥½?§è?ä¸€æ¬¡ï? */
  grant?: PendingApproval;
}

export type GuardDecision =
  | { kind: "allow"; reason: string }
  | { kind: "hold"; reason: string; approverUserId?: string }
  | { kind: "deny"; reason: string };

export const ALLOW = (reason: string): GuardDecision => ({ kind: "allow", reason });
export const DENY = (reason: string): GuardDecision => ({ kind: "deny", reason });
export const HOLD = (reason: string, approverUserId?: string): GuardDecision => ({
  kind: "hold",
  reason,
  approverUserId,
});

const UNGUARDED_BRAND: unique symbol = Symbol("OC.unguarded");

export interface Unguarded {
  readonly [UNGUARDED_BRAND]: true;
  readonly reason: string;
}

/** ?¾å?å£°æ?"æ­¤åŠ¨ä½œæ??€å®ˆå«"ï¼ˆå”¯ä¸€?¸é€ ç‚¹ï¼?*/
export function unguarded(reason: string): Unguarded {
  return { [UNGUARDED_BRAND]: true, reason };
}

export function isUnguarded(v: unknown): v is Unguarded {
  return typeof v === "object" && v !== null && (v as Record<symbol, unknown>)[UNGUARDED_BRAND] === true;
}

/** ä»¥æ??™è¡¨"è®¾è®¡?…æ?ç»?ï¼Œè??¨æ–¹?¯ä??Ÿå??…é??ºå?ï¼ˆA2A ç­‰æ?ç¨‹ä½¿?¨ï? */
export class GuardDenyError extends Error {
  constructor(reason: string) {
    super(`guard denied: ${reason}`);
    this.name = "GuardDenyError";
  }
}
