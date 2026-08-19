/**
 * i18n/catalog.ts —— 宿主侧多语目录（zh/en/ja）
 *
 * 职责：以稳定 message id 为键的三语翻译目录；纯数据，无副作用，可被 t() 与测试直接断言。
 * 关键导出：Locale, SUPPORTED_LOCALES, DEFAULT_LOCALE, CATALOG
 * 承重不变量：
 *   1. 三语 key 集合必须完全一致（测试 lint 强制），缺失即回退 key 本身；
 *   2. message id 一旦发布永不改名（线上日志/审计可能引用）；
 *   3. 占位符统一 {name} 形状，由 t() 插值。
 * 命名空间：common.* 共享 / cli.* CLI 操作面 / api.* Web API / channel.* 渠道终端用户面。
 *
 * 修改记录：2026-08-13 创建（阶段 14）
 */
export type Locale = "zh" | "en" | "ja";

export const SUPPORTED_LOCALES: readonly Locale[] = ["zh", "en", "ja"];

/**
 * 宿主侧默认 en：对齐既有 CLI/Web API 操作面英文现状（行为保持）；
 * 中文/日文经 OC_LOCALE 或 Accept-Language 显式选择。前端控制台默认 zh（独立运行时）。
 */
export const DEFAULT_LOCALE: Locale = "en";

export const CATALOG: Record<Locale, Record<string, string>> = {
  zh: {
    "common.approve": "批准",
    "common.reject": "拒绝",

    "cli.usage": "用法：<resource> <verb> [id] [--flags]",
    "cli.unknown_command": "未知命令：{resource} {verb}",
    "cli.invalid_caller": "非法调用者身份",
    "cli.scope_disabled": "cli_scope=disabled（该群组已禁用 CLI）",
    "cli.not_in_group_scope": "命令不在群组范围内：{cmd}",
    "cli.approval_title": "CLI 命令需要审批：{cmd}",
    "cli.not_found": "未找到：{id}",
    "cli.missing_id": "缺少 id",
    "cli.name_folder_required": "需要 --name 与 --folder",
    "cli.wiring_flags_required": "需要 --messaging-group 与 --agent-group",
    "cli.user_role_required": "需要 <user_id> --role",
    "cli.user_group_required": "需要 <user_id> --group",
    "cli.task_id_required": "需要 <task_id|series_id>",
    "cli.nested_resolve_forbidden": "重放上下文中禁止嵌套 approvals resolve",
    "cli.approval_decision_required": "需要 <approval_id> --decision approve|reject",
    "cli.decision_must_be": "--decision 必须为 approve|reject",
    "cli.session_gone": "会话已不存在",
    "cli.error": "CLI 错误：{msg}",
    "cli.timeout": "CLI 超时",

    "api.err.bad_request": "请求无效",
    "api.err.forbidden": "禁止跨站请求",
    "api.err.payload_too_large": "请求体过大",
    "api.err.unauthorized": "未授权",
    "api.err.not_found": "未找到",
    "api.err.session_not_found": "会话不存在",
    "api.err.method_not_allowed": "方法不允许",
    "api.err.internal": "服务器内部错误",

    "channel.command_denied": "命令被拒绝：{reason}",
    "channel.admin_required": "执行 {cmd} 需要管理员权限",
    "channel.install_needs_approval": "安装软件包需要所有者审批",
    "channel.add_mcp_needs_approval": "添加 MCP 服务器需要所有者审批",
  },
  en: {
    "common.approve": "Approve",
    "common.reject": "Reject",

    "cli.usage": "usage: <resource> <verb> [id] [--flags]",
    "cli.unknown_command": "unknown command: {resource} {verb}",
    "cli.invalid_caller": "invalid caller actor",
    "cli.scope_disabled": "cli_scope=disabled",
    "cli.not_in_group_scope": "command not in group scope: {cmd}",
    "cli.approval_title": "CLI command requires approval: {cmd}",
    "cli.not_found": "not found: {id}",
    "cli.missing_id": "missing id",
    "cli.name_folder_required": "--name and --folder required",
    "cli.wiring_flags_required": "--messaging-group and --agent-group required",
    "cli.user_role_required": "<user_id> --role required",
    "cli.user_group_required": "<user_id> --group required",
    "cli.task_id_required": "<task_id|series_id> required",
    "cli.nested_resolve_forbidden": "nested approvals resolve is forbidden in replay context",
    "cli.approval_decision_required": "<approval_id> --decision approve|reject required",
    "cli.decision_must_be": "--decision must be approve|reject",
    "cli.session_gone": "session gone",
    "cli.error": "cli error: {msg}",
    "cli.timeout": "cli timeout",

    "api.err.bad_request": "bad request",
    "api.err.forbidden": "cross-site request forbidden",
    "api.err.payload_too_large": "payload too large",
    "api.err.unauthorized": "unauthorized",
    "api.err.not_found": "not found",
    "api.err.session_not_found": "session not found",
    "api.err.method_not_allowed": "method not allowed",
    "api.err.internal": "internal",

    "channel.command_denied": "command denied: {reason}",
    "channel.admin_required": "admin privilege required for {cmd}",
    "channel.install_needs_approval": "installing packages requires owner approval",
    "channel.add_mcp_needs_approval": "adding an MCP server requires owner approval",
  },
  ja: {
    "common.approve": "承認",
    "common.reject": "拒否",

    "cli.usage": "使い方：<resource> <verb> [id] [--flags]",
    "cli.unknown_command": "不明なコマンド：{resource} {verb}",
    "cli.invalid_caller": "不正な呼び出し元アクター",
    "cli.scope_disabled": "cli_scope=disabled（このグループは CLI 無効）",
    "cli.not_in_group_scope": "コマンドがグループ範囲外です：{cmd}",
    "cli.approval_title": "CLI コマンドには承認が必要です：{cmd}",
    "cli.not_found": "見つかりません：{id}",
    "cli.missing_id": "id がありません",
    "cli.name_folder_required": "--name と --folder が必要です",
    "cli.wiring_flags_required": "--messaging-group と --agent-group が必要です",
    "cli.user_role_required": "<user_id> --role が必要です",
    "cli.user_group_required": "<user_id> --group が必要です",
    "cli.task_id_required": "<task_id|series_id> が必要です",
    "cli.nested_resolve_forbidden": "リプレイ文脈でのネスト approvals resolve は禁止されています",
    "cli.approval_decision_required": "<approval_id> --decision approve|reject が必要です",
    "cli.decision_must_be": "--decision は approve|reject でなければなりません",
    "cli.session_gone": "セッションは存在しません",
    "cli.error": "CLI エラー：{msg}",
    "cli.timeout": "CLI タイムアウト",

    "api.err.bad_request": "不正なリクエスト",
    "api.err.forbidden": "クロスサイトリクエスト禁止",
    "api.err.payload_too_large": "リクエストボディが大きすぎます",
    "api.err.unauthorized": "未認証",
    "api.err.not_found": "見つかりません",
    "api.err.session_not_found": "セッションが見つかりません",
    "api.err.method_not_allowed": "メソッドは許可されていません",
    "api.err.internal": "内部エラー",

    "channel.command_denied": "コマンドが拒否されました：{reason}",
    "channel.admin_required": "{cmd} には管理者権限が必要です",
    "channel.install_needs_approval": "パッケージのインストールにはオーナーの承認が必要です",
    "channel.add_mcp_needs_approval": "MCP サーバーの追加にはオーナーの承認が必要です",
  },
};
