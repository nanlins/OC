/**
 * providers/ollama.ts —— Ollama provider 主机侧容器贡献
 *
 * 职责：spawn 时把 OLLAMA_HOST 经 -e 注入容器（容器侧 OllamaProvider 读 process.env）。
 *       ollama 走 OpenAI 兼容协议，通常本地无 key，仅需 base url。
 * 关键导出：无（副作用注册 ollama）
 * 借鉴：nanoclaw src/providers/ 的 env 透传形态
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";
import { registerProviderContainerConfig } from "./provider-container-registry.js";

registerProviderContainerConfig("ollama", () => {
  const dotenv = readEnvFile(["OLLAMA_HOST", "OPENAI_BASE_URL"], ENV_PATH);
  const env: Record<string, string> = {};
  const base =
    dotenv.OPENAI_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    (dotenv.OLLAMA_HOST ? `${dotenv.OLLAMA_HOST}/v1` : process.env.OLLAMA_HOST ? `${process.env.OLLAMA_HOST}/v1` : "");
  if (base) env.OPENAI_BASE_URL = base;
  return { mounts: [], env };
});
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

