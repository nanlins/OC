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
import { LLM_PROXY_PORT } from "../llm-proxy.js";
import { registerProviderContainerConfig } from "./provider-container-registry.js";

registerProviderContainerConfig("openai", () => {
  // 阶段 12（密钥网关简化版）：容器不再注入真实密钥——注入宿主代理地址，
  // 容器 LLM 请求经 /llm-proxy 由主机注入密钥转发（密钥永不进容器，对齐 nanoclaw OneCLI 语义）。
  const env: Record<string, string> = {};
  env.OC_LLM_PROXY_URL = `http://host.docker.internal:${LLM_PROXY_PORT}/llm-proxy`;
  return { mounts: [], env };
});

/*
 * 修改记录：
 *   2026-08-24 补齐未完成清单：移除 ollama 注册（已拆分到 ollama.ts）
 */
