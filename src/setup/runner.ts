/**
 * setup/runner.ts ?”â€??¶æ€å?è§?? + æ­¥éª¤æ³¨å??†å?
 *
 * ?Œè´£ï¼šparseStatusStream è§?? L2 ?—ï?registerStep/runStep ?†å?ï¼?-step <name>ï¼‰ã€? * ?³é”®å¯¼å‡ºï¼šparseStatusStream, registerStep, runStep, listSteps
 * ?Ÿé‰´ï¼šnanoclaw setup/lib/runner.tsï¼ˆStatusStream è§??å½¢æ€ï?
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-13 ?›å»ºï¼ˆé˜¶æ®?8ï¼? */
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
    const begin = /^=== OC SETUP: (.+) ===$/.exec(line);
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
