/**
 * cli/crud.ts —— 声明式资源 CRUD 生成器
 *
 * 职责：registerCrudResource(name, {table, columns, scopeField?}) 自动生成 list/get 命令；
 *       列白名单（读投影）；scopeField 按 caller.agentGroupId 过滤（agent 调用面）。
 * 关键导出：registerCrudResource, CrudResourceDef
 * 借鉴：nanoclaw src/cli/crud.ts（列元数据即帮助即校验的简化形态）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 7）
 *   2026-08-13 阶段 14：get 的 missing id / not found 改抛 LocalizedError
 */
import { getDb } from "../db/connection.js";
import { registerCommand, type ParsedArgs } from "./registry.js";
import type { CallerContext } from "./frame.js";
import { LocalizedError } from "../i18n/index.js";

export interface CrudResourceDef {
  table: string;
  /** 读投影列白名单 */
  columns: string[];
  /** agent 调用时按此列 = caller.agentGroupId 过滤 */
  scopeField?: string;
  agentVisible?: boolean;
  /** 复合主键表无 id 列时不注册 get（P2 修复） */
  noGet?: boolean;
}

const COL_RE = /^[a-z_][a-z0-9_]*$/;

export function registerCrudResource(name: string, def: CrudResourceDef): void {
  // P2 修复：table/scopeField 与列名同校验（SQL 拼接面不对称补齐）
  if (!COL_RE.test(def.table)) throw new Error(`invalid table name: ${def.table}`);
  if (def.scopeField && !COL_RE.test(def.scopeField)) throw new Error(`invalid scopeField: ${def.scopeField}`);
  for (const c of def.columns) {
    if (!COL_RE.test(c)) throw new Error(`invalid column name: ${c}`);
  }
  registerCommand({
    resource: name,
    verb: "list",
    scope: def.agentVisible ? "agent-group" : "host",
    agentVisible: def.agentVisible,
    handler: (_args: ParsedArgs, caller: CallerContext) => {
      const cols = def.columns.join(", ");
      let sql = `SELECT ${cols} FROM ${def.table}`;
      const params: unknown[] = [];
      if (def.scopeField && caller.actor === "agent" && caller.agentGroupId) {
        sql += ` WHERE ${def.scopeField} = ?`;
        params.push(caller.agentGroupId);
      }
      sql += " ORDER BY rowid DESC LIMIT 200";
      return getDb()
        .prepare(sql)
        .all(...params);
    },
  });
  if (def.noGet) return;
  registerCommand({
    resource: name,
    verb: "get",
    scope: def.agentVisible ? "agent-group" : "host",
    agentVisible: def.agentVisible,
    handler: (args: ParsedArgs, caller: CallerContext) => {
      if (!args.id) throw new LocalizedError("cli.missing_id", {}, "invalid-args");
      const cols = def.columns.join(", ");
      let sql = `SELECT ${cols} FROM ${def.table} WHERE id = ?`;
      const params: unknown[] = [args.id];
      if (def.scopeField && caller.actor === "agent" && caller.agentGroupId) {
        sql += ` AND ${def.scopeField} = ?`;
        params.push(caller.agentGroupId);
      }
      const row = getDb()
        .prepare(sql)
        .get(...params);
      if (!row) throw new LocalizedError("cli.not_found", { id: args.id }, "not-found");
      return row;
    },
  });
}
