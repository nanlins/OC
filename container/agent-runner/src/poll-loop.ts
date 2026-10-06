/**
 * poll-loop.ts —— 容器主循环（Agent Loop 承重核心）
 *
 * 职责：清 stale acks → 轮询 inbound → 累积门控 → markProcessing → 命令分流（/clear）→
 *       格式化 → provider.query（期间并发轮询 push 新消息）→ 写 messages_out → markCompleted。
 *       corruption 连续 10 次 → exit(75) 交宿主重启。
 * 关键导出：runPollLoop, isCorruptionError, PollLoopConfig
 * 承重不变量（借鉴 nanoclaw container/agent-runner/src/poll-loop.ts）：
 *   - trigger=0 累积门控冷热两处；on_wake 仅首轮（messages-in 层保证）；
 *   - result 到达即 ack 初始批；corruption 计数 10 次 → 停心跳 → exit(75)；
 *   - P0-1：每批生命周期（读批 → 置 processing → 查询 → 写结果 → completed）收进
 *     单一邮箱会话 withMailboxSession。会话边界=连接生命周期而非 SQLite 长事务——
 *     DELETE journal 下跨 LLM 调用持写锁会饿死宿主的投递轮询；原子性由单语句保证。
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-12 修复：循环尾 await sleep(0) 宏任务让渡（防纯同步 provider 微任务空转饿死定时器）
 *   2026-08-12 ai-inspector 修复：/clear 重置 continuation+历史；热路径 formatMessages；in_reply_to+clearCurrentInReplyTo；system 注入；批次日志
 *   2026-08-28 阶段 12 路径 B：systemPrompt 支持工厂（每轮求值），使 todo 清单跨消息刷新
 *   2026-10-06 P0-1：整批经 withMailboxSession（mailbox 抽象层），不再直接 import db 层裸调用
 */
import { randomUUID } from "node:crypto";
import { log } from "./log-lite.ts";
import { formatMessages, extractRouting, isClearCommand } from "./formatter.ts";
import { clearStaleProcessingAcks, touchHeartbeat, closeOutboundDb } from "./db/connection.ts";
import { setCurrentInReplyTo, clearCurrentInReplyTo, clearContinuation, clearHistory } from "./db/session-state.ts";
import { withMailboxSession } from "./mailbox/index.ts";
import type { MailboxMessage } from "./mailbox/types.ts";
import { parseTaskEnvelope, runTaskScriptGate } from "./scheduling/task-script.ts";
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

/**
 * P0-3：pre-task 脚本门控。批内 task 消息若带 script 信封，先执行脚本；
 * 返回被拒绝（script-skip）的消息 id 集合。失败消息不进入 LLM 提示。
 */
async function gateTaskScripts(msgs: MailboxMessage[]): Promise<Set<string>> {
  const skipped = new Set<string>();
  for (const m of msgs) {
    if (m.kind !== "task") continue;
    const env = parseTaskEnvelope(m.content);
    if (!env.script) continue;
    const res = await runTaskScriptGate(env.script);
    if (res.decision === "skip") {
      skipped.add(m.id);
      log(`task script gate skipped ${m.id}: ${res.reason}`, "warn");
    }
  }
  return skipped;
}

