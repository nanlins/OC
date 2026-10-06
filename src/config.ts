/**
 * config.ts —— 主机配置常量（加载期一次性求值）
 *
 * 职责：路径/镜像/资源限额/出口封锁/时区/provider 默认；.env 优先、process.env 兜底。
 * 关键导出：DATA_DIR, GROUPS_DIR, STORE_DIR, TEMPLATES_DIR, MOUNT_ALLOWLIST_PATH,
 *           CONTAINER_IMAGE, CONTAINER_CPU_LIMIT, CONTAINER_MEMORY_LIMIT, CONTAINER_PIDS_LIMIT,
 *           EGRESS_LOCKDOWN, EGRESS_NETWORK, TIMEZONE, DEFAULT_AGENT_PROVIDER, WEB_PORT, WEB_HOST,
 *           ENV_PATH, LLM_PROXY_HOST, LLM_PROXY_PORT, LLM_PROXY_TRUSTED_CIDRS
 * 承重不变量：MOUNT_ALLOWLIST_PATH 在项目根之外（防容器自改规则）；秘密经 readEnvFile 白名单读取。
 * 借鉴：nanoclaw src/config.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 *   2026-08-13 阶段 14：OC_LOCALE 纳入 .env 白名单并导出（P1-1 修复）
 *   2026-09-16 新增 WEB_HOST（默认 127.0.0.1，保持 fail-closed）：容器化部署需绑 0.0.0.0，
 *              否则发布端口从宿主不可达；纳入 .env 白名单
 *   2026-09-16 GROUPS_DIR 改为可经 OC_GROUPS_DIR 覆盖：容器化部署时该路径会被原样交给
 *              `docker run -v`，由宿主 daemon 解析，必须是宿主绝对路径而非容器内路径
 *   2026-10-06 P0-2：新增 LLM_PROXY_HOST（默认 127.0.0.1）与 LLM_PROXY_TRUSTED_CIDRS
 *              （默认回环 + Docker 网桥，不再整段信任 172.16.0.0/12）；ANTHROPIC_BASE_URL 入白名单
 *   2026-10-06 T1-1：新增 LLM_PROXY_PORT（OC_LLM_PROXY_PORT，默认 8081，非法值回落）——
 *              本机 8081 被 com.docker.backend/wslrelay 占用，端口不可配会让代理起不来；
 *              并按实测更正 LLM_PROXY_HOST 注释（Docker Desktop 下回环绑定容器可达）
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
    "WEB_HOST", // 容器化部署需绑 0.0.0.0，否则发布端口从宿主不可达
    "WEB_TOKEN", // P1 修复（se-inspector）：.env 配置不得被静默忽略
    "OC_LOCALE", // 阶段 14 P1-1 修复（se-inspector）：i18n locale 纳入 .env 白名单
    "OC_DATA_DIR",
    "OC_GROUPS_DIR", // 容器化部署需指向宿主绝对路径（见 GROUPS_DIR 注释）
    "OC_LLM_PROXY_HOST", // P0-2：代理监听地址（默认 127.0.0.1）
    "OC_LLM_PROXY_PORT", // T1-1：代理监听端口（默认 8081，被占用时可覆盖）
    "OC_LLM_PROXY_TRUSTED_CIDRS", // P0-2：受信来源网段白名单（逗号分隔 CIDR）
    "ANTHROPIC_BASE_URL", // P0-2：claude 走代理时的上游地址
  ],
  ENV_PATH,
);

const pick = (key: string, fallback: string): string => env[key] ?? process.env[key] ?? fallback;

export const APP_ENV = pick("APP_ENV", "dev");

export const DATA_DIR = pick("OC_DATA_DIR", join(PROJECT_ROOT, "data"));
/**
 * Agent 组工作区根。可用 OC_GROUPS_DIR 覆盖——容器化部署时**必须**覆盖成宿主上的绝对路径：
 * 这个路径会被原样交给 `docker run -v <hostPath>:...`，由**宿主上的 daemon** 解析，
 * 而不是由主机进程所在容器解析。若沿用容器内路径，daemon 会在宿主上自动创建空目录，
 * Agent 拿到空 workspace（没有 CLAUDE.md / memory / container.json）而静默失效。
 */
export const GROUPS_DIR = pick("OC_GROUPS_DIR", join(PROJECT_ROOT, "groups"));
/** 会话双 DB 存放根：data/v2-sessions/<agent_group_id>/<session_id>/ */
export const STORE_DIR = join(DATA_DIR, "v2-sessions");
export const TEMPLATES_DIR = join(PROJECT_ROOT, "templates");
export const CENTRAL_DB_PATH = join(DATA_DIR, "v2.db");

/** 挂载白名单在项目根之外——容器与 agent 均不可达（借鉴 nanoclaw 安全设计） */
export const MOUNT_ALLOWLIST_PATH = join(homedir(), ".config", "oc", "mount-allowlist.json");

export const INSTALL_SLUG = getInstallSlug(PROJECT_ROOT);
export const CONTAINER_IMAGE_BASE = getInstallSlug(PROJECT_ROOT) ? `oc-agent-${INSTALL_SLUG}` : "oc-agent";
export const CONTAINER_IMAGE = getDefaultContainerImage(INSTALL_SLUG);
/** 容器 label：孤儿清理只收本安装（作用域隔离） */
export const CONTAINER_INSTALL_LABEL = `org.oc.install=${INSTALL_SLUG}`;

export const CONTAINER_CPU_LIMIT = pick("CONTAINER_CPU_LIMIT", "1");
export const CONTAINER_MEMORY_LIMIT = pick("CONTAINER_MEMORY_LIMIT", "1g");
export const CONTAINER_PIDS_LIMIT = pick("CONTAINER_PIDS_LIMIT", "100");

export const EGRESS_LOCKDOWN = pick("EGRESS_LOCKDOWN", "false") === "true";
export const EGRESS_NETWORK = pick("EGRESS_NETWORK", "oc-egress");

export const TIMEZONE = resolveTimezone([env["TZ"], process.env["TZ"]]);

export const DEFAULT_AGENT_PROVIDER = pick("DEFAULT_AGENT_PROVIDER", "claude");

export const WEB_PORT = Number(pick("WEB_PORT", "8080"));
/**
 * Web 控制台监听地址。默认 127.0.0.1（fail-closed：只有本机可达）。
 * 容器化部署必须显式设成 0.0.0.0，否则服务只绑定容器内回环，发布的端口从宿主不可达。
 * 设成 0.0.0.0 时的实际暴露面：/api/* 与 /events 仍受 authorized() 保护（未配 WEB_TOKEN 时
 * 按 remoteAddress 只放行回环，非回环一律 401，见 web/api.ts:69-83）；但静态前端外壳
 * （index.html/app.js/style.css）不经鉴权，会对全网可达。生产暴露请同时配置 WEB_TOKEN
 * 并置于反向代理之后。
 */
export const WEB_HOST = pick("WEB_HOST", "127.0.0.1");
/** 可选 Bearer token；未设置 = 本机信任（文档声明） */
export const WEB_TOKEN = env["WEB_TOKEN"] ?? process.env["WEB_TOKEN"] ?? "";

/** 宿主侧 i18n locale（zh/en/ja）；.env 优先、process.env 兜底；空 = 由 i18n 取默认 en */
export const OC_LOCALE = pick("OC_LOCALE", "");

/**
 * LLM 密钥代理监听地址（P0-2）。默认 127.0.0.1 —— fail-closed：只有本机能连。
 *
 * 容器可达性按平台而定（T1-1 实测，Windows Docker Desktop 29.8.1）：
 *   - Docker Desktop（win32/darwin）：容器经 host.docker.internal 访问，WSL/VPNKit relay
 *     会在**宿主回环上重新发起**连接，实测到达时 remoteAddress=127.0.0.1。所以默认的回环
 *     绑定容器就能连通，无需放宽；绑 0.0.0.0 表现相同却额外把端口暴露给局域网，纯亏。
 *   - 原生 Linux Docker：容器经 docker0 网关（172.17.0.1）访问宿主，回环绑定**不可达**，
 *     需显式设 OC_LLM_PROXY_HOST=172.17.0.1（或 0.0.0.0 并靠 CIDR 白名单收窄）。
 * startLlmProxy 只在 linux 上就此打 WARN，不再对所有平台误报。
 */
export const LLM_PROXY_HOST = pick("OC_LLM_PROXY_HOST", "127.0.0.1");

/**
 * LLM 密钥代理监听端口（T1-1）。默认 8081 保持向后兼容，但**必须可覆盖**：
 * 8081 是常见抢占目标——本机实测被 Docker Desktop 的 com.docker.backend（`::` 全接口）
 * 与 wslrelay（`::1`）占用，代理会 EADDRINUSE/EACCES 起不来，而 openai/claude 两个
 * provider 都依赖它注入密钥，端口冲突会让整条 LLM 链路静默失效。
 * 非法/越界值回落默认端口（配置错误不得让主机起不来）。
 */
function resolveProxyPort(raw: string | undefined): number {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < 1 || n > 65535) return 8081;
  return n;
}
export const LLM_PROXY_PORT = resolveProxyPort(pick("OC_LLM_PROXY_PORT", ""));

/**
 * 代理受信来源网段（逗号分隔 CIDR）。默认只含回环 + Docker 默认网桥 + Docker Desktop 内网桥，
 * 不再整段信任 172.16.0.0/12（P0-2）：那是覆盖 100 万个地址的私网段，企业网/VPN 里的
 * 无关主机同样落在其中，等于把主机 API 密钥开放给整个内网。
 * compose 自建网络（常见 172.18+/192.168.x）请显式追加。
 */
export const LLM_PROXY_TRUSTED_CIDRS = pick("OC_LLM_PROXY_TRUSTED_CIDRS", "127.0.0.0/8,172.17.0.0/16,192.168.65.0/24");
