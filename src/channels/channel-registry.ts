/**
 * channels/channel-registry.ts —— 通道注册表 + 生命周期 + 投递桥
 *
 * 职责：适配器自注册；活实例 Map（键=instance ?? channelType）；查找非对称
 *       （入站精确无回退 / 出站 exact-only）；MissingChannelAdapterError 刻意抛错。
 * 关键导出：registerChannelAdapter, getChannelAdapterExact, getChannelAdapter,
 *           initChannelAdapters, teardownChannelAdapters, getActiveAdapters, MissingChannelAdapterError
 * 承重不变量：出站投递绝不回退到同平台兄弟实例（会用错 bot 身份发信，nanoclaw #2995 教训）。
 * 借鉴：nanoclaw src/channels/channel-registry.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { log } from "../log.js";
import type { ChannelAdapter, ChannelRegistration, ChannelSetup } from "./adapter.js";

export class MissingChannelAdapterError extends Error {
  constructor(key: string) {
    super(`missing channel adapter for key: ${key}`);
    this.name = "MissingChannelAdapterError";
  }
}

const registry = new Map<string, ChannelRegistration>();
const activeAdapters = new Map<string, ChannelAdapter>();

export function registerChannelAdapter(name: string, registration: ChannelRegistration): void {
  if (registry.has(name)) log.warn(`channel adapter re-registered: ${name}`);
  registry.set(name, registration);
}

export function getChannelAdapterExact(key: string): ChannelAdapter | undefined {
  return activeAdapters.get(key);
}

/** channelType-only 调用方用：精确未中 → 同 channelType 首个（插入序）+ warn */
export function getChannelAdapter(key: string): ChannelAdapter | undefined {
  const exact = activeAdapters.get(key);
  if (exact) return exact;
  for (const adapter of activeAdapters.values()) {
    if (adapter.channelType === key) {
      log.warn(`channel adapter fallback by channelType: ${key} -> ${adapter.instance ?? adapter.channelType}`);
      return adapter;
    }
  }
  return undefined;
}

/** 出站投递专用：找不到即抛错（undefined 会被误标"投递成功"，#2995） */
export function requireDeliveryAdapter(key: string): ChannelAdapter {
  const adapter = activeAdapters.get(key);
  if (!adapter) throw new MissingChannelAdapterError(key);
  return adapter;
}

export function getActiveAdapters(): ChannelAdapter[] {
  return [...activeAdapters.values()];
}

/** 启动期实例化全部已注册通道；factory null（缺凭证）跳过；重复实例键 warn 覆盖。
 *  makeSetup 由主机提供（instance 戳印接缝：适配器保持实例盲，主机在 onInbound 戳 instance）。 */
export async function initChannelAdapters(makeSetup: (adapter: ChannelAdapter) => ChannelSetup): Promise<void> {
  for (const [name, reg] of registry) {
    let adapter: ChannelAdapter | null = null;
    try {
      adapter = reg.factory();
    } catch (err) {
      log.error(`channel factory threw: ${name}`, { err });
      continue;
    }
    if (!adapter) {
      log.info(`channel skipped (missing credentials): ${name}`);
      continue;
    }
    try {
      await adapter.setup(makeSetup(adapter));
    } catch (err) {
      log.error(`channel setup failed: ${name}`, { err });
      continue;
    }
    const key = adapter.instance ?? adapter.channelType;
    if (activeAdapters.has(key)) log.warn(`duplicate channel instance key overridden: ${key}`);
    activeAdapters.set(key, adapter);
    log.info(`channel active: ${key}`);
  }
}

export async function teardownChannelAdapters(): Promise<void> {
  for (const adapter of activeAdapters.values()) {
    try {
      await adapter.teardown?.();
    } catch (err) {
      log.warn(`channel teardown failed: ${adapter.name}`, { err });
    }
  }
  activeAdapters.clear();
}

/** 仅供测试 */
export function clearChannelRegistryForTest(): void {
  registry.clear();
  activeAdapters.clear();
}

/** 仅供测试：直接注入活实例 */
export function setActiveAdapterForTest(adapter: ChannelAdapter): void {
  activeAdapters.set(adapter.instance ?? adapter.channelType, adapter);
}
