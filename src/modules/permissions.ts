/**
 * modules/permissions.ts —— 权限与访问控制模块
 *
 * 职责：注册 senderResolver（upsert users）/ accessGate（用户级角色+成员门控，策略拒绝自记审计）/
 *       senderScopeGate（wiring sender_scope=known）/ channelRequestGate（未接线升级 owner 审批）。
 * 关键导出：无（副作用注册）
 * 承重不变量：权限在用户级而非群组级；admin@A 隐含 A 成员；策略性拒绝由门记审计（核心不代记）。
 * 借鉴：nanoclaw src/modules/permissions/
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 6）
 */
import { setSenderResolver, setAccessGate, setSenderScopeGate, setChannelRequestGate } from "../router.js";
import { upsertUser, canAccessAgentGroup, isMember, hasAdminPrivilege, isOwner } from "../db/users.js";
import { recordDeniedSender } from "../db/messaging-groups.js";
import { listOwners } from "./approvals.js";
import { log } from "../log.js";
import type { InboundEvent } from "../channels/adapter.js";
import type { MessagingGroup, MessagingGroupAgent } from "../types.js";

// senderResolver：命名空间用户 id upsert（kind=channelType）
setSenderResolver(async (event: InboundEvent) => {
  const senderId = event.message.senderId ?? null;
  if (!senderId) return { userId: null };
  const user = upsertUser(senderId, event.channelType, event.message.senderName ?? undefined);
  return { userId: user.id, displayName: user.display_name ?? undefined };
});

// accessGate：unknown_sender_policy + 用户级访问判定
setAccessGate(async (event: InboundEvent, userId: string | null, mg: MessagingGroup, agentGroupId: string) => {
  if (mg.unknown_sender_policy === "public") return { allow: true };
  if (!userId) {
    recordDeniedSender(mg.id, event.message.senderId ?? "unknown", event.message.senderName ?? null);
    return { allow: false, reason: "unknown sender" };
  }
  const decision = canAccessAgentGroup(userId, agentGroupId);
  if (
    decision.kind === "owner" ||
    decision.kind === "global_admin" ||
    decision.kind === "admin_of_group" ||
    decision.kind === "member"
  ) {
    return { allow: true };
  }
  if (mg.unknown_sender_policy === "request_approval") {
    recordDeniedSender(mg.id, userId, event.message.senderName ?? null);
    log.info(`access pending approval: ${userId} -> ${agentGroupId}`);
    return { allow: false, reason: "approval required" };
  }
  recordDeniedSender(mg.id, userId, event.message.senderName ?? null);
  return { allow: false, reason: "strict policy: not a member" };
});

// senderScopeGate：wiring sender_scope=known → 必须成员/特权
setSenderScopeGate(async (wiring: MessagingGroupAgent, userId: string | null) => {
  if (!userId) return false;
  const d = canAccessAgentGroup(userId, wiring.agent_group_id);
  return d.kind !== "not_member" && d.kind !== "unknown_user";
});

// channelRequestGate：未接线频道被 @ → 通知 owner（经 approvals 卡片，阶段 6 简化为日志+广播）
setChannelRequestGate((event: InboundEvent, mg: MessagingGroup) => {
  const owners = listOwners();
  log.info(`channel registration request: ${mg.channel_type}:${mg.platform_id} owners=${owners.length}`);
});

export { isMember, hasAdminPrivilege, isOwner };
