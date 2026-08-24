/**
 * security/content-filter.ts —— 内容安全过滤
 *
 * 职责：敏感词检测 + PII 脱敏 + 输出安全审查。输入/输出双向过滤。
 * 关键导出：filterInput, filterOutput, ContentFilterResult, detectPII
 * 承重不变量：过滤失败时返回原始内容并标注风险（不静默丢弃）。
 * 知识文档映射：04-Agent应用详解 §4.11 Agent安全
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */

export interface ContentFilterResult {
  passed: boolean;
  reason: string | null;
  filtered: string;
  piiFound: string[];
}

const PII_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { name: "phone_cn", pattern: /1[3-9]\d{9}/g },
  { name: "id_card_cn", pattern: /\d{17}[\dXx]/g },
  { name: "credit_card", pattern: /\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}/g },
  { name: "ip_address", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { name: "api_key", pattern: /(?:api[-_]?key|token|secret|password)\s*[:=]\s*["']?[^\s"']{8,}["']?/gi },
];

const SENSITIVE_WORDS_CN = [
  "政治敏感", "反动", "颠覆", "分裂", "独立宣言",
  "色情", "赌博", "毒品", "枪支", "暴力",
  "黑客", "攻击", "漏洞利用", "恶意代码",
];

export function detectPII(content: string): string[] {
  const found: string[] = [];
  for (const { name, pattern } of PII_PATTERNS) {
    const matches = content.match(pattern);
    if (matches) found.push(name);
  }
  return [...new Set(found)];
}

export function filterInput(content: string): ContentFilterResult {
  const piiFound = detectPII(content);

  let filtered = content;
  for (const { pattern } of PII_PATTERNS) {
    filtered = filtered.replace(pattern, (match) => {
      if (match.length <= 4) return match;
      if (match.includes("@")) {
        const [local, domain] = match.split("@");
        return `${local![0]}***@${domain!}`;
      }
      return match.slice(0, 2) + "***" + match.slice(-2);
    });
  }

  const hasSensitive = SENSITIVE_WORDS_CN.some((w) => content.includes(w));

  return {
    passed: !hasSensitive,
    reason: hasSensitive ? "sensitive_content" : null,
    filtered,
    piiFound,
  };
}

export function filterOutput(content: string): ContentFilterResult {
  const piiFound = detectPII(content);

  if (piiFound.length > 0) {
    return {
      passed: false,
      reason: "pii_leak",
      filtered: "[输出被安全过滤器拦截，含敏感信息]",
      piiFound,
    };
  }

  return { passed: true, reason: null, filtered: content, piiFound: [] };
}