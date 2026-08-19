/**
 * pages/Audit.tsx —— 审计页（审计记录表格）
 *
 * 关键导出：Audit
 *
 * 修改记录：2026-08-13 创建（阶段 11）；同日阶段 14 表头接入 i18n
 */
import { useAppState } from "../store/app-store.js";
import { useT } from "../i18n/index.js";

export function Audit() {
  const state = useAppState();
  const t = useT();

  return (
    <section>
      <table>
        <thead>
          <tr>
            <th>{t("col.action")}</th>
            <th>{t("col.actor")}</th>
            <th>{t("col.decision")}</th>
            <th>{t("col.reason")}</th>
          </tr>
        </thead>
        <tbody>
          {state.audit.map((row) => (
            <tr key={row.id}>
              <td>{row.action}</td>
              <td>{row.actor}</td>
              <td>{row.decision}</td>
              <td>{row.reason ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
