# templates

> 用途：本地 Agent 模板库的**数据目录**——`oc groups create --template <ref>` 从这里按相对 ref 取模板，盖印成新的 Agent 组。本目录随仓库提交但**默认为空**（只有本 README），模板由使用者自行放入。

## 为什么这个目录必须存在

`src/config.ts` 的 `TEMPLATES_DIR = join(PROJECT_ROOT, "templates")` 是硬编码路径，`src/templates/local-dir.ts:resolveLocalTemplate()` 以它为解析根。目录缺失时：

- 本机运行：`resolveLocalTemplate` 在 `existsSync` 检查处抛 `Template not found`，错误信息可读，不崩主机；
- **容器化运行：Docker 会为不存在的 bind-mount 源自动创建空目录**（root 所有），`docker-compose.yml` 里的 `./templates:/app/templates` 会在宿主上凭空造出一个 root 属主的目录。这是本目录连同本 README 一起提交的原因——让挂载源始终存在且属主正确。

## 模板目录结构

一个模板就是一个子目录，由 `src/templates/parse.ts:parseTemplate()` 解析：

```
templates/<模板名>/
├── context/
│   ├── instructions.md      必填。常设指令（人格、角色、行为约束）
│   └── **/*.md              可选。额外上下文，递归读取，文件名即 name
├── .mcp.json                可选。{ "mcpServers": { ... } }，无效 JSON 被静默忽略
├── skills/
│   └── <技能名>/            可选。每个子目录一个技能，原样拷进新组
└── tasks/
    └── <任务名>.md          可选。定时任务，格式见下
```

`tasks/*.md` 的格式（`parseTaskFile` 强制校验）：

```markdown
---
schedule: 0 9 * * 1
---
每周一早上汇总上周的未读消息并给出处理建议。
```

- 首行必须是 `---`，且必须有闭合的 `---`；
- frontmatter 里 `schedule:` 必填（cron 表达式，按组时区解释）；
- 闭合 `---` 之后的正文即 prompt，不能为空；
- 文件名去掉 `.md` 就是任务名，按文件名字典序加载。

## 安全约束

`resolveLocalTemplate` 只做**词汇包含检查**，不 resolve symlink：

- 拒绝绝对路径和 `~` 前缀（`ref` 必须是相对路径）；
- 拒绝解析后逃出 `TEMPLATES_DIR` 的 ref（`relative()` 以 `..` 开头即抛）；
- 要求目标存在且是目录。

不 resolve symlink 是刻意的取舍：模板目录由使用者自己维护，属主即信任边界；加 realpath 检查会挡住"用符号链接把模板指向仓库外"这一合法用法。

## 内容清单

| 条目 | 说明 |
|------|------|
| `README.md` | 本文件。目录存在的唯一理由，请勿删除 |

（模板本身不随仓库分发。）

## 相关代码

| 文件 | 职责 |
|------|------|
| `src/config.ts:TEMPLATES_DIR` | 路径常量 |
| `src/templates/local-dir.ts` | ref → 绝对路径解析 + 穿越防御 |
| `src/templates/parse.ts` | 模板目录 → 结构化 `Template` 对象 |
| `src/templates/create-agent.ts` | 按模板盖印新 Agent 组 |

## 修改记录

- 2026-09-16：创建。修复 `docker-compose.yml` 挂载了一个不存在的 `./templates` 目录（Docker 会以 root 属主自动创建它）；同时补齐 `TEMPLATES_DIR` 这一硬编码路径的落地目录与格式文档。
