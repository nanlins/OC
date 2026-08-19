# 阶段 3 记录：容器运行时 + guard 决策接缝

> 用途：记录阶段 3（container-runner/runtime/restart/host-sweep/egress/guard 全套）的决策、问题、对标与扩展。

## 一、重要决策
1. **wakeContainer 契约**：永不抛/布尔返回/in-flight Promise 去重；瞬态失败交 sweep 重试；调用方零防御代码。
2. **可注入 spawner**（setContainerSpawnerForTest）使容器编排全链路可在无 Docker 环境测试。
3. **guard 全套**：品牌化动作值（编译期+WeakSet 运行时）、fail-closed、grant 只满足 hold 永不松动 deny、grantCoversRequest 领域绑定、unguarded 唯一铸造（"遗漏不可表示"）。
4. **挂载白名单在项目根之外**（~/.config/openclaw/mount-allowlist.json），解析错误不缓存。
5. **egress fail-fast**：封锁建立失败拒绝 spawn；sweep 每 tick 自愈。

## 二、所遇问题与修复方案
1. **P0 认领判定读错数据源**：getProcessingClaims/reset 以 `messages_in.status='processing'` 为源，但生产无任何路径写该状态（容器只写 processing_ack）→ sweep 卡死检测/退避全失效 → 改为以 outbound processing_ack 为认领源，回查 inbound 取 tries。
2. **P1 kill-claim 心跳缺失不判** → 心跳 null 视为无生命迹象（对齐基线 host-sweep.ts:114）。
3. **P1 单写者文档不一致** → session-db 头部登记第二成文例外（sweep 维护写）。
4. P2：--shm-size 无条件附加；pids-limit floor+finite；getContainerToolState 仅 Bash 门控 + 缺表容错。
5. 测试虚假信心：崩溃用例原靠手工 UPDATE status='processing' → 改为生产路径（写 ack 行）。

## 三、对标 claw 开源源码完成度
- 已复刻：container-runner spawn 十步/挂载顺序/RO 嵌套/hardening 三件套/onExit 接力/on_wake；container-runtime 门面 + label 作用域孤儿清理；host-sweep 六职责 + decideStuckAction 纯函数 + parseSqliteUtc；container-restart；egress-lockdown；guard 四件套 + 一致性测试位。
- 简化：per-group 派生镜像构建（buildAgentGroupImage）裁除（延后）；skill 符号链接同步延后阶段 6。
- 缺失：OneCLI ensureAgent/凭证网关注入（决策：密钥经 env→SDK，容器不持原始密钥的目标以 OPENCLAW_* 环境变量本地实现，生产形态待 OneCLI 类网关接入）。

## 四、扩展度
- decideStuckAction/parseSqliteUtc 纯函数化 + 全分支单测（含心跳缺失 kill-claim）。
- 第二成文例外登记制度。
- sweep 到期唤醒先于崩溃清理的死锁防御测试锚定。

## 修改记录
- 2026-08-12 创建。
