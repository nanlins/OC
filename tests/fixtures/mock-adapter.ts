/**
 * tests/fixtures/mock-adapter.ts —— Mock 通道适配器
 *
 * 职责：内存通道适配器，无网络调用。用于测试投递/路由全链路。
 * 关键导出：createMockAdapter, MockAdapter
 * 借鉴：测试策略文档第十二章
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */

import type { ChannelAdapter, ChannelSetup, InboundMessage, OutboundMessage } from "../../src/channels/adapter.js";

export interface MockAdapterConfig {
  channelType?: string;
  supportsThreads?: boolean;
  deliverDelayMs?: number;
}

export interface MockAdapterInstance extends ChannelAdapter {
  simulateInbound: (platformId: string, threadId: string | null, message: InboundMessage) => void;
  getDeliveredMessages: () => Array<{ platformId: string; threadId: string | null; msg: OutboundMessage }>;
  reset: () => void;
}

export function createMockAdapter(config: MockAdapterConfig = {}): MockAdapterInstance {
  const channelType = config.channelType ?? "mock";
  const supportsThreads = config.supportsThreads ?? false;
  let setup: ChannelSetup | null = null;
  const delivered: Array<{ platformId: string; threadId: string | null; msg: OutboundMessage }> = [];

  return {
    name: "mock-adapter",
    channelType,
    supportsThreads,
    setup(cfg: ChannelSetup) {
      setup = cfg;
    },
    async deliver(platformId: string, threadId: string | null, msg: OutboundMessage) {
      delivered.push({ platformId, threadId, msg });
      return `mock-msg-${delivered.length}`;
    },
    simulateInbound(platformId: string, threadId: string | null, message: InboundMessage) {
      if (setup) setup.onInbound(platformId, threadId, message);
    },
    getDeliveredMessages() {
      return [...delivered];
    },
    reset() {
      delivered.length = 0;
    },
  };
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

