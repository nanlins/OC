/**
 * i18n/index.ts —— 前端三语资源与切换（zh/en/ja）
 *
 * 职责：t(key) 翻译函数 + locale 三语循环切换（localStorage 持久化）。
 * 关键导出：useT, setLocale, getLocale, cycleLocale, Locale
 * 承重不变量：三语 key 集合一致（i18n.test.ts lint 强制）；缺 key 回退 key 本身。
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 11）
 *   2026-08-13 阶段 14：全量抽取页面文案，扩展 zh/en/ja 三语 + cycleLocale
 */
import { useSyncExternalStore } from "react";

export type Locale = "zh" | "en" | "ja";

export const LOCALES: readonly Locale[] = ["zh", "en", "ja"];

const DICT: Record<Locale, Record<string, string>> = {
  zh: {
    "nav.dashboard": "总览",
    "nav.sessions": "会话",
    "nav.groups": "Agent 群组",
    "nav.wirings": "接线",
    "nav.approvals": "审批",
    "nav.audit": "审计",
    "dashboard.title": "OC 管理控制台",
    "dashboard.groups": "Agent 群组",
    "dashboard.sessions": "活跃会话",
    "dashboard.pending": "待审批",
    "dashboard.events": "事件直播",
    "approvals.approve": "批准",
    "approvals.reject": "拒绝",
    "sessions.messages": "消息",
    "common.loading": "加载中…",
    "common.error": "错误",
    "col.id": "ID",
    "col.agent_group": "Agent 群组",
    "col.status": "状态",
    "col.container_status": "容器状态",
    "col.last_active": "最后活跃",
    "col.messaging_group": "消息群组",
    "col.engage_mode": "触发模式",
    "col.sender_scope": "发送者范围",
    "col.session_mode": "会话模式",
    "col.priority": "优先级",
    "col.action": "动作",
    "col.title": "标题",
    "col.created_at": "创建时间",
    "col.actor": "执行者",
    "col.decision": "决定",
    "col.reason": "原因",
    "col.name": "名称",
    "col.folder": "目录",
    "col.agent_provider": "Provider",
    "wirings.select_messaging_group": "-- 选择消息群组 --",
    "wirings.select_agent_group": "-- 选择 Agent 群组 --",
    "wirings.create": "创建接线",
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
    "common.loading": "Loading…",
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
    "nav.dashboard": "ダッシュボード",
    "nav.sessions": "セッション",
    "nav.groups": "Agent グループ",
    "nav.wirings": "配線",
    "nav.approvals": "承認",
    "nav.audit": "監査",
    "dashboard.title": "OC 管理コンソール",
    "dashboard.groups": "Agent グループ",
    "dashboard.sessions": "アクティブセッション",
    "dashboard.pending": "承認待ち",
    "dashboard.events": "イベントライブ",
    "approvals.approve": "承認",
    "approvals.reject": "拒否",
    "sessions.messages": "メッセージ",
    "common.loading": "読み込み中…",
    "common.error": "エラー",
    "col.id": "ID",
    "col.agent_group": "Agent グループ",
    "col.status": "ステータス",
    "col.container_status": "コンテナ状態",
    "col.last_active": "最終アクティブ",
    "col.messaging_group": "メッセージグループ",
    "col.engage_mode": "トリガーモード",
    "col.sender_scope": "送信者スコープ",
    "col.session_mode": "セッションモード",
    "col.priority": "優先度",
    "col.action": "アクション",
    "col.title": "タイトル",
    "col.created_at": "作成日時",
    "col.actor": "実行者",
    "col.decision": "判定",
    "col.reason": "理由",
    "col.name": "名前",
    "col.folder": "フォルダ",
    "col.agent_provider": "Provider",
    "wirings.select_messaging_group": "-- メッセージグループを選択 --",
    "wirings.select_agent_group": "-- Agent グループを選択 --",
    "wirings.create": "配線を作成",
  },
};

let locale: Locale = (localStorage.getItem("oc_locale") as Locale) || "zh";
if (!LOCALES.includes(locale)) locale = "zh";
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(l: Locale): void {
  locale = l;
  localStorage.setItem("oc_locale", l);
  for (const lsn of listeners) lsn();
}

/** 三语循环：zh → en → ja → zh */
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

/** 仅供测试：访问底层字典做 key 一致性 lint */
export function __dictForTest(): Record<Locale, Record<string, string>> {
  return DICT;
}
