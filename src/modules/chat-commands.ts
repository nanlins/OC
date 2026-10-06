/**
 * modules/chat-commands.ts —— 聊天斜杠命令（宿主侧拦截器，阶段 15）
 *
 * 职责：拦截 CLI 聊天斜杠命令 /config /model /agent /export /new /clear /setup，宿主侧直接执行并回写
 *       chat 回复（不唤醒容器）。借鉴 opencode/aichat/aider 的 REPL 命令集形态：
 *       - /model（aider）、/export /session（aichat）、/config（claude-code）、/new（opencode）。
 * 关键导出：resolveCliSession, parseSetupArgs（其余为副作用自注册 registerMessageInterceptor）
 * 承重不变量：
 *   - 仅认领 senderId=cli:local（本地可信通道），渠道消息绝不触发管理命令；
 *   - 首个认领即终止路由（return true），命令不落 messages_in、不唤醒容器；
 *   - 作用会话由 resolveCliSession 按 router 同一套链路解析（CLI 通道身份固定 → 结果确定），
 *     绝不全局猜"最近活跃会话"；解析不到即放行，不静默吞命令；
 *   - 上下文清空的范围由 session-manager.clearSessionContext 单点定义（/new 与 /clear 与
 *     oc sessions clear 三处共用），本文件不得自行拼 session_state 的 DELETE。
 *
 * 修改记录：
 *   2026-09-01 创建（阶段 15：chat 斜杠命令 + onboarding）
 *   2026-09-16 修复 ESLint no-irregular-whitespace：真实 U+3000 空格改为 \u3000 转义，显示不变；同步 Prettier 换行
 *   2026-10-06 P1-2：补 /clear（TUI 帮助一直广告它但主机侧没有），与 /new 同义同实现；
 *              P1-3：latestSession 全局猜测 → resolveCliSession 按 router 链路解析；
 *              handleNew 改用 clearSessionContext（消除与 sessions clear 的重复 SQL）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerMessageInterceptor } from "../router.js";
import { CLI_CHANNEL_TYPE, CLI_PLATFORM_ID, CLI_INSTANCE } from "../channels/cli.js";
import { findSession } from "../db/sessions.js";
import { getAgentGroup, listAgentGroups } from "../db/agent-groups.js";
import { getMessagingGroupWithAgentCount, listWirings } from "../db/messaging-groups.js";
import { getContainerConfig, ensureContainerConfig, updateContainerConfig } from "../db/container-configs.js";
import { writeOutboundDirectFor, inboundDbPath, outboundDbPath, clearSessionContext } from "../session-manager.js";
import { openInboundDb, openOutboundDb } from "../db/session-db.js";
import { readEnvValue, upsertEnv, maskKey } from "../env-write.js";
import { DATA_DIR } from "../config.js";
import { log } from "../log.js";
import type { Session } from "../types.js";

/** /clear 与 /new 同义（都是"清空当前会话上下文"）；TUI 帮助两者都列，实现必须都在。 */
const COMMANDS = new Set(["/config", "/model", "/agent", "/export", "/new", "/clear", "/setup"]);

function reply(session: Session, text: string): void {
  writeOutboundDirectFor(session, {
    kind: "chat",
    content: text,
    channelType: "cli",
    platformId: "local",
    streamFinal: true,
  });
}

/**
 * 解析 TUI 当前真正连着的会话（P1-3 修复）。
 *
 * 原实现 `listSessions().find(s => s.status === "active")` 是全局猜测：listSessions 按
 * last_active DESC 排序，多组/多会话时取到的是"最近有动静的任意会话"，于是 /model 可能
 * 改到别的组的 container_config、/export 导出别的会话。
 *
 * 现改为走 router 的同一套解析链：CLI 通道身份 → messaging_group → 接线（priority DESC）
 * → findSession(session_mode)。CLI 通道身份是固定的（cli/local/无线程），因此结果确定。
 * 解析不到即返回 null（绝不回退到全局猜测），由调用方放行给正常路由。
 */
export function resolveCliSession(): Session | null {
  const combo = getMessagingGroupWithAgentCount(CLI_CHANNEL_TYPE, CLI_PLATFORM_ID, CLI_INSTANCE);
  if (!combo) return null;
  for (const wiring of listWirings(combo.group.id)) {
    const session = findSession({
      agentGroupId: wiring.agent_group_id,
      messagingGroupId: combo.group.id,
      threadId: null,
      sessionMode: wiring.session_mode,
    });
    if (session) return session;
  }
  return null;
}

