/**
 * scripts/setup.ts —— 交互式安装向导（阶段 15，onboarding）
 *
 * 职责：终端引导配置 LLM 供应商/模型/密钥并写入 .env，可选创建默认 Agent 组。
 *       解决"从 GitHub 克隆后如何在终端配置"的 onboarding 缺口。
 * 用法：pnpm setup
 * 借鉴：claude-code /config 交互式设置 + nanoclaw setup 步骤（set-env/verify）形态；
 *       UI 用 @clack/prompts（package.json 既有依赖）。
 * 承重不变量：密钥只写 .env（0600 语义由主机读取层保证），不回显明文、不进 argv。
 *
 * 修改记录：2026-09-01 创建（阶段 15：chat 斜杠命令 + onboarding）
 */
import * as p from "@clack/prompts";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { ENV_PATH, CENTRAL_DB_PATH } from "../src/config.js";
import { initDb, closeDb } from "../src/db/connection.js";
import { createAgentGroup, getAgentGroupByFolder } from "../src/db/agent-groups.js";
import { ensureContainerConfig, updateContainerConfig } from "../src/db/container-configs.js";

function upsertEnv(kv: Record<string, string>): void {
  let lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  if (lines.length === 1 && lines[0] === "") lines = [];
  const remaining = new Set(Object.keys(kv));
  const out = lines.map((l) => {
    const eq = l.indexOf("=");
    if (eq > 0) {
      const key = l.slice(0, eq).trim();
      if (key in kv) {
        remaining.delete(key);
        return `${key}=${kv[key]}`;
      }
    }
    return l;
  });
  for (const k of remaining) out.push(`${k}=${kv[k]}`);
  writeFileSync(ENV_PATH, out.join("\n") + "\n");
  try {
    chmodSync(ENV_PATH, 0o600);
  } catch {
    /* win32 忽略 */
  }
}

async function main(): Promise<void> {
  p.intro("OC 配置向导");

  const provider = await p.select({
    message: "选择 LLM 供应商",
    options: [
      { value: "openai", label: "OpenAI 兼容（DeepSeek/GLM/Qwen/Moonshot…）", hint: "推荐" },
      { value: "claude", label: "Anthropic Claude" },
      { value: "ollama", label: "本地 Ollama（免 key）" },
      { value: "mock", label: "Mock（纯 echo，验证链路）" },
    ],
  });
  if (p.isCancel(provider)) return p.cancel("已取消");

  const env: Record<string, string> = { DEFAULT_AGENT_PROVIDER: provider as string };
  let model = "";

  if (provider === "openai") {
    const baseUrl = await p.text({
      message: "OpenAI 兼容端点 BASE_URL",
      initialValue: "https://api.deepseek.com/v1",
      defaultValue: "https://api.deepseek.com/v1",
    });
    if (p.isCancel(baseUrl)) return p.cancel("已取消");
    const key = await p.password({ message: "API Key（OPENAI_API_KEY）" });
    if (p.isCancel(key)) return p.cancel("已取消");
    const m = await p.text({ message: "模型名", initialValue: "deepseek-chat", defaultValue: "deepseek-chat" });
    if (p.isCancel(m)) return p.cancel("已取消");
    env.OPENAI_BASE_URL = String(baseUrl);
    env.OPENAI_API_KEY = String(key);
    model = String(m);
  } else if (provider === "claude") {
    const key = await p.password({ message: "ANTHROPIC_API_KEY" });
    if (p.isCancel(key)) return p.cancel("已取消");
    env.ANTHROPIC_API_KEY = String(key);
    const m = await p.text({ message: "模型名", initialValue: "claude-sonnet-4-20250514", defaultValue: "claude-sonnet-4-20250514" });
    if (p.isCancel(m)) return p.cancel("已取消");
    model = String(m);
  } else if (provider === "ollama") {
    const host = await p.text({
      message: "Ollama 地址",
      initialValue: "http://127.0.0.1:11434",
      defaultValue: "http://127.0.0.1:11434",
    });
    if (p.isCancel(host)) return p.cancel("已取消");
    env.OLLAMA_HOST = String(host);
    const m = await p.text({ message: "模型名", initialValue: "llama3", defaultValue: "llama3" });
    if (p.isCancel(m)) return p.cancel("已取消");
    model = String(m);
  }

  upsertEnv(env);
  p.log.success(`已写入 .env（provider=${provider}）`);

  const wantGroup = await p.confirm({ message: "现在创建/绑定一个默认 Agent 组？", initialValue: true });
  if (!p.isCancel(wantGroup) && wantGroup) {
    const name = await p.text({ message: "组名", initialValue: "demo", defaultValue: "demo" });
    if (p.isCancel(name)) return p.cancel("已取消");
    const folder = await p.text({ message: "工作目录 folder", initialValue: "demo", defaultValue: "demo" });
    if (p.isCancel(folder)) return p.cancel("已取消");
    initDb(CENTRAL_DB_PATH);
    let group = getAgentGroupByFolder(String(folder));
    if (!group) group = createAgentGroup({ name: String(name), folder: String(folder), agentProvider: provider as string });
    ensureContainerConfig(group.id, provider as string);
    if (model) updateContainerConfig(group.id, { provider: provider as string, model } as never);
    closeDb();
    p.log.success(`Agent 组就绪：${group.name}（${group.folder}）provider=${provider}${model ? ` model=${model}` : ""}`);
  }

  p.outro(["完成。下一步：", "  pnpm build:container   # 构建容器镜像", "  pnpm start             # 启动主机", "  pnpm chat              # 对话（/help 看命令）"].join("\n"));
}

main().catch((err) => {
  p.cancel(String(err));
  process.exit(1);
});
/*
 * 修改记录：2026-09-01 创建（阶段 15：chat 斜杠命令 + onboarding）
 */
