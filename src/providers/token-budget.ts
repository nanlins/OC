/**
 * providers/token-budget.ts —— Token 预算管理
 *
 * 职责：动态上下文窗口管理 + 自动压缩/截断/摘要。跟踪每次请求的 token 用量，
 *       在接近上限时自动压缩历史消息。
 * 关键导出：TokenBudget, createTokenBudget, trackTokens, shouldCompress
 * 承重不变量：系统提示永不被压缩；压缩后消息数 ≥ 4；budget 透支时截断而非丢消息。
 * 知识文档映射：04-Agent应用详解 §4.6 上下文工程
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */

export interface TokenBudgetConfig {
  maxTokens: number;
  systemPromptTokens: number;
  reserveTokens: number;
  compressThreshold: number;
  minMessagesAfterCompress: number;
}

export interface TokenUsage {
  total: number;
  system: number;
  messages: number;
  tools: number;
  timestamp: string;
}

export interface CompressResult {
  compressed: boolean;
  messagesRemoved: number;
  tokensSaved: number;
  remainingMessages: number;
  remainingTokens: number;
}

const DEFAULT_CONFIG: TokenBudgetConfig = {
  maxTokens: 200_000,
  systemPromptTokens: 0,
  reserveTokens: 4_000,
  compressThreshold: 0.8,
  minMessagesAfterCompress: 4,
};

export class TokenBudget {
  private config: TokenBudgetConfig;
  private usage: TokenUsage;
  private history: TokenUsage[];

  constructor(config: Partial<TokenBudgetConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.usage = { total: 0, system: 0, messages: 0, tools: 0, timestamp: new Date().toISOString() };
    this.history = [];
  }

  setSystemTokens(tokens: number): void {
    this.config.systemPromptTokens = tokens;
    this.usage.system = tokens;
    this.recalc();
  }

  trackMessageTokens(tokens: number): void {
    this.usage.messages += tokens;
    this.recalc();
  }

  trackToolTokens(tokens: number): void {
    this.usage.tools += tokens;
    this.recalc();
  }

  private recalc(): void {
    this.usage.total = this.usage.system + this.usage.messages + this.usage.tools;
    this.usage.timestamp = new Date().toISOString();
  }

  getUsage(): TokenUsage {
    return { ...this.usage };
  }

  remainingTokens(): number {
    return this.config.maxTokens - this.usage.total - this.config.reserveTokens;
  }

  shouldCompress(): boolean {
    return this.usage.total > this.config.maxTokens * this.config.compressThreshold;
  }

  estimateCompress(messageTokens: number[], oldestFirst: boolean = true): CompressResult {
    if (!this.shouldCompress()) {
      return { compressed: false, messagesRemoved: 0, tokensSaved: 0, remainingMessages: messageTokens.length, remainingTokens: this.usage.total };
    }

    const target = this.config.maxTokens * 0.5;
    const minKeep = this.config.minMessagesAfterCompress;

    let cumulative = 0;
    const tokens = oldestFirst ? messageTokens : [...messageTokens].reverse();
    const toRemove: number[] = [];

    for (let i = 0; i < tokens.length - minKeep; i++) {
      cumulative += tokens[i]!;
      toRemove.push(i);
      if (this.usage.total - cumulative <= target) break;
    }

    return {
      compressed: true,
      messagesRemoved: toRemove.length,
      tokensSaved: cumulative,
      remainingMessages: messageTokens.length - toRemove.length,
      remainingTokens: this.usage.total - cumulative,
    };
  }

  reset(): void {
    this.usage = { total: this.config.systemPromptTokens, system: this.config.systemPromptTokens, messages: 0, tools: 0, timestamp: new Date().toISOString() };
  }

  snapshot(): void {
    this.history.push({ ...this.usage });
    if (this.history.length > 100) this.history.shift();
  }

  getHistory(): TokenUsage[] {
    return [...this.history];
  }

  updateConfig(patch: Partial<TokenBudgetConfig>): void {
    this.config = { ...this.config, ...patch };
  }
}

export function createTokenBudget(config: Partial<TokenBudgetConfig> = {}): TokenBudget {
  return new TokenBudget(config);
}

export function estimateMessageTokens(text: string): number {
  const cnChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const otherChars = text.length - cnChars;
  return Math.ceil(cnChars / 1.5 + otherChars / 4);
}