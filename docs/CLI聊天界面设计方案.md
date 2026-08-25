# OC CLI 聊天界面 — 详细设计方案

> 用途：为 OC 设计一个类 opencode/OpenClaw 的终端聊天 TUI。本文档包含 GitHub 对标调研、交互模型、视觉规范、帧协议设计、技术选型与实现计划。

## 一、对标调研（GitHub 成熟项目）

| 项目 | 语言/框架 | 许可 | 最近更新 | 终端交互设计要点 | 可借鉴 | 不适合借鉴 |
|------|----------|------|----------|----------------|--------|-----------|
| sst/opencode | Go + Bubble Tea | MIT | 持续活跃（2025-2026） | 上下分屏：上方对话流（Markdown 流式渲染、工具调用折叠块带 spinner）、下方输入框；角色用颜色区分；状态栏显示模型名/会话/token；`/` 命令面板；Ctrl+C 取消 | 布局模型、工具调用折叠块、状态栏、斜杠命令 | Go 生态 Bubble Tea，无法直接移植到 Node |
| nanoclaw（原 OpenClaw）| TypeScript + Chat SDK | 个人项目 | v2.1.54 | CLI 通道 + Chat SDK 桥；CLI socket 行协议；交互式问题选项卡渲染 | 行协议思想（我们的 CLI 通道即源于此）、选项卡选项渲染 | Chat SDK 自带 UI，交互深度依赖 SDK |
| sigoden/aichat | Rust | Apache-2.0 | 活跃 | 轻量 REPL；斜杠命令（/model /role /session）；历史（上箭头）；Markdown 渲染；多 Provider | REPL 命令集、历史交互、多 provider 切换 | Rust 实现 |
| bgentry/eric | Node + Ink | 个人项目 | 停更 | Ink（React CLI）流式 Markdown 渲染、输入历史、按键绑定 | Ink 组件化思路、流式 token 渲染 | 依赖 React/Ink，供应链重 |
| ollama run | Go | MIT | 活跃 | 极简 REPL 流式输出、Ctrl+D 退出、`/?` 帮助 | 极简交互、键盘约定 | 无多会话/工具调用展示 |
| charmbracelet/glamour | Go | MIT | 活跃 | 终端 Markdown 渲染库（ANSI 样式） | 配色/排版规则可参考 | Go |

**结论**：
1. **布局**借鉴 opencode：上下分屏（消息流 + 输入行 + 状态栏），工具调用折叠块；
2. **命令**借鉴 aichat：`/help` `/clear` `/exit`，历史用上下箭头；
3. **渲染**借鉴 glamour 规则：纯 ANSI 手写 Markdown 子集（粗体/代码/列表/引用），不引第三方库；
4. **协议**沿用 nanoclaw 行协议思想并扩展帧类型（我们已有 CLI socket 行协议）；
5. **不借鉴**：Bubble Tea/Ink 等框架——零依赖 + 教学价值优先（本项目定位"小到能看懂"）。

## 二、设计目标与原则

| 目标 | 说明 |
|------|------|
| 零新依赖 | 只用手头已有依赖（readline 内置 + kleur 已装），遵守 pnpm 供应链策略 |
| 小到能看懂 | TUI 引擎控制在单文件，ANSI 转义手工管理 |
| 协议兼容 | 老客户端（发 `{"text":...}` 收 JSON 行）不受破坏，新帧为增量字段 |
| 可测试 | TUI 渲染逻辑抽成纯函数（帧 → 文本），不测终端原始模式 |

## 三、交互模型

### 3.1 布局

```
┌──────────────────────────────────────────┐
│ OC chat · Demo · deepseek-chat   [会话] │ ← 状态栏（1 行，反色）
├──────────────────────────────────────────┤
│  you  你好                           10:30│ ← 消息流（滚动区）
│  agent 你好！我是 Demo Agent……           │
│  ▸ tool: web_search  ✓ 2.1s             │ ← 工具调用折叠块
│        (展开时显示参数/结果摘要)          │
│                                          │
│  you  帮我写个脚本                        │
│  agent █ (流式打字机)                    │
├──────────────────────────────────────────┤
│ > 帮我查下天气                        █  │ ← 输入行
└──────────────────────────────────────────┘
```

### 3.2 角色配色（暗色终端）

