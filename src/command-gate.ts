/**
 * command-gate.ts —— 主机侧斜杠命令闸门（进容器前分类）
 *
 * 职责：管理员命令鉴权 / 放行。直查 user_roles，无 env 变量、无容器侧检查。
 * 关键导出：gateCommand, ADMIN_COMMANDS, RUNNER_COMMANDS
 * 核心模式：未知斜杠命令放行给 SDK 处理；deny 由 router 直写 outbound 不唤醒容器 + 审计日志。
 * 内容形状契约（P1 修复，se-inspector）：content 为纯文本；若阶段 5 戳印接缝改用 JSON 信封，
 *           必须在此先解包 .text 再判定，防门绕过。
 * 借鉴：nanoclaw src/command-gate.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 *   2026-08-12 删除死代码 filter 分支；注明内容形状契约
 *   2026-08-13 阶段 14：deny 结果增补 reasonKey/params（渠道本地化），英文 reason 保留供审计
 */
import { hasAdminPrivilege } from "./db/users.js";

/** 容器内 runner 自行处理的命令（主机透传） */
export const RUNNER_COMMANDS = new Set(["/clear"]);

/** 需要 admin 权限的主机管理命令 */
export const ADMIN_COMMANDS = new Set(["/manage-channels", "/customize", "/restart", "/add-skill"]);

export type GateResult =
  { action: "pass" } | { action: "deny"; reason: string; reasonKey?: string; params?: Record<string, string> };

export function gateCommand(content: string, userId: string | null, agentGroupId: string): GateResult {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) return { action: "pass" };
  const cmd = (trimmed.split(/\s/)[0] ?? "").toLowerCase();
  if (RUNNER_COMMANDS.has(cmd)) return { action: "pass" };
  if (!ADMIN_COMMANDS.has(cmd)) return { action: "pass" }; // 未知斜杠命令交 SDK
  if (userId && hasAdminPrivilege(userId, agentGroupId)) return { action: "pass" };
  // reason 保留英文供审计/测试；reasonKey/params 供渠道按 locale 本地化（阶段 14）
  return {
    action: "deny",
    reason: `admin privilege required for ${cmd}`,
    reasonKey: "channel.admin_required",
    params: { cmd },
  };
}
