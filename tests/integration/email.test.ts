/**
 * email.test.ts ?”â€?Email ?šé??‚é??¨é??æ?è¯•ï?mock socket è¡Œå?è®®ï?ä¸è?å¤–ç?ï¼? *
 * ?Œè´£ï¼šIMAP LOGIN/FETCH å¾€è¿”ï?{N} literal è§?? ??onInboundï¼‰ï?äºŒæ¬¡è½®è¯¢ UNSEEN ?»é?ï¼? *       SMTP deliver ?¨æ¡?‹ä? DATA \r\n.\r\n ç»ˆæ­¢åºå?ï¼›å‡­?®ç¼ºå¤?factory è¿”å? null?? * ä¿®æ”¹è®°å?ï¼? *   2026-08-13 ?›å»ºï¼ˆé˜¶æ®?10ï¼? */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createEmailAdapter, registerEmailChannel, type MailSocket } from "../../src/channels/email.js";
import {
  clearChannelRegistryForTest,
  getActiveAdapters,
  initChannelAdapters,
} from "../../src/channels/channel-registry.js";
import type { ChannelSetup, InboundMessage } from "../../src/channels/adapter.js";

class FakeMailSocket implements MailSocket {
  written: string[] = [];
  private dataCbs: Array<(chunk: Buffer | string) => void> = [];

  constructor(
    private readonly handler: (line: string) => string | null,
    greeting?: string,
  ) {
    if (greeting !== undefined) {
      const g = greeting;
      queueMicrotask(() => this.push(g));
    }
  }

