# 阶段 2 记录：核心管线

> 用途：记录阶段 2（index 编排/router/session-manager/安全三件套/channels 基础设施）的决策、问题、对标与扩展。

## 一、重要决策
1. **router 零领域知识**：5 钩子接缝（senderResolver/accessGate/senderScopeGate/interceptor/channelRequestGate）+ waker/typing 注入，模块经 barrel 副作用注册。
2. **不引入 Chat SDK 桥接**：webhook-server/state-sqlite/chat_sdk_* 全裁（基线该层为第三方 `chat` 包服务），通道直接实现 ChannelAdapter；决策记录于此，后续通道（阶段 5+）按原生适配器形态落地。
3. **command-gate 主机侧**：admin 命令直查 user_roles，deny 直写 outbound 不唤醒容器；内容形状契约（纯文本）注释在案。
4. **open-write-CLOSE 助手**：withInboundDb 统一保证承重不变量 2。
5. **熔断器**文件状态机 + 退避表 [0,0,10,30,120,300,900] + 1h 窗口。

## 二、所遇问题与修复方案
1. **P0 clearOutbox 无防御**（容器可控 messageId 直入 rmSync）→ basename 校验 + root/target lstat 拒符号链接与非目录 + realpath 容纳 + rmSync(real)。
2. **P0 熔断器 finally 无条件重置**（启动崩溃也重置→退避失效）→ graceful 标志仅信号路径重置。
3. **P1 subscribe 无 .catch** 可崩主机 → 移门后 + `.catch(log.warn)` + isGroup/effectiveThread 守卫。
4. **P1 sticky 用原始 threadId** → 折叠后 effectiveThread + DM(is_group=0) 守卫。
5. **P1 mount-security resolve() 不解析符号链接 + containerPath 可遮蔽 RO 挂载** → realpath 校验挂载 + `/workspace/extra/` 沙箱 + blocked 清单扩充（.netrc/.npmrc/id_rsa/.kube/.docker 等）+ Windows 分隔符归一。
6. **P1 任务 GC 硬编码 hasLiveTasks=false** → countLiveTasks 实查。
7. **P1 审计职责矛盾** → 结构性丢弃核心记、策略拒绝门记；no_agent_engaged 升 log.info。
8. P2：--shm-size 无条件、pids floor+finite、getContainerToolState 仅 Bash 门控+容错、materializeContainerJson 原子写（P2 记录，后续闭环）。

## 三、对标 claw 开源源码完成度
- 已复刻：router 12 步管线（含 accumulate 语义"被门拒绝绝不 accumulate"）、channel-registry 查找非对称 + MissingChannelAdapterError、channel-defaults 五级解析 + 行为忠实回退、group-init/folder、session-manager 全操作、circuit-breaker、host-lifecycle 逆序容错。
- 简化：claude-md-compose 延后（阶段 6 模板）；mention-sticky 首版恒 false，复检补齐会话存在查询。
- 缺失：webhook-server/state-sqlite（决策裁除）；upgrade-state tripwire（裁除，记录）。

## 四、扩展度
- inbound.db **RO 嵌套挂载**（基线仅整目录 RW，防御加深）。
- 容器名/stop 名字白名单正则防注入。
- isGroup 上下文选择统一派生（基线明文纪律落地为代码）。

## 修改记录
- 2026-08-12 创建。
