/**
 * modules/scheduling/run-log.ts —— 任务运行日志
 *
 * 职责：appendRunLog / appendHostTaskNote——每次任务运行/宿主侧事件追加到
 *       groups/<folder>/tasks/<series>.md（本地时间戳）。文件是运维可见的运行史，
 *       不是 DB 状态。
 * 关键导出：appendRunLog, appendHostTaskNote
 * 借鉴：nanoclaw src/modules/scheduling/run-log.ts
 *
 * 修改记录：2026-10-06 创建（P0-3：任务运行日志）
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentGroup } from "../../db/agent-groups.js";
import { resolveGroupFolderPath } from "../../group-folder.js";

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function append(agentGroupId: string, seriesId: string, line: string): void {
  const group = getAgentGroup(agentGroupId);
  if (!group) return;
  const dir = join(resolveGroupFolderPath(group.folder), "tasks");
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${seriesId}.md`), `${stamp()}  ${line}\n`, "utf8");
  } catch {
    /* 日志失败不得影响任务主链路 */
  }
}

/** 追加一条任务运行记录。 */
export function appendRunLog(agentGroupId: string, seriesId: string, line: string): void {
  append(agentGroupId, seriesId, `[run] ${line}`);
}

/** 追加一条宿主侧备注（如自动暂停/退避）。 */
export function appendHostTaskNote(agentGroupId: string, seriesId: string, line: string): void {
  append(agentGroupId, seriesId, `[host] ${line}`);
}
