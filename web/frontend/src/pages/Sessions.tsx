/**
 * pages/Sessions.tsx —— 会话页（会话表格 + 行内展开会话消息列表）
 *
 * 关键导出：Sessions
 *
 * 修改记录：2026-08-13 创建（阶段 11）；同日阶段 14 表头接入 i18n
 */
import { Fragment, useState } from "react";
import { useAppState } from "../store/app-store.js";
import { useT } from "../i18n/index.js";
import { apiClient } from "../api/client.js";
import type { MessageRow } from "../api/types.js";

export function Sessions() {
  const state = useAppState();
  const t = useT();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function toggle(id: string): Promise<void> {
    if (expandedId === id) {
      setExpandedId(null);
      setMessages([]);
      return;
    }
    setExpandedId(id);
    setLoading(true);
    try {
      setMessages(await apiClient.sessionMessages(id));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <table>
        <thead>
          <tr>
            <th>{t("col.id")}</th>
            <th>{t("col.agent_group")}</th>
            <th>{t("col.status")}</th>
            <th>{t("col.container_status")}</th>
            <th>{t("col.last_active")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {state.sessions.map((s) => (
            <Fragment key={s.id}>
              <tr>
                <td>{s.id}</td>
                <td>{s.agent_group_id}</td>
                <td>{s.status}</td>
                <td>{s.container_status}</td>
                <td>{s.last_active ?? ""}</td>
                <td>
                  <button onClick={() => void toggle(s.id)}>{t("sessions.messages")}</button>
                </td>
              </tr>
              {expandedId === s.id && (
                <tr>
                  <td colSpan={6}>
                    {loading ? (
                      <p>{t("common.loading")}</p>
                    ) : (
                      <ul className="events">
                        {messages.map((m) => (
                          <li key={m.id}>
                            <code>{m.kind}</code> {m.status} {m.content.slice(0, 80)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </section>
  );
}
