/**
 * channels/cli.ts —— CLI 通道适配器（内置，socket 通信）
 *
 * 职责：net server（Unix socket / Windows named pipe）；客户端发 JSON 行 {text} 或纯文本 →
 *       onInbound('local', null, msg)；deliver 写 JSON 行给已连接客户端；
 *       ensureCliWiring 幂等接线（让"装完即可对话"成立）。
 * 关键导出：CLI_DEFAULTS, cliSocketPath, CLI_CHANNEL_TYPE, CLI_PLATFORM_ID, CLI_INSTANCE,
 *           ensureCliWiring
 * 核心模式：socket 路径权限即身份（chmod 0600 / pipe ACL）；单聊天槽位语义简化为多客户端广播。
 * 借鉴：nanoclaw src/channels/cli.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 5）
 *   2026-08-12 修复：win32 teardown 等待管道释放（防旧 server 竞态）
 *   2026-10-06 T2：新增 ensureCliWiring + CLI 身份常量单一来源。修掉首次安装后第一条
 *              消息被静默丢弃的两个独立根因：① demo-setup 把 instance 写成 "default"，
 *              与 router 查询用的 "cli" 不匹配；② createMessagingGroup 默认
 *              unknown_sender_policy=strict，而 cli:local 从不是成员，accessGate 直接拒。
 *              策略一律取自本通道自己声明的 CLI_DEFAULTS，不硬编码。
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import { chmodSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR, INSTALL_SLUG } from "../config.js";
import { log } from "../log.js";
import { getDb } from "../db/connection.js";
import { createMessagingGroup, createWiring, findByPlatform, listWirings } from "../db/messaging-groups.js";
import { registerChannelAdapter } from "./channel-registry.js";
import type { ChannelAdapter, ChannelDefaults, ChannelSetup, OutboundMessage } from "./adapter.js";

export function cliSocketPath(): string {
  return process.platform === "win32" ? `\\\\.\\pipe\\oc-chat-${INSTALL_SLUG}` : join(DATA_DIR, "cli-chat.sock");
}

/** 阶段 12：chat 流式合并兜底窗口（毫秒）；测试可注入 0 免等待。
 *  主路径是 streamFinal 流结束信号（立即冲刷）；本窗口仅兜底旧容器/异常中断场景。
 *  120s：工具调用序列中"工具 done → 下一个工具 running"的 LLM 生成间隙可达几十秒，
 *  窗口过短会把累积中间态当完整回复 flush（用户看到的滚雪球多条 agent 根因）。 */
let chatMergeMs = 120_000;
export function setChatMergeMsForTest(ms: number): void {
  chatMergeMs = ms;
}

export const CLI_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "public" },
  group: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "public" },
  mentions: "never",
};

/**
 * CLI 通道的固定身份（单一来源）。
 *
 * 三个值必须与下面两处严格一致，否则 router 查不到 messaging group：
 *   - setup() 里的 onInbound(CLI_PLATFORM_ID, null, ...)
 *   - router 的 instance = event.instance ?? event.channelType，而 index.ts 用
 *     adapter.instance ?? adapter.channelType 戳印 —— 本适配器不声明 instance，故为 "cli"
 * 历史上 demo-setup 曾把 instance 写成 "default"，导致 router 永远匹配不上、
 * 转而新建一个 agentCount=0 的群组并把消息静默丢弃（T2 根因之一）。
 */
export const CLI_CHANNEL_TYPE = "cli";
export const CLI_PLATFORM_ID = "local";
export const CLI_INSTANCE = "cli";

export interface EnsureCliWiringResult {
  messagingGroupId: string;
  wiringId: string | null;
  createdMessagingGroup: boolean;
  createdWiring: boolean;
  repaired: string[];
}

/**
 * 幂等地把 CLI 通道接线到指定 agent 组，让"装完就能对话"成立（T2）。
 *
 * 为什么需要它：`pnpm setup` / `demo-setup` 只建 agent 组时，第一条 chat 会被 router
 * 以 "no agent wired" 丢弃；即便建了接线，`createMessagingGroup` 的
 * `unknown_sender_policy` 默认是 **strict**，而 `cli:local` 从来不是任何组的成员，
 * 于是 accessGate 以 "strict policy: not a member" 再次静默丢弃。两条路径都表现为
 * "发消息没有任何回复"，且日志之外无任何用户可见反馈。
 *
 * 本函数一律采用 CLI 通道**自己声明的** defaults（CLI_DEFAULTS.dm）作为策略来源，
 * 而不是硬编码 "public"：通道适配器是自身默认口径的权威，改声明即改行为。
 *
 * 同时修复历史遗留行（旧 demo-setup 写下的 instance="default" 或 strict 策略），
 * 否则已经踩过坑的安装会一直坏下去。
 */
