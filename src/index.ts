/**
 * index.ts ?”â€?ä¸»æœºä¸»å…¥????•è?ç¨‹ç??’å™¨ï¼? *
 * ?Œè´£ï¼šä¸¥?¼ç??·å¯?¨å???+ ?†å?ä¼˜é??³å??? *   0 ?”æ–­?€????1 ä¸­å¤® DB+è¿ç§» ??2 ?šé??‚é??¨å?å§‹å? ??3 ä¸»æœºæ¨¡å??¯åŠ¨
 *   ?’ï??•é€’è½®è¯?å·¡æ?/CLI ?±å?ç»­é˜¶æ®µç? host-lifecycle æ³¨å??¥å…¥ï¼? * ?³é”®å¯¼å‡ºï¼šmain
 * ?¿é?ä¸å??ï??³å??†å? + finally å¿…é?ç½®ç??­å™¨ï¼ˆSIGTERM ?°è¾¾?³é?å´©æ?ï¼‰ã€? * ?Ÿé‰´ï¼šnanoclaw src/index.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?0 éª¨æ¶ï¼? *   2026-08-12 ?¶æ®µ 2ï¼šå??´å¯?¨ç??’ï?DB/è¿ç§»/?šé?/æ¨¡å?/?³å?ï¼‰ï?æ¸…ç?ä¸­éƒ¨ import
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
import "./channels/index.js"; // ?¯ä???barrelï¼šå?ç½®é€šé??ªæ³¨?Œï??¶æ®µ 5 å¡«å?ï¼?import "./providers/index.js"; // ?¯ä???barrelï¼šprovider å®¹å™¨è´¡çŒ®ï¼ˆå???-e ?ä?ï¼Œæ”¶?Ÿæ?è¡¥ï?
import "./modules/index.js"; // ?¯ä???barrelï¼šæ¨¡?—é’©å­è‡ªæ³¨å?ï¼ˆé˜¶æ®?6 å¡«å?ï¼?import "./host-sweep.js"; // ?¯ä??¨ï?å·¡æ?æ³¨å???host-lifecycleï¼ˆé˜¶æ®?3ï¼?import "./delivery.js"; // ?¯ä??¨ï??•é€’è½®è¯¢æ³¨?Œåˆ° host-lifecycleï¼ˆé˜¶æ®?5ï¼ŒP0 ä¿®å?ï¼?import "./cli/socket-server.js"; // ?¯ä??¨ï?CLI ?§åˆ¶ socket æ³¨å???host-lifecycleï¼ˆé˜¶æ®?7ï¼?import "./web/server.js"; // ?¯ä??¨ï?Web ç®¡ç??§åˆ¶?°æ³¨?Œåˆ° host-lifecycleï¼ˆé˜¶æ®?9ï¼?
export async function main(): Promise<void> {
  // 0. ?”æ–­?€?¿ï?è¿è???initDb ä¹‹å?ï¼?  await enforceStartupBackoff(DATA_DIR);

  let graceful = false;
  try {
    // 1. ä¸­å¤® DB + è¿ç§»
    mkdirSync(DATA_DIR, { recursive: true });
    initDb(CENTRAL_DB_PATH);
    runMigrations(getDb(), [migration001]);
    log.info("central db ready");

    // fix-plan P1ï¼šå¯?¨æ??†ä?ä¸€è¿è??—ç??„æœ¬å®‰è?å­¤å„¿å®¹å™¨ï¼ˆæ?æ´»åŠ¨ä¼šè?ï¼Œlive ?†å?ä¸ºç©ºï¼?    try {
      cleanupOrphans(new Set());
    } catch (err) {
      log.warn("startup orphan cleanup failed", { err });
    }

    // 2. ?šé??‚é??¨ï?instance ?³å°?¥ç?ï¼šé€‚é??¨ä??å?ä¾‹ç›²ï¼Œä¸»?ºåœ¨ onInbound ??instanceï¼?    // fix-plan P1ï¼šå…¥ç«™å?æ­¥ç?ä¸€?™è¯¯è¾¹ç??”â€”routeInbound ?’ç??ªè®°?¥å?ï¼Œç?ä¸è‡´ä¸»æœº?€??    await initChannelAdapters((adapter) => ({
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
      onAction: () => {}, // interactive æ¨¡å??¶æ®µ 6 ?¥å…¥
    }));

    // 2.5 å®¹å™¨?¤é??©å?æ³¨å…¥è·¯ç”±ï¼ˆé˜¶æ®?3ï¼?    setContainerWaker((session) => wakeContainer(session));

    // 3. ä¸»æœºæ¨¡å?ï¼ˆhost-sweep ç»?barrel æ³¨å?ï¼›æ???CLI ?ç»­?¶æ®µï¼?    await startHostModules();

    log.info("OC host started", { pid: process.pid });

    await waitForShutdownSignal();
    graceful = true; // ä»…ä¿¡?·è·¯å¾„è?ä¸ºä??…å…³?œï?P0 ä¿®å?ï¼šå´©æºƒè·¯å¾„ä??™ç??­çŠ¶?ï?
  } finally {
    // ?†å??³å?ï¼šæ¨¡?????šé? ??å­¤å„¿å®¹å™¨æ¸…ç? ??ï¼ˆä??…æ—¶ï¼‰ç??­å™¨?ç½® ??DB
    try {
      await stopHostModules();
      await teardownChannelAdapters();
      // fix-plan P1ï¼šå…³?œæ—¶?Œæ­¥æ¸…ç??¬å?è£…é??™å®¹?¨ï?ä¼šè?å·²å?ï¼Œlive ?†å?ä¸ºç©ºï¼?      try {
        cleanupOrphans(new Set());
      } catch (err) {
        log.warn("shutdown orphan cleanup failed", { err });
      }
    } finally {
      if (graceful) resetCircuitBreaker(DATA_DIR); // SIGTERM/SIGINT ?°è¾¾?³é?å´©æ?ï¼›å¯?¨å´©æºƒä??™é€€??      closeDb();
      log.info("OC host stopped", { graceful });
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