function handleConfig(session: Session): void {
  const group = getAgentGroup(session.agent_group_id);
  const cfg = getContainerConfig(session.agent_group_id);
  const envProvider = readEnvValue("DEFAULT_AGENT_PROVIDER") ?? "(未设置)";
  const baseUrl = readEnvValue("OPENAI_BASE_URL") ?? "(未设置)";
  const key = maskKey(readEnvValue("OPENAI_API_KEY"));
  reply(
    session,
    [
      "当前配置：",
      `· 组：${group?.name ?? "?"}（${group?.folder ?? "?"}）`,
      `· 组 provider：${cfg?.provider ?? "(未设置)"}\u3000模型：${cfg?.model ?? "(未设置)"}`,
      `· .env 默认 provider：${envProvider}`,
      `· OPENAI_BASE_URL：${baseUrl}`,
      `· OPENAI_API_KEY：${key}`,
      "",
      "修改密钥/供应商：终端运行 pnpm setup；改模型：/model <名称>；看组：/agent",
    ].join("\n"),
  );
}

function handleModel(session: Session, arg: string | null): void {
  const group = getAgentGroup(session.agent_group_id);
  ensureContainerConfig(session.agent_group_id, group?.agent_provider ?? null);
  const cfg = getContainerConfig(session.agent_group_id);
  if (!arg) {
    reply(session, `当前模型：${cfg?.model ?? "(未设置)"}（provider=${cfg?.provider ?? "?"}）。设置：/model <名称>`);
    return;
  }
  updateContainerConfig(session.agent_group_id, { model: arg });
  reply(session, `模型已设为：${arg}（下一条消息生效）`);
}

function handleAgent(session: Session): void {
  const groups = listAgentGroups();
  const lines = groups.map((g) => {
    const cfg = getContainerConfig(g.id);
    const cur = g.id === session.agent_group_id ? "  ← 当前" : "";
    return `· ${g.name}（${g.folder}）provider=${cfg?.provider ?? "?"} model=${cfg?.model ?? "?"}${cur}`;
  });
  reply(
    session,
    ["Agent 组：", ...(lines.length ? lines : ["(无)"]), "", "切换组请用：pnpm oc -- groups list / Web 控制台"].join(
      "\n",
    ),
  );
}

