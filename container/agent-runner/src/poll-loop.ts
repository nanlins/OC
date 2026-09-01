/**
 * poll-loop.ts —— 容器主循环（Agent Loop 承重核心）
 *
 * 职责：清 stale acks → 轮询 inbound → 累积门控 → markProcessing → 命令分流（/clear）→
 *       格式化 → provider.query（期间并发轮询 push 新消息）→ 写 messages_out → markCompleted。
 *       corruption 连续 10 次 → exit(75) 交宿主重启。
 * 关键导出：runPollLoop, isCorruptionError, PollLoopConfig
 * 承重不变量（借鉴 nanoclaw container/agent-runner/src/poll-loop.ts）：
 *   - trigger=0 累积门控冷热两处；on_wake 仅首轮（messages-in 层保证）；
 *   - result 到达即 ack 初始批；corruption 计数 10 次 → 停心跳 → exit(75)。
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-12 修复：循环尾 await sleep(0) 宏任务让渡（防纯同步 provider 微任务空转饿死定时器）
 *   2026-08-12 ai-inspector 修复：/clear 重置 continuation+历史；热路径 formatMessages；in_reply_to+clearCurrentInReplyTo；system 注入；批次日志
 *   2026-08-28 阶段 12 路径 B：systemPrompt 支持工厂（每轮求值），使 todo 清单跨消息刷新
 */
import { randomUUID } from "node:crypto";
import { log } from "./log-lite.ts";
import { formatMessages, extractRouting, isClearCommand } from "./formatter.ts";
import { getPendingMessages, markCompleted, markProcessing, type MessageInRow } from "./db/messages-in.ts";
import { writeMessageOut } from "./db/messages-out.ts";
import { clearStaleProcessingAcks, touchHeartbeat } from "./db/connection.ts";
import { setCurrentInReplyTo, clearCurrentInReplyTo, clearContinuation, clearHistory } from "./db/session-state.ts";
import type { AgentProvider } from "./providers/types.ts";

export interface PollLoopConfig {
  provider: AgentProvider;
  timezone: string;
  assistantName: string | null;
  maxMessages: number;
  /** 系统提示（目的地附录 + 记忆恒载），P1-1 修复注入 LLM；可为工厂以每轮重算（阶段 12：todo 跨消息刷新） */
  systemPrompt?: string | (() => string);
  signal?: AbortSignal;
  /** 测试注入：替代 process.exit */
  onCorruptionExit?: (code: number) => void;
  sleepMs?: { idle?: number; hot?: number };
  /** fix-plan 流式：edit 节流间隔（毫秒），测试可注入 0 */
  editThrottleMs?: number;
}

export function isCorruptionError(err: unknown): boolean {
  const msg = String(err);
  return /SQLITE_CORRUPT|database disk image is malformed|file is not a database/i.test(msg);
}

/** 阶段 12 实测修复：VirtioFS 概率性 disk I/O error——视为瞬态，短暂退避后重试而非 fatal */
export function isTransientIoError(err: unknown): boolean {
  const msg = String(err);
  return /disk I\/O error/i.test(msg);
}

const CORRUPTION_STREAK_MAX = 10;

/** fix-plan 流式增量投递：edit 节流间隔（毫秒） */
export const STREAM_EDIT_THROTTLE_MS = 400;

export async function runPollLoop(cfg: PollLoopConfig): Promise<void> {
  clearStaleProcessingAcks();
  let firstPoll = true;
  let corruptionStreak = 0;
  const idleMs = cfg.sleepMs?.idle ?? 1000;

  while (!cfg.signal?.aborted) {
    touchHeartbeat();
    let msgs: MessageInRow[];
    try {
      msgs = getPendingMessages({ isFirstPoll: firstPoll, max: cfg.maxMessages, nowIso: new Date().toISOString() });
      corruptionStreak = 0;
    } catch (err) {
      if (isCorruptionError(err)) {
        corruptionStreak += 1;
        log(`sqlite corruption streak ${corruptionStreak}`, "error");
        if (corruptionStreak >= CORRUPTION_STREAK_MAX) {
          // 停心跳让宿主 sweep 快速判死
          if (cfg.onCorruptionExit) cfg.onCorruptionExit(75);
          else process.exit(75);
        }
        await sleep(idleMs);
        continue;
      }
      // 阶段 12 实测修复：VirtioFS 概率性 disk I/O error 视为瞬态，重开连接退避重试（不 fatal）
      if (isTransientIoError(err)) {
        log(`transient io error, retrying poll: ${String(err)}`, "warn");
        const { closeOutboundDb } = await import("./db/connection.ts");
        closeOutboundDb();
        await sleep(idleMs * 2);
        continue;
      }
      throw err;
    }
    firstPoll = false;

    if (msgs.length === 0) {
      await sleep(idleMs);
      continue;
    }
    // 累积门控（冷批次）：全 trigger=0 → 不唤醒，保持 pending 等真触发捎带
    if (msgs.every((m) => m.trigger === 0)) {
      await sleep(idleMs);
      continue;
    }

    const ids = msgs.map((m) => m.id);
    markProcessing(ids);

    // 命令分流：/clear 重置 continuation + 历史，不走 LLM（P1-4 修复）
    if (msgs.some((m) => isClearCommand(m.content))) {
      clearContinuation(cfg.provider.name);
      clearHistory(cfg.provider.name);
      markCompleted(ids);
      continue;
    }

    const routing = extractRouting(msgs);
    setCurrentInReplyTo(msgs[msgs.length - 1]?.id ?? randomUUID());
    const prompt = formatMessages(msgs, { timezone: cfg.timezone, assistantName: cfg.assistantName });
    log(`batch picked: n=${ids.length} kinds=${msgs.map((m) => m.kind).join(",")}`);

    let resultText = "";
    let hadError = false;
    // fix-plan 流式增量投递：累积流式内容；首增量发首条消息，之后节流发 operation=edit（宿主据此更新同一条）
    let streamedContent = "";
    let liveMessageId: string | null = null;
    let lastEditAt = 0;
    // 热路径：查询期间并发轮询新 trigger=1 消息 → provider.push（累积门控同样适用）
    const hotTimer = setInterval(() => {
      try {
        const hot = getPendingMessages({ isFirstPoll: false, max: cfg.maxMessages, nowIso: new Date().toISOString() });
        const hotTrigger = hot.filter((m) => m.trigger === 1);
        if (hotTrigger.length === 0) return;
        markProcessing(hotTrigger.map((m) => m.id));
        // P1-5 修复：热路径同样走 formatMessages（XML 块 + internal 标签剥离）
        for (const m of hotTrigger) {
          cfg.provider.push(formatMessages([m], { timezone: cfg.timezone, assistantName: cfg.assistantName }));
        }
        markCompleted(hotTrigger.map((m) => m.id));
      } catch (err) {
        log(`hot poll failed: ${String(err)}`, "warn");
      }
    }, cfg.sleepMs?.hot ?? 500);

    try {
      // 阶段 12：系统提示可为工厂——每轮查询前求值，使 todo_write 更新的清单跨消息可见
      const system = typeof cfg.systemPrompt === "function" ? cfg.systemPrompt() : cfg.systemPrompt;
      for await (const ev of cfg.provider.query({ prompt, routing, system })) {
        if (ev.type === "activity") touchHeartbeat();
        if (ev.type === "progress") {
          // fix-plan 流式：首增量写首条消息，之后按节流写 edit（in_reply_to 指向首条，供宿主解析编辑目标）
          streamedContent += ev.message;
          const now = Date.now();
          if (liveMessageId === null) {
            liveMessageId = randomUUID();
            writeMessageOut({
              id: liveMessageId,
              kind: "chat",
              content: streamedContent,
              channelType: routing.channelType,
              platformId: routing.platformId,
              threadId: routing.threadId,
              inReplyTo: msgs[msgs.length - 1]?.id ?? null,
            });
            lastEditAt = now;
          } else if (now - lastEditAt >= (cfg.editThrottleMs ?? STREAM_EDIT_THROTTLE_MS)) {
            writeMessageOut({
              id: randomUUID(),
              kind: "chat",
              content: streamedContent,
              operation: "edit",
              channelType: routing.channelType,
              platformId: routing.platformId,
              threadId: routing.threadId,
              inReplyTo: liveMessageId,
            });
            lastEditAt = now;
          }
        }
        if (ev.type === "result") resultText = ev.text;
        if (ev.type === "error") {
          hadError = true;
          resultText = ev.message;
        }
      }
    } finally {
      clearInterval(hotTimer);
    }

    if (liveMessageId !== null) {
      // 已流式：补一条最终 edit（阶段 12：streamFinal 标记流式结束；恒写，即使内容与末次增量相同，
      // 保证 CLI 通道总能收到流结束信号立即冲刷，而非等 3s 时间窗口）
      const finalText = hadError ? `! ${resultText}` : resultText;
      writeMessageOut({
        id: randomUUID(),
        kind: "chat",
        content: finalText,
        operation: "edit",
        streamFinal: true,
        channelType: routing.channelType,
        platformId: routing.platformId,
        threadId: routing.threadId,
        inReplyTo: liveMessageId,
      });
    } else {
      // 非流式 provider：按原逻辑一次性写结果（本身即最终版）
      writeMessageOut({
        id: randomUUID(),
        kind: "chat",
        content: hadError ? `! ${resultText}` : resultText,
        streamFinal: true,
        channelType: routing.channelType,
        platformId: routing.platformId,
        threadId: routing.threadId,
        inReplyTo: msgs[msgs.length - 1]?.id ?? null, // P2-1 修复：主回复打 in_reply_to
      });
    }
    markCompleted(ids);
    clearCurrentInReplyTo(); // P2-1 修复：批次间不残留旧值
    // 宏任务让渡：provider 可能纯同步（Mock/本地），防止微任务空转饿死定时器（abort/hot poll）
    await sleep(0);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
