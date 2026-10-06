/**
 * scripts/setup.ts -- Interactive setup wizard (phase 15, onboarding)
 *
 * Responsibility: Terminal-guided LLM provider/model/key configuration writing to .env,
 * optional default Agent group creation + CLI channel wiring. Branded intro with brandChip.
 * Usage: pnpm setup
 *
 * **这是 `pnpm setup` 的唯一真实主路径**（package.json "setup" 脚本指向本文件）。
 * `src/setup/`（index/runner/steps/status）是一个从未接线到任何入口的 step-runner 框架，
 * 不是 `pnpm setup`；二者不是等价路径，见 src/setup/README.md 的废弃标注。
 *
 * Referenced: nanoclaw setup flow, @clack/prompts
 * Invariant: keys are only written to .env (0600 semantics enforced by host read layer),
 * never echoed as plaintext, never in argv.
 *
 * Modification record:
 *   2026-09-01  Created (phase 15: chat slash commands + onboarding)
 *   2026-10-04  P0-2: branded intro; P0-5: unified as primary setup entry
 *   2026-10-06  P2-1: 标注为 pnpm setup 的唯一主路径，与 src/setup/ 区分
 */
import * as p from "@clack/prompts";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { ENV_PATH, CENTRAL_DB_PATH, DATA_DIR } from "../src/config.js";
import { initDb, closeDb, getDb } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrations/index.js";
import { migration001 } from "../src/db/migrations/001-initial.js";
import { migration002 } from "../src/db/migrations/002-destinations.js";
import { createAgentGroup, getAgentGroupByFolder } from "../src/db/agent-groups.js";
import { ensureContainerConfig, updateContainerConfig } from "../src/db/container-configs.js";
import { ensureCliWiring } from "../src/channels/cli.js";
import { brandChip } from "../src/theme.js";

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
    /* win32 ignored */
  }
}

async function main(): Promise<void> {
  p.intro(brandChip(" OC Setup "));

  const provider = await p.select({
    message: "Select LLM provider",
    options: [
      { value: "openai", label: "OpenAI compatible (DeepSeek/GLM/Qwen/Moonshot...)", hint: "recommended" },
      { value: "claude", label: "Anthropic Claude" },
      { value: "ollama", label: "Local Ollama (no key needed)" },
      { value: "mock", label: "Mock (echo only, verify pipeline)" },
    ],
  });
  if (p.isCancel(provider)) return p.cancel("Cancelled");

  const env: Record<string, string> = { DEFAULT_AGENT_PROVIDER: provider as string };
  let model = "";

  if (provider === "openai") {
    const baseUrl = await p.text({
      message: "OpenAI compatible endpoint BASE_URL",
      initialValue: "https://api.deepseek.com/v1",
      defaultValue: "https://api.deepseek.com/v1",
    });
    if (p.isCancel(baseUrl)) return p.cancel("Cancelled");
    const key = await p.password({ message: "API Key (OPENAI_API_KEY)" });
    if (p.isCancel(key)) return p.cancel("Cancelled");
    const m = await p.text({ message: "Model name", initialValue: "deepseek-chat", defaultValue: "deepseek-chat" });
    if (p.isCancel(m)) return p.cancel("Cancelled");
    env.OPENAI_BASE_URL = String(baseUrl);
    env.OPENAI_API_KEY = String(key);
    model = String(m);
  } else if (provider === "claude") {
    const key = await p.password({ message: "ANTHROPIC_API_KEY" });
    if (p.isCancel(key)) return p.cancel("Cancelled");
    env.ANTHROPIC_API_KEY = String(key);
    const m = await p.text({ message: "Model name", initialValue: "claude-sonnet-4-20250514", defaultValue: "claude-sonnet-4-20250514" });
    if (p.isCancel(m)) return p.cancel("Cancelled");
    model = String(m);
  } else if (provider === "ollama") {
    const host = await p.text({
      message: "Ollama address",
      initialValue: "http://127.0.0.1:11434",
      defaultValue: "http://127.0.0.1:11434",
    });
    if (p.isCancel(host)) return p.cancel("Cancelled");
    env.OLLAMA_HOST = String(host);
    const m = await p.text({ message: "Model name", initialValue: "llama3", defaultValue: "llama3" });
    if (p.isCancel(m)) return p.cancel("Cancelled");
    model = String(m);
  }

  upsertEnv(env);
  p.log.success(`Written to .env (provider=${provider})`);

  // Owner/admin onboarding: create first agent group AND wire the CLI channel to it.
  // T2: creating only the agent group left the first `pnpm chat` message silently
  // dropped ("no agent wired"), so the documented quick start did not actually work.
  const wantGroup = await p.confirm({ message: "Create/bind a default Agent group now?", initialValue: true });
  if (!p.isCancel(wantGroup) && wantGroup) {
    const name = await p.text({ message: "Group name", initialValue: "demo", defaultValue: "demo" });
    if (p.isCancel(name)) return p.cancel("Cancelled");
    const folder = await p.text({ message: "Workspace folder", initialValue: "demo", defaultValue: "demo" });
    if (p.isCancel(folder)) return p.cancel("Cancelled");
    // A fresh clone has no data/ dir; better-sqlite3 cannot create the DB without it.
    mkdirSync(DATA_DIR, { recursive: true });
    initDb(CENTRAL_DB_PATH);
    runMigrations(getDb(), [migration001, migration002]);
    let group = getAgentGroupByFolder(String(folder));
    if (!group)
      group = createAgentGroup({ name: String(name), folder: String(folder), agentProvider: provider as string });
    ensureContainerConfig(group.id, provider as string);
    if (model) updateContainerConfig(group.id, { provider: provider as string, model } as never);

    // Wire the local CLI channel so `pnpm chat` works immediately after setup.
    const wired = ensureCliWiring(group.id);
    if (model) updateContainerConfig(group.id, { model } as never);
    closeDb();
    p.log.success(
      `Agent group ready: ${group.name} (${group.folder}) provider=${provider}${model ? ` model=${model}` : ""}`,
    );
    p.log.success(
      wired.createdWiring
        ? `CLI channel wired (messaging group ${wired.messagingGroupId.slice(0, 8)}, policy from CLI_DEFAULTS)`
        : `CLI channel already wired (messaging group ${wired.messagingGroupId.slice(0, 8)})`,
    );
    if (wired.repaired.length > 0) p.log.warn(`Repaired existing CLI wiring: ${wired.repaired.join(", ")}`);
  }

  // Owner onboarding: next steps
  const nextSteps = [
    "Next steps:",
    "  pnpm build:container    # Build container image",
    "  pnpm start              # Start host",
    "  pnpm chat               # Chat (/help for commands)",
  ];

  p.outro(nextSteps.join("\n"));
}

main().catch((err) => {
  p.cancel(String(err));
  process.exit(1);
});

/*
 * Modification record:
 *   2026-09-01  Created (phase 15: chat slash commands + onboarding)
 *   2026-10-04  P0-2: branded intro with brandChip; P0-5: unified as primary setup entry
 *   2026-10-06  T2: onboarding now wires the CLI channel via ensureCliWiring and runs
 *               migration001+002, so `pnpm setup` -> `pnpm dev` -> `pnpm chat` works on a
 *               fresh clone. Previously it created only an agent group and the first
 *               message was silently dropped as "no agent wired".
 */