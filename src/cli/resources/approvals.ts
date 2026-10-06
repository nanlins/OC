/**
 * cli/resources/approvals.ts —— approvals 资源（crud + resolve）
 *
 * 职责：approvals list/get（CRUD 生成）+ resolve（审批闭环入口：cli_command 审批后以
 *       原 caller 重放；投递动作审批经 approvals.resolveApproval 回放）。
 * 关键导出：registerApprovalsResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/approvals.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { randomUUID } from "node:crypto";
import { registerCommand } from "../registry.js";
import { registerCrudResource } from "../crud.js";
import { dispatch } from "../dispatch.js";
import { getDb } from "../../db/connection.js";
import { getSession } from "../../db/sessions.js";
import { getPendingApproval } from "../../modules/approvals.js";
import type { CallerContext } from "../frame.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerApprovalsResource(): void {
  // ---- approvals：list + resolve（审批闭环入口） ----
  registerCrudResource("approvals", {
    table: "pending_approvals",
    columns: ["id", "action", "status", "title", "agent_group_id", "created_at"],
  });
  registerCommand({
    resource: "approvals",
    verb: "resolve",
    scope: "admin",
    description: "Approve or reject a pending approval. cli_command approvals replay the original command on approve.",
    flags: [
      { name: "id", description: "Approval id.", required: true },
      { name: "decision", description: "Resolution.", required: true, enum: ["approve", "reject"] },
    ],
    handler: async (args, caller) => {
      // P1 fix: replay context forbids nested resolve (prevent approval nesting auth transfer)
      if (caller.approved || caller.replaying) {
        throw new LocalizedError("cli.nested_resolve_forbidden", {}, "forbidden");
      }
      if (!args.id || !args.flags.decision) {
        throw new LocalizedError("cli.approval_decision_required", {}, "invalid-args");
      }
      const decision = args.flags.decision;
      if (decision !== "approve" && decision !== "reject") {
        throw new LocalizedError("cli.decision_must_be", {}, "invalid-args");
      }
      const row = getPendingApproval(args.id);
      if (!row) return { resolved: false };
      if (decision === "reject") {
        getDb().prepare("DELETE FROM pending_approvals WHERE id = ?").run(args.id);
        return { resolved: true, decision };
      }
      if (row.action === "cli_command") {
        // cli_command approval: replay with original caller + approved/replaying flags
        const payload = JSON.parse(row.payload) as { cmd?: string; caller?: CallerContext };
        const replay = await dispatch(
          { cmd: payload.cmd ?? "", requestId: randomUUID() },
          { ...(payload.caller ?? caller), approved: true, replaying: true },
        );
        if (replay.ok) getDb().prepare("DELETE FROM pending_approvals WHERE id = ?").run(args.id);
        return replay;
      }
      // delivery action approval: replay via approvals.resolveApproval (guard checks live row)
      const { resolveApproval } = await import("../../modules/approvals.js");
      const session = getSession(row.session_id);
      const out = JSON.parse(row.payload) as { content?: string };
      if (!session) throw new LocalizedError("cli.session_gone", {}, "not-found");
      const ok = await resolveApproval(
        args.id,
        "approve",
        {
          content: out.content ?? row.payload,
          kind: "system",
          operation: null,
          platform_id: null,
          channel_type: "cli",
          thread_id: null,
        },
        session,
      );
      return { resolved: ok };
    },
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
