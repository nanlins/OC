/**
 * container-restart.ts —— 按 Agent 群组批量 kill + on_wake 唤醒重生
 *
 * 职责：写 on_wake=1 消息（仅新容器首轮 poll 可见）→ killContainer → onExit 回调里 wakeContainer。
 * 关键导出：restartAgentGroupContainers
 * 承重不变量：垂死容器抢不走唤醒消息（on_wake 列 + onExit 接力）。
 * 借鉴：nanoclaw src/container-restart.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 3）
 */
import { randomUUID } from "node:crypto";
import { listSessions } from "./db/sessions.js";
import { writeSessionMessage } from "./session-manager.js";
import { killContainer, wakeContainer, isContainerRunning } from "./container-runner.js";
import { log } from "./log.js";
import type { Session } from "./types.js";

export function restartAgentGroupContainers(agentGroupId: string, reason: string, wakeMessage?: string): number {
  const sessions = listSessions().filter((s) => s.agent_group_id === agentGroupId && s.status === "active");
  let restarted = 0;
  for (const session of sessions) {
    if (wakeMessage) {
      writeSessionMessage(session, {
        id: randomUUID(),
        kind: "system",
        content: wakeMessage,
        onWake: 1, // 仅新容器首轮 poll 可见
        trigger: 1,
      });
    }
    if (isContainerRunning(session.id)) {
      killContainer(session, {
        onExit: () => {
          void wakeContainer(session);
        },
      });
      restarted += 1;
    } else if (wakeMessage) {
      void wakeContainer(session); // 无运行中容器：直接唤醒消费 on_wake
      restarted += 1;
    }
  }
  log.info(`agent group restart requested: ${agentGroupId} (${reason}), sessions=${restarted}`);
  return restarted;
}

export type { Session };