export async function runPollLoop(cfg: PollLoopConfig): Promise<void> {
  clearStaleProcessingAcks();
  let firstPoll = true;
  let corruptionStreak = 0;
  const idleMs = cfg.sleepMs?.idle ?? 1000;

  while (!cfg.signal?.aborted) {
    touchHeartbeat();
    let backoff = false;

    try {
      // P0-1：整批生命周期收进单一邮箱会话。读批 + 置 processing 在同一会话内先后执行，
      // 写结果 + completed 也在同一会话收尾——连接一次打开、用毕即关。
      await withMailboxSession(async (mbox) => {
        let msgs: MailboxMessage[];
        try {
          msgs = mbox.readPending({ isFirstPoll: firstPoll, max: cfg.maxMessages, nowIso: new Date().toISOString() });
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
            backoff = true;
            return;
          }
          // 阶段 12 实测修复：VirtioFS 概率性 disk I/O error 视为瞬态，重开连接退避重试（不 fatal）
          if (isTransientIoError(err)) {
            log(`transient io error, retrying poll: ${String(err)}`, "warn");
            closeOutboundDb();
            backoff = true;
            return;
          }
          throw err;
        }
        firstPoll = false;

        if (msgs.length === 0) return;
        // 累积门控（冷批次）：全 trigger=0 → 不唤醒，保持 pending 等真触发捎带
        if (msgs.every((m) => m.trigger === 0)) return;

        const ids = msgs.map((m) => m.id);
        mbox.markProcessing(ids);

        // P0-3：pre-task 脚本门控——task 消息带 script 信封时先跑脚本，
        // 被拒的写 script-skip ack（宿主 sync 为 failed），且不进 LLM 提示。
        const skipped = await gateTaskScripts(msgs);
        if (skipped.size > 0) mbox.markScriptSkip([...skipped]);
        const active = msgs.filter((m) => !skipped.has(m.id));
        if (active.length === 0) return;
        const activeIds = active.map((m) => m.id);

        // 命令分流：/clear 重置 continuation + 历史，不走 LLM（P1-4 修复）
        if (active.some((m) => isClearCommand(m.content))) {
          clearContinuation(cfg.provider.name);
          clearHistory(cfg.provider.name);
          mbox.markCompleted(ids);
          return;
        }

        const routing = extractRouting(active);
        setCurrentInReplyTo(active[active.length - 1]?.id ?? randomUUID());
        const prompt = formatMessages(active, { timezone: cfg.timezone, assistantName: cfg.assistantName });
        log(`batch picked: n=${activeIds.length} kinds=${active.map((m) => m.kind).join(",")}`);

        let resultText = "";
        let hadError = false;
        // fix-plan 流式增量投递：累积流式内容；首增量发首条消息，之后节流发 operation=edit（宿主据此更新同一条）
        let streamedContent = "";
        let liveMessageId: string | null = null;
        let lastEditAt = 0;
        // 热路径：查询期间并发轮询新 trigger=1 消息 → provider.push（累积门控同样适用；同一邮箱会话）
        const hotTimer = setInterval(() => {
          try {
            const hot = mbox.readPending({
              isFirstPoll: false,
              max: cfg.maxMessages,
              nowIso: new Date().toISOString(),
            });
            const hotTrigger = hot.filter((m) => m.trigger === 1);
            if (hotTrigger.length === 0) return;
            mbox.markProcessing(hotTrigger.map((m) => m.id));
            // P1-5 修复：热路径同样走 formatMessages（XML 块 + internal 标签剥离）
            for (const m of hotTrigger) {
              cfg.provider.push(formatMessages([m], { timezone: cfg.timezone, assistantName: cfg.assistantName }));
            }
            mbox.markCompleted(hotTrigger.map((m) => m.id));
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
                mbox.writeOutbound({
                  id: liveMessageId,
                  kind: "chat",
                  content: streamedContent,
                  channelType: routing.channelType,
                  platformId: routing.platformId,
                  threadId: routing.threadId,
                  inReplyTo: active[active.length - 1]?.id ?? null,
                });
                lastEditAt = now;
              } else if (now - lastEditAt >= (cfg.editThrottleMs ?? STREAM_EDIT_THROTTLE_MS)) {
                mbox.writeOutbound({
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
          mbox.writeOutbound({
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
          mbox.writeOutbound({
            id: randomUUID(),
            kind: "chat",
            content: hadError ? `! ${resultText}` : resultText,
            streamFinal: true,
            channelType: routing.channelType,
            platformId: routing.platformId,
            threadId: routing.threadId,
            inReplyTo: active[active.length - 1]?.id ?? null, // P2-1 修复：主回复打 in_reply_to
          });
        }
        mbox.markCompleted(ids);
        clearCurrentInReplyTo(); // P2-1 修复：批次间不残留旧值
      });
    } catch (err) {
      // 会话外的真正意外错误：向上抛（与旧行为一致——旧代码只有 corruption/io 两类吞掉）
      throw err;
    }
    // 宏任务让渡：provider 可能纯同步（Mock/本地），防止微任务空转饿死定时器（abort/hot poll）
    await sleep(backoff ? idleMs * 2 : idleMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
