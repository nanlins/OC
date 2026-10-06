# resources

> 用途：CLI 资源声明中心——每个资源一个文件（R-6 拆分后），`index.ts` 编排全部注册

## 内容清单
- `index.ts`：registerAllResources 编排桶（幂等；web 与 cli 双入口共用）
- `kb.ts`：kb add/sync
- `groups.ts`：groups CRUD + create
- `messaging-groups.ts`：messaging-groups 只读 CRUD（host-only）
- `wirings.ts`：wirings CRUD + create（写入侧校验 engage）
- `users.ts`：users 只读 CRUD
- `roles.ts`：roles CRUD + grant/revoke
- `members.ts`：members CRUD + add/remove
- `sessions.ts`：sessions CRUD + history
- `tasks.ts`：tasks list/cancel/create/pause/resume/delete
- `approvals.ts`：approvals CRUD + resolve（审批闭环入口）
- `dropped.ts`：dropped 只读 CRUD
- `status.ts`：status get（host-only）
- `destinations.ts`：destinations add/remove/verify + 投影一致性校验

注：`../resources.ts` 是兼容 shim，只 re-export `./resources/index.js`。
历史 README 曾声称本目录存在 `policies.ts` / `user-dms.ts`——OC 没有这两个资源，
已删去该描述（R-3）。

## 修改记录
- 2026-08-12 创建（当时列出的文件名是 nanoclaw 形态，实际未实现——幻影引用，R-3 记录在案）
- 2026-10-06 R-6：resources.ts 按资源拆入本目录，README 与真实文件对齐
