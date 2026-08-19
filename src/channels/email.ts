/**
 * channels/email.ts —— Email 通道适配器（IMAP 轮询入站 + SMTP 出站）
 *
 * 职责：最小 IMAP 客户端（CAPABILITY/LOGIN/SELECT INBOX/UID SEARCH/UID FETCH/UID STORE 子集，行协议 + {N} literal）；
 *       轮询 UNSEEN → onInbound（platformId=email:<user>、senderId=email:<from>、isMention=true）；
 *       最小 SMTP 客户端（EHLO/AUTH LOGIN/MAIL FROM/RCPT TO/DATA，\r\n.\r\n 终止）；socketFactory 注入可测。
 * 关键导出：createEmailAdapter, registerEmailChannel, MailSocket, SocketFactory
 * 承重不变量：UID 单调推进去重（同一 UNSEEN 列表二次轮询不重复入站）；SMTP DATA 必须以 \r\n.\r\n 结束。
 * 借鉴：nanoclaw channels 分支 email 形态
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 10）
 */
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { readEnvFile } from "../env.js";
import { ENV_PATH } from "../config.js";
import { log } from "../log.js";
import { registerChannelAdapter } from "./channel-registry.js";
import type { ChannelAdapter, ChannelDefaults, ChannelSetup, OutboundMessage } from "./adapter.js";

export interface MailSocket {
  write(data: string): void;
  end(): void;
  destroy(): void;
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  /** fix-plan P1：底层 socket（供 STARTTLS 升级包裹）；测试假 socket 可无此字段 */
  raw?: unknown;
}

export type SocketFactory = (opts: { host: string; port: number; secure: boolean }) => MailSocket;

export interface EmailDeps {
  imapHost: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
  user: string;
  pass: string;
  pollMs?: number;
  socketFactory?: SocketFactory;
}

const DEFAULTS: ChannelDefaults = {
  dm: { engageMode: "pattern", engagePattern: ".", threads: false, unknownSenderPolicy: "strict" },
  group: { engageMode: "mention", threads: false, unknownSenderPolicy: "request_approval" },
  mentions: "dm-only",
};

const defaultSocketFactory: SocketFactory = ({ host, port, secure }) => {
  const s = secure ? tlsConnect({ host, port }) : netConnect({ host, port });
  return Object.assign(s, { raw: s }) as MailSocket;
};

/**
 * fix-plan P1（STARTTLS）：在已建立的明文 socket 上升级 TLS（验证证书，rejectUnauthorized 默认 true）。
 * 升级成功返回包裹后的 TLS MailSocket；底层 socket 缺失或握手失败则 reject（调用方拒绝认证，凭据不走明文）。
 */
