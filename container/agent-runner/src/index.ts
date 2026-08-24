/**
 * index.ts —— Agent Runner 容器入口
 *
 * 职责：加载 container.json → 记忆脚手架 → 系统提示附录 → 工具注册 → provider → 轮询循环。
 * 关键导出：main
 * 借鉴：nanoclaw container/agent-runner/src/index.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
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
  // fix-plan P0：工具路由上下文注入真实 channel/platform/thread（按批次由 provider 传入），缺省 null
  const ctxFactory = (routing?: RoutingContext): ToolContext => ({
    routing: routing ?? { platformId: null, channelType: null, threadId: null },
    assistantName: config.assistantName,
  });
  const provider = createProvider(config.provider, config, ctxFactory);

  const addendum = buildSystemPromptAddendum(config.assistantName);
  const memory = renderMemorySection();
  // 阶段 13：技能指令注入系统提示（/app/skills 或 OPENCLAW_SKILLS_DIR 注入）
  const skills = renderSkillsSection(loadSkills(process.env.OPENCLAW_SKILLS_DIR ?? "/app/skills"));
  // fix-plan P0：加载群组 CLAUDE.md 注入系统提示（修复上下文断点）
  const claudeMd = renderClaudeMdSection(loadClaudeMd(getWorkspace()));
  log(
    `agent-runner started: provider=${config.provider} claudemd=${claudeMd.length}B addendum=${addendum.length}B memory=${memory.length}B skills=${skills.length}B`,
  );

  await runPollLoop({
    provider,
    timezone: tz,
    assistantName: config.assistantName,
    maxMessages: config.maxMessagesPerPrompt,
    // 群组指令（CLAUDE.md）置于技能/记忆之前作为人格/行为基线
    systemPrompt: [claudeMd, addendum, skills, memory].filter(Boolean).join("\n"),
  });
}

if (process.env.VITEST !== "true" && import.meta.main) {
  main().catch((err) => {
    log(`agent-runner fatal: ${String(err)}`, "error");
    process.exit(1);
  });
}
