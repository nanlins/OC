/**
 * modules/self-mod.ts —— Agent 自我修改模块
 *
 * 职责：install_packages / add_mcp_server 特权动作：guard 恒 HOLD（审批人 owner）；
 *       precheck 校验（apt/npm 包名正则 ≤20、MCP 参数上限）；批准后 apply：
 *       更新 container_configs + restartAgentGroupContainers（on_wake 验证提示）。
 * 关键导出：无（副作用注册）
 * 承重不变量：容器侧 MCP 门可被绕过，授权必须主机侧；grant 回放结构检查重跑。
 * 借鉴：nanoclaw src/modules/self-mod/
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 6）
 *   2026-08-12 复检修复：投递动作名与审批 action/grantActionName 三处同名闭合；precheck 硬化（16KB/args≤32/禁版本后缀）
 *   2026-08-13 阶段 14：审批卡标题按宿主 locale 本地化；HOLD reason 保持英文供审计（P1-4 修复）
 */
import { registerDeliveryAction } from "../delivery.js";
import { defineGuardedAction, HOLD } from "../guard/index.js";
import { requestApproval } from "./approvals.js";
import { updateContainerConfig } from "../db/container-configs.js";
import { configFromDb } from "../container-config.js";
import { restartAgentGroupContainers } from "../container-restart.js";
import { log } from "../log.js";
import { t, resolveLocaleFromEnv } from "../i18n/index.js";
import type { MessageOut, Session } from "../types.js";

const PKG_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,100}$/; // 禁版本后缀/@内嵌/路径形（基线 NPM_RE 语义）
const MAX_PACKAGES = 20;
const MAX_PAYLOAD_BYTES = 16 * 1024; // 基线 payload 上限
const MAX_MCP_ARGS = 32;

const installPackagesAction = defineGuardedAction("self_mod.install_packages", {
  // HOLD reason 保持英文：写入 guard_audit.reason，须 locale 无关可 grep（P1-4 修复，对齐 command-gate 模式）
  decide: () => HOLD("installing packages requires owner approval"),
  grantActionName: "self_mod.install_packages",
});
const addMcpServerAction = defineGuardedAction("self_mod.add_mcp_server", {
  decide: () => HOLD("adding an MCP server requires owner approval"),
  grantActionName: "self_mod.add_mcp_server",
});

function precheckPackages(out: MessageOut, _session: Session): string | null {
  if (out.content.length > MAX_PAYLOAD_BYTES) return "payload exceeds 16KB";
  const parsed = JSON.parse(out.content) as { packages?: string[] };
  const pkgs = parsed.packages ?? [];
  if (pkgs.length === 0) return "no packages specified";
  if (pkgs.length > MAX_PACKAGES) return `too many packages (>${MAX_PACKAGES})`;
  for (const p of pkgs) {
    if (!PKG_RE.test(p)) return `invalid package name: ${p}`;
  }
  return null;
}

/**
 * fix-plan P0（诚实降级）：install_packages 当前为「配置级」生效——把包写入 container_configs.packages
 * 并重启容器，但运行时镜像并不热安装这些包（需重建镜像或容器启动钩子，属未接通项，见 benchmark-90 §未完成）。
 * 故 on_wake 文案如实说明，不再谎称"已安装"。
 */
async function applyInstall(out: MessageOut, session: Session): Promise<void> {
  const parsed = JSON.parse(out.content) as { packages?: string[] };
  const current = configFromDb(session.agent_group_id);
  const merged = [...new Set([...current.packages, ...(parsed.packages ?? [])])];
  updateContainerConfig(session.agent_group_id, { packages: merged } as never);
  restartAgentGroupContainers(
    session.agent_group_id,
    "self-mod install_packages",
    "packages recorded in config; runtime install requires image rebuild (not hot-applied)",
  );
  log.info(`self-mod applied: install_packages config updated (${merged.length} total)`);
}

/**
 * fix-plan P0（诚实降级）：add_mcp_server 当前为「配置级」生效——把 server 写入 container_configs.mcp_servers，
 * 但 agent-runner 尚无 MCP client 去连接并注册这些 server 的工具（未接通项，见 benchmark-90 §未完成）。
 */
async function applyAddMcp(out: MessageOut, session: Session): Promise<void> {
  const parsed = JSON.parse(out.content) as { name?: string; command?: string; args?: string[] };
  if (!parsed.name || !parsed.command) throw new Error("add_mcp_server requires name+command");
  const current = configFromDb(session.agent_group_id);
  const servers = { ...current.mcpServers, [parsed.name]: { command: parsed.command, args: parsed.args ?? [] } };
  updateContainerConfig(session.agent_group_id, { mcpServers: servers } as never);
  restartAgentGroupContainers(
    session.agent_group_id,
    "self-mod add_mcp_server",
    "mcp server recorded in config; runtime connection not yet implemented",
  );
  log.info(`self-mod applied: add_mcp_server config updated ${parsed.name}`);
}

registerDeliveryAction("self_mod.install_packages", {
  guard: {
    guardAction: installPackagesAction,
    precheck: precheckPackages,
    requestHold: async (out, session, _reason) => {
      // 审批卡标题（审批人面）本地化；审计面保留英文 reason（P1-4 修复）
      await requestApproval({
        sessionId: session.id,
        action: "self_mod.install_packages",
        agentGroupId: session.agent_group_id,
        payload: out.content,
        title: t("channel.install_needs_approval", resolveLocaleFromEnv()),
      });
    },
    onDeny: async (out, session, reason) => {
      log.warn(`install_packages denied: ${reason}`);
    },
  },
  handler: applyInstall,
});

registerDeliveryAction("self_mod.add_mcp_server", {
  guard: {
    guardAction: addMcpServerAction,
    precheck: (out) => {
      if (out.content.length > MAX_PAYLOAD_BYTES) return "payload exceeds 16KB";
      const parsed = JSON.parse(out.content) as { name?: string; command?: string; args?: string[] };
      if (!parsed.name) return "missing mcp server name";
      if (!parsed.command) return "missing mcp server command";
      if ((parsed.args ?? []).length > MAX_MCP_ARGS) return `too many mcp args (>${MAX_MCP_ARGS})`;
      return null;
    },
    requestHold: async (out, session, _reason) => {
      await requestApproval({
        sessionId: session.id,
        action: "self_mod.add_mcp_server",
        agentGroupId: session.agent_group_id,
        payload: out.content,
        title: t("channel.add_mcp_needs_approval", resolveLocaleFromEnv()),
      });
    },
    onDeny: async (_out, _session, reason) => {
      log.warn(`add_mcp_server denied: ${reason}`);
    },
  },
  handler: applyAddMcp,
});
