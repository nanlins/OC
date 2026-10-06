# providers

> 用途：Provider 主机侧容器贡献注册表（spawn 时的挂载 / env 注入）

## 内容清单
- `provider-container-registry.ts`：registerProviderContainerConfig / resolveProviderContribution
- `claude.ts`：注册 claude 贡献——注入 `ANTHROPIC_BASE_URL` 指向宿主 LLM 代理（密钥不进容器）
- `openai.ts`：注册 openai 贡献——注入 `OC_LLM_PROXY_URL` 指向宿主 LLM 代理（密钥不进容器）
- `ollama.ts`：注册 ollama 贡献——注入 `OPENAI_BASE_URL`（本地无密钥）
- `index.ts`：副作用 barrel，主机启动时导入以完成三个 provider 的自注册
- 容器侧 provider 实现（claude/openai/ollama/mock）在 `container/agent-runner/src/providers/`

## 密钥口径（承重）
三个 provider 的贡献函数**都不得返回真实密钥**。密钥只存在于主机 `.env`，由
`src/llm-proxy.ts` 在网络边界注入上游请求；容器只拿到代理地址。

## 修改记录
- 2026-08-12 创建（阶段 0 骨架）
- 2026-08-12 阶段 3 落地主机侧注册表
- 2026-10-06 P2-1 删除死代码：`factory.ts`、`fallback.ts`、`token-budget.ts`、`types.ts`
  （四个文件全仓零 import，`types.ts` 仅被同为死代码的 `factory.ts` 引用）；
  注册表的 capabilities 机制与 `providerProvidesAgentSurfaces` 一并删除（无声明方也无读取方）
- 2026-10-06 P0-2 `claude.ts` 改为走 LLM 代理，不再向容器注入真实 ANTHROPIC_API_KEY