| 角色 | 前缀 | 颜色 |
|------|------|------|
| 用户 | `you` | 蓝色（kleur.blue） |
| Agent | `agent` | 绿色（kleur.green） |
| 工具 | `▸ tool` | 黄色（kleur.yellow），完成 ✓ / 失败 ✗ |
| 系统 | `·` | 灰色（kleur.gray） |
| 错误 | `!` | 红色（kleur.red） |

### 3.3 输入交互

| 按键/命令 | 行为 |
|-----------|------|
| Enter | 发送当前行 |
| ↑ / ↓ | 历史导航（会话内 100 条） |
| `/help` | 显示命令帮助 |
| `/clear` | 清空会话上下文（转发给 Agent 的 /clear 命令） |
| `/exit` 或 `/quit` | 退出 |
| Ctrl+C | 中断流式输出（不退出） |
| Ctrl+D | 空输入时退出 |
| 粘贴多行 | 连续 Enter 直到空行发送（简化：单行输入） |

### 3.4 状态栏

`OC chat · <agent 名> · <模型> · <provider>`（从主机 metadata 帧获取；未知时显示 `connecting…`）

## 四、帧协议设计（扩展，向后兼容）

CLI 通道 deliver 目前写 `{text, kind, operation}`。扩展为：

```ts
// 主机 → 客户端帧
{ kind: "chat", text: "内容" }                    // 助手消息（可多次，客户端打字机渲染）
{ kind: "meta", agent: "Demo", model: "deepseek-chat", provider: "openai" }  // 会话元数据
{ kind: "tool", tool: "web_search", status: "running" | "done" | "error", elapsedMs?: number }
{ kind: "end" }                                   // 一轮结束（提示符回来）
{ kind: "error", text: "错误信息" }
```

客户端 → 主机帧保持 `{text}` 与纯文本两种形态不变（兼容老客户端）。

工具状态来源：主机 delivery 轮询时读 `container_state.current_tool`（容器写），检测变化后向 CLI 客户端广播 tool 帧。**不破坏单写者原则**——只读，不写。

## 五、技术选型

| 方案 | 优点 | 缺点 | 决定 |
|------|------|------|------|
| Ink（React CLI） | 组件化、社区成熟 | 引入 react/reconciler 依赖链，供应链重 | ❌ |
| Blessed/neo-blessed | 老牌 Node TUI | 维护停滞、API 老旧 | ❌ |
| 纯 ANSI + readline | 零依赖、可控、教学价值高 | 需手工管理光标/滚动 | ✅ |

关键 ANSI 技术点：
- 原始模式：`readline.emitKeypressEvents(process.stdin)` + `setRawMode(true)`
- 滚动区：非滚动消息区（顶部打印）用"光标上移 + 重绘"实现滚动缓冲；首版用简单"逐行打印"（终端自带滚动），聚焦功能而非炫技
- 光标隐藏：`\x1b[?25l`，退出时 `\x1b[?25h` 恢复
- 打字机渲染：消息整条到达后按字符输出（`setTimeout` 0-8ms），Ctrl+C 中断加速输出剩余

## 六、实现计划

| 文件 | 改动 |
|------|------|
| `scripts/chat.ts` | 重写为 TUI：状态栏 + 消息流渲染 + 输入行 + 历史 + 斜杠命令 |
| `src/channels/cli.ts` | deliver 帧扩展：meta/tool/end 帧；广播前序列化 |
| `src/delivery.ts` | 工具状态检测：轮询 container_state.current_tool 变化 → 广播 tool 帧（仅 CLI 通道） |
| `src/channels/cli-render.ts`（新） | 纯函数渲染层：Frame → ANSI 文本（可单测，不依赖终端） |
| `tests/integration/cli-channel.test.ts` | 补 meta/tool/end 帧协议测试 |
| `tests/unit/cli-render.test.ts`（新） | 渲染纯函数测试（角色配色/工具块/错误帧） |
| `package.json` | `chat` 脚本指向新 TUI |

## 七、取舍与后续

| 取舍 | 理由 | 后续 |
|------|------|------|
| 打字机渲染而非真流式 | 真流式需容器每 token 跨挂载写 outbound（DELETE journal 高频写不划算） | 若接入 Chat SDK 桥可获真流式 |
| 单行输入 | 多行输入需复杂光标管理 | v2 支持多行 |
| 消息区不截断重绘 | 终端自带滚动足够，复杂度低 | v2 做独立滚动区 |

---

## 修改记录
- 2026-08-25 创建（阶段 12：CLI 聊天界面设计）
