/**
 * provider-contracts/verifier.ts —— 合约一致性校验
 *
 * 职责：verifyRealization 检查五个能力面全部存在且关键字段合法；
 *       任何缺面/缺字段都是 fail（fail-closed：护栏失效必须可见）。
 * 借鉴：nanoclaw container/agent-runner/src/provider-contracts/verifier.ts
 *
 * 修改记录：2026-10-06 创建（P0-2）
 */
import type { ProviderRealization } from "./registry.ts";
import { CAPABILITY_FACETS } from "./names.ts";

export interface VerificationResult {
  ok: boolean;
  failures: string[];
}

export function verifyRealization(r: ProviderRealization): VerificationResult {
  const failures: string[] = [];
  const c = r.capabilities;

  if (!c.configuration) failures.push("missing facet: configuration");
  else {
    if (!c.configuration.executionPolicy || typeof c.configuration.executionPolicy.maxToolRounds !== "number")
      failures.push("configuration.executionPolicy.maxToolRounds must be a number");
    if (!c.configuration.inference || typeof c.configuration.inference.model !== "string")
      failures.push("configuration.inference.model must be a string");
    if (!Array.isArray(c.configuration.memory?.sessionStatePrefixes))
      failures.push("configuration.memory.sessionStatePrefixes must be an array");
    if (!Array.isArray(c.configuration.mcpServers?.toolNames))
      failures.push("configuration.mcpServers.toolNames must be an array");
  }
  if (!c.lifecycle) failures.push("missing facet: lifecycle");
  if (!c.history) failures.push("missing facet: history");
  if (!c.textDelivery || typeof c.textDelivery.result !== "boolean")
    failures.push("textDelivery.result must be a boolean");
  if (!c.commands || !Array.isArray(c.commands.admin) || !Array.isArray(c.commands.filtered))
    failures.push("commands.admin/filtered must be arrays");

  // 五面齐全（结构性检查，与具体字段检查互补）
  for (const f of CAPABILITY_FACETS) {
    if (!(f in (c as unknown as Record<string, unknown>))) failures.push(`missing facet: ${f}`);
  }

  return { ok: failures.length === 0, failures };
}
