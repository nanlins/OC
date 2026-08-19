# 阶段 14 记录：i18n 多语全链路

> 用途：记录阶段 14（宿主侧 i18n 运行时 + 前端三语全量抽取 + CLI/Web API/渠道三面接入）的决策、问题、对标与扩展。

## 一、重要决策
1. **宿主侧 i18n 模块（src/i18n/）**：`catalog.ts` 三语（zh/en/ja）纯数据目录，message id 稳定不改名、占位符 `{name}` 形状；`index.ts` 提供 `t()`（查表+插值+回退，绝不抛错）、`resolveLocaleFromEnv()`（读 `OC_LOCALE`）、`negotiateLocale()`（解析 Accept-Language，按 q 值降序取首个支持的主标签）、`LocalizedError`（结构化错误：key/params/code，message 用英文目录插值兜底供日志）。
2. **各面 locale 解析策略**：CLI=宿主进程 `OC_LOCALE`；Web API=请求头 Accept-Language 协商→`OC_LOCALE`→默认；渠道=宿主 `OC_LOCALE` 默认。每群组 locale 覆盖列为后续扩展点（未加 schema 列，避免 i18n 阶段引入表结构演进）。
3. **宿主默认 `en`、前端默认 `zh`**：宿主 CLI/Web API 操作面既有为英文，默认 en 保持行为不变（测试断言 code 不断言文案，亦不受影响）；前端控制台既有为中文（独立运行时），默认 zh。二者分治，对齐现状。
4. **前端三语全量抽取**：6 页面表头/表单/按钮硬编码文案全部入字典，新增 `col.*`/`wirings.*`/`common.empty` 键；`cycleLocale()` 三语循环（zh→en→ja→zh），localStorage 持久化；`__dictForTest()` 供 key 一致性 lint。
5. **CLI 接入**：`dispatch()` 增 `locale` 参数（Web 面传入协商值），静态错误与 `LocalizedError` 在渲染缝隙按 locale 翻译；`resources.ts`/`crud.ts` 参数/未找到错误改抛 `LocalizedError`；`client.ts` 传输错误（cli error/timeout）本地化。
6. **Web API 接入**：错误响应改 `{ error: 本地化文案, code: 稳定 message id }`（前端可按 code 再译）；`dispatch` 调用传入请求 locale。
7. **渠道接入**：`command-gate.ts` deny 结果增补 `reasonKey/params`（英文 reason 保留供审计）；`router.ts` 拒绝回复按 locale 组合本地化；`approvals.ts` 审批卡 `options_json`、`self-mod.ts` HOLD 理由本地化。
8. **刻意不本地化 / 边界**：
   - `eval-resource.ts` 兜底答案（MockJudge 拒答正则依赖该中文串，ja 化会破坏拒答检测，属评估数据契约）；
   - `web/static` 旧版控制台（阶段 9 产物，是主机 `/` 当前实际供给的控制台；React 前端目前仅 vite dev 供给、无 build→static 管线，改造收益低，故排除）；
   - **LLM 回复语言**：i18n 覆盖主机 UI/错误文案，不直接字典化 LLM 自由生成内容——输出语言属 Prompt 工程，已通过 CLAUDE.md「跟随用户语言回复」指令缓解；每群组 locale 注入系统提示为后续扩展点；
   - **评估语料**：检索/判分已具备 zh/en/ja 能力（tokenize 假名 + 多语拒答正则），但种子语料与改写前缀仍以中文为主，seed-en/seed-ja 语料为后续扩展（当前 ja/en 支持集中在 UI 文案面）。

## 二、所遇问题与修复方案
1. **LocalizedError.message 未插值**（测试断言 `not found: x` 失败）→ 构造函数对英文目录做 `{param}` 插值。
2. **noUncheckedIndexedAccess**：`SUPPORTED_LOCALES[0]` 推导为 `Locale | undefined` 不能作索引 → `?? DEFAULT_LOCALE` 兜底。
3. **默认 locale 取舍**：若宿主默认 zh 会将既有英文 CLI/API 输出转中文（行为变更）→ 定为 en 保持现状，中文经 `OC_LOCALE`/Accept-Language 显式选择。
4. **eval 兜底答案 ja 化破坏拒答检测** → 保持中文不本地化，并删除目录中预留的 `cli.eval_fallback` 死键。

### 检查员复检（se-inspector / ai-inspector，均 CONDITIONAL PASS、无 P0）所发现并已修复：
5. **P1-1（se）`OC_LOCALE` 经 .env 被静默忽略** → 纳入 config.ts 白名单并导出，`resolveLocaleFromEnv` 优先读 config 值；`.env.example` 增补条目。
6. **P1-2（se）前端丢弃服务端本地化错误体** → `api/client.ts` get/post 在 `!res.ok` 时解析 `{error, code}` 并抛出本地化文案。
7. **P1-3（se）死键/未接线** → `session gone` 改抛 `LocalizedError(cli.session_gone)`；删除死键 `cli.duplicate_command`、宿主侧 `common.loading/error`、前端 `common.empty`。
8. **P1-4（se）self-mod HOLD 理由本地化污染审计** → `decide()` 恢复英文 reason（审计面 locale 无关），仅审批卡标题在 `requestHold` 本地化（对齐 command-gate 模式）。
9. **P1-1（ai）LlmJudge 无拒答分支** → 增 `JUDGE_REFUSAL_RUBRIC`，`outOfDomain` 走拒答判分，答案以 `<answer>` 分隔隔离。
10. **P1-2（ai）评估多语盲区** → `tokenize` 并入日文假名区 U+3040–U+30FF；MockJudge 拒答正则多语化（zh/en/ja）。语料库仍以中文为主，seed-en/seed-ja 列为后续（见 §三）。
11. **P2 随修**：`negotiateLocale` 过滤 q≤0/NaN；`client.ts` 空 msg 去尾冒号；`router.test.ts` 拒绝断言改判被拒命令名（locale 无关）；CLAUDE.md 增补"跟随用户语言回复"指令。

## 三、对标 claw 开源源码完成度
- nanoclaw 基线无 i18n（单语），本阶段为自主扩展；前端 i18n 基础在阶段 11 已铺设，本阶段完成宿主+前端全链路闭环。
- 渠道适配器保持零文案透传（与基线一致），本地化收敛于上游少数作者点（router/command-gate/approvals/self-mod），未侵入 9 个适配器。

## 四、扩展度
- 三语目录（zh/en/ja）+ Accept-Language q 值协商 + `LocalizedError` 结构化错误 + Web API 错误码方案（code 与文案分离）。
- 目录三语 key 一致性 lint（host + frontend 双测）；tokenize 假名区 + 多语拒答正则 + LlmJudge 拒答分支（i18n×评估交集回归）。
- 落地知识文档 02（文案本地化；Prompt 语言控制经 CLAUDE.md 指令）与 05（后端 API 错误码工程）。
- 累计：host 290 用例 / frontend 15 用例 / container 24 用例通过；tsc + eslint 全绿；总行数约 25,289。

## 修改记录
- 2026-08-13 创建。
