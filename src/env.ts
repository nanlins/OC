/**
 * env.ts —— .env 白名单读取（秘密不进 process.env）
 *
 * 职责：解析项目根 .env，仅返回白名单 key 的值；刻意不写入 process.env
 *       （容器 spawn 会继承环境，秘密泄漏面最小化，借鉴 nanoclaw src/env.ts）。
 * 关键导出：readEnvFile
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { readFileSync, existsSync } from "node:fs";
import { log } from "./log.js";

/** 读取 .env 中指定 key（支持引号剥离）；文件不存在返回空映射 */
export function readEnvFile(keys: string[], envPath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(envPath)) return out;
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch (err) {
    log.warn("env file unreadable", { err });
    return out;
  }
  const wanted = new Set(keys);
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!wanted.has(key)) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!val) continue; // P1 修复：空值击穿回退链（对齐基线 env.ts:38 的 if (value) 过滤）
    out[key] = val;
  }
  return out;
}
