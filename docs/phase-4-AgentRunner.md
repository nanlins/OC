# 阶段 4 记录：Agent Runner（容器侧）

> 用途：记录阶段 4（poll-loop/formatter/providers/MCP 工具/记忆/容器侧 DB）的决策、问题、对标与扩展。

## 一、重要决策
1. **Bun 运行时 + bun:sqlite**（容器），命名参数 `$name`；导入后缀全树 `.ts` + `allowImportingTsExtensions`（bun 不解析 .js→.ts）。
2. **Provider 形态降级（显式记录）**：基线用 Claude Agent SDK（resume/JSONL transcript/compact_boundary/rate-limit rejected/12MB-14d 轮换/isSessionInvalid）；本项目改裸 messages API 自写工具循环——理由：手搓可控、可双协议（OpenAI 兼容覆盖国产模型）、测试可注入假 client；代价与缺失项记录于第三节。
3. **continuation 真实语义 = session_state 历史持久化**（条目 20/字节 64K 双上限截断最旧 = 轮换的显式降级形态）；/clear 同时清 continuation+history。
4. **MCP 双形态**：stdio MCP server（容器生态兼容）+ in-process 工具执行（provider 工具循环直调 handler）。
5. **系统提示注入**：目的地附录 + 记忆恒载经 QueryInput.system 注入两家协议。

## 二、所遇问题与修复方案
1. **PowerShell Set-Content 转码损坏**：UTF-8 无 BOM 文件经 ANSI 往返后中文注释乱码、个别换行被吞（poll-loop 语法破坏）→ 全树重写 + 约定禁用 Set-Content 改代码文件。
2. **bun:sqlite run() 返回对象**（非 number）→ typeof 判断取 changes。
3. **Windows EBUSY**：SQLite 句柄释放瞬态 → afterEach 重试删除。
4. **微任务空转饿死定时器**：MockProvider 纯同步使 while 循环永不让渡，abort/hot 定时器不触发 → 循环尾 `await sleep(0)` 宏任务让渡。
5. **容器侧重复处理**：messages_in.status 由宿主 sweep 同步，60s 窗口内同消息被重取 → getPendingMessages 容器侧排除已 ack。
6. **ai-inspector P0 `..` 穿越**：字符串前缀沙箱被 `/workspace/../x` 绕过 → `path.resolve` 归一后比较 + 穿越回归测试（read/write/list/send_file 四工具）。
7. **ai-inspector P1**：system 未注入→注入；历史只写不读→持久化；ask 应答双消费→消费后 markCompleted + 轮询排除 kind='system'；/clear 不重置→重置；热路径 push 原始 content→formatMessages；未知 provider 静默 mock→抛错；工具结果无截断→24KB；bash timeout 无上限→clamp 10min；edit/reaction 无 operation 语义→messages_out 增 operation 列（双端 schema）。
8. **ai-inspector P1-10**：provider 零回归 → 假 client 测试（tool 循环/错误回传/历史携带）。

## 三、对标 claw 开源源码完成度
- 已复刻：poll-loop 承重语义（双频轮询/trigger 门控冷热/on_wake 首轮/corruption exit(75)/stale ack 清理/心跳）；formatter XML 无包裹协议 + internal 剥离；destinations 实时查库；memory 脚手架（wx 只补缺失 + 16K 预算）；mcp-tools 12 工具（send_message/send_file/edit/reaction/ask/card/schedule/list/cancel/web_fetch/web_search/read/write/list/bash）；session-state 分键 continuation。
- 简化/缺失（降级记录）：Agent SDK resume/compact_boundary/rate-limit rejected/轮换守卫/isSessionInvalid；查询中斜杠命令 abort 活动流；pre-task script gate（阶段 6 scheduling 闭环）；容器内 ncl（阶段 7）。
- 测试：24 pass/1 skip（win32 bash）。

## 四、扩展度
- ollama 独立 continuation 键（基线复用 openai 键的缺陷修复）。
- web_fetch 10s AbortSignal + untrusted 标注（Prompt Injection 面收敛）。
- 工具结果 24KB 截断 + bash clamp（上下文预算护栏，知识文档 01/04 落地）。
- operation 列使交互操作语义可判别（docs/07 要求落地）。

## 修改记录
- 2026-08-12 创建。
