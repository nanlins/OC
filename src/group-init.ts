/**
 * group-init.ts ?”â€?Agent ç¾¤ç??‡ä»¶ç³»ç?å¹‚ç??šæ??? *
 * ?Œè´£ï¼šç¾¤ç»„ç›®å½?+ ?ºç? OC.mdï¼ˆç¼ºå¤±æ—¶ï¼? container_configs è¡Œï?æ¯æ­¥ä»??®æ?ä¸å???ä¸ºé—¨?? * ?³é”®å¯¼å‡ºï¼šinitGroupFilesystem
 * ?Ÿé‰´ï¼šnanoclaw src/group-init.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?3ï¼? *   2026-08-13 ?¶æ®µ 14ï¼šCLAUDE.md å¢è¡¥"è·Ÿé??¨æˆ·è¯­è??å?"?‡ä»¤ï¼ˆai-inspector P2-6ï¼? */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureContainerConfig } from "./db/container-configs.js";
import { resolveGroupFolderPath } from "./group-folder.js";
import { log } from "./log.js";
import type { AgentGroup } from "./types.js";

const BASE_CLAUDE_MD = `# Agent å·¥ä???
ä½ æ˜¯ OC ?„ä?ä¸?Agent?‚ç?æ´æ??šï?å·¥ä??‡ä»¶??/workspace/agent/ï¼?è®°å?ä¸å¯¹è¯å?æ¡???™è?å®¹å™¨?€?½ã€‚å…³?®æ?ä½œéµå¾ªç³»ç»Ÿæ?ä»¤ä¸­?„å®¡?¹è?æ±‚ã€?å§‹ç?ä½¿ç”¨?¨æˆ·å½“å?æ¶ˆæ¯?€?¨ç?è¯­è??å?ï¼ˆç”¨?·ç”¨ä¸­æ??™ä¸­?‡ã€è‹±?‡å??±æ??æ—¥?‡å??¥æ?ï¼‰ã€?`;

/** å¹‚ç??šæ??¶ï??®å?/OC.md/container_configs è¡Œï?å·²å??¨å?è·³è? */
export function initGroupFilesystem(group: AgentGroup, opts?: { provider?: string | null }): void {
  const dir = resolveGroupFolderPath(group.folder);
  mkdirSync(join(dir, "tasks"), { recursive: true });
  mkdirSync(join(dir, "memory"), { recursive: true });
  const claudePath = join(dir, "OC.md");
  if (!existsSync(claudePath)) {
    writeFileSync(claudePath, BASE_CLAUDE_MD, { flag: "wx" });
    log.info(`group OC.md created: ${group.folder}`);
  }
  ensureContainerConfig(group.id, opts?.provider ?? group.agent_provider);
}
