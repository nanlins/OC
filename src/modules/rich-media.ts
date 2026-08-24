/**
 * modules/rich-media.ts —— 富媒体消息支持
 *
 * 职责：Markdown 渲染 + 按钮/卡片/表单（Telegram/Discord/Slack 原生组件）。
 *       根据通道类型自动选择最佳渲染格式。
 * 关键导出：renderCard, renderButtons, renderForm, RichCard, ButtonGroup
 * 知识文档映射：04-Agent应用详解 §4.10 交互式问题
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */

export type Platform = "telegram" | "discord" | "slack" | "cli" | "web";

export interface Button {
  text: string;
  value: string;
  style?: "primary" | "danger" | "default";
  url?: string;
}

export interface ButtonGroup {
  buttons: Button[];
  columns?: number;
}

export interface RichCard {
  title: string;
  subtitle?: string;
  body?: string;
  image?: string;
  buttons?: ButtonGroup;
  footer?: string;
  color?: string;
}

export interface RenderResult {
  content: string;
  attachments?: Array<{ name: string; content: string; mime: string }>;
}

export function renderCard(card: RichCard, platform: Platform): RenderResult {
  switch (platform) {
    case "telegram":
      return renderTelegramCard(card);
    case "discord":
      return renderDiscordCard(card);
    case "slack":
      return renderSlackCard(card);
    case "web":
      return renderWebCard(card);
    case "cli":
    default:
      return renderCliCard(card);
  }
}

function renderTelegramCard(card: RichCard): RenderResult {
  const lines: string[] = [];
  if (card.title) lines.push(`*${card.title}*`);
  if (card.subtitle) lines.push(`_${card.subtitle}_`);
  if (card.body) lines.push("", card.body);
  if (card.footer) lines.push("", `_${card.footer}_`);

  const inlineKeyboard = card.buttons?.buttons.map((b) => ({
    text: b.text,
    callback_data: b.value,
    url: b.url,
  }));

  return {
    content: lines.join("\n"),
    attachments: inlineKeyboard
      ? [{ name: "keyboard.json", content: JSON.stringify({ inline_keyboard: [inlineKeyboard] }), mime: "application/json" }]
      : undefined,
  };
}

function renderDiscordCard(card: RichCard): RenderResult {
  const embed: Record<string, unknown> = {
    title: card.title,
    description: card.body ?? card.subtitle ?? "",
    color: card.color ? parseInt(card.color.replace("#", ""), 16) : undefined,
    footer: card.footer ? { text: card.footer } : undefined,
    image: card.image ? { url: card.image } : undefined,
  };

  const payload: Record<string, unknown> = { embeds: [embed] };
  if (card.buttons) {
    payload.components = [
      {
        type: 1,
        components: card.buttons.buttons.map((b) => ({
          type: 2,
          style: b.style === "danger" ? 4 : b.style === "primary" ? 1 : 2,
          label: b.text,
          custom_id: b.value,
          url: b.url,
        })),
      },
    ];
  }

  return {
    content: JSON.stringify(payload),
    attachments: [{ name: "discord.json", content: JSON.stringify(payload), mime: "application/json" }],
  };
}

function renderSlackCard(card: RichCard): RenderResult {
  const blocks: unknown[] = [];
  if (card.title) {
    blocks.push({ type: "header", text: { type: "plain_text", text: card.title } });
  }
  if (card.body) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: card.body } });
  }
  if (card.buttons) {
    blocks.push({
      type: "actions",
      elements: card.buttons.buttons.map((b) => ({
        type: "button",
        text: { type: "plain_text", text: b.text },
        value: b.value,
        url: b.url,
        style: b.style,
      })),
    });
  }
  if (card.footer) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: card.footer }] });
  }

  return { content: JSON.stringify({ blocks }) };
}

function renderWebCard(card: RichCard): RenderResult {
  const html = [
    `<div class="card" style="border-left:4px solid ${card.color ?? '#5865f2'};padding:12px;margin:8px 0">`,
    card.title ? `<h3>${card.title}</h3>` : "",
    card.subtitle ? `<p style="color:#888">${card.subtitle}</p>` : "",
    card.image ? `<img src="${card.image}" style="max-width:100%"/>` : "",
    card.body ? `<p>${card.body}</p>` : "",
    card.buttons
      ? `<div>${card.buttons.buttons.map((b) => `<button value="${b.value}" style="${b.style === 'danger' ? 'background:red' : b.style === 'primary' ? 'background:#5865f2' : ''}">${b.text}</button>`).join(" ")}</div>`
      : "",
    card.footer ? `<p style="color:#666;font-size:12px">${card.footer}</p>` : "",
    "</div>",
  ].join("\n");

  return { content: html };
}

function renderCliCard(card: RichCard): RenderResult {
  const lines: string[] = [];
  const divider = "─".repeat(40);
  lines.push(divider);
  if (card.title) lines.push(`  ${card.title}`);
  if (card.subtitle) lines.push(`  ${card.subtitle}`);
  if (card.body) lines.push("", card.body);
  if (card.buttons) {
    lines.push("");
    card.buttons.buttons.forEach((b, i) => {
      lines.push(`  [${i + 1}] ${b.text}`);
    });
  }
  if (card.footer) lines.push("", `  ${card.footer}`);
  lines.push(divider);

  return { content: lines.join("\n") };
}

export function renderButtons(buttons: Button[], platform: Platform): RenderResult {
  return renderCard({ title: "", buttons: { buttons } }, platform);
}

export function renderForm(title: string, fields: Array<{ label: string; value: string }>, platform: Platform): RenderResult {
  const body = fields.map((f) => `**${f.label}**: ${f.value}`).join("\n");
  return renderCard({ title, body }, platform);
}