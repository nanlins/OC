# 阶段 13 记录：容器技能库

> 用途：记录阶段 13（技能加载器、20 个容器技能、宿主安装技能、nc: 指令引擎）的决策、问题、对标与扩展。

## 一、重要决策
1. **技能加载器（container/agent-runner/src/skills/loader.ts）**：解析 SKILL.md frontmatter（name/description），按 name 排序；`renderSkillsSection` 以 `SKILLS_BUDGET_CHARS=12000` 预算截断，超预算技能整体丢弃并插入 `truncated by budget` 标记，保证系统提示词体积可控。
2. **20 个容器技能**：6 个手写（welcome / memory-management / rag-search / code-review / scheduler-helper / web-research）+ 14 个委派子代理批量产出（translator / summarizer / test-writer / git-helper / docker-helper / data-analyst / report-writer / email-drafter / todo-manager / knowledge-curator / browser-automation / frontend-engineer / self-customize / escalation）。每个技能均含 name、description（>10 字）、body（>100 字）。
3. **接线**：`poll-loop.ts` 将渲染后的技能段并入 `system: cfg.systemPrompt`；`index.ts` 从 `/app/skills`（或 `OPENCLAW_SKILLS_DIR` 覆盖）加载，与 memory scaffold、destinations 一并注入系统提示词。
4. **宿主安装技能（skills/）**：add-eval-corpus（copy 语料 + append 配置）、add-webhook-channel（prompt 收集密钥 + env-set 幂等写入 `.env`）。复用阶段 8 的 `nc:` 指令引擎（parseDirectives/validateDirectives/applySkill），`env-set` 采用 set-if-absent 语义保证重复应用幂等。
5. **测试（tests/unit/skills-engine.test.ts）**：loader 解析/排序、预算截断、20 技能 frontmatter lint、安装技能 validate + applySkill 幂等，共 5 用例。

## 二、所遇问题与修复方案
1. **add-eval-corpus `{{domain}}` 占位符未定义** → 在 SKILL.md 中补 `nc:prompt` 指令定义 domain 输入，validate 通过。
2. **skills-engine.test.ts lint 报 3 处未用导入/变量**（existsSync / parseFrontmatter / second）→ 移除未用导入，将 `second` 用于断言重复 apply 仍 `ok`（强化幂等语义）。

## 三、对标 claw 开源源码完成度
- nanoclaw 具备 skills 目录与按技能注入系统提示词的机制；本阶段复刻其「技能即 Markdown + frontmatter」形态，并新增预算截断与宿主侧 `nc:` 安装指令（基线无此安装引擎，属扩展）。
- 20 个容器技能覆盖基线常见助手能力域（记忆/RAG/代码/调度/浏览器/多语/上报等），完成度：已复刻并扩量。

## 四、扩展度
- 技能加载器预算截断 + 排序稳定性（基线无显式预算控制）。
- 宿主安装技能 + `nc:` 指令幂等应用（copy/append/env-set/prompt），落地知识文档 02（Prompt 工程）与 04（Agent 工具/技能）的技能化封装。
- 累计：host 263 用例 / container 24 用例通过；tsc + eslint 全绿；总行数约 23,810。

## 修改记录
- 2026-08-13 创建。
