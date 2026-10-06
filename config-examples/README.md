# config-examples

> 用途：配置示例索引。注意：本目录**不复制**配置样例文件，只说明它们在哪里。

## 内容清单
- 环境变量模板：`../.env.example`（仓库根目录，复制为 `.env` 后填写）
- `container.json`：**运行时生成**（主机 spawn 时把 container_configs 表物化到
  `groups/<folder>/container.json`），不是静态样例文件，仓库中不存在
- `mount-allowlist.json`：**用户级配置文件**（`~/.config/oc/mount-allowlist.json`），
  由运维在主机上自行创建，仓库中不存在

## 修改记录
- 2026-08-12 创建
- 2026-10-06 R-3：修正为如实描述——本目录此前声称的 container.json 与
  mount-allowlist.json 是运行时/用户级产物，不在仓库内；.env.example 在仓库根
