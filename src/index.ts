/**
 * index.ts —— 主机主入口（单进程编排器）
 *
 * 职责：严格编号启动序列 + 逆序优雅关停。
 *   0 熔断退避 → 1 中央 DB+迁移 → 2 通道适配器初始化 → 3 主机模块启动
 *   →（投递轮询/巡检/CLI 由后续阶段经 host-lifecycle 注册接入）
 * 关键导出：main
 * 承重不变量：关停逆序 + finally 必重置熔断器（SIGTERM 到达即非崩溃）。
 * 借鉴：nanoclaw src/index.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 0 骨架）
 *   2026-08-12 阶段 2：完整启动编排（DB/迁移/通道/模块/关停）；清理中部 import
 */
import { mkdirSync } from "node:fs";
import { basename } from "node:path";
import { DATA_DIR, CENTRAL_DB_PATH } from "./config.js";
import { log } from "./log.js";
import { enforceStartupBackoff, resetCircuitBreaker } from "./circuit-breaker.js";
import { initDb, closeDb, getDb } from "./db/connection.js";
import { runMigrations } from "./db/migrations/index.js";
import { migration001 } from "./db/migrations/001-initial.js";
import { startHostModules, stopHostModules } from "./host-lifecycle.js";
import { initChannelAdapters, teardownChannelAdapters } from "./channels/channel-registry.js";
import { wakeContainer } from "./container-runner.js";
import { cleanupOrphans } from "./container-runtime.js";
import { routeInbound, setContainerWaker } from "./router.js";
import "./channels/index.js"; // 副作用 barrel：内置通道自注册（阶段 5 填充）
import "./providers/index.js"; // 副作用 barrel：provider 容器贡献（密钥 -e 透传，收束期补）
import "./modules/index.js"; // 副作用 barrel：模块钩子自注册（阶段 6 填充）
import "./host-sweep.js"; // 副作用：巡检注册到 host-lifecycle（阶段 3）
import "./delivery.js"; // 副作用：投递轮询注册到 host-lifecycle（阶段 5，P0 修复）
import "./cli/socket-server.js"; // 副作用：CLI 控制 socket 注册到 host-lifecycle（阶段 7）
import "./web/server.js"; // 副作用：Web 管理控制台注册到 host-lifecycle（阶段 9）

export async function main(): Promise<void> {
  // 0. 熔断退避（运行在 initDb 之前）
  await enforceStartupBackoff(DATA_DIR);

  let graceful = false;
  try {
    // 1. 中央 DB + 迁移
    mkdirSync(DATA_DIR, { recursive: true });
    initDb(CENTRAL_DB_PATH);
    runMigrations(getDb(), [migration001]);
    log.info("central db ready");

    // fix-plan P1：启动清理上一运行遗留的本安装孤儿容器（无活动会话，live 集合为空）
    try {
      cleanupOrphans(new Set());
    } catch (err) {
      log.warn("startup orphan cleanup failed", { err });
    }

    // 2. 通道适配器（instance 戳印接缝：适配器保持实例盲，主机在 onInbound 戳 instance）
    // fix-plan P1：入站异步统一错误边界——routeInbound 拒绝只记日志，绝不致主机退出
    await initChannelAdapters((adapter) => ({
      onInbound: (platformId, threadId, message) => {
        void routeInbound({
          channelType: adapter.channelType,
          instance: adapter.instance ?? adapter.channelType,
          platformId,
          threadId,
          message,
        }).catch((err) => log.error("routeInbound failed", { err, channelType: adapter.channelType, platformId }));
      },
      onInboundEvent: (event) => {
        void routeInbound({ ...event, instance: event.instance ?? adapter.instance ?? adapter.channelType }).catch(
          (err) => log.error("routeInbound failed", { err, channelType: adapter.channelType }),
        );
      },
      onMetadata: () => {},
      onAction: () => {}, // interactive 模块阶段 6 接入
    }));

    // 2.5 容器唤醒钩子注入路由（阶段 3）
    setContainerWaker((session) => wakeContainer(session));

    // 3. 主机模块（host-sweep 经 barrel 注册；投递/CLI 后续阶段）
    await startHostModules();

    log.info("openclaw host started", { pid: process.pid });

    await waitForShutdownSignal();
    graceful = true; // 仅信号路径视为优雅关停（P0 修复：崩溃路径保留熔断状态）
  } finally {
    // 逆序关停：模块 → 通道 → 孤儿容器清理 → （优雅时）熔断器重置 → DB
    try {
      await stopHostModules();
      await teardownChannelAdapters();
      // fix-plan P1：关停时同步清理本安装遗留容器（会话已停，live 集合为空）
      try {
        cleanupOrphans(new Set());
      } catch (err) {
        log.warn("shutdown orphan cleanup failed", { err });
      }
    } finally {
      if (graceful) resetCircuitBreaker(DATA_DIR); // SIGTERM/SIGINT 到达即非崩溃；启动崩溃保留退避
      closeDb();
      log.info("openclaw host stopped", { graceful });
    }
  }
}

function waitForShutdownSignal(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = () => {
      log.info("shutdown signal received");
      resolve();
    };
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
  });
}

const entry = process.argv[1] ? basename(process.argv[1]) : "";
if ((entry === "index.ts" || entry === "index.js") && process.env.VITEST !== "true") {
  main().catch((err) => {
    log.fatal("host crashed", { err });
    process.exit(1);
  });
}
