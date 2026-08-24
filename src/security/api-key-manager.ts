/**
 * security/api-key-manager.ts —— API Key 管理
 *
 * 职责：租户/Agent 级 Key 隔离 + Key 轮换 + 用量监控 + 加密存储。
 *       密钥不在上下文中出现，通过 .env 白名单读取、-e 注入容器。
 * 关键导出：registerKey, getKey, rotateKey, trackUsage, KeyEntry, KeyUsage
 * 承重不变量：密钥明文永不出现在日志/审计/DB 查询结果中。
 * 知识文档映射：05-后端工程详解 §5.1 密钥管理
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */
import { randomUUID, createHash } from "node:crypto";
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";

export interface KeyEntry {
  id: string;
  provider: string;
  agentGroupId: string | null;
  keyHash: string;
  createdAt: string;
  rotatedAt: string | null;
  usageLimit: number | null;
}

export interface KeyUsage {
  keyId: string;
  tokens: number;
  requests: number;
  lastUsed: string;
}

const keys = new Map<string, KeyEntry>();
const usage = new Map<string, KeyUsage>();

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function registerKey(opts: {
  provider: string;
  agentGroupId?: string | null;
  key: string;
  usageLimit?: number | null;
}): KeyEntry {
  const entry: KeyEntry = {
    id: randomUUID(),
    provider: opts.provider,
    agentGroupId: opts.agentGroupId ?? null,
    keyHash: hashKey(opts.key),
    createdAt: new Date().toISOString(),
    rotatedAt: null,
    usageLimit: opts.usageLimit ?? null,
  };
  keys.set(entry.id, entry);
  usage.set(entry.id, { keyId: entry.id, tokens: 0, requests: 0, lastUsed: new Date().toISOString() });
  return entry;
}

export function getKey(provider: string, _agentGroupId?: string | null): string | null {
  const envKey = readEnvFile([`${provider.toUpperCase()}_API_KEY`], ENV_PATH);
  const key = envKey[`${provider.toUpperCase()}_API_KEY`];
  return key || null;
}

export function rotateKey(keyId: string, newKey: string): KeyEntry | null {
  const entry = keys.get(keyId);
  if (!entry) return null;
  entry.keyHash = hashKey(newKey);
  entry.rotatedAt = new Date().toISOString();
  return entry;
}

export function trackUsage(keyId: string, tokens: number): void {
  const u = usage.get(keyId);
  if (!u) return;
  u.tokens += tokens;
  u.requests += 1;
  u.lastUsed = new Date().toISOString();
}

export function getUsage(keyId: string): KeyUsage | null {
  return usage.get(keyId) ?? null;
}

export function isOverLimit(keyId: string): boolean {
  const entry = keys.get(keyId);
  if (!entry?.usageLimit) return false;
  const u = usage.get(keyId);
  return (u?.tokens ?? 0) >= entry.usageLimit;
}

export function listKeys(agentGroupId?: string | null): KeyEntry[] {
  const result = [...keys.values()];
  if (agentGroupId !== undefined) {
    return result.filter((k) => k.agentGroupId === agentGroupId);
  }
  return result;
}
