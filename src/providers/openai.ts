/**
 * providers/openai.ts —— OpenAI 兼容 provider 主机侧容器贡献（openai / ollama）
 *
 * 职责：spawn 时把 OPENAI_API_KEY / OPENAI_BASE_URL 经 -e 注入容器（容器侧
 *       OpenAICompatProvider 读 process.env）。密钥经 readEnvFile 白名单读取，
 *       .env 优先、process.env 兜底；不写入宿主 process.env。
 * 关键导出：无（副作用注册 openai + ollama）
 * 承重不变量：密钥只经显式 -e 注入，不靠环境继承；缺 key 时不透传（容器侧报 missing）。
 * 借鉴：nanoclaw src/providers/claude.ts 的 env 透传形态（简化：无 OneCLI 网关）
 *
 * 修改记录：2026-08-13 创建（收束期补 key 接线，支撑端到端实测）
 */
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";
import { registerProviderContainerConfig } from "./provider-container-registry.js";

registerProviderContainerConfig("openai", () => {
  const dotenv = readEnvFile(["OPENAI_API_KEY", "OPENAI_BASE_URL"], ENV_PATH);
  const env: Record<string, string> = {};
  const key = dotenv.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
  const base = dotenv.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || "";
  if (key) env.OPENAI_API_KEY = key;
  if (base) env.OPENAI_BASE_URL = base;
  return { mounts: [], env };
});

/*
 * 修改记录：
 *   2026-08-24 补齐未完成清单：移除 ollama 注册（已拆分到 ollama.ts）
 */


