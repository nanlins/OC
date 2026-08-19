/**
 * guard/guard-actions.ts ?î‚Ä??πÊ??®‰??ÆÂ?ÔºàÂ??åÂ??®‰??ºÔ?
 *
 * ?åË¥£ÔºödefineGuardedAction ?∏ÈÄ†Â∏¶?ÅÁ???GuardedActionÔºõÈ??çÂç≥?õÈ?ÔºõWeakSet ËøêË??∂Â?Â∫ï„Ä? * ?≥ÈîÆÂØºÂá∫ÔºödefineGuardedAction, isGuardedAction, listGuardedActions, GuardedAction, GuardedActionSpec
 * ?∏Â?Ê®°Â?ÔºöÊ???{action, decide} ÂØπË±°?¢Ë?‰∏ç‰?ÁºñË?‰πüË?‰∏ç‰?ËøêË??∂Ô?fail-closedÔºâÔ?
 *           ?çÂ???grant ?πÈ??ÆÔ??®ËØ¢?∫Â∏¶?ºËÄåÈ??çÂ?ÔºàÊãº?ôÊòØÁºñË??ôËØØÔºâ„Ä? * ?üÈâ¥Ôºönanoclaw src/guard/guard-actions.ts
 *
 * ‰øÆÊîπËÆ∞Â?Ôº? *   2026-08-12 ?õÂª∫ÔºàÈò∂ÊÆ?3Ôº? */
import type { GuardDecision, GuardInput } from "./types.js";

export interface GuardedActionSpec {
  /** ?Ø‰? allow ?•Ê? */
  decide: (input: GuardInput) => GuardDecision;
  /** hold ÁªèÂì™‰∏?pending_approvals.action Ëß?Ü≥ */
  grantActionName?: string;
  /** grant ‰∏éËØ∑Ê±ÇÁ?È¢ùÂ?È¢ÜÂ?ÁªëÂ?ÔºàÁ??ÑÊ??•Ê?Ê¨°Â??æÈ?Ë∑ëÔ? */
  grantCoversRequest?: (grantPayload: unknown, input: GuardInput) => boolean;
}

const BRAND: unique symbol = Symbol("OC.guarded-action");

export interface GuardedAction {
  readonly [BRAND]: true;
  readonly name: string;
  readonly spec: GuardedActionSpec;
}

const known = new WeakSet<object>();
const all: GuardedAction[] = [];

export function defineGuardedAction(name: string, spec: GuardedActionSpec): GuardedAction {
  if (all.some((a) => a.name === name)) throw new Error(`duplicate guarded action: ${name}`);
  const action: GuardedAction = { [BRAND]: true, name, spec };
  known.add(action);
  all.push(action);
  return action;
}

/** ËøêË??∂Â?Â∫ïÔ??ãÂ?ÂØπË±°Ëøá‰?‰∫?*/
export function isGuardedAction(v: unknown): v is GuardedAction {
  return typeof v === "object" && v !== null && known.has(v);
}

export function listGuardedActions(): readonly GuardedAction[] {
  return all;
}

/** ‰ªÖ‰?ÊµãË? */
export function clearGuardedActionsForTest(): void {
  all.length = 0;
}
