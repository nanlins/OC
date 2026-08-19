/**
 * mcp-tools/tools.test.ts —— 工具单元测试（bun:test）
 *
 * 职责：send_message 默认路由/命名目的地/a2a/未知目的地报错；send_file outbox 暂存与越界拒绝；
 *       文件工具沙箱；bash 执行。
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏与 import 路径
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { closeSessionDbsForTest, getOutboundDb, getWorkspace, initTestSessionDb, inboundPath } from "../db/connection.ts";
import { INBOUND_SCHEMA, OUTBOUND_SCHEMA } from "../db/schema.ts";
import { bootstrapTools } from "./index.ts";
import { getTool, type ToolContext } from "./registry.ts";

let dir: string;
const ctx: ToolContext = {
  routing: { platformId: "tg:1", channelType: "telegram", threadId: null },
  assistantName: "A",
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "oc-tools-"));
  initTestSessionDb(dir, INBOUND_SCHEMA, OUTBOUND_SCHEMA);
  const db = new Database(inboundPath());
  db.run(
    `INSERT INTO destinations (name, display_name, type, channel_type, platform_id) VALUES ('home', 'Home', 'channel', 'telegram', 'tg:1')`,
  );
  db.run(`INSERT INTO destinations (name, display_name, type, agent_group_id) VALUES ('peer', 'Peer', 'agent', 'g2')`);
  db.close();
  bootstrapTools();
});

afterEach(() => {
  closeSessionDbsForTest();
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      Bun.sleepSync(50);
    }
  }
});

describe("mcp tools", () => {
  it("send_message default routing uses current chat", async () => {
    const out = (await getTool("send_message")!.handler({ text: "hi" }, ctx)) as { ok: boolean };
    expect(out.ok).toBe(true);
    const row = getOutboundDb().prepare("SELECT channel_type, platform_id, content FROM messages_out").get() as {
      channel_type: string;
      platform_id: string;
      content: string;
    };
    expect(row.channel_type).toBe("telegram");
    expect(row.platform_id).toBe("tg:1");
    expect(row.content).toBe("hi");
  });

  it("send_message named agent destination becomes a2a", async () => {
    await getTool("send_message")!.handler({ text: "collab?", destination: "peer" }, ctx);
    const row = getOutboundDb().prepare("SELECT kind, platform_id FROM messages_out").get() as {
      kind: string;
      platform_id: string;
    };
    expect(row.kind).toBe("a2a");
    expect(row.platform_id).toBe("g2");
  });

  it("send_message unknown destination errors", async () => {
    await expect(getTool("send_message")!.handler({ text: "x", destination: "nope" }, ctx)).rejects.toThrow(
      /unknown destination/,
    );
  });

  it("send_file stages into outbox and rejects paths outside workspace", async () => {
    const f = join(getWorkspace(), "report.txt");
    writeFileSync(f, "data");
    const out = (await getTool("send_file")!.handler({ file_path: f, text: "see" }, ctx)) as { id: string };
    expect(existsSync(join(getWorkspace(), "outbox", out.id, "report.txt"))).toBe(true);
    await expect(getTool("send_file")!.handler({ file_path: "/etc/passwd" }, ctx)).rejects.toThrow(/inside \/workspace/);
  });

  it("file tools are sandboxed to workspace", async () => {
    await expect(getTool("read_file")!.handler({ path: "/etc/passwd" }, ctx)).rejects.toThrow(/inside \/workspace/);
    await getTool("write_file")!.handler({ path: "notes/a.md", content: "x" }, ctx);
    const list = (await getTool("list_files")!.handler({ path: "notes" }, ctx)) as string[];
    expect(list).toContain("a.md");
  });

  it("rejects dot-dot traversal after resolve (P0 regression)", async () => {
    const ws = getWorkspace();
    await expect(getTool("read_file")!.handler({ path: `${ws}/../secrets.txt` }, ctx)).rejects.toThrow(
      /inside \/workspace/,
    );
    await expect(getTool("list_files")!.handler({ path: `${ws}/../../` }, ctx)).rejects.toThrow(/inside \/workspace/);
    await expect(getTool("write_file")!.handler({ path: `${ws}/../evil.md`, content: "x" }, ctx)).rejects.toThrow(
      /inside \/workspace/,
    );
    await expect(getTool("send_file")!.handler({ file_path: `${ws}/../x.txt` }, ctx)).rejects.toThrow(
      /inside \/workspace/,
    );
  });

  it.skipIf(process.platform === "win32")("bash executes in container workspace", async () => {
    const out = (await getTool("bash")!.handler({ command: "echo hi" }, ctx)) as { stdout: string };
    expect(out.stdout.trim()).toBe("hi");
  });
});