export function ensureCliWiring(agentGroupId: string): EnsureCliWiringResult {
  const ctx = CLI_DEFAULTS.dm;
  const repaired: string[] = [];

  let mg = findByPlatform(CLI_CHANNEL_TYPE, CLI_PLATFORM_ID, CLI_INSTANCE);
  let createdMessagingGroup = false;

  if (!mg) {
    // 旧 demo-setup 用 instance="default" 建过行：认领并纠正，而不是再建一个重复群组
    const legacy = findByPlatform(CLI_CHANNEL_TYPE, CLI_PLATFORM_ID, "default");
    if (legacy) {
      getDb().prepare("UPDATE messaging_groups SET instance = ? WHERE id = ?").run(CLI_INSTANCE, legacy.id);
      repaired.push(`instance default->${CLI_INSTANCE}`);
      mg = { ...legacy, instance: CLI_INSTANCE };
    }
  }

  if (!mg) {
    mg = createMessagingGroup({
      channelType: CLI_CHANNEL_TYPE,
      platformId: CLI_PLATFORM_ID,
      instance: CLI_INSTANCE,
      name: "CLI local chat",
      isGroup: false,
      // 承重：不用 createMessagingGroup 的 strict 默认值
      unknownSenderPolicy: ctx.unknownSenderPolicy,
    });
    createdMessagingGroup = true;
  } else if (mg.unknown_sender_policy === "strict") {
    // strict 会把 cli:local 挡在门外（它不是成员），首次安装即静默失效
    getDb()
      .prepare("UPDATE messaging_groups SET unknown_sender_policy = ? WHERE id = ?")
      .run(ctx.unknownSenderPolicy, mg.id);
    repaired.push(`unknown_sender_policy strict->${ctx.unknownSenderPolicy}`);
    mg = { ...mg, unknown_sender_policy: ctx.unknownSenderPolicy };
  }

  // 永久静默标记会让接线看起来成功却收不到任何回复
  if (mg.denied_at) {
    getDb().prepare("UPDATE messaging_groups SET denied_at = NULL WHERE id = ?").run(mg.id);
    repaired.push("cleared denied_at");
  }

  const existing = listWirings(mg.id).find((w) => w.agent_group_id === agentGroupId);
  if (existing) {
    return {
      messagingGroupId: mg.id,
      wiringId: existing.id,
      createdMessagingGroup,
      createdWiring: false,
      repaired,
    };
  }

  const wiring = createWiring({
    messagingGroupId: mg.id,
    agentGroupId,
    engageMode: ctx.engageMode,
    engagePattern: ctx.engagePattern ?? undefined,
    sessionMode: ctx.threads ? "per-thread" : "shared",
  });
  return {
    messagingGroupId: mg.id,
    wiringId: wiring.id,
    createdMessagingGroup,
    createdWiring: true,
    repaired,
  };
}

