# channels

> 用途：通道适配器层：ChannelAdapter 接口、注册表、defaults 五级解析、平台适配器

## 内容清单
- `adapter.ts`：ChannelAdapter/ChannelSetup/InboundEvent/ChannelDefaults/ChannelRegistration 接口全家
- `channel-registry.ts`：自注册 + 活实例 Map + 查找非对称（出站 exact-only，MissingChannelAdapterError）
- `channel-defaults.ts`：wiring 创建期默认值解析/线程策略硬 AND/engage 校验/行为忠实回退
- `index.ts`：自注册 barrel（trunk 只带 CLI，阶段 5 接入）
- `cli/`：CLI 通道（阶段 5）

## 修改记录
- 2026-08-12 创建（阶段 0 骨架）
- 2026-08-12 阶段 2 落地接口/注册表/defaults
