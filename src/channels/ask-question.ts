/**
 * channels/ask-question.ts —— 交互式问题载荷 schema + 标准化
 *
 * 职责：ask_question 载荷的选项标准化（裸字符串 → 含 label/value/selectedLabel 对象）。
 *       生产者（主机审批、容器 ask_user_question MCP 工具）用此标准化后再投递。
 * 关键导出：AskQuestionPayload, normalizeOption, normalizeOptions, RawOption, NormalizedOption
 * 借鉴：nanoclaw src/channels/ask-question.ts
 *
 * 修改记录：2026-08-24 创建（补齐未完成清单）
 */

export type OptionStyle = "primary" | "danger" | "default";

export interface OptionInput {
  label: string;
  selectedLabel?: string;
  value?: string;
  style?: OptionStyle;
}

export type RawOption = string | OptionInput;

export interface NormalizedOption {
  label: string;
  selectedLabel: string;
  value: string;
  style?: OptionStyle;
}

export function normalizeOption(raw: RawOption): NormalizedOption {
  if (typeof raw === "string") {
    return { label: raw, selectedLabel: raw, value: raw };
  }
  return {
    label: raw.label,
    selectedLabel: raw.selectedLabel ?? raw.label,
    value: raw.value ?? raw.label,
    style: raw.style === "primary" || raw.style === "danger" || raw.style === "default" ? raw.style : undefined,
  };
}

export function normalizeOptions(raws: RawOption[]): NormalizedOption[] {
  return raws.map(normalizeOption);
}

export interface AskQuestionPayload {
  type: "ask_question";
  questionId: string;
  title: string;
  question: string;
  options: NormalizedOption[];
}
/*
 * 修改记录：
 *   2026-08-24 创建（补齐未完成清单）
 */

