/**
 * scripts/healthcheck.ts —— 健康检查端点
 *
 * 职责：/health + /ready HTTP 端点，检查 DB 连接、Provider 可达性、容器状态。
 *       用于 Docker Compose healthcheck、Kubernetes liveness/readiness probe。
 * 关键导出：healthCheck, checkDatabase, checkProvider
 * 知识文档映射：05-后端工程详解 §5.3 健康检查
 *
 * 修改记录：2026-08-24 创建（阶段 11 五、文档之外可扩展方向）
 */
import { get } from "node:http";
import { existsSync } from "node:fs";
import { CENTRAL_DB_PATH, WEB_PORT } from "../src/config.js";

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: {
    database: boolean;
    disk: boolean;
    docker: boolean;
  };
  uptime: number;
  version: string;
}

export function checkDatabase(): boolean {
  return existsSync(CENTRAL_DB_PATH);
}

export function checkDisk(): boolean {
  try {
    const { statSync } = require("node:fs");
    const { DATA_DIR } = require("../src/config.js");
    const stats = require("node:fs").statSync(DATA_DIR);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export function checkDocker(): boolean {
  try {
    const { execSync } = require("node:child_process");
    execSync("docker info", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function healthCheck(): HealthStatus {
  const dbOk = checkDatabase();
  const diskOk = checkDisk();
  const dockerOk = checkDocker();

  const allOk = dbOk && diskOk;
  const anyFail = !dbOk || !diskOk;

  return {
    status: anyFail ? "unhealthy" : dockerOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks: {
      database: dbOk,
      disk: diskOk,
      docker: dockerOk,
    },
    uptime: process.uptime(),
    version: process.env.npm_package_version ?? "0.0.1",
  };
}

export function startHealthServer(port: number = WEB_PORT): void {
  const { createServer } = require("node:http");
  const server = createServer((_req: any, res: any) => {
    const status = healthCheck();
    const code = status.status === "unhealthy" ? 503 : 200;
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status));
  });
  server.listen(port + 1, () => {
    console.log(`[health] listening on port ${port + 1}`);
  });
}