/**
 * i18n/index.ts ?”â€??ç«¯ä¸‰è¯­èµ„æ?ä¸å??¢ï?zh/en/jaï¼? *
 * ?Œè´£ï¼št(key) ç¿»è??½æ•° + locale ä¸‰è¯­å¾ªç¯?‡æ¢ï¼ˆlocalStorage ?ä??–ï??? * ?³é”®å¯¼å‡ºï¼šuseT, setLocale, getLocale, cycleLocale, Locale
 * ?¿é?ä¸å??ï?ä¸‰è¯­ key ?†å?ä¸€?´ï?i18n.test.ts lint å¼ºåˆ¶ï¼‰ï?ç¼?key ?é€€ key ?¬èº«?? *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-13 ?›å»ºï¼ˆé˜¶æ®?11ï¼? *   2026-08-13 ?¶æ®µ 14ï¼šå…¨?æŠ½?–é¡µ?¢æ?æ¡ˆï??©å? zh/en/ja ä¸‰è¯­ + cycleLocale
 */
import { useSyncExternalStore } from "react";

export type Locale = "zh" | "en" | "ja";

export const LOCALES: readonly Locale[] = ["zh", "en", "ja"];

const DICT: Record<Locale, Record<string, string>> = {
  zh: {
    "nav.dashboard": "?»è?",
    "nav.sessions": "ä¼šè?",
    "nav.groups": "Agent ç¾¤ç?",
    "nav.wirings": "?¥çº¿",
    "nav.approvals": "å®¡æ‰¹",
    "nav.audit": "å®¡è®¡",
    "dashboard.title": "OC ç®¡ç??§åˆ¶??,
    "dashboard.groups": "Agent ç¾¤ç?",
    "dashboard.sessions": "æ´»è?ä¼šè?",
    "dashboard.pending": "å¾…å®¡??,
    "dashboard.events": "äº‹ä»¶?´æ’­",
    "approvals.approve": "?¹å?",
    "approvals.reject": "?’ç?",
    "sessions.messages": "æ¶ˆæ¯",
    "common.loading": "? è½½ä¸­â€?,
    "common.error": "?™è¯¯",
    "col.id": "ID",
    "col.agent_group": "Agent ç¾¤ç?",
    "col.status": "?¶æ€?,
    "col.container_status": "å®¹å™¨?¶æ€?,
    "col.last_active": "?€?æ´»è·?,
    "col.messaging_group": "æ¶ˆæ¯ç¾¤ç?",
    "col.engage_mode": "è§¦å?æ¨¡å?",
    "col.sender_scope": "?‘é€è€…è???,
    "col.session_mode": "ä¼šè?æ¨¡å?",
    "col.priority": "ä¼˜å?çº?,
    "col.action": "?¨ä?",
    "col.title": "?‡é?",
    "col.created_at": "?›å»º?¶é—´",
    "col.actor": "?§è???,
    "col.decision": "?³å?",
    "col.reason": "?Ÿå?",
    "col.name": "?ç§°",
    "col.folder": "?®å?",
    "col.agent_provider": "Provider",
    "wirings.select_messaging_group": "-- ?‰æ‹©æ¶ˆæ¯ç¾¤ç? --",
    "wirings.select_agent_group": "-- ?‰æ‹© Agent ç¾¤ç? --",
    "wirings.create": "?›å»º?¥çº¿",
  },
  en: {
    "nav.dashboard": "Dashboard",
    "nav.sessions": "Sessions",
    "nav.groups": "Agent Groups",
    "nav.wirings": "Wirings",
    "nav.approvals": "Approvals",
    "nav.audit": "Audit",
    "dashboard.title": "OC Console",
    "dashboard.groups": "Agent Groups",
    "dashboard.sessions": "Active Sessions",
    "dashboard.pending": "Pending Approvals",
    "dashboard.events": "Live Events",
    "approvals.approve": "Approve",
    "approvals.reject": "Reject",
    "sessions.messages": "Messages",
    "common.loading": "Loading??,
    "common.error": "Error",
    "col.id": "ID",
    "col.agent_group": "Agent Group",
    "col.status": "Status",
    "col.container_status": "Container Status",
    "col.last_active": "Last Active",
    "col.messaging_group": "Messaging Group",
    "col.engage_mode": "Engage Mode",
    "col.sender_scope": "Sender Scope",
    "col.session_mode": "Session Mode",
    "col.priority": "Priority",
    "col.action": "Action",
    "col.title": "Title",
    "col.created_at": "Created At",
    "col.actor": "Actor",
    "col.decision": "Decision",
    "col.reason": "Reason",
    "col.name": "Name",
    "col.folder": "Folder",
    "col.agent_provider": "Provider",
    "wirings.select_messaging_group": "-- select messaging group --",
    "wirings.select_agent_group": "-- select agent group --",
    "wirings.create": "Create Wiring",
  },
  ja: {
    "nav.dashboard": "?€?ƒã‚·?¥ã??¼ã?",
    "nav.sessions": "?»ã??·ãƒ§??,
    "nav.groups": "Agent ?°ãƒ«?¼ã?",
    "nav.wirings": "?ç?",
    "nav.approvals": "?¿è?",
    "nav.audit": "??Ÿ»",
    "dashboard.title": "OC ç®¡ç??³ãƒ³?½ãƒ¼??,
    "dashboard.groups": "Agent ?°ãƒ«?¼ã?",
    "dashboard.sessions": "?¢ã‚¯?†ã‚£?–ã‚»?ƒã‚·?§ãƒ³",
    "dashboard.pending": "?¿è?å¾…ã¡",
    "dashboard.events": "?¤ã??³ã??©ã‚¤??,
    "approvals.approve": "?¿è?",
    "approvals.reject": "?’å¦",
    "sessions.messages": "?¡ã??»ãƒ¼??,
    "common.loading": "èª­ã¿è¾¼ã¿ä¸­â€?,
    "common.error": "?¨ãƒ©??,
    "col.id": "ID",
    "col.agent_group": "Agent ?°ãƒ«?¼ã?",
    "col.status": "?¹ã??¼ã‚¿??,
    "col.container_status": "?³ãƒ³?†ã??¶æ?",
    "col.last_active": "?€çµ‚ã‚¢?¯ã????",
    "col.messaging_group": "?¡ã??»ãƒ¼?¸ã‚°?«ãƒ¼??,
    "col.engage_mode": "?ˆãƒª?¬ãƒ¼?¢ãƒ¼??,
    "col.sender_scope": "?ä¿¡?…ã‚¹?³ãƒ¼??,
    "col.session_mode": "?»ã??·ãƒ§?³ãƒ¢?¼ã?",
    "col.priority": "?ªå?åº?,
    "col.action": "?¢ã‚¯?·ãƒ§??,
    "col.title": "?¿ã‚¤?ˆãƒ«",
    "col.created_at": "ä½œæ??¥æ?",
    "col.actor": "å®Ÿè???,
    "col.decision": "?¤å?",
    "col.reason": "?†ç”±",
    "col.name": "?å?",
    "col.folder": "?•ã‚©?«ã?",
    "col.agent_provider": "Provider",
    "wirings.select_messaging_group": "-- ?¡ã??»ãƒ¼?¸ã‚°?«ãƒ¼?—ã??¸æ? --",
    "wirings.select_agent_group": "-- Agent ?°ãƒ«?¼ã??’é¸??--",
    "wirings.create": "?ç??’ä???,
  },
};

let locale: Locale = (localStorage.getItem("OC_locale") as Locale) || "zh";
if (!LOCALES.includes(locale)) locale = "zh";
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(l: Locale): void {
  locale = l;
  localStorage.setItem("OC_locale", l);
  for (const lsn of listeners) lsn();
}

/** ä¸‰è¯­å¾ªç¯ï¼šzh ??en ??ja ??zh */
export function cycleLocale(): Locale {
  const idx = LOCALES.indexOf(locale);
  const next = LOCALES[(idx + 1) % LOCALES.length] as Locale;
  setLocale(next);
  return next;
}

export function useT(): (key: string) => string {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => locale,
  );
  return (key: string) => DICT[current][key] ?? key;
}

/** ä»…ä?æµ‹è?ï¼šè®¿?®å?å±‚å??¸å? key ä¸€?´æ€?lint */
export function __dictForTest(): Record<Locale, Record<string, string>> {
  return DICT;
}
