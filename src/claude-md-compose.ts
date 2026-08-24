/**
 * claude-md-compose.ts —— CLAUDE.md 组合（base + 技能片段 + MCP 片段）
 *
 * 职责：每次 spawn 时重新生成 groups/<folder>/CLAUDE.md，从容器内共享 base
 *       （/app/CLAUDE.md）导入，叠加已启用技能的 instructions.md 片段和 MCP
 *       服务器指令片段。确定性——相同输入产生相同输出，过期片段自动清理。
 * 关键导出：composeGroupClaudeMd
 * 承重不变量：组合顺序：persona → shared base → 技能片段（排序）→ MCP 片段（排序）
 * 借鉴：nanoclaw src/claude-md-compose.ts
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GROUPS_DIR } from "./config.js";
import { getContainerConfig } from "./db/container-configs.js";
import type { AgentGroup } from "./types.js";

const COMPOSED_HEADER = "<!-- 由主机 spawn 时自动生成，勿手动编辑。记忆：memory/。 -->";

export function composeGroupClaudeMd(group: AgentGroup): void {
  const groupDir = join(GROUPS_DIR, group.folder);
  if (!existsSync(groupDir)) mkdirSync(groupDir, { recursive: true });

  const fragmentsDir = join(groupDir, ".claude-fragments");
  if (!existsSync(fragmentsDir)) mkdirSync(fragmentsDir, { recursive: true });

  const configRow = getContainerConfig(group.id);
  const mcpServers: Record<string, { instructions?: string }> = configRow?.mcp_servers
    ? JSON.parse(configRow.mcp_servers)
    : {};

  const desired = new Map<string, { type: "symlink" | "inline"; content: string }>();

  // 技能片段：扫描 container/skills/ 下每个有 instructions.md 的技能
  const skillsHostDir = join(process.cwd(), "container", "skills");
  if (existsSync(skillsHostDir)) {
    for (const skillName of readdirSync(skillsHostDir)) {
      const hostFragment = join(skillsHostDir, skillName, "instructions.md");
      if (existsSync(hostFragment)) {
        desired.set(`skill-${skillName}.md`, {
          type: "symlink",
          content: `/app/skills/${skillName}/instructions.md`,
        });
      }
    }
  }

  // MCP 服务器片段
  for (const [name, mcp] of Object.entries(mcpServers)) {
    if (mcp.instructions) {
      desired.set(`mcp-${name}.md`, { type: "inline", content: mcp.instructions });
    }
  }

  // 清理过期片段
  if (existsSync(fragmentsDir)) {
    for (const existing of readdirSync(fragmentsDir)) {
      if (!desired.has(existing)) {
        try {
          unlinkSync(join(fragmentsDir, existing));
        } catch {
          /* 忽略 */
        }
      }
    }
  }

  // 写入目标片段
  for (const [name, frag] of desired) {
    const fragPath = join(fragmentsDir, name);
    if (frag.type === "symlink") {
      writeSymlink(fragPath, frag.content);
    } else {
      writeFileSync(fragPath, frag.content, "utf-8");
    }
  }

  // 组合入口
  const imports: string[] = [];
  imports.push(`@./.claude-shared.md`);
  for (const name of [...desired.keys()].sort()) {
    imports.push(`@./.claude-fragments/${name}`);
  }
  const body = [COMPOSED_HEADER, ...imports, ""].join("\n");
  const target = join(groupDir, "CLAUDE.md");
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, body, "utf-8");
  try {
    unlinkSync(target);
  } catch {
    /* 不存在 */
  }
  writeFileSync(target, body, "utf-8");
  try {
    unlinkSync(tmp);
  } catch {
    /* 忽略 */
  }
}

function writeSymlink(linkPath: string, target: string): void {
  try {
    const current = readFileSync(linkPath, "utf-8");
    if (current === target) return;
  } catch {
    /* 不存在 */
  }
  try {
    unlinkSync(linkPath);
  } catch {
    /* 忽略 */
  }
  writeFileSync(linkPath, target, "utf-8");
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */
