# OC 安全模型

> 说明 OC 的安全架构：guard 授权、容器沙箱、Web 安全、密钥管理、文件系统防护、审批流。

## 1. guard fail-closed 授权

所有特权动作经 `guard(action, input) -> allow | hold | deny` 决策：

- **非铸造值一律 DENY**（`WeakSet` 品牌检查 + 运行时兜底）
- **decide 抛错 -> DENY**（fail-closed）
- **grant 只满足 hold，永不松动 deny**
- 审批回放时：重跑结构检查 + 查库验活行（`pending_approvals` 存在）-> 恰好执行一次

**文件**：`src/guard/guard.ts`、`src/guard/guard-actions.ts`、`src/delivery-guard.ts`

## 2. 容器沙箱

- **`--cap-drop=ALL`**：丢弃全部 Linux capabilities
- **`--security-opt=no-new-privileges`**：禁止子进程提权
- **`--init`**：tini 作为 PID 1，正确转发 SIGTERM
- **文件系统隔离**：只挂载显式路径（`/workspace`、`/workspace/agent`、`inbound.db`(RO)、`outbound.db`）
- **挂载白名单**：`~/.config/oc/mount-allowlist.json`，在项目根之外（容器与 agent 不可达）
- **资源限制**：`--cpus`、`--memory`、`--pids-limit`（floor + finite 校验）
- **出口网络**：可选 `--internal` 网络（egress lockdown）

## 3. Web 安全

| 防御 | 实现 |
|------|------|
| **fail-closed 鉴权** | `WEB_TOKEN` 未配置时自动生成随机 token 持久化（`data/web-token`），拒绝空 token |
| **CSRF** | POST 请求拒绝 `Sec-Fetch-Site: cross-site` 与 Origin 不等于 Host |
| **路径穿越** | `/api/traces/:id` 经 `isSafeTraceId`（拒分隔符 + resolve 容纳校验） |
| **请求体超限** | 超 1MB 停止累积，返回 413 |
| **常量时间 token 比较** | `timingSafeEqual` |
| **SQL 注入** | 全部参数化查询；动态列名经白名单校验（`COL_RE` 正则） |

**文件**：`src/web/api.ts`、`src/web/server.ts`、`src/eval/trace.ts`

## 4. 密钥管理

- **不进 process.env**：`.env` 经 `readEnvFile` 白名单读取，刻意不写入 `process.env`
- **不进 docker argv**：密钥写 0600 临时文件，经 `--env-file` 注入容器，容器退出即删
- **不进 Git**：`.env` 已 gitignore
- **诚实取舍**：弱于基线 OneCLI 网关的"token 不进容器"（docs/architecture.md 已记录）

**文件**：`src/env.ts`、`src/providers/openai.ts`、`src/container-runner.ts`

## 5. 附件与文件系统安全

四层防御（`src/attachment-safety.ts`、`src/inbox-safety.ts`）：

1. `basename` 校验--拒绝含路径分隔符的文件名
2. `lstat` 拒绝 symlink 和非目录
3. `realpath` 容纳（解析符号链接后的真实路径）
4. `wx` 独占写--拒绝覆盖已有文件

挂载安全（`src/modules/mount-security.ts`）：
- 白名单路径校验
- `realpath` 归一化
- RW 挂载需满足双条件（白名单 + 用户确认）
- 黑名单拒绝（`.ssh`、`.aws`、`.env`、`.config/oc` 等）

## 6. 审批流

- **self-mod**（install_packages / add_mcp_server）：恒 HOLD，需 owner 审批；precheck 硬化（包名正则/数量/payload 上限）
- **CLI admin 命令**：非 admin 用户调用时 hold -> 建审批 -> approval-pending -> host 批准后重放
- **审批回放**：先重放后删行（恰好一次）；grant 携带活行复核
- **审批人偏好链**：scoped admins -> global admins -> owners

## 7. Agent 内安全

- **bash 工具**：只能在容器内执行，超时 clamp 10 分钟
- **文件工具**：路径 resolve 后前缀校验，限制在 `/workspace` 内
- **ask_user 交互**：300s 超时 + `questionId` 精确等值匹配 + `kind` 专用 + 消费后删
- **web_fetch**：返回 `untrusted: true` 标注；SSRF 防护为基础容器网络隔离

## 8. 已知安全取舍

| 项 | 取舍 | 原因 |
|---|---|---|
| 密钥进容器 env | 弱于基线 OneCLI 网关 | 可移植性 > 隔离强度（已记录） |
| Windows 命名管道无 0600 等价 ACL | 依赖文件系统权限 | 仅平台支持（Unix 有 chmod 0600） |
| web_fetch 无应用层 SSRF 过滤 | 依赖容器网络隔离 | 简化实现 |
| SMTP 587 STARTTLS 验证证书 | 已实现 | 修复记录见 commit history |