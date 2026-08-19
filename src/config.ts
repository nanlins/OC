/**
 * config.ts ?”â€?ä¸»æœº?ç½®å¸¸é?ï¼ˆå?è½½æ?ä¸€æ¬¡æ€§æ??¼ï?
 *
 * ?Œè´£ï¼šè·¯å¾??œå?/èµ„æ??é?/?ºå£å°é?/?¶åŒº/provider é»˜è®¤ï¼?env ä¼˜å??process.env ?œå??? * ?³é”®å¯¼å‡ºï¼šDATA_DIR, GROUPS_DIR, STORE_DIR, TEMPLATES_DIR, MOUNT_ALLOWLIST_PATH,
 *           CONTAINER_IMAGE, CONTAINER_CPU_LIMIT, CONTAINER_MEMORY_LIMIT, CONTAINER_PIDS_LIMIT,
 *           EGRESS_LOCKDOWN, EGRESS_NETWORK, TIMEZONE, DEFAULT_AGENT_PROVIDER, WEB_PORT, ENV_PATH
 * ?¿é?ä¸å??ï?MOUNT_ALLOWLIST_PATH ?¨é¡¹?®æ ¹ä¹‹å?ï¼ˆé˜²å®¹å™¨?ªæ”¹è§„å?ï¼‰ï?ç§˜å?ç»?readEnvFile ?½å??•è¯»?–ã€? * ?Ÿé‰´ï¼šnanoclaw src/config.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?2ï¼? *   2026-08-13 ?¶æ®µ 14ï¼šOC_LOCALE çº³å…¥ .env ?½å??•å¹¶å¯¼å‡ºï¼ˆP1-1 ä¿®å?ï¼? */
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvFile } from "./env.js";
import { getInstallSlug, getDefaultContainerImage } from "./install-slug.js";
import { resolveTimezone } from "./timezone.js";

/** é¡¹ç›®?¹ï?src/ ?„çˆ¶?®å?ï¼?*/
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
    "WEB_TOKEN", // P1 ä¿®å?ï¼ˆse-inspectorï¼‰ï?.env ?ç½®ä¸å?è¢«é?é»˜å¿½??    "OC_LOCALE", // ?¶æ®µ 14 P1-1 ä¿®å?ï¼ˆse-inspectorï¼‰ï?i18n locale çº³å…¥ .env ?½å???    "OC_DATA_DIR",
  ],
  ENV_PATH,
);

const pick = (key: string, fallback: string): string => env[key] ?? process.env[key] ?? fallback;

export const APP_ENV = pick("APP_ENV", "dev");

export const DATA_DIR = pick("OC_DATA_DIR", join(PROJECT_ROOT, "data"));
export const GROUPS_DIR = join(PROJECT_ROOT, "groups");
/** ä¼šè???DB å­˜æ”¾?¹ï?data/v2-sessions/<agent_group_id>/<session_id>/ */
export const STORE_DIR = join(DATA_DIR, "v2-sessions");
export const TEMPLATES_DIR = join(PROJECT_ROOT, "templates");
export const CENTRAL_DB_PATH = join(DATA_DIR, "v2.db");

/** ?‚è½½?½å??•åœ¨é¡¹ç›®?¹ä?å¤–â€”â€”å®¹?¨ä? agent ?‡ä??¯è¾¾ï¼ˆå€Ÿé‰´ nanoclaw å®‰å…¨è®¾è®¡ï¼?*/
export const MOUNT_ALLOWLIST_PATH = join(homedir(), ".config", "OC", "mount-allowlist.json");

export const INSTALL_SLUG = getInstallSlug(PROJECT_ROOT);
export const CONTAINER_IMAGE_BASE = getInstallSlug(PROJECT_ROOT) ? `OC-agent-${INSTALL_SLUG}` : "OC-agent";
export const CONTAINER_IMAGE = getDefaultContainerImage(INSTALL_SLUG);
/** å®¹å™¨ labelï¼šå­¤?¿æ??†åª?¶æœ¬å®‰è?ï¼ˆä??¨å??”ç¦»ï¼?*/
export const CONTAINER_INSTALL_LABEL = `org.OC.install=${INSTALL_SLUG}`;

export const CONTAINER_CPU_LIMIT = pick("CONTAINER_CPU_LIMIT", "1");
export const CONTAINER_MEMORY_LIMIT = pick("CONTAINER_MEMORY_LIMIT", "1g");
export const CONTAINER_PIDS_LIMIT = pick("CONTAINER_PIDS_LIMIT", "100");

export const EGRESS_LOCKDOWN = pick("EGRESS_LOCKDOWN", "false") === "true";
export const EGRESS_NETWORK = pick("EGRESS_NETWORK", "OC-egress");

export const TIMEZONE = resolveTimezone([env["TZ"], process.env["TZ"]]);

export const DEFAULT_AGENT_PROVIDER = pick("DEFAULT_AGENT_PROVIDER", "claude");

export const WEB_PORT = Number(pick("WEB_PORT", "8080"));
/** ?¯é€?Bearer tokenï¼›æœªè®¾ç½® = ?¬æœºä¿¡ä»»ï¼ˆæ?æ¡?£°?ï? */
export const WEB_TOKEN = env["WEB_TOKEN"] ?? process.env["WEB_TOKEN"] ?? "";

/** å®¿ä¸»ä¾?i18n localeï¼ˆzh/en/jaï¼‰ï?.env ä¼˜å??process.env ?œå?ï¼›ç©º = ??i18n ?–é?è®?en */
export const OC_LOCALE = pick("OC_LOCALE", "");
