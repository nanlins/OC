# 阶段 7 记录：CLI 管理工具

> 用途：记录阶段 7（oc socket-server + 声明式 CRUD + cli_scope 执行 + 审批解决入口闭环）的决策、问题、对标与扩展。

## 一、重要决策
1. **行分隔 JSON 帧协议**：身份不在帧里，由传输适配器填充（unix socket chmod 0600 / win32 named pipe = 权限即身份）。
2. **声明式 CRUD**：registerCrudResource 列白名单读投影 + scopeField 按 caller.agentGroupId 过滤；列名正则校验防注入。
3. **cli_scope 三级执行**：disabled→全拒；group→agentVisible 白名单；global→admin 级命令可发起但需审批（hold→'cli_command'）。
4. **审批解决入口闭环**（阶段 6 遗留 P1 闭环）：`approvals resolve <id> --decision` 为 cli_command 以原 caller+approved 标记重放（审批即授权），为投递动作经 resolveApproval 回放（guard 查库验活行）。
5. **approved 重放标记仅由 resolve 注入**：dispatch 不接受帧携带（caller 由传输填充）。

## 二、所遇问题与修复方案
1. **payload 双重 stringify**：dispatch 传字符串给 createPendingApproval（其内部再 stringify）→ resolve 解析得字符串 → 重放 invalid-args → 改传对象 + e2e 回归测试。
2. **getContainerConfig 导入源错误**（container-config.js 无此导出）→ db/container-configs.js。
3. **作用域语义与测试对齐**：group 面非白名单=forbidden（不进入审批）；审批 hold 仅 global 面 admin 级命令；disabled 需 ensure 行存在才生效（测试补 ensureContainerConfig）。
4. P2 记录：bin/oc 仅提供 pnpm oc/ncl 脚本（Windows 兼容），bash launcher 延后。

## 三、对标 claw 开源源码完成度
- 已复刻：帧协议/传输无关 dispatch/crud 声明式/registry 声明即守卫/cli_scope 三级/socket 控制面/tasks list/cancel（会话 inbound 形态）。
- 简化：wirings create 未做自然键解析与伴随 destinations 投影（宿主侧 writeDestinations 在 spawn 时全量刷新兜底）；help 渲染简化（human=JSON 美化）。
- 缺失：容器内 ncl（DB 传输客户端，阶段 4 遗留，延后）；reason-capture CLI 文本流。

## 四、扩展度
- approved 重放标记显式化（基线以 approval 行作 grant，本项目以 caller.approved 注入点单一化）。
- cli_command 审批 payload 存原 caller，重放保持调用者语义。
- 回归测试锚定：scope 三级 + 审批闭环 e2e + socket 回环。

## 五、复检修复（se-inspector CONDITIONAL PASS → 修复）
1. **P0 帧身份伪造**：RequestFrame 删除 caller 字段；handleCliLine 带外传参 + actor 白名单 fail-closed；socket 适配器恒 host；测试改带外 caller 并补"帧内伪造被剥离"回归。
2. **P1 非法 cli_scope fail-open** → 缺行默认 group、非法非空值 disabled + 回归测试。
3. **P1 group 面跨组枚举** → groups scopeField=id（仅本组）；messaging-groups 改 host-only（无按组过滤列，简化记录）。
4. **P1 cli_command 先删后放** → 先重放成功后删行；replaying 标记禁止嵌套 resolve（防审批传递授权）+ approved 注入点唯一（resources resolve 带外）。
5. **P1 守卫段异常崩主机** → dispatch 全段 try/catch 兜底 handler-error。
6. **P1 client 入口失效** → import.meta.main 改 basename 判定。
7. **P2**：crud table/scopeField 正则补齐；复合主键资源 noGet。
8. 遗留 P2 记录：stopCliServer pipe 释放等待、行长/连接上限、bin/oc bash launcher。

## 修改记录
- 2026-08-13 创建；同日补复检修复节。
