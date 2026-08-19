# src/i18n

> 用途：宿主侧多语（i18n）运行时与翻译目录，支撑 CLI / Web API / 渠道三面用户可见文案的本地化。

## 内容清单
- `catalog.ts` —— 三语（zh/en/ja）翻译目录；纯数据。message id 稳定不改名；占位符 `{name}` 形状。
- `index.ts` —— `t()` 查表+插值+回退；`resolveLocaleFromEnv()`（读 `OC_LOCALE`）；`negotiateLocale()`（解析 Accept-Language）；`LocalizedError`（结构化错误，渲染缝隙按请求 locale 翻译）。
- `README.md` —— 本文件。

## locale 解析策略（各面）
- **CLI**：宿主进程 `OC_LOCALE`（host 级配置，操作面）；缺省 `en`（对齐既有英文操作面）。
- **Web API**：请求头 `Accept-Language` 协商，回退 `OC_LOCALE` → `en`。
- **渠道**：宿主 `OC_LOCALE` 默认（每群组 locale 覆盖为后续扩展点，见 phase-14）。
- 前端控制台为独立运行时，默认 `zh`。

## 不变量
1. 三语 key 集合必须一致（测试 lint 强制）。
2. `t()` 缺 key/缺 locale 只回退不抛错。
3. `LocalizedError` 只改文案不改 `code` 语义。

## 修改记录
- 2026-08-13 创建（阶段 14）。
