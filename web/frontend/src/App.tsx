/**
 * App.tsx —— 应用壳：导航 + 页面路由（hash 路由，无外部路由依赖）
 *
 * 关键导出：App
 *
 * 修改记录：2026-08-13 创建（阶段 11）；同日阶段 14 语言切换改三语循环
 */
import { useEffect, useState } from "react";
import { actions, useAppState } from "./store/app-store.js";
import { useT, cycleLocale, getLocale } from "./i18n/index.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Sessions } from "./pages/Sessions.js";
import { Groups } from "./pages/Groups.js";
import { Wirings } from "./pages/Wirings.js";
import { Approvals } from "./pages/Approvals.js";
import { Audit } from "./pages/Audit.js";

export type Page = "dashboard" | "sessions" | "groups" | "wirings" | "approvals" | "audit";

function pageFromHash(): Page {
  const h = window.location.hash.replace(/^#\/?/, "");
  const known: Page[] = ["dashboard", "sessions", "groups", "wirings", "approvals", "audit"];
  return (known.find((p) => p === h) ?? "dashboard") as Page;
}

export function App() {
  const state = useAppState();
  const t = useT();
  const [page, setPage] = useState<Page>(pageFromHash());

  useEffect(() => {
    actions.start();
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      actions.stop();
    };
  }, []);

  const nav: Array<{ key: Page; label: string }> = [
    { key: "dashboard", label: t("nav.dashboard") },
    { key: "sessions", label: t("nav.sessions") },
    { key: "groups", label: t("nav.groups") },
    { key: "wirings", label: t("nav.wirings") },
    { key: "approvals", label: t("nav.approvals") },
    { key: "audit", label: t("nav.audit") },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <h1>{t("dashboard.title")}</h1>
        <nav>
          {nav.map((n) => (
            <a key={n.key} href={`#/${n.key}`} className={page === n.key ? "active" : ""}>
              {n.label}
            </a>
          ))}
        </nav>
        <button onClick={() => cycleLocale()}>
          {getLocale() === "zh" ? "中文" : getLocale() === "en" ? "EN" : "日本語"}
        </button>
      </header>
      {state.error && <div className="error-banner">{t("common.error")}: {state.error}</div>}
      <main>
        {page === "dashboard" && <Dashboard />}
        {page === "sessions" && <Sessions />}
        {page === "groups" && <Groups />}
        {page === "wirings" && <Wirings />}
        {page === "approvals" && <Approvals />}
        {page === "audit" && <Audit />}
      </main>
    </div>
  );
}
