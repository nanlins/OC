/**
 * pages/Dashboard.tsx —— 总览页（计数卡 + 事件直播）
 *
 * 关键导出：Dashboard
 *
 * 修改记录：2026-08-13 创建（阶段 11）
 */
import { useAppState } from "../store/app-store.js";
import { useT } from "../i18n/index.js";

export function Dashboard() {
  const state = useAppState();
  const t = useT();
  const activeSessions = state.sessions.filter((s) => s.status === "active");
  const pending = state.approvals.filter((a) => a.status === "pending");

  return (
    <section>
      <div className="cards">
        <div className="card">
          <h3>{t("dashboard.groups")}</h3>
          <p className="num">{state.groups.length}</p>
        </div>
        <div className="card">
          <h3>{t("dashboard.sessions")}</h3>
          <p className="num">{activeSessions.length}</p>
        </div>
        <div className="card">
          <h3>{t("dashboard.pending")}</h3>
          <p className="num">{pending.length}</p>
        </div>
      </div>
      <h3>{t("dashboard.events")}</h3>
      <ul className="events">
        {state.events.map((ev, i) => (
          <li key={i}>
            <code>{ev.at ?? ""}</code> {ev.type} {JSON.stringify(ev.payload ?? {})}
          </li>
        ))}
      </ul>
    </section>
  );
}
