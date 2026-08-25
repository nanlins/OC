/**
 * group-init.ts —— Agent 群组文件系统幂等脚手架
 *
 * 职责：群组目录 + 基础 CLAUDE.md（缺失时）+ container_configs 行；每步以"目标不存在"为门。
 * 关键导出：initGroupFilesystem
 * 借鉴：nanoclaw src/group-init.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 *   2026-08-13 阶段 14：CLAUDE.md 增补"跟随用户语言回复"指令（ai-inspector P2-6）
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureContainerConfig } from "./db/container-configs.js";
import { resolveGroupFolderPath } from "./group-folder.js";
import { log } from "./log.js";
import type { AgentGroup } from "./types.js";

const BASE_CLAUDE_MD = `# Agent 工作区

你是 OC 的一个 Agent。简洁沟通；工作文件放 /workspace/agent/；
记忆与对话归档规则见容器技能。关键操作遵循系统指令中的审批要求。
始终使用用户当前消息所用的语言回复（用户用中文则中文、英文则英文、日文则日文）。
`;

/** 幂等脚手架：目录/CLAUDE.md/container_configs 行，已存在则跳过 */
export function initGroupFilesystem(group: AgentGroup, opts?: { provider?: string | null }): void {
  const dir = resolveGroupFolderPath(group.folder);
  mkdirSync(join(dir, "tasks"), { recursive: true });
  mkdirSync(join(dir, "memory"), { recursive: true });
  const claudePath = join(dir, "CLAUDE.md");
  if (!existsSync(claudePath)) {
    writeFileSync(claudePath, BASE_CLAUDE_MD, { flag: "wx" });
    log.info(`group CLAUDE.md created: ${group.folder}`);
  }
  ensureContainerConfig(group.id, opts?.provider ?? group.agent_provider);
}