  on(event: "data", listener: (chunk: Buffer | string) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  on(
    event: "data" | "close" | "error",
    listener: ((chunk: Buffer | string) => void) | (() => void) | ((err: Error) => void),
  ): void {
    if (event === "data") this.dataCbs.push(listener as (chunk: Buffer | string) => void);
  }

  write(data: string): void {
    this.written.push(data);
    const reply = this.handler(data.replace(/\r\n$/, ""));
    if (reply !== null) this.push(reply);
  }

  push(chunk: string): void {
    for (const cb of [...this.dataCbs]) cb(chunk);
  }

  end(): void {}

  destroy(): void {}
}

const MAIL_BODY = "From: Alice <alice@example.com>\r\nSubject: hello\r\n\r\nhi from email";

function imapHandler(searchUid: number): (line: string) => string | null {
  return (line) => {
    const tag = line.split(" ")[0] ?? "";
    if (line.includes("CAPABILITY")) return `* CAPABILITY IMAP4rev1\r\n${tag} OK CAPABILITY completed\r\n`;
    if (line.includes(" LOGIN ")) return `${tag} OK LOGIN completed\r\n`;
    if (line.includes("SELECT INBOX")) return `* 1 EXISTS\r\n${tag} OK [READ-WRITE] SELECT completed\r\n`;
    if (line.includes("UID SEARCH")) {
      return searchUid > 0
        ? `* SEARCH ${searchUid}\r\n${tag} OK SEARCH completed\r\n`
        : `${tag} OK SEARCH completed\r\n`;
    }
    if (line.includes("UID FETCH")) {
      return `* 1 FETCH (UID ${searchUid} BODY[] {${MAIL_BODY.length}}\r\n${MAIL_BODY}\r\n)\r\n${tag} OK FETCH completed\r\n`;
    }
    if (line.includes("UID STORE")) return `${tag} OK STORE completed\r\n`;
    if (line.includes("LOGOUT")) return `* BYE\r\n${tag} OK LOGOUT completed\r\n`;
    return `${tag} BAD unknown command\r\n`;
  };
}

function smtpHandler(): (line: string) => string | null {
  let authStep = 0;
  return (line) => {
    if (line.startsWith("EHLO")) return "250-smtp.test\r\n250 AUTH LOGIN\r\n";
    if (line === "AUTH LOGIN") {
      authStep = 1;
      return "334 VXNlcm5hbWU6\r\n";
    }
    if (authStep === 1) {
      authStep = 2;
      return "334 UGFzc3dvcmQ6\r\n";
    }
    if (authStep === 2) {
      authStep = 0;
      return "235 Authentication successful\r\n";
    }
    if (line.startsWith("MAIL FROM:")) return "250 sender ok\r\n";
    if (line.startsWith("RCPT TO:")) return "250 recipient ok\r\n";
    if (line === "DATA") return "354 go ahead\r\n";
    if (line.endsWith("\r\n.")) return "250 message queued\r\n";
    if (line === "QUIT") return "221 bye\r\n";
    return null;
  };
}

function setupCapture(): {
  inbound: Array<{ platformId: string; threadId: string | null; message: InboundMessage }>;
  cfg: ChannelSetup;
} {
  const inbound: Array<{ platformId: string; threadId: string | null; message: InboundMessage }> = [];
  const cfg: ChannelSetup = {
    onInbound: (platformId, threadId, message) => inbound.push({ platformId, threadId, message }),
    onInboundEvent: () => {},
    onMetadata: () => {},
    onAction: () => {},
  };
  return { inbound, cfg };
}

beforeEach(() => clearChannelRegistryForTest());
afterEach(() => clearChannelRegistryForTest());

describe("email adapter", () => {
  it("IMAP LOGIN/FETCH roundtrip emits inbound email", async () => {
    const socket = new FakeMailSocket(imapHandler(7), "* OK IMAP4rev1 ready\r\n");
    const adapter = createEmailAdapter({
      imapHost: "imap.test",
      user: "bot@OC.dev",
      pass: "pw",
      socketFactory: () => socket,
    });
    const { inbound, cfg } = setupCapture();
    adapter.setup(cfg);
    await adapter.pollOnce();
    expect(inbound).toHaveLength(1);
    const first = inbound[0]!;
    expect(first.platformId).toBe("email:bot@OC.dev");
    expect(first.threadId).toBeNull();
    expect(first.message.senderId).toBe("email:alice@example.com");
    expect(first.message.senderName).toBe("Alice");
    expect(first.message.isMention).toBe(true);
    expect(first.message.isGroup).toBe(false);
    expect(first.message.content).toContain("hi from email");
    const cmds = socket.written.map((w) => w.replace(/\r\n$/, ""));
    expect(cmds.some((c) => c.endsWith("CAPABILITY"))).toBe(true);
    expect(cmds.some((c) => c.includes('LOGIN "bot@OC.dev" "pw"'))).toBe(true);
    expect(cmds.some((c) => c.endsWith("SELECT INBOX"))).toBe(true);
    expect(cmds.some((c) => c.includes("UID FETCH 7"))).toBe(true);
    await adapter.teardown?.();
  });

  it("second poll with same UNSEEN uid does not re-emit", async () => {
    const sockets: FakeMailSocket[] = [];
    const adapter = createEmailAdapter({
      imapHost: "imap.test",
      user: "bot@OC.dev",
      pass: "pw",
      socketFactory: () => {
        const s = new FakeMailSocket(imapHandler(7), "* OK ready\r\n");
        sockets.push(s);
        return s;
      },
    });
    const { inbound, cfg } = setupCapture();
    adapter.setup(cfg);
    await adapter.pollOnce();
    await adapter.pollOnce();
    expect(inbound).toHaveLength(1);
    const fetches = sockets.flatMap((s) => s.written).filter((w) => w.includes("UID FETCH"));
    expect(fetches).toHaveLength(1);
    await adapter.teardown?.();
  });

  it("SMTP deliver over implicit TLS (465) completes handshake and terminates DATA with CRLF.CRLF", async () => {
    const socket = new FakeMailSocket(smtpHandler(), "220 smtp.test ESMTP\r\n");
    const adapter = createEmailAdapter({
      imapHost: "imap.test",
      smtpHost: "smtp.test",
      smtpPort: 465, // fix-plan P1ï¼?65 ?å? TLSï¼Œæ??€ STARTTLS
      user: "bot@OC.dev",
      pass: "pw",
      socketFactory: () => socket,
    });
    await adapter.deliver("email:bob@example.com", null, { kind: "chat", content: "reply to you" });
    const joined = socket.written.join("");
    expect(joined).toContain("MAIL FROM:<bot@OC.dev>");
    expect(joined).toContain("RCPT TO:<bob@example.com>");
    expect(joined).toContain(Buffer.from("bot@OC.dev").toString("base64"));
    expect(joined).toContain(Buffer.from("pw").toString("base64"));
    expect(socket.written.some((w) => w.endsWith("\r\n.\r\n"))).toBe(true);
  });

  it("SMTP 587 without STARTTLS refuses auth and leaks no credentials (fix-plan P1 regression)", async () => {
    // smtpHandler ??EHLO ä¸å®£??STARTTLS ??å¿…é¡»?’ç??æ?è®¤è?
    const socket = new FakeMailSocket(smtpHandler(), "220 smtp.test ESMTP\r\n");
    const adapter = createEmailAdapter({
      imapHost: "imap.test",
      smtpHost: "smtp.test",
      smtpPort: 587,
      user: "bot@OC.dev",
      pass: "secretpw",
      socketFactory: () => socket,
    });
    await expect(adapter.deliver("email:bob@example.com", null, { kind: "chat", content: "x" })).rejects.toThrow(
      /STARTTLS/,
    );
    // ?­æ®ç»ä?å¾—å‡º?°åœ¨?æ?ä¼šè?ä¸?    const joined = socket.written.join("");
    expect(joined).not.toContain(Buffer.from("secretpw").toString("base64"));
    expect(joined).not.toContain("AUTH LOGIN");
  });

  it("factory returns null when credentials missing", async () => {
    registerEmailChannel();
    await initChannelAdapters(() => setupCapture().cfg);
    expect(getActiveAdapters().some((a) => a.channelType === "email")).toBe(false);
  });
});
