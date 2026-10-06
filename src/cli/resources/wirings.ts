/**
 * cli/resources/wirings.ts —— wirings 资源（crud + create）
 *
 * 职责：wirings list/get（CRUD 生成）+ create（写入侧校验 engage：通道 mentions 策略 +
 *       pattern 必填 + 正则可编译——P0-3，validateEngageAgainstChannel 唯一生产调用点）。
 * 关键导出：registerWiringsResource（副作用注册）
 * 借鉴：nanoclaw src/cli/resources/wirings.ts（R-6 从 resources.ts 拆出，行为不变）
 */
import { registerCommand } from "../registry.js";
import { registerCrudResource } from "../crud.js";
import { createWiring, getMessagingGroup } from "../../db/messaging-groups.js";
import { validateEngageAgainstChannel } from "../../channels/channel-defaults.js";
import { LocalizedError } from "../../i18n/index.js";

export function registerWiringsResource(): void {
  registerCrudResource("wirings", {
    table: "messaging_group_agents",
    columns: ["id", "messaging_group_id", "agent_group_id", "engage_mode", "sender_scope", "session_mode", "priority"],
    scopeField: "agent_group_id",
    agentVisible: true,
  });

  registerCommand({
    resource: "wirings",
    verb: "create",
    scope: "host",
    description: "Link a messaging group to an agent group.",
    flags: [
      { name: "messaging-group", description: "Messaging group id.", required: true },
      { name: "agent-group", description: "Agent group id.", required: true },
      {
        name: "engage",
        description: "When the agent should respond.",
        default: "mention",
        enum: ["mention", "pattern", "mention-sticky"],
      },
      { name: "pattern", description: "Regex used when engage=pattern." },
    ],
    handler: (args) => {
      if (!args.flags["messaging-group"] || !args.flags["agent-group"]) {
        throw new LocalizedError("cli.wiring_flags_required", {}, "invalid-args");
      }
      const mg = getMessagingGroup(args.flags["messaging-group"]);
      if (!mg) {
        throw new LocalizedError("cli.not_found", { id: args.flags["messaging-group"] }, "not-found");
      }
      const engageMode = (args.flags.engage as "mention" | "pattern" | "mention-sticky") ?? "mention";
      const engagePattern = args.flags.pattern ?? null;
      // P0-3：写入侧校验 engage（通道 mentions 策略 + pattern 必填 + 正则可编译）。
      // 此前 validateEngageAgainstChannel 只有测试在调、生产零调用，非法正则一路落库，
      // 到 router 才炸——现已改为 fail-closed，但脏数据仍会让接线静默不触发，故在入口拒绝。
      try {
        validateEngageAgainstChannel({
          channelKey: mg.instance || mg.channel_type,
          channelType: mg.channel_type,
          engageMode,
          engagePattern,
        });
      } catch (err) {
        throw new LocalizedError(
          "cli.invalid_engage",
          { reason: err instanceof Error ? err.message : String(err) },
          "invalid-args",
        );
      }
      return createWiring({
        messagingGroupId: args.flags["messaging-group"],
        agentGroupId: args.flags["agent-group"],
        engageMode,
        engagePattern: engagePattern ?? undefined,
      });
    },
  });
}

/*
 * 修改记录：
 *   2026-10-06 R-6：从 src/cli/resources.ts 拆出（行为不变）
 */
