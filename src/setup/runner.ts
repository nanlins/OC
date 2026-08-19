/**
 * setup/runner.ts —— 状态块解析 + 步骤注册分发
 *
 * 职责：parseStatusStream 解析 L2 块；registerStep/runStep 分发（--step <name>）。
 * 关键导出：parseStatusStream, registerStep, runStep, listSteps
 * 借鉴：nanoclaw setup/lib/runner.ts（StatusStream 解析形态）
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 8）
 */
import { STATUS_END } from "./status.js";

export interface StatusBlock {
  type: string;
  kv: Record<string, string>;
}

export function parseStatusStream(text: string): StatusBlock[] {
  const blocks: StatusBlock[] = [];
  const lines = text.split(/\r?\n/);
  let current: StatusBlock | null = null;
  for (const line of lines) {
    const begin = /^=== OPENCLAW SETUP: (.+) ===$/.exec(line);
    if (begin) {
      current = { type: begin[1] ?? "", kv: {} };
      blocks.push(current);
      continue;
    }
    if (line.trim() === STATUS_END) {
      current = null;
      continue;
    }
    if (current) {
      const idx = line.indexOf(":");
      if (idx > 0) current.kv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return blocks;
}

export type StepFn = (args: string[]) => Promise<Record<string, string | number | boolean>>;

const steps = new Map<string, StepFn>();

export function registerStep(name: string, fn: StepFn): void {
  if (steps.has(name)) throw new Error(`duplicate setup step: ${name}`);
  steps.set(name, fn);
}

export function listSteps(): string[] {
  return [...steps.keys()];
}

export async function runStep(name: string, args: string[]): Promise<Record<string, string | number | boolean>> {
  const fn = steps.get(name);
  if (!fn) throw new Error(`unknown setup step: ${name}`);
  return fn(args);
}
