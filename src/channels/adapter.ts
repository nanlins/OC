/**
 * channels/adapter.ts —— ChannelAdapter 接口全家
 *
 * 职责：通道适配器契约：接收平台事件/过滤/提取双 ID/出站投递；适配器不知道 agent group/session。
 * 关键导出：ChannelAdapter, ChannelSetup, InboundEvent, InboundMessage, DeliveryAddress,
 *           ChannelDefaults, ChannelContextDefaults, ChannelRegistration
 * 借鉴：nanoclaw src/channels/adapter.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */

export interface DeliveryAddress {
  channelType: string;
  platformId: string;
  threadId?: string | null;
}

export interface InboundMessage {
  id: string;
  kind: "chat" | "chat-sdk";
  content: string;
  timestamp: string;
  /** 平台确认的 @ 信号；路由器只认 isMention===true，无文本匹配回退 */
  isMention?: boolean;
  isGroup?: boolean;
  attachments?: Array<{ name?: string | null; mime?: string | null; kind?: string | null; base64: string }>;
  senderId?: string | null;
  senderName?: string | null;
}

export interface InboundEvent {
  channelType: string;
  instance?: string;
  platformId: string;
  threadId: string | null;
  message: InboundMessage;
  /** 路由器层概念，agent 不可设置；仅操作员意图（CLI 管理路由） */
  replyTo?: DeliveryAddress;
}

export interface OutboundMessage {
  kind: string;
  content: string;
  files?: Array<{ name: string; buffer: Buffer }>;
  operation?: "edit" | "reaction" | string | null;
  type?: "ask_question" | "card";
  /** fix-plan 流式：operation=edit 时的目标平台消息 id（宿主从 delivered 解析），渠道据此 editMessageText */
  editTarget?: string | null;
  /** 阶段 12 CLI TUI：流式消息链 id（poll-loop 首条消息 id；edit 消息同链），CLI 客户端据此合并增量 */
  inReplyTo?: string | null;
  /** 阶段 12：流式结束标记（true = 该消息为流式链最终完整版） */
  streamFinal?: boolean | null;
  /** 阶段 12 CLI TUI：会话元数据帧（agent 名/provider/model）；非 CLI 通道忽略 */
  meta?: { agent?: string | null; model?: string | null; provider?: string | null } | null;
}

export interface ChannelSetup {
  onInbound: (platformId: string, threadId: string | null, message: InboundMessage) => void;
  onInboundEvent: (event: InboundEvent) => void;
  onMetadata: (platformId: string, name?: string, isGroup?: boolean) => void;
  onAction: (questionId: string, selectedOption: string, userId: string) => void;
}

export interface ChannelContextDefaults {
  engageMode: "pattern" | "mention" | "mention-sticky";
  engagePattern?: string;
  threads: boolean;
  unknownSenderPolicy: "strict" | "request_approval" | "public";
}

export interface ChannelDefaults {
  dm: ChannelContextDefaults;
  group: ChannelContextDefaults;
  mentions: "platform" | "dm-only" | "never";
}

export interface ChannelAdapter {
  name: string;
  channelType: string;
  instance?: string;
  supportsThreads: boolean;
  setup: (config: ChannelSetup) => void | Promise<void>;
  teardown?: () => void | Promise<void>;
  isConnected?: () => boolean;
  deliver: (platformId: string, threadId: string | null, msg: OutboundMessage) => Promise<string | undefined>;
  setTyping?: (platformId: string, threadId?: string | null) => Promise<void>;
  subscribe?: (platformId: string, threadId: string | null) => Promise<void>;
  openDM?: (userHandle: string) => Promise<string>;
  /** 阶段 12 CLI TUI：容器工具运行状态广播（当前仅 cli 通道实现；host-sweep/delivery 轮询驱动） */
  notifyTool?: (tool: string, status: "running" | "done" | "error", elapsedMs?: number) => void;
  defaults?: ChannelDefaults;
}

export interface ChannelRegistration {
  factory: () => ChannelAdapter | null; // 凭证缺失返回 null 即跳过
  defaults?: ChannelDefaults;
}

/*
 * 修改记录：
 *   2026-08-25 阶段 12：CLI 聊天界面（meta/tool/end 帧协议 + TUI 渲染）
 */

