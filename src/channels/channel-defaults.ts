/**
 * channels/channel-defaults.ts —— wiring 创建期默认值解析与校验
 *
 * 职责：适配器声明的 ChannelDefaults 与 wiring 覆盖的两级解析；行为忠实回退。
 * 关键导出：fallbackChannelDefaults, getChannelDefaults, resolveWiringDefaults,
 *           resolveThreadPolicy, validateEngageAgainstChannel
 * 核心模式：恰好两级配置（适配器声明 / wiring 覆盖），不落 DB；
 *           "仅升级 trunk 不改变任何未声明适配器的行为"（回退忠实）。
 * 借鉴：nanoclaw src/channels/channel-defaults.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { getActiveAdapters, getChannelAdapterExact } from "./channel-registry.js";
import type { ChannelDefaults } from "./adapter.js";
import type { EngageMode, MessagingGroupAgent } from "../types.js";

/** 未声明适配器的行为忠实回退（dm=pattern '.'，group=mention-sticky，policy=request_approval） */
export function fallbackChannelDefaults(supportsThreads: boolean): ChannelDefaults {
  return {
    dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "request_approval" },
    group: {
      engageMode: supportsThreads ? "mention-sticky" : "mention",
      threads: supportsThreads,
      unknownSenderPolicy: "request_approval",
    },
    mentions: "platform",
  };
}

/** 五级解析：活实例精确 → 活实例同类型 → 注册表声明 → 按类型声明 → 回退 */
export function getChannelDefaults(key: string, channelType?: string): ChannelDefaults {
  const exact = getChannelAdapterExact(key);
  if (exact?.defaults) return exact.defaults;
  if (exact) return fallbackChannelDefaults(exact.supportsThreads);
  for (const adapter of getActiveAdapters()) {
    if (adapter.channelType === (channelType ?? key) && adapter.defaults) return adapter.defaults;
  }
  return fallbackChannelDefaults(false);
}

export function hasDeclaredChannelDefaults(key: string): boolean {
  return getChannelAdapterExact(key)?.defaults !== undefined;
}

/** wiring 创建期：取声明上下文默认；mention-sticky 在无 threads 上下文自动降级 mention */
export function resolveWiringDefaults(opts: {
  channelKey: string;
  channelType: string;
  isGroup: boolean;
  agentName?: string;
}): Pick<MessagingGroupAgent, "engage_mode" | "engage_pattern" | "session_mode"> & {
  threads: boolean;
  unknownSenderPolicy: string;
} {
  const defaults = getChannelDefaults(opts.channelKey, opts.channelType);
  const ctx = opts.isGroup ? defaults.group : defaults.dm;
  let engageMode: EngageMode = ctx.engageMode;
  let engagePattern = ctx.engagePattern ?? null;
  if (engageMode === "pattern" && engagePattern?.includes("{name}")) {
    engagePattern = engagePattern.replaceAll("{name}", escapeRegExp(opts.agentName ?? "agent"));
  }
  if (engageMode === "mention-sticky" && !ctx.threads) engageMode = "mention";
  return {
    engage_mode: engageMode,
    engage_pattern: engagePattern,
    session_mode: "shared",
    threads: ctx.threads,
    unknownSenderPolicy: ctx.unknownSenderPolicy,
  };
}

/** 线程策略：wiring.threads NULL=继承声明；与适配器原始能力硬 AND */
export function resolveThreadPolicy(
  wiringThreads: number | null,
  declaredThreads: boolean,
  adapterSupports: boolean,
): boolean {
  if (!adapterSupports) return false;
  if (wiringThreads === null) return declaredThreads;
  return wiringThreads === 1;
}

/** 跨列校验：mentions:'never' 的通道拒绝 mention 类 engage；pattern 缺 pattern 抛错 */
export function validateEngageAgainstChannel(opts: {
  channelKey: string;
  channelType: string;
  engageMode: EngageMode;
  engagePattern: string | null;
}): void {
  const defaults = getChannelDefaults(opts.channelKey, opts.channelType);
  if (defaults.mentions === "never" && (opts.engageMode === "mention" || opts.engageMode === "mention-sticky")) {
    throw new Error(`channel ${opts.channelType} declares mentions:never; mention engage modes are invalid`);
  }
  if (opts.engageMode === "pattern" && !opts.engagePattern) {
    throw new Error("engage_mode=pattern requires engage_pattern");
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
