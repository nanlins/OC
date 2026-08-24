/**
 * security/input-guard.ts —— Prompt 注入防御框架
 *
 * 职责：用户输入/工具结果/外部文档分类 + 注入检测 + 分隔符隔离。
 *       所有外部内容视为不可信数据，用分隔符隔离并标注来源。
 * 关键导出：classifyInput, isInjection, sanitizeInput, InputClass, GuardResult
 * 承重不变量：工具结果永不作指令解释；外部文档用 XML 标签包裹。
 * 知识文档映射：04-Agent应用详解 §4.11 Agent安全
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */

export type InputClass = "user" | "tool_result" | "external_doc" | "system" | "memory";

export interface GuardResult {
  safe: boolean;
  risk: "none" | "low" | "medium" | "high";
  flags: string[];
  sanitized?: string;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|above|prior)\s+(instructions|prompts?)/i,
  /you\s+are\s+now\s+(a\s+)?(different|new)\s+(assistant|ai|model|role)/i,
  /system\s*prompt\s*:/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /\[system\]/i,
  /forget\s+everything/i,
  /pretend\s+you\s+are/i,
  /act\s+as\s+(if\s+)?you\s+are/i,
  /your\s+new\s+(instructions?|role|task|identity)\s+(is|are)/i,
];

const SENSITIVE_KEY_PATTERNS = [
  /[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9]{32,}/g,
  /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  /ghp_[a-zA-Z0-9]{36}/g,
  /gho_[a-zA-Z0-9]{36}/g,
  /xox[baprs]-[a-zA-Z0-9-]+/g,
];

export function classifyInput(content: string, source: InputClass): InputClass {
  if (source === "tool_result" || source === "external_doc") return source;
  if (content.includes("<|im_start|>") || content.includes("[system]")) return "system";
  return source;
}

export function isInjection(content: string): GuardResult {
  const flags: string[] = [];
  let risk: GuardResult["risk"] = "none";

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      flags.push(`injection:${pattern.source}`);
      risk = "high";
    }
  }

  for (const pattern of SENSITIVE_KEY_PATTERNS) {
    if (pattern.test(content)) {
      flags.push("sensitive_key");
      risk = risk === "high" ? "high" : "medium";
    }
  }

  return { safe: risk === "none", risk, flags };
}

export function sanitizeInput(content: string): string {
  let sanitized = content;
  for (const pattern of SENSITIVE_KEY_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized;
}

export function wrapExternalContent(content: string, source: string): string {
  return `<external_source="${source}">\n${content}\n</external_source>`;
}

export function wrapToolResult(content: string, toolName: string): string {
  return `<tool_result="${toolName}">\n${content}\n</tool_result>`;
}
