/**
 * config.ts —— 主机配置常量（加载期一次性求值）
 *
 * 职责：路径/镜像/资源限额/出口封锁/时区/provider 默认；.env 优先、process.env 兜底。
 * 关键导出：DATA_DIR, GROUPS_DIR, STORE_DIR, TEMPLATES_DIR, MOUNT_ALLOWLIST_PATH,
 *           CONTAINER_IMAGE, CONTAINER_CPU_LIMIT, CONTAINER_MEMORY_LIMIT, CONTAINER_PIDS_LIMIT,
 *           EGRESS_LOCKDOWN, EGRESS_NETWORK, TIMEZONE, DEFAULT_AGENT_PROVIDER, WEB_PORT, ENV_PATH
 * 承重不变量：MOUNT_ALLOWLIST_PATH 在项目根之外（防容器自改规则）；秘密经 readEnvFile 白名单读取。
 * 借鉴：nanoclaw src/config.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 *   2026-08-13 阶段 14：OC_LOCALE 纳入 .env 白名单并导出（P1-1 修复）
 */
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "./env.js";
import { getInstallSlug, getDefaultContainerImage } from "./install-slug.js";
import { resolveTimezone } from "./timezone.js";

/** 项目根（src/ 的父目录） */
export const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const ENV_PATH = join(PROJECT_ROOT, ".env");

const env = readEnvFile(
  [
    "APP_ENV",
    "TZ",
    "DEFAULT_AGENT_PROVIDER",
    "CONTAINER_CPU_LIMIT",
    "CONTAINER_MEMORY_LIMIT",
    "CONTAINER_PIDS_LIMIT",
    "EGRESS_LOCKDOWN",
    "EGRESS_NETWORK",
    "WEB_PORT",
    "WEB_TOKEN", // P1 修复（se-inspector）：.env 配置不得被静默忽略
    "OC_LOCALE", // 阶段 14 P1-1 修复（se-inspector）：i18n locale 纳入 .env 白名单
    "OPENCLAW_DATA_DIR",
  ],
  ENV_PATH,
);

const pick = (key: string, fallback: string): string => env[key] ?? process.env[key] ?? fallback;

export const APP_ENV = pick("APP_ENV", "dev");

export const DATA_DIR = pick("OPENCLAW_DATA_DIR", join(PROJECT_ROOT, "data"));
export const GROUPS_DIR = join(PROJECT_ROOT, "groups");
/** 会话双 DB 存放根：data/v2-sessions/<agent_group_id>/<session_id>/ */
export const STORE_DIR = join(DATA_DIR, "v2-sessions");
export const TEMPLATES_DIR = join(PROJECT_ROOT, "templates");
export const CENTRAL_DB_PATH = join(DATA_DIR, "v2.db");

/** 挂载白名单在项目根之外——容器与 agent 均不可达（借鉴 nanoclaw 安全设计） */
export const MOUNT_ALLOWLIST_PATH = join(homedir(), ".config", "openclaw", "mount-allowlist.json");

export const INSTALL_SLUG = getInstallSlug(PROJECT_ROOT);
export const CONTAINER_IMAGE_BASE = getInstallSlug(PROJECT_ROOT) ? `openclaw-agent-${INSTALL_SLUG}` : "openclaw-agent";
export const CONTAINER_IMAGE = getDefaultContainerImage(INSTALL_SLUG);
/** 容器 label：孤儿清理只收本安装（作用域隔离） */
export const CONTAINER_INSTALL_LABEL = `org.openclaw.install=${INSTALL_SLUG}`;

export const CONTAINER_CPU_LIMIT = pick("CONTAINER_CPU_LIMIT", "1");
export const CONTAINER_MEMORY_LIMIT = pick("CONTAINER_MEMORY_LIMIT", "1g");
export const CONTAINER_PIDS_LIMIT = pick("CONTAINER_PIDS_LIMIT", "100");

export const EGRESS_LOCKDOWN = pick("EGRESS_LOCKDOWN", "false") === "true";
export const EGRESS_NETWORK = pick("EGRESS_NETWORK", "openclaw-egress");

export const TIMEZONE = resolveTimezone([env["TZ"], process.env["TZ"]]);

export const DEFAULT_AGENT_PROVIDER = pick("DEFAULT_AGENT_PROVIDER", "claude");

export const WEB_PORT = Number(pick("WEB_PORT", "8080"));
/** 可选 Bearer token；未设置 = 本机信任（文档声明） */
export const WEB_TOKEN = env["WEB_TOKEN"] ?? process.env["WEB_TOKEN"] ?? "";

/** 宿主侧 i18n locale（zh/en/ja）；.env 优先、process.env 兜底；空 = 由 i18n 取默认 en */
export const OC_LOCALE = pick("OC_LOCALE", "");
