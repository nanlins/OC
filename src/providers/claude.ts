/**
 * providers/claude.ts —— Anthropic Claude provider 主机侧容器贡献
 *
 * 职责：spawn 时把 ANTHROPIC_API_KEY（及可选 ANTHROPIC_BASE_URL）经 -e 注入容器
 *       （容器侧 ClaudeProvider 读 process.env.ANTHROPIC_API_KEY）。
 * 关键导出：无（副作用注册 claude）
 * 承重不变量：密钥只经显式 -e 注入；.env 优先、process.env 兜底；不写宿主 process.env。
 * 借鉴：nanoclaw src/providers/claude.ts（简化：直连 api.anthropic.com，无 OneCLI 网关改写）
 *
 * 修改记录：2026-08-13 创建（收束期补 key 接线，支撑端到端实测）
 */
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";
import { registerProviderContainerConfig } from "./provider-container-registry.js";

registerProviderContainerConfig("claude", () => {
  const dotenv = readEnvFile(["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"], ENV_PATH);
  const env: Record<string, string> = {};
  const key = dotenv.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "";
  const base = dotenv.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || "";
  if (key) env.ANTHROPIC_API_KEY = key;
  if (base) env.ANTHROPIC_BASE_URL = base;
  return { mounts: [], env };
});