function upgradeToTls(socket: MailSocket, host: string): Promise<MailSocket> {
  return new Promise((resolve, reject) => {
    const raw = socket.raw as import("node:net").Socket | undefined;
    if (!raw || typeof (raw as { pause?: () => void }).pause !== "function") {
      reject(new Error("smtp STARTTLS unavailable: socket not upgradable"));
      return;
    }
    const tlsSock = tlsConnect({ socket: raw, host, rejectUnauthorized: true });
    let settled = false;
    tlsSock.once("secureConnect", () => {
      if (settled) return;
      settled = true;
      resolve(Object.assign(tlsSock, { raw: tlsSock }) as MailSocket);
    });
    tlsSock.once("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

const quote = (s: string): string => `"${s.replace(/["\\]/g, (c) => `\\${c}`)}"`;

interface ImapReply {
  ok: boolean;
  lines: string[];
}

class ImapSession {
  private buf = "";
  private literalRemaining = -1;
  private literalParts: string[] = [];
  private tagSeq = 0;
  private current: {
    tag: string;
    lines: string[];
    resolve: (r: ImapReply) => void;
    reject: (e: Error) => void;
  } | null = null;
  private greeting: { resolve: (line: string) => void; reject: (e: Error) => void } | null = null;

  constructor(private readonly socket: MailSocket) {
    socket.on("data", (chunk) => this.onData(String(chunk)));
    socket.on("error", (err) => this.fail(err));
    socket.on("close", () => this.fail(new Error("imap socket closed")));
  }

  waitGreeting(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.greeting = { resolve, reject };
    });
  }

  command(cmd: string): Promise<ImapReply> {
    const tag = `A${++this.tagSeq}`;
    return new Promise((resolve, reject) => {
      this.current = { tag, lines: [], resolve, reject };
      this.socket.write(`${tag} ${cmd}\r\n`);
    });
  }

  private fail(err: Error): void {
    this.current?.reject(err);
    this.current = null;
    this.greeting?.reject(err);
    this.greeting = null;
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    for (;;) {
      if (this.literalRemaining >= 0) {
        if (this.buf.length < this.literalRemaining) {
          this.literalParts.push(this.buf);
          this.literalRemaining -= this.buf.length;
          this.buf = "";
          return;
        }
        this.literalParts.push(this.buf.slice(0, this.literalRemaining));
        this.buf = this.buf.slice(this.literalRemaining);
        this.literalRemaining = -1;
        this.deliverLine(this.literalParts.join(""));
        this.literalParts = [];
        continue;
      }
      const idx = this.buf.indexOf("\r\n");
      if (idx < 0) return;
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      const lit = line.match(/\{(\d+)\}$/);
      if (lit) {
        this.deliverLine(line);
        this.literalRemaining = Number(lit[1]);
        continue;
      }
      this.deliverLine(line);
    }
  }

  private deliverLine(line: string): void {
    if (this.greeting) {
      const g = this.greeting;
      this.greeting = null;
      g.resolve(line);
      return;
    }
    const cur = this.current;
    if (!cur) return;
    if (line.startsWith(`${cur.tag} `)) {
      this.current = null;
      cur.resolve({ ok: /^\S+ OK/.test(line), lines: cur.lines });
      return;
    }
    cur.lines.push(line);
  }
}

async function must(p: Promise<ImapReply>, what: string): Promise<ImapReply> {
  const r = await p;
  if (!r.ok) throw new Error(`imap ${what} failed`);
  return r;
}

function parseRawEmail(raw: string): { from: string; name: string | null; subject: string; body: string } {
  const [headerPart = "", ...rest] = raw.split(/\r?\n\r?\n/);
  const body = rest.join("\n\n").trim();
  const headers = headerPart.split(/\r?\n/);
  const header = (name: string): string | null => {
    const h = headers.find((l) => l.toLowerCase().startsWith(`${name}:`));
    return h ? h.slice(name.length + 1).trim() : null;
  };
  const fromRaw = header("from") ?? "";
  const addr = fromRaw.match(/<([^>]+)>/);
  const nameMatch = fromRaw.match(/^"?([^"<]*)"?\s*</);
  return {
    from: addr?.[1] ?? fromRaw,
    name: nameMatch?.[1]?.trim() || null,
    subject: header("subject") ?? "",
    body,
  };
}

interface SmtpReply {
  code: number;
  lines: string[];
}

class SmtpSession {
  private buf = "";
  private partial: string[] = [];
  private waiters: Array<{ resolve: (r: SmtpReply) => void; reject: (e: Error) => void }> = [];
  private queued: SmtpReply[] = [];

  constructor(private readonly socket: MailSocket) {
    socket.on("data", (chunk) => this.onData(String(chunk)));
    socket.on("error", (err) => this.fail(err));
    socket.on("close", () => this.fail(new Error("smtp socket closed")));
  }

  waitReply(): Promise<SmtpReply> {
    const early = this.queued.shift();
    if (early) return Promise.resolve(early);
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }

  command(cmd: string): Promise<SmtpReply> {
    this.socket.write(`${cmd}\r\n`);
    return this.waitReply();
  }

  private fail(err: Error): void {
    for (const w of this.waiters.splice(0)) w.reject(err);
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    for (;;) {
      const idx = this.buf.indexOf("\r\n");
      if (idx < 0) return;
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      this.partial.push(line);
      if (/^\d{3}( |$)/.test(line)) {
        const reply: SmtpReply = { code: Number(line.slice(0, 3)), lines: this.partial.splice(0) };
        const w = this.waiters.shift();
        if (w) w.resolve(reply);
        else this.queued.push(reply);
      }
    }
  }
}

function expectCode(r: SmtpReply, code: number, what: string): void {
  if (r.code !== code) throw new Error(`smtp ${what}: ${r.code} ${r.lines.join(" | ")}`);
}

export function createEmailAdapter(deps: EmailDeps): ChannelAdapter & { pollOnce: () => Promise<void> } {
  const socketFactory = deps.socketFactory ?? defaultSocketFactory;
  const imapPort = deps.imapPort ?? 993;
  const smtpHost = deps.smtpHost ?? deps.imapHost;
  const smtpPort = deps.smtpPort ?? 587;
  let setupCfg: ChannelSetup | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastSeenUid = 0;
  let busy = false;
  let aborted = false;

  async function pollOnce(): Promise<void> {
    if (busy || aborted) return;
    busy = true;
    try {
      const socket = socketFactory({ host: deps.imapHost, port: imapPort, secure: imapPort !== 143 });
      const session = new ImapSession(socket);
      try {
        await session.waitGreeting();
        await must(session.command("CAPABILITY"), "CAPABILITY");
        await must(session.command(`LOGIN ${quote(deps.user)} ${quote(deps.pass)}`), "LOGIN");
        await must(session.command("SELECT INBOX"), "SELECT INBOX");
        const search = await must(session.command("UID SEARCH UNSEEN"), "UID SEARCH");
        const searchLine = search.lines.find((l) => l.startsWith("* SEARCH"));
        const uids = (searchLine ?? "")
          .split(/\s+/)
          .slice(2)
          .map(Number)
          .filter((n) => Number.isFinite(n) && n > lastSeenUid);
        for (const uid of uids) {
          const fetched = await must(session.command(`UID FETCH ${uid} (UID BODY.PEEK[])`), `UID FETCH ${uid}`);
          const raw = fetched.lines.find((l) => l.includes("From:"));
          if (raw) {
            const mail = parseRawEmail(raw);
            if (mail.from && setupCfg) {
              setupCfg.onInbound(`email:${deps.user}`, null, {
                id: `email-${uid}`,
                kind: "chat",
                content: [mail.subject, mail.body].filter(Boolean).join("\n"),
                timestamp: new Date().toISOString(),
                isMention: true,
                isGroup: false,
                senderId: `email:${mail.from}`,
                senderName: mail.name,
              });
            }
          }
          await session.command(`UID STORE ${uid} +FLAGS (\\Seen)`);
          lastSeenUid = Math.max(lastSeenUid, uid);
        }
        await session.command("LOGOUT");
      } finally {
        socket.destroy();
      }
    } finally {
      busy = false;
    }
  }

  async function deliver(
    platformId: string,
    _threadId: string | null,
    msg: OutboundMessage,
  ): Promise<string | undefined> {
    const to = platformId.replace(/^email:/, "");
    const ehloDomain = deps.user.split("@")[1] ?? "openclaw.local";
    // fix-plan P1：465 隐式 TLS；其余端口（如 587）明文连接后必须 STARTTLS 升级，凭据只在 TLS 上发送
    const implicitTls = smtpPort === 465;
    let socket = socketFactory({ host: smtpHost, port: smtpPort, secure: implicitTls });
    let session = new SmtpSession(socket);
    try {
      expectCode(await session.waitReply(), 220, "greeting");
      const ehlo = await session.command(`EHLO ${ehloDomain}`);
      expectCode(ehlo, 250, "EHLO");
      if (!implicitTls) {
        const advertises = ehlo.lines.some((l) => /\bSTARTTLS\b/i.test(l));
        if (!advertises) throw new Error("smtp: server does not advertise STARTTLS; refusing plaintext auth");
        expectCode(await session.command("STARTTLS"), 220, "STARTTLS");
        // 升级 TLS（验证证书）；失败即抛错，绝不退回明文认证
        const tlsSocket = await upgradeToTls(socket, smtpHost);
        socket = tlsSocket;
        session = new SmtpSession(tlsSocket);
        expectCode(await session.command(`EHLO ${ehloDomain}`), 250, "EHLO over TLS");
      }
      expectCode(await session.command("AUTH LOGIN"), 334, "AUTH LOGIN");
      expectCode(await session.command(Buffer.from(deps.user).toString("base64")), 334, "AUTH user");
      expectCode(await session.command(Buffer.from(deps.pass).toString("base64")), 235, "AUTH pass");
      expectCode(await session.command(`MAIL FROM:<${deps.user}>`), 250, "MAIL FROM");
      expectCode(await session.command(`RCPT TO:<${to}>`), 250, "RCPT TO");
      expectCode(await session.command("DATA"), 354, "DATA");
      const subject = msg.content.split(/\r?\n/)[0]?.slice(0, 78) ?? "";
      const body = msg.content
        .split(/\r?\n/)
        .map((l) => (l.startsWith(".") ? `.${l}` : l))
        .join("\r\n");
      socket.write(`From: ${deps.user}\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${body}\r\n.\r\n`);
      expectCode(await session.waitReply(), 250, "DATA end");
      await session.command("QUIT").catch(() => {});
      return undefined;
    } finally {
      socket.destroy();
    }
  }

  return {
    name: "email",
    channelType: "email",
    supportsThreads: false,
    defaults: DEFAULTS,
    setup: (cfg) => {
      setupCfg = cfg;
      aborted = false;
      if (timer) clearInterval(timer);
      timer = setInterval(
        () => void pollOnce().catch((err) => log.warn("email poll failed", { err })),
        deps.pollMs ?? 60_000,
      );
      timer.unref();
    },
    teardown: async () => {
      aborted = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    isConnected: () => setupCfg !== null && !aborted,
    deliver,
    pollOnce,
  };
}

export function registerEmailChannel(): void {
  const { EMAIL_IMAP_HOST, EMAIL_USER, EMAIL_PASS, EMAIL_SMTP_HOST, EMAIL_IMAP_PORT, EMAIL_SMTP_PORT, EMAIL_POLL_MS } =
    readEnvFile(
      [
        "EMAIL_IMAP_HOST",
        "EMAIL_USER",
        "EMAIL_PASS",
        "EMAIL_SMTP_HOST",
        "EMAIL_IMAP_PORT",
        "EMAIL_SMTP_PORT",
        "EMAIL_POLL_MS",
      ],
      ENV_PATH,
    );
  registerChannelAdapter("email", {
    factory: () =>
      EMAIL_IMAP_HOST && EMAIL_USER && EMAIL_PASS
        ? createEmailAdapter({
            imapHost: EMAIL_IMAP_HOST,
            imapPort: EMAIL_IMAP_PORT ? Number(EMAIL_IMAP_PORT) : undefined,
            smtpHost: EMAIL_SMTP_HOST,
            smtpPort: EMAIL_SMTP_PORT ? Number(EMAIL_SMTP_PORT) : undefined,
            user: EMAIL_USER,
            pass: EMAIL_PASS,
            pollMs: EMAIL_POLL_MS ? Number(EMAIL_POLL_MS) : undefined,
          })
        : null,
    defaults: DEFAULTS,
  });
}
