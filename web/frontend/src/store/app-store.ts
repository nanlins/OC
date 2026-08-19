/**
 * store/app-store.ts —— 控制台全局状态（useSyncExternalStore 轻量 store，无外部依赖）
 *
 * 职责：投影数据缓存 + 事件流缓冲 + 加载态；action 式更新。
 * 关键导出：useAppState, actions
 *
 * 修改记录：2026-08-13 创建（阶段 11）
 */
import { useSyncExternalStore } from "react";
import { apiClient, subscribeEvents } from "../api/client.js";
import type { ApprovalRow, AuditRow, GroupRow, SessionRow, WebEvent, WiringRow } from "../api/types.js";

export interface AppState {
  loaded: boolean;
  groups: GroupRow[];
  sessions: SessionRow[];
  wirings: WiringRow[];
  approvals: ApprovalRow[];
  audit: AuditRow[];
  events: WebEvent[];
  error: string | null;
}

let state: AppState = {
  loaded: false,
  groups: [],
  sessions: [],
  wirings: [],
  approvals: [],
  audit: [],
  events: [],
  error: null,
};

const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, () => state);
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let unsubEvents: (() => void) | null = null;

export const actions = {
  async refresh(): Promise<void> {
    try {
      const [groups, sessions, wirings, approvals, audit] = await Promise.all([
        apiClient.groups(),
        apiClient.sessions(),
        apiClient.wirings(),
        apiClient.approvals(),
        apiClient.audit(),
      ]);
      setState({ groups, sessions, wirings, approvals, audit, loaded: true, error: null });
    } catch (err) {
      setState({ error: String(err) });
    }
  },
  start(): void {
    void actions.refresh();
    if (!refreshTimer) refreshTimer = setInterval(() => void actions.refresh(), 10_000);
    if (!unsubEvents) {
      unsubEvents = subscribeEvents((ev) => {
        setState({ events: [ev, ...state.events].slice(0, 100) });
        void actions.refresh();
      });
    }
  },
  stop(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = null;
    unsubEvents?.();
    unsubEvents = null;
  },
  async approve(id: string): Promise<void> {
    await apiClient.resolveApproval(id, "approve");
    await actions.refresh();
  },
  async reject(id: string): Promise<void> {
    await apiClient.resolveApproval(id, "reject");
    await actions.refresh();
  },
};