function handleExport(session: Session): void {
  try {
    const inDb = openInboundDb(inboundDbPath(session.agent_group_id, session.id));
    const outDb = openOutboundDb(outboundDbPath(session.agent_group_id, session.id));
    let inbound: unknown[] = [];
    let outbound: unknown[] = [];
    inbound = inDb.prepare("SELECT kind, content, timestamp FROM messages_in ORDER BY seq").all();
    outbound = outDb.prepare("SELECT kind, content, timestamp FROM messages_out ORDER BY seq").all();
    inDb.close();
    outDb.close();
    const dir = join(DATA_DIR, "exports");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${session.id}-${Date.now()}.json`);
    writeFileSync(
      file,
      JSON.stringify({ sessionId: session.id, exportedAt: new Date().toISOString(), inbound, outbound }, null, 2),
    );
    reply(session, `会话已导出：${file}`);
  } catch (err) {
    log.warn("export failed", { err });
    reply(session, `导出失败：${String(err)}`);
  }
}

/** /new 与 /clear 同一实现：清空容器侧对话状态（语义单点定义在 session-manager.clearSessionContext）。 */
function handleNew(session: Session): void {
  try {
    const clearedKeys = clearSessionContext(session);
    reply(session, `已开始新会话（上下文与子任务清单已清空，清除 ${clearedKeys} 项状态）。`);
  } catch (err) {
    log.warn("new session reset failed", { err });
    reply(session, `重置失败：${String(err)}`);
  }
}

export type SetupParse =
  { ok: true; provider: string; env: Record<string, string>; model: string } | { ok: false; error: string };

/** 校验 OpenAI 兼容端点：可解析 + 主机名是 localhost/回环/含点 FQDN（拦 "https://api.deepseek" 这类笔误）。 */
function invalidBaseUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `BASE_URL 不是合法 URL：${url}（示例 https://api.deepseek.com/v1）`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `BASE_URL 协议须为 http/https：${url}`;
  const h = u.hostname;
  const localOk = /^(localhost|127\.|0\.0\.0\.0|::1)$/.test(h);
  if (!localOk) {
    const labels = h.split(".");
    const tld = labels[labels.length - 1] ?? "";
    // 非回环主机须是 FQDN 且末段像 TLD（2-6 字母）——拦 "https://api.deepseek" 这类缺 .com 的笔误
    if (labels.length < 2 || !/^[a-zA-Z]{2,6}$/.test(tld)) {
      return `BASE_URL 主机名无效（缺 .com 等后缀）：${url}（示例 https://api.deepseek.com/v1）`;
    }
  }
  return null;
}

/** 纯解析（可单测）：/setup 参数 → provider + .env 键值 + 模型。首参为 URL 时默认 openai。 */
export function parseSetupArgs(arg: string): SetupParse {
  const parts = arg.split(/\s+/).filter(Boolean);
  const KNOWN = new Set(["openai", "claude", "ollama", "mock"]);
  let provider = parts[0] ?? "";
  let a = parts.slice(1);
  if (!KNOWN.has(provider)) {
    if (/^https?:\/\//i.test(provider)) {
      provider = "openai";
      a = parts;
    } else {
      return {
        ok: false,
        error: "未知 provider，可选：openai / claude / ollama / mock；或省略 provider 直接贴 <BASE_URL> <KEY> [模型]",
      };
    }
  }
  const env: Record<string, string> = { DEFAULT_AGENT_PROVIDER: provider };
  let model = "";
  if (provider === "openai") {
    const baseUrl = a[0];
    const key = a[1];
    model = a[2] ?? "";
    if (!baseUrl || !key) return { ok: false, error: "openai 需要：/setup openai <BASE_URL> <API_KEY> [模型]" };
    const badUrl = invalidBaseUrl(baseUrl);
    if (badUrl) return { ok: false, error: badUrl };
    env.OPENAI_BASE_URL = baseUrl;
    env.OPENAI_API_KEY = key;
  } else if (provider === "claude") {
    const key = a[0];
    model = a[1] ?? "";
    if (!key) return { ok: false, error: "claude 需要：/setup claude <API_KEY> [模型]" };
    env.ANTHROPIC_API_KEY = key;
  } else if (provider === "ollama") {
    env.OLLAMA_HOST = a[0] ?? "http://127.0.0.1:11434";
    model = a[1] ?? "";
  }
  return { ok: true, provider, env, model };
}

function handleSetup(session: Session, arg: string | null): void {
  if (!arg) {
    reply(
      session,
      [
        "用法：/setup <provider> <参数…>（保存 .env 并切换当前组）",
        "  openai：/setup openai <BASE_URL> <API_KEY> [模型]",
        "  claude：/setup claude <API_KEY> [模型]",
        "  ollama：/setup ollama [地址] [模型]",
        "  mock： /setup mock",
        "  也可省略 provider 直接贴 <BASE_URL> <KEY> [模型]",
        "仅查看用 /config；终端交互向导用 pnpm setup",
      ].join("\n"),
    );
    return;
  }
  const parsed = parseSetupArgs(arg);
  if (!parsed.ok) return reply(session, parsed.error);
  const { provider, env, model } = parsed;
  upsertEnv(env);
  ensureContainerConfig(session.agent_group_id, provider);
  const patch: Record<string, string> = { provider };
  if (model) patch.model = model;
  updateContainerConfig(session.agent_group_id, patch as never);
  reply(
    session,
    `已保存 .env（provider=${provider}${model ? ` model=${model}` : ""}），当前组已切换，下一条消息生效。`,
  );
}

registerMessageInterceptor(async (event) => {
  const text = (event.message.content ?? "").trim();
  const cmd = text.split(/\s+/)[0] ?? "";
  if (!COMMANDS.has(cmd)) return false;
  if (event.message.senderId !== "cli:local") return false; // 仅本地 CLI 可信通道
  const session = resolveCliSession();
  if (!session) {
    // 解析不到 CLI 会话：不猜、不静默吞——放行给正常路由（未接线时由 router 记丢弃审计）
    log.info(`chat command "${cmd}" not claimed: no cli session resolved`);
    return false;
  }
  const arg = text.slice(cmd.length).trim() || null;
  switch (cmd) {
    case "/config":
      handleConfig(session);
      break;
    case "/model":
      handleModel(session, arg);
      break;
    case "/agent":
      handleAgent(session);
      break;
    case "/export":
      handleExport(session);
      break;
    case "/new":
    case "/clear":
      handleNew(session);
      break;
    case "/setup":
      handleSetup(session, arg);
      break;
  }
  return true; // 认领：终止路由，不唤醒容器
});
/*
 * 修改记录：
 *   2026-09-01 创建（阶段 15：chat 斜杠命令 + onboarding）
 *   2026-09-16 修复 ESLint no-irregular-whitespace：真实 U+3000 空格改为 \u3000 转义，显示不变；同步 Prettier 换行
 */
