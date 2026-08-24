/**
 * backfill-container-configs.ts —— 旧 container.json 回填到 DB
 *
 * 职责：迁移后、通道启动前运行，将旧 groups/<folder>/container.json 的配置
 *       回填到 container_configs 表。幂等——已有配置行的群组跳过。
 * 关键导出：backfillContainerConfigs
 * 借鉴：nanoclaw src/backfill-container-configs.ts（简化：去 OneCLI/MCP 复杂字段）
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GROUPS_DIR } from "./config.js";
import { listAgentGroups } from "./db/agent-groups.js";
import { getContainerConfig, ensureContainerConfig } from "./db/container-configs.js";
import { log } from "./log.js";

interface LegacyContainerJson {
  mcpServers?: Record<string, unknown>;
  provider?: string;
  assistantName?: string;
  model?: string;
  effort?: string;
  cpuLimit?: string;
  memoryLimit?: string;
  pidsLimit?: string;
}

export function backfillContainerConfigs(): void {
  const groups = listAgentGroups();
  let backfilled = 0;

  for (const group of groups) {
    if (getContainerConfig(group.id)) continue;

    const filePath = join(GROUPS_DIR, group.folder, "container.json");
    let legacy: LegacyContainerJson = {};
    if (existsSync(filePath)) {
      try {
        legacy = JSON.parse(readFileSync(filePath, "utf-8")) as LegacyContainerJson;
      } catch (err) {
        log.warn("backfill: failed to parse container.json", { folder: group.folder, err: String(err) });
      }
    }

    const provider = group.agent_provider || legacy.provider || null;

    ensureContainerConfig(group.id, provider);
    backfilled++;
  }

  if (backfilled > 0) {
    log.info("backfilled container_configs from disk", { count: backfilled });
  }
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */
