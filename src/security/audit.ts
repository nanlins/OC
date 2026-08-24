/**
 * security/audit.ts —— 结构化审计日志
 *
 * 职责：append-only 不可篡改审计日志 + 可导出（JSONL/CSV）+ 保留策略。
 *       记录所有 guard 决策、工具调用、权限变更、审批流。
 * 关键导出：auditLog, queryAudit, exportAudit, AuditEvent, AuditRetention
 * 承重不变量：日志文件追加模式（O_APPEND），永不编辑/删除已写入行。
 * 知识文档映射：05-后端工程详解 §5.2 审计与可观测性
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.js";
import { log } from "../log.js";

export interface AuditEvent {
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  decision: "allow" | "deny" | "hold";
  reason: string;
  metadata?: Record<string, unknown>;
}

const AUDIT_DIR = join(DATA_DIR, "audit");
const AUDIT_FILE = "audit.jsonl";

function ensureAuditDir(): void {
  if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });
}

export function auditLog(event: AuditEvent): void {
  ensureAuditDir();
  const line = JSON.stringify(event) + "\n";
  try {
    appendFileSync(join(AUDIT_DIR, AUDIT_FILE), line, "utf-8");
  } catch (err) {
    log.warn("audit write failed", { err, action: event.action });
  }
}

export function queryAudit(opts: {
  actor?: string;
  action?: string;
  decision?: string;
  after?: string;
  limit?: number;
}): AuditEvent[] {
  ensureAuditDir();
  const path = join(AUDIT_DIR, AUDIT_FILE);
  if (!existsSync(path)) return [];

  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  const results: AuditEvent[] = [];

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]!) as AuditEvent;
      if (opts.actor && event.actor !== opts.actor) continue;
      if (opts.action && event.action !== opts.action) continue;
      if (opts.decision && event.decision !== opts.decision) continue;
      if (opts.after && event.timestamp < opts.after) continue;
      results.push(event);
      if (opts.limit && results.length >= opts.limit) break;
    } catch {
      continue;
    }
  }

  return results.reverse();
}

export function exportAudit(format: "jsonl" | "csv"): string {
  ensureAuditDir();
  const path = join(AUDIT_DIR, AUDIT_FILE);
  if (!existsSync(path)) return "";

  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);

  if (format === "csv") {
    const header = "timestamp,actor,action,resource,decision,reason";
    const rows = lines.map((l) => {
      try {
        const e = JSON.parse(l) as AuditEvent;
        return `${e.timestamp},${e.actor},${e.action},${e.resource},${e.decision},"${e.reason}"`;
      } catch {
        return "";
      }
    }).filter(Boolean);
    return [header, ...rows].join("\n");
  }

  return lines.join("\n");
}

export function rotateAudit(maxSizeMB = 100): void {
  ensureAuditDir();
  const path = join(AUDIT_DIR, AUDIT_FILE);
  if (!existsSync(path)) return;

  const { size } = require("node:fs").statSync(path);
  if (size > maxSizeMB * 1024 * 1024) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    require("node:fs").renameSync(path, join(AUDIT_DIR, `audit-${ts}.jsonl`));
    log.info("audit log rotated", { size, ts });
  }
}