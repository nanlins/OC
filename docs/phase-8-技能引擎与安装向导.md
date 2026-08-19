# 阶段 8 记录：技能引擎 + 安装向导

> 用途：记录阶段 8（nc: 指令解析/apply 引擎/策略推导 + setup 步骤分发/三级输出契约）的决策、问题、对标与扩展。

## 一、重要决策
1. **两个读者一份文档**：prose 给 agent、`nc:` fence 给引擎；prose-primary 与 degrade-to-agent 两条不变式落地（未知指令/无 resolver/无 exec 全弹回 agentTasks）。
2. **blocked 闩锁**：任一指令弹回后，后续副作用指令（run/copy/env-set/json-merge）转 agentTasks，防"上游失败还去执行副作用"。
3. **journal 倒放 = removeSkill**：不手写 REMOVE.md；journal 存相对路径（fsRoot 可移植）。
4. **展示策略从文档结构推导**：gatePolicy 自然屏障（operator 后副作用指令→确认）；extractOfferUrl 剥标点/拒占位符。
5. **setup 三级输出契约**：L2 状态块 `=== OPENCLAW SETUP: TYPE ===`；步骤即独立可重跑单元（--step 分发，无内存共享）。

## 二、所遇问题与修复方案
1. **属性语法分歧**：nanoclaw 用 `k:v`，创作常用 `k=v` 且值含空格 → lookahead 正则 `k=(.*?)(?=\s+k[=:]|$)` 兼容两形态。
2. **lineNo 指向闭合 fence**（body 循环推进 i）→ startLine 捕获修复（retired/lint 行定位正确）。
3. **journal 绝对路径致 removeSkill 失效**（join(fsRoot, abs) 错拼）→ 存相对路径 + 回归测试。
4. **append 值被空白 token 截断** → 同属性正则修复（"demo line" 完整捕获）。
5. P2 记录：dep 精确钉版仅 warn；run capture 首行语义简单。

## 三、对标 claw 开源源码完成度
- 已复刻：八种指令（copy/append/env-set/json-merge/run/prompt/operator/dep）幂等语义；退役属性大声失败；when 守卫；blocked 闩锁；journal 回滚；gatePolicy/extractOfferUrl；setup 状态块契约 + 步骤分发。
- 简化：run effect 八值表简化为 ok/fail 二值；channels 远程分支安装形态（git fetch + 加法式取文件）延后；claude-assist/handoff 延后。
- 缺失：skill 合规测试套件（skill-conformance 形态）延后阶段 10。

## 四、扩展度
- 属性双语法兼容（k=v/k:v）强于基线单形态。
- setup 步骤注册表 + --list 自省（基线为硬编码 STEPS 表）。
- 回归测试锚定：解析/lint/策略/幂等/闩锁/回滚/状态块往返。

## 五、复检修复（se-inspector FAIL → 修复）
1. **P0 fsRoot 越界**：safeJoin（resolve+relative 防 .. 与绝对路径）统一收口 copy/append/json-merge/removeSkill；越界 bounce + 负向回归测试。
2. **P1 引擎崩溃面**：逐指令 try/catch bounce（注入器 throw 不崩引擎）+ 回归测试。
3. **P1 json-merge 静默清空**：损坏目标 bounce；journal 记旧值，回滚恢复旧值 + 回归测试。
4. **P1 解析器重扫面**：append 消费 fence 体（体内嵌 fence 不再成可执行面）；未闭合 fence 报 validate 错误 + 回归测试。
5. **P1 secret**：prompt secret=true 进 secretVars（可替换）但排除出 res.vars + 回归测试。
6. **P1 blocked 后 operator 跳过**（不再误导人工）。
7. **P1 removeSkill 单条失败不中断倒放**（try/catch continue）。
8. **P1 尾换行防护**：append 先导换行 + journal 记实际写入文本，回滚可恢复。
9. P2：retired 按解析键检查（消子串误报）+ k:v 冒号形态解析；env-set key 正则校验；registerBuiltinSteps 幂等；policy 恒真死代码清理。
10. 遗留记录：deferred 置闩锁为刻意差异（更保守，头注释声明）；run 值进 shell 的信任模型声明在头注释；PLAN/effect 体系/skill-driver 接线延后。

## 修改记录
- 2026-08-13 创建；同日补复检修复节。
