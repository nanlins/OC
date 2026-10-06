/**
 * index.ts —— Agent Runner 容器入口
 *
 * 职责：加载 container.json → 记忆脚手架 → 系统提示附录 → 工具注册 → provider → 轮询循环。
 * 关键导出：main
 * 借鉴：nanoclaw container/agent-runner/src/index.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-28 阶段 12 路径 B：系统提示改为工厂每轮求值，注入 renderTodosSection（todo 跨消息可见）
 */
import { loadConfig } from "./config.ts";
import { buildSystemPromptAddendum } from "./destinations.ts";
import { ensureMemoryScaffold } from "./memory/scaffold.ts";
import "./memory/session-hook.ts"; // P1-1：副作用注册记忆会话钩子（经 hook.ts 机制）
import { runSessionHooks } from "./memory/hook.ts";
import { loadSkills, renderSkillsSection } from "./skills/loader.ts";
import { loadClaudeMd, renderClaudeMdSection } from "./claude-md.ts";
import { bootstrapTools } from "./mcp-tools/index.ts";
import { renderTodosSection } from "./mcp-tools/todo.ts";
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
  // 阶段 13：技能指令注入系统提示（/app/skills 或 OC_SKILLS_DIR 注入）
  const skills = renderSkillsSection(loadSkills(process.env.OC_SKILLS_DIR ?? "/app/skills"));
  // fix-plan P0：加载群组 CLAUDE.md 注入系统提示（修复上下文断点）
  const claudeMd = renderClaudeMdSection(loadClaudeMd(getWorkspace()));
  log(
    `agent-runner started: provider=${config.provider} claudemd=${claudeMd.length}B addendum=${addendum.length}B skills=${skills.length}B`,
  );

  await runPollLoop({
    provider,
    timezone: tz,
    assistantName: config.assistantName,
    maxMessages: config.maxMessagesPerPrompt,
    // 群组指令（CLAUDE.md）置于技能/记忆之前作为人格/行为基线；
    // 阶段 12：系统提示用工厂每轮求值，使 todo_write 更新的子任务清单跨消息可见；
    // P1-1：经 runSessionHooks 运行已注册的会话钩子（记忆钩子在此注入 OKF v0.1 记忆块）
    systemPrompt: () =>
      runSessionHooks({
        workspaceDir: getWorkspace(),
        systemPrompt: [claudeMd, addendum, skills, renderTodosSection()].filter(Boolean).join("\n"),
      }),
  });
}

if (process.env.VITEST !== "true" && import.meta.main) {
  main().catch((err) => {
    log(`agent-runner fatal: ${String(err)}`, "error");
    process.exit(1);
  });
}
/*
 * 修改记录：
 *   2026-08-28 阶段 12 路径 B：系统提示改为工厂每轮求值，注入 renderTodosSection（todo 跨消息可见）
 *   2026-10-06 T1-4：OPENCLAW_SKILLS_DIR → OC_SKILLS_DIR（统一 OC_* 环境变量家族）
 *   2026-10-06 P1-1：记忆注入改经 runSessionHooks（session-hook 副作用注册真正接入）
 */
