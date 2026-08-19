/**
 * pages/Wirings.tsx —— 接线页（接线表格 + 创建表单：messagingGroup × group 双选择）
 *
 * 关键导出：Wirings
 *
 * 修改记录：2026-08-13 创建（阶段 11）；同日阶段 14 表单/表头接入 i18n
 */
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { actions, useAppState } from "../store/app-store.js";
import { useT } from "../i18n/index.js";
import { apiClient } from "../api/client.js";
import type { MessagingGroupRow } from "../api/types.js";

export function Wirings() {
  const state = useAppState();
  const t = useT();
  const [messagingGroups, setMessagingGroups] = useState<MessagingGroupRow[]>([]);
  const [messagingGroupId, setMessagingGroupId] = useState("");
  const [agentGroupId, setAgentGroupId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .messagingGroups()
      .then(setMessagingGroups)
      .catch((err: unknown) => setError(String(err)));
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!messagingGroupId || !agentGroupId) return;
    try {
      await apiClient.createWiring(messagingGroupId, agentGroupId);
      setError(null);
      await actions.refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <section>
      <form onSubmit={(e) => void submit(e)}>
        <select
          aria-label="messaging-group"
          value={messagingGroupId}
          onChange={(e) => setMessagingGroupId(e.target.value)}
        >
          <option value="">{t("wirings.select_messaging_group")}</option>
          {messagingGroups.map((mg) => (
            <option key={mg.id} value={mg.id}>
              {mg.channel_type}/{mg.platform_id}
            </option>
          ))}
        </select>
        <select
          aria-label="agent-group"
          value={agentGroupId}
          onChange={(e) => setAgentGroupId(e.target.value)}
        >
          <option value="">{t("wirings.select_agent_group")}</option>
          {state.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button type="submit">{t("wirings.create")}</button>
      </form>
      {error && <div className="error-banner">{error}</div>}
      <table>
        <thead>
          <tr>
            <th>{t("col.messaging_group")}</th>
            <th>{t("col.agent_group")}</th>
            <th>{t("col.engage_mode")}</th>
            <th>{t("col.sender_scope")}</th>
            <th>{t("col.session_mode")}</th>
            <th>{t("col.priority")}</th>
          </tr>
        </thead>
        <tbody>
          {state.wirings.map((w) => (
            <tr key={w.id}>
              <td>{w.messaging_group_id}</td>
              <td>{w.agent_group_id}</td>
              <td>{w.engage_mode}</td>
              <td>{w.sender_scope}</td>
              <td>{w.session_mode}</td>
              <td>{w.priority}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