function createCliAdapter(): ChannelAdapter {
  let server: Server | null = null;
  const clients = new Set<Socket>();

  // 阶段 12：服务端流式合并缓冲（chat 消息合并窗口）+ 工具运行中标志（暂停兜底冲刷）
  let pendingChat: {
    content: string;
    meta: OutboundMessage["meta"] | null;
    inReplyTo: string | null;
    timer: NodeJS.Timeout;
  } | null = null;
  let toolActive = false;

  const adapter: ChannelAdapter = {
    name: "cli",
    channelType: "cli",
    supportsThreads: false,
    defaults: CLI_DEFAULTS,

    setup: (config: ChannelSetup) => {
      const path = cliSocketPath();
      if (process.platform !== "win32" && existsSync(path)) rmSync(path, { force: true });
      server = createServer((socket) => {
        clients.add(socket);
        socket.on("close", () => clients.delete(socket));
        socket.on("error", () => clients.delete(socket));
        let buf = "";
        socket.on("data", (chunk) => {
          buf += chunk.toString();
          let idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line) continue;
            let text = line;
            try {
              text = String((JSON.parse(line) as { text?: string }).text ?? line);
            } catch {
              text = line; // 纯文本兜底
            }
            config.onInbound(CLI_PLATFORM_ID, null, {
              id: randomUUID(),
              kind: "chat",
              content: text,
              timestamp: new Date().toISOString(),
              isMention: true,
              isGroup: false,
              senderId: "cli:local",
              senderName: "local",
            });
          }
        });
      });
      server.listen(path, () => {
        if (process.platform !== "win32") {
          try {
            chmodSync(path, 0o600); // socket 权限即身份
          } catch (err) {
            log.warn("cli socket chmod failed", { err });
          }
        }
        log.info(`cli channel listening: ${path}`);
      });
      server.on("error", (err) => log.error("cli socket error", { err }));
    },

    teardown: async () => {
      for (const c of clients) c.destroy();
      clients.clear();
      await new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
      });
      // Windows named pipe 释放异步：等待连接被拒，防下个使用者连到旧 server（测试竞态修复）
      if (process.platform === "win32") {
        const deadline = Date.now() + 1000;
        while (Date.now() < deadline) {
          const ok = await new Promise<boolean>((resolve) => {
            const s = connect(cliSocketPath(), () => {
              s.destroy();
              resolve(true);
            });
            s.on("error", () => resolve(false));
          });
          if (!ok) break;
          await new Promise((r) => setTimeout(r, 50));
        }
      } else {
        rmSync(cliSocketPath(), { force: true });
      }
    },

    isConnected: () => server !== null,

    deliver: async (_platformId, _threadId, msg: OutboundMessage) => {
      // 阶段 12：多帧协议（meta 可选 → 消息 → end），行分隔向后兼容（老客户端逐行 JSON.parse 只读 text）
      const write = (m: OutboundMessage) => {
        const lines: string[] = [];
        if (m.meta) {
          lines.push(
            JSON.stringify({
              kind: "meta",
              agent: m.meta.agent ?? null,
              model: m.meta.model ?? null,
              provider: m.meta.provider ?? null,
              inReplyTo: m.inReplyTo ?? null,
            }),
          );
        }
        lines.push(
          JSON.stringify({
            kind: m.kind ?? "chat",
            text: m.content,
            operation: m.operation ?? null,
            type: m.type ?? null,
            inReplyTo: m.inReplyTo ?? null,
          }),
        );
        lines.push(JSON.stringify({ kind: "end", inReplyTo: m.inReplyTo ?? null }));
        const payload = lines.join("\n") + "\n";
        for (const c of clients) c.write(payload);
      };

      // 冲刷合并缓冲（供各分支复用）
      const flushPending = () => {
        if (!pendingChat) return;
        clearTimeout(pendingChat.timer);
        const p = pendingChat;
        pendingChat = null;
        write({ kind: "chat", content: p.content, meta: p.meta, inReplyTo: p.inReplyTo });
      };

      // 兜底定时器：工具运行中推迟冲刷（重新定时），否则冲刷最后一条缓冲
      const scheduleFallbackFlush = () => {
        if (pendingChat) {
          pendingChat.timer = setTimeout(() => {
            if (toolActive) {
              scheduleFallbackFlush(); // 工具运行中：继续等（等 streamFinal）
              return;
            }
            flushPending();
          }, chatMergeMs);
        }
      };

      // 流式合并（阶段 12 实测修复）：poll-loop 对同一回复写多条 outbound（首条片段 + 每 400ms 一条
      // operation=edit + 最终 edit）。服务端合并：普通 chat 缓冲替换，streamFinal 到达立即冲刷最终完整版。
      // 兜底定时器在【工具运行中】时推迟冲刷（工具调用长停顿期间 LLM 无新增量，若此刻 flush 会把
      // "我先看看"类预告当完整回复显示——即用户看到的多个 agent + 中断 + 滚雪球）。
      if (msg.kind === "chat" && !msg.type) {
        if (pendingChat) clearTimeout(pendingChat.timer);
        pendingChat = {
          content: msg.content,
          meta: msg.meta ?? pendingChat?.meta ?? null,
          inReplyTo: msg.inReplyTo ?? pendingChat?.inReplyTo ?? null,
          timer: setTimeout(() => {
            if (toolActive) {
              scheduleFallbackFlush();
              return;
            }
            flushPending();
          }, chatMergeMs),
        };
        // streamFinal：流式链最终完整版——立即冲刷（不等定时器）
        if (msg.streamFinal === true) {
          flushPending();
        }
        return undefined;
      }

      // 非 chat（system/ask_question 等）：先冲刷缓冲，再立即广播本条
      flushPending();
      write(msg);
      return undefined;
    },

    /** 阶段 12：容器工具状态广播（delivery 轮询 container_state 变化时调用）；running 时暂停合并冲刷。
     *  args 携带命令摘要（如 bash 命令），TUI 实时展示"执行了哪些命令"。 */
    notifyTool: (tool: string, status: "running" | "done" | "error", elapsedMs?: number, args?: string | null) => {
      toolActive = status === "running";
      const line =
        JSON.stringify({ kind: "tool", tool, status, elapsedMs: elapsedMs ?? null, args: args ?? null }) + "\n";
      for (const c of clients) c.write(line);
    },
  };
  return adapter;
}

registerChannelAdapter("cli", { factory: () => createCliAdapter(), defaults: CLI_DEFAULTS });

/*
 * 修改记录：
 *   2026-08-25 阶段 12：CLI 聊天界面（meta/tool/end 帧协议 + TUI 渲染）
 */
