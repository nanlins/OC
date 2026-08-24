/**
 * providers/fallback.ts —— Provider 降级链
 *
 * 职责：主 Provider 不可用时自动切换到备用 Provider。按优先级列表依次尝试，
 *       直到成功或全部失败。支持超时、重试、熔断。
 * 关键导出：FallbackChain, createFallbackChain, FallbackConfig
 * 承重不变量：降级不改变消息内容，仅切换 Provider；熔断后 30s 冷却。
 * 知识文档映射：04-Agent应用详解 §3.3 Provider 抽象
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */

export interface FallbackConfig {
  name: string;
  provider: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface FallbackResult {
  success: boolean;
  provider: string;
  model: string;
  response?: string;
  error?: string;
  attempts: number;
  totalMs: number;
}

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

const circuits = new Map<string, CircuitState>();
const CIRCUIT_COOLDOWN_MS = 30_000;
const CIRCUIT_THRESHOLD = 3;

function getCircuit(name: string): CircuitState {
  if (!circuits.has(name)) {
    circuits.set(name, { failures: 0, lastFailure: 0, open: false });
  }
  return circuits.get(name)!;
}

function isCircuitOpen(name: string): boolean {
  const c = getCircuit(name);
  if (!c.open) return false;
  if (Date.now() - c.lastFailure > CIRCUIT_COOLDOWN_MS) {
    c.open = false;
    c.failures = 0;
    return false;
  }
  return true;
}

function recordFailure(name: string): void {
  const c = getCircuit(name);
  c.failures++;
  c.lastFailure = Date.now();
  if (c.failures >= CIRCUIT_THRESHOLD) {
    c.open = true;
  }
}

function recordSuccess(name: string): void {
  const c = getCircuit(name);
  c.failures = 0;
  c.open = false;
}

export class FallbackChain {
  private configs: FallbackConfig[];

  constructor(configs: FallbackConfig[]) {
    if (configs.length === 0) throw new Error("fallback chain requires at least one provider");
    this.configs = configs;
  }

  addFallback(config: FallbackConfig): void {
    this.configs.push(config);
  }

  async execute(
    query: (provider: string, model: string, messages: unknown[], signal: AbortSignal) => Promise<string>,
    messages: unknown[],
  ): Promise<FallbackResult> {
    const start = Date.now();
    let lastError: string | undefined;

    for (let i = 0; i < this.configs.length; i++) {
      const cfg = this.configs[i]!;

      if (isCircuitOpen(cfg.name)) {
        lastError = `circuit open: ${cfg.name}`;
        continue;
      }

      for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

          const response = await query(cfg.provider, cfg.model, messages, controller.signal);
          clearTimeout(timeout);

          recordSuccess(cfg.name);
          return {
            success: true,
            provider: cfg.provider,
            model: cfg.model,
            response,
            attempts: attempt,
            totalMs: Date.now() - start,
          };
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          recordFailure(cfg.name);
        }
      }
    }

    return {
      success: false,
      provider: "none",
      model: "none",
      error: lastError ?? "all providers failed",
      attempts: this.configs.reduce((s, c) => s + c.maxRetries, 0),
      totalMs: Date.now() - start,
    };
  }
}

export function createFallbackChain(configs: FallbackConfig[]): FallbackChain {
  return new FallbackChain(configs);
}

export const DEFAULT_FALLBACK_CONFIGS: FallbackConfig[] = [
  { name: "claude", provider: "claude", model: "claude-sonnet-4-20250514", timeoutMs: 60_000, maxRetries: 2 },
  { name: "openai", provider: "openai", model: "gpt-4o", timeoutMs: 60_000, maxRetries: 2 },
  { name: "ollama", provider: "ollama", model: "llama3.1", timeoutMs: 120_000, maxRetries: 1 },
];