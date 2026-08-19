# providers

> 用途：Provider 主机侧：容器配置贡献注册表（挂载/env 透传 + 能力声明）

## 内容清单
- `provider-container-registry.ts`：registerProviderContainerConfig/resolveProviderContribution/providerProvidesAgentSurfaces
- 容器侧 provider 实现（claude/openai/ollama/mock）在 `container/agent-runner/src/providers/`（阶段 4）

## 修改记录
- 2026-08-12 创建（阶段 0 骨架）
- 2026-08-12 阶段 3 落地主机侧注册表
