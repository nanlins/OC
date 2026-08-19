/**
 * channels/index.ts —— 通道自注册 barrel（import 副作用）
 *
 * 职责：trunk 内置 CLI 通道 + 阶段 10 全量平台通道注册；新增通道=追加一行 import（基线同形态）。
 * 关键导出：无（副作用模块）
 * 借鉴：nanoclaw src/channels/index.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2，空 barrel）
 *   2026-08-12 阶段 5：接入 CLI 通道
 *   2026-08-13 阶段 10：接入 telegram/discord/slack/feishu/dingtalk/wecom/email/webhook-generic
 */
import "./cli.js";
import { registerTelegramChannel } from "./telegram.js";
import { registerDiscordChannel } from "./discord.js";
import { registerSlackChannel } from "./slack.js";
import { registerFeishuChannel } from "./feishu.js";
import { registerDingtalkChannel } from "./dingtalk.js";
import { registerWecomChannel } from "./wecom.js";
import { registerEmailChannel } from "./email.js";
import { registerWebhookChannel } from "./webhook-generic.js";

registerTelegramChannel();
registerDiscordChannel();
registerSlackChannel();
registerFeishuChannel();
registerDingtalkChannel();
registerWecomChannel();
registerEmailChannel();
registerWebhookChannel();

export {};
