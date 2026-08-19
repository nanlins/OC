/**
 * pages/Groups.tsx —— Agent 群组页（群组表格）
 *
 * 关键导出：Groups
 *
 * 修改记录：2026-08-13 创建（阶段 11）；同日阶段 14 表头接入 i18n
 */
import { useAppState } from "../store/app-store.js";
import { useT } from "../i18n/index.js";

export function Groups() {
  const state = useAppState();
  const t = useT();

  return (
    <section>
      <table>
        <thead>
          <tr>
            <th>{t("col.name")}</th>
            <th>{t("col.folder")}</th>
            <th>{t("col.agent_provider")}</th>
            <th>{t("col.created_at")}</th>
          </tr>
        </thead>
        <tbody>
          {state.groups.map((g) => (
            <tr key={g.id}>
              <td>{g.name}</td>
              <td>{g.folder}</td>
              <td>{g.agent_provider ?? ""}</td>
              <td>{g.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
