/**
 * modules/chat-commands.ts —— 聊天斜杠命令（宿主侧拦截器，阶段 15）
 *
 * 职责：拦截 CLI 聊天斜杠命令 /config /model /agent /export /new，宿主侧直接执行并回写
 *       chat 回复（不唤醒容器）。借鉴 opencode/aichat/aider 的 REPL 命令集形态：
 *       - /model（aider）、/export /session（aichat）、/config（claude-code）、/new（opencode）。
 * 关键导出：无（副作用自注册 registerMessageInterceptor）
 * 承重不变量：
 *   - 仅认领 senderId=cli:local（本地可信通道），渠道消息绝不触发管理命令；
 *   - 首个认领即终止路由（return true），命令不落 messages_in、不唤醒容器；
 *   - /new 对 outbound session_state 的写属"host-sweep 维护写"同类成文例外（只删历史/continuation 键）。
 *
 * 修改记录：2026-09-01 创建（阶段 15：chat 斜杠命令 + onboarding）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerMessageInterceptor } from "../router.js";
import { listSessions } from "../db/sessions.js";
import { getAgentGroup, listAgentGroups } from "../db/agent-groups.js";
import { getContainerConfig, ensureContainerConfig, updateContainerConfig } from "../db/container-configs.js";
import { writeOutboundDirectFor, inboundDbPath, outboundDbPath } from "../session-manager.js";
import { openInboundDb, openOutboundDb, openOutboundDbRw } from "../db/session-db.js";
import { readEnvValue, upsertEnv, maskKey } from "../env-write.js";
import { DATA_DIR } from "../config.js";
import { log } from "../log.js";
import type { Session } from "../types.js";

const COMMANDS = new Set(["/config", "/model", "/agent", "/export", "/new", "/setup"]);

function reply(session: Session, text: string): void {
  writeOutboundDirectFor(session, {
    kind: "chat",
    content: text,
    channelType: "cli",
    platformId: "local",
    streamFinal: true,
  });
}

function latestSession(): Session | null {
  return listSessions().find((s) => s.status === "active") ?? null;
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
      `· 组 provider：${cfg?.provider ?? "(未设置)"}　模型：${cfg?.model ?? "(未设置)"}`,
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
  reply(session, ["Agent 组：", ...(lines.length ? lines : ["(无)"]), "", "切换组请用：pnpm oc -- groups list / Web 控制台"].join("\n"));
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
    writeFileSync(file, JSON.stringify({ sessionId: session.id, exportedAt: new Date().toISOString(), inbound, outbound }, null, 2));
    reply(session, `会话已导出：${file}`);
  } catch (err) {
    log.warn("export failed", { err });
    reply(session, `导出失败：${String(err)}`);
  }
}

function handleNew(session: Session): void {
  // 清容器会话状态（历史/continuation/回复指针）→ 下一条消息即全新会话（同类 host-sweep 维护写）
  try {
    const db = openOutboundDbRw(outboundDbPath(session.agent_group_id, session.id));
    db.prepare("DELETE FROM session_state WHERE key LIKE 'history:%' OR key LIKE 'continuation:%' OR key = 'current_in_reply_to' OR key = 'todos'").run();
    db.close();
    reply(session, "已开始新会话（上下文与子任务清单已清空）。");
  } catch (err) {
    log.warn("new session reset failed", { err });
    reply(session, `重置失败：${String(err)}`);
  }
}

export type SetupParse =
  | { ok: true; provider: string; env: Record<string, string>; model: string }
  | { ok: false; error: string };

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
      return { ok: false, error: "未知 provider，可选：openai / claude / ollama / mock；或省略 provider 直接贴 <BASE_URL> <KEY> [模型]" };
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
  reply(session, `已保存 .env（provider=${provider}${model ? ` model=${model}` : ""}），当前组已切换，下一条消息生效。`);
}

registerMessageInterceptor(async (event) => {
  const text = (event.message.content ?? "").trim();
  const cmd = text.split(/\s+/)[0] ?? "";
  if (!COMMANDS.has(cmd)) return false;
  if (event.message.senderId !== "cli:local") return false; // 仅本地 CLI 可信通道
  const session = latestSession();
  if (!session) return false;
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
      handleNew(session);
      break;
    case "/setup":
      handleSetup(session, arg);
      break;
  }
  return true; // 认领：终止路由，不唤醒容器
});
/*
 * 修改记录：2026-09-01 创建（阶段 15：chat 斜杠命令 + onboarding）
 */
