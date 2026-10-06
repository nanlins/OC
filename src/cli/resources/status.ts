/**
 * cli/resources/status.ts —— status 资源（host-only）
 *
 * 职责：status get——宿主健康（pid/uptime/instance id/项目根/渠道）。
 * 关键导出：registerStatusResource（副作用注册）
 * 借鉴：nanoclaw src/cli/commands/status.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCommand } from "../registry.js";
import { PROJECT_ROOT, INSTALL_SLUG } from "../../config.js";
import { getActiveAdapters } from "../../channels/channel-registry.js";

export function registerStatusResource(): void {
  // P1-9: host status command (host-only, hidden from agent)
  registerCommand({
    resource: "status",
    verb: "get",
    scope: "host",
    description: "Host liveness: pid, uptime, instance id, project root, connected channels.",
    handler: () => {
      const channels: string[] = [];
      for (const a of getActiveAdapters()) {
        channels.push(`${a.channelType}`);
      }
      return {
        pid: process.pid,
        uptime: `${Math.floor(process.uptime())}s`,
        instance_id: INSTALL_SLUG,
        project_root: PROJECT_ROOT,
        channels,
      };
    },
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
