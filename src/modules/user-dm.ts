/**
 * modules/user-dm.ts —— 冷 DM 解析（user_dms 缓存）
 *
 * 职责：ensureUserDm(userId) 返回可用于给该用户发 DM 的 messaging_group（惰性创建并缓存）。
 *       审批/通知/配对握手等一切"主动 DM 用户"的入口统一走本函数。
 * 关键导出：ensureUserDm
 * 承重不变量：缓存行指向的 messaging_group 已删时重新解析；直址通道（handle 即 DM id）免 openDM 往返。
 * 借鉴：nanoclaw src/modules/permissions/user-dm.ts（同构简化）
 *
 * 修改记录：2026-08-26 创建（阶段 12：补齐 nanoclaw user_dms 冷 DM 缓存逻辑）
 */
import { getChannelAdapter } from "../channels/channel-registry.js";
import { createMessagingGroup, findByPlatform, getMessagingGroup } from "../db/messaging-groups.js";
import { getUser } from "../db/users.js";
import { getUserDm, upsertUserDm } from "../db/user-dms.js";
import { log } from "../log.js";
import type { MessagingGroup, User } from "../types.js";

/** 解析 "channel:handle" 命名空间用户 id；非命名空间或适配器缺失返回 null */
function parseUserId(user: User): { channelType: string; handle: string } | null {
  const idx = user.id.indexOf(":");
  if (idx < 0) return null;
  const channelType = user.id.slice(0, idx);
  const handle = user.id.slice(idx + 1);
  if (!channelType || !handle) return null;
  // Teams 等特殊前缀：前缀不是适配器时回退 kind
  if (!getChannelAdapter(channelType) && user.kind && getChannelAdapter(user.kind)) {
    return { channelType: user.kind, handle: user.id };
  }
  return { channelType, handle };
}

/**
 * 返回可用于 DM 该用户的 messaging_group（惰性创建 + user_dms 缓存）。
 * 返回 null = 用户不可达（不存在 / id 未命名空间 / 通道无适配器 / openDM 失败）。
 */
export async function ensureUserDm(userId: string): Promise<MessagingGroup | null> {
  const user = getUser(userId);
  if (!user) {
    log.warn("ensureUserDm: user not found", { userId });
    return null;
  }
  const parsed = parseUserId(user);
  if (!parsed) {
    log.warn("ensureUserDm: user id not namespaced", { userId });
    return null;
  }
  const { channelType, handle } = parsed;

  // 缓存命中：加载 messaging_group，有效即返回
  const cached = getUserDm(userId, channelType);
  if (cached) {
    const mg = getMessagingGroup(cached.messaging_group_id);
    if (mg) return mg;
    log.warn("ensureUserDm: cached row references missing messaging_group, re-resolving", { channelType });
  }

  // 缓存未命中：解析 DM 平台 id（openDM 或直址）
  const adapter = getChannelAdapter(channelType);
  if (!adapter) {
    log.warn("ensureUserDm: no adapter for channel", { channelType });
    return null;
  }
  let dmPlatformId: string;
  if (adapter.openDM) {
    try {
      dmPlatformId = await adapter.openDM(handle);
    } catch (err) {
      log.error("ensureUserDm: adapter.openDM failed", { channelType, err });
      return null;
    }
  } else {
    dmPlatformId = handle; // 直址通道：handle 即 DM 平台 id
  }

  // find-or-create messaging_group（先前收到的 DM 可能已有行）
  const instance = adapter.instance ?? channelType;
  let mg = findByPlatform(channelType, dmPlatformId, instance);
  if (!mg) {
    mg = createMessagingGroup({
      channelType,
      platformId: dmPlatformId,
      instance,
      isGroup: false,
      name: user.display_name ?? undefined,
      // 刻意 strict：本行支撑主机发起的 DM（审批人等特权用户），不接受通道声明的 public 策略（nanoclaw 同语义）
      unknownSenderPolicy: "strict",
    });
    log.info("ensureUserDm: created DM messaging_group", { userId, channelType });
  }

  upsertUserDm({ user_id: userId, channel_type: channelType, messaging_group_id: mg.id });
  return mg;
}
