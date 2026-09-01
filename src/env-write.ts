/**
 * env-write.ts —— .env 读取/幂等写入助手（阶段 15）
 *
 * 职责：readEnvValue（按 KEY= 读取）；upsertEnv（存在则改、缺失则追加，写后 0600）。
 *       供 scripts/setup.ts 向导与 modules/chat-commands.ts 的 /setup 命令复用。
 * 关键导出：readEnvValue, upsertEnv, maskKey
 * 承重不变量：密钥只落 .env 文件，不回显明文、不进 process.argv。
 * 借鉴：nanoclaw setup/set-env.ts 的 set-if-absent 语义（此处升级为 upsert）。
 *
 * 修改记录：2026-09-01 创建（阶段 15：chat 斜杠命令 + onboarding）
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { ENV_PATH } from "./config.js";

export function readEnvValue(key: string): string | null {
  if (!existsSync(ENV_PATH)) return null;
  for (const l of readFileSync(ENV_PATH, "utf8").split(/\r?\n/)) {
    if (l.startsWith(`${key}=`)) return l.slice(key.length + 1).trim();
  }
  return null;
}

/** 存在则覆盖、缺失则追加；写后尽量 0600（win32 忽略） */
export function upsertEnv(kv: Record<string, string>): void {
  let lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  if (lines.length === 1 && lines[0] === "") lines = [];
  const remaining = new Set(Object.keys(kv));
  const out = lines.map((l) => {
    const eq = l.indexOf("=");
    if (eq > 0) {
      const key = l.slice(0, eq).trim();
      if (key in kv) {
        remaining.delete(key);
        return `${key}=${kv[key]}`;
      }
    }
    return l;
  });
  for (const k of remaining) out.push(`${k}=${kv[k]}`);
  writeFileSync(ENV_PATH, out.join("\n") + "\n");
  try {
    chmodSync(ENV_PATH, 0o600);
  } catch {
    /* win32 忽略 */
  }
}

export function maskKey(v: string | null): string {
  if (!v) return "(未设置)";
  return v.length <= 8 ? "***" : `${v.slice(0, 6)}…***`;
}
/*
 * 修改记录：2026-09-01 创建（阶段 15：chat 斜杠命令 + onboarding）
 */
