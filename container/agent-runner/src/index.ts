/**
 * index.ts —— Agent Runner 容器入口
 *
 * ??：加? container.json → ???手架 → 系?提示附? → 工具注? → provider → ??循?。
 * ???出：main
 * 借?：nanoclaw container/agent-runner/src/index.ts
 *
 * 修改??：
 *   2026-08-12 ?建（?段 4）；重?修复???坏
 */
import { loadConfig } from "./config.ts";
import { buildSystemPromptAddendum } from "./destinations.ts";
import { ensureMemoryScaffold, renderMemorySection } from "./memory/scaffold.ts";
import { loadSkills, renderSkillsSection } from "./skills/loader.ts";
import { loadClaudeMd, renderClaudeMdSection } from "./claude-md.ts";
import { bootstrapTools } from "./mcp-tools/index.ts";
import type { ToolContext } from "./mcp-tools/registry.ts";
import type { RoutingContext } from "./formatter.ts";
import { createProvider } from "./providers/index.ts";
import { runPollLoop } from "./poll-loop.ts";
import { log } from "./log-lite.ts";
import { resolveTimezone } from "./timezone-lite.ts";
import { getWorkspace } from "./db/connection.ts";

export async function main(): Promise<void> {
  const config = loadConfig();
  ensureMemoryScaffold();
  bootstrapTools();

  const tz = resolveTimezone(config.timezone);
  // fix-plan P0：工具路由上下文注入真? channel/platform/thread（按批次由 provider ?入），缺省 null
  const ctxFactory = (routing?: RoutingContext): ToolContext => ({
    routing: routing ?? { platformId: null, channelType: null, threadId: null },
    assistantName: config.assistantName,
  });
  const provider = createProvider(config.provider, config, ctxFactory);

  const addendum = buildSystemPromptAddendum(config.assistantName);
  const memory = renderMemorySection();
  // ?段 13：技能指令注入系?提示（/app/skills 或 OC_SKILLS_DIR 注入）
  const skills = renderSkillsSection(loadSkills(process.env.OC_SKILLS_DIR ?? "/app/skills"));
  // fix-plan P0：加?群? CLAUDE.md 注入系?提示（修复上下文??）
  const claudeMd = renderClaudeMdSection(loadClaudeMd(getWorkspace()));
  log(
    `agent-runner started: provider=${config.provider} claudemd=${claudeMd.length}B addendum=${addendum.length}B memory=${memory.length}B skills=${skills.length}B`,
  );

  await runPollLoop({
    provider,
    timezone: tz,
    assistantName: config.assistantName,
    maxMessages: config.maxMessagesPerPrompt,
    // 群?指令（CLAUDE.md）置于技能/??之前作?人格/行?基?
    systemPrompt: [claudeMd, addendum, skills, memory].filter(Boolean).join("\n"),
  });
}

if (process.env.VITEST !== "true" && import.meta.main) {
  main().catch((err) => {
    log(`agent-runner fatal: ${String(err)}`, "error");
    process.exit(1);
  });
}
