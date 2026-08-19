/**
 * pages/Approvals.tsx —— 审批页（待审批表格 + 批准/拒绝操作）
 *
 * 关键导出：Approvals
 *
 * 修改记录：2026-08-13 创建（阶段 11）；同日阶段 14 表头接入 i18n
 */
import { actions, useAppState } from "../store/app-store.js";
import { useT } from "../i18n/index.js";

export function Approvals() {
  const state = useAppState();
  const t = useT();
  const pending = state.approvals.filter((a) => a.status === "pending");

  return (
    <section>
      <table>
        <thead>
          <tr>
            <th>{t("col.action")}</th>
            <th>{t("col.title")}</th>
            <th>{t("col.agent_group")}</th>
            <th>{t("col.created_at")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pending.map((a) => (
            <tr key={a.id}>
              <td>{a.action}</td>
              <td>{a.title ?? ""}</td>
              <td>{a.agent_group_id ?? ""}</td>
              <td>{a.created_at}</td>
              <td>
                <button onClick={() => void actions.approve(a.id)}>{t("approvals.approve")}</button>
                <button onClick={() => void actions.reject(a.id)}>{t("approvals.reject")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
