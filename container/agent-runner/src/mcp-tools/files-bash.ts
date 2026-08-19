/**
 * mcp-tools/files-bash.ts —— 文件三件套 + bash（容器内沙箱执行）
 *
 * 职责：read_file/write_file/list_files（限 /workspace）；bash 带超时 + 工具在飞标记。
 * 关键导出：registerFilesBashTools
 * 承重不变量：bash 在容器内执行（隔离即安全）；container_state 联动。
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 4）；重写修复转码损坏
 *   2026-08-12 ai-inspector 修复：resolve 归一防 .. 穿越（P0）；bash 超时 clamp 10min
 */
import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getWorkspace, setContainerToolInFlight, clearContainerToolInFlight } from "../db/connection.ts";
import { registerTools } from "./registry.ts";

function assertInsideWorkspace(p: string): string {
  const ws = getWorkspace();
  const norm = (x: string) => x.replace(/\\/g, "/"); // Windows 分隔符归一
  const abs = p.startsWith("/") || /^[A-Za-z]:/.test(p) ? p : join(ws, p);
  // P0 修复（ai-inspector）：resolve 归一消除 .. 穿越后再做前缀比较
  const real = resolve(abs);
  if (!norm(real).startsWith(`${norm(resolve(ws))}/`) && norm(real) !== norm(resolve(ws))) {
    throw new Error("path must be inside /workspace");
  }
  return real;
}

export function registerFilesBashTools(): void {
  registerTools([
    {
      name: "read_file",
      description: "Read a UTF-8 text file inside /workspace.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: async (args) => readFileSync(assertInsideWorkspace(String(args.path)), "utf8"),
    },
    {
      name: "write_file",
      description: "Write a text file inside /workspace (creates parent dirs).",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
      handler: async (args) => {
        const abs = assertInsideWorkspace(String(args.path));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, String(args.content));
        return { ok: true };
      },
    },
    {
      name: "list_files",
      description: "List a directory inside /workspace.",
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      handler: async (args) => readdirSync(assertInsideWorkspace(String(args.path))),
    },
    {
      name: "bash",
      description: "Run a bash command inside this container (never on the host).",
      parameters: {
        type: "object",
        properties: { command: { type: "string" }, timeout: { type: "number", description: "ms, default 30000" } },
        required: ["command"],
      },
      handler: async (args) => {
        const timeout = Math.min(Number(args.timeout ?? 30000), 600000); // P1-8 修复：clamp 10min 硬上限
        setContainerToolInFlight("Bash", timeout);
        try {
          return await new Promise((resolvePromise, rejectPromise) => {
            execFile(
              "bash",
              ["-c", String(args.command)],
              { cwd: getWorkspace(), timeout, maxBuffer: 1024 * 1024 },
              (err, stdout, stderr) => {
                if (err) rejectPromise(new Error(`bash failed: ${err.message}\n${stderr}`));
                else resolvePromise({ stdout, stderr });
              },
            );
          });
        } finally {
          clearContainerToolInFlight();
        }
      },
    },
  ]);
}
