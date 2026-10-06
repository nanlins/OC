/**
 * scheduling/task-script.ts —— pre-task 脚本门控（P0-3）
 *
 * 职责：任务消息带 script 信封时，在唤醒 LLM 前执行脚本并按输出决策：
 *   - 输出 JSON `{wakeAgent: bool, data?: any}`：wakeAgent=true 才继续，data 附加进提示；
 *   - 错误退出 / 超时 / 输出超限 / 无输出 / 非法 JSON / wakeAgent=false → script-skip
 *     （写 processing_ack status='script-skip:error'，宿主 syncProcessingAcks 映射为 failed）。
 * 关键导出：parseTaskEnvelope, runTaskScriptGate, TaskEnvelope, ScriptGateResult
 *
 * 承重说明：脚本经 `bash -c` 运行，超时先 SIGTERM 进程组、2s 宽限后 SIGKILL。脚本进程在
 * Agent 容器沙箱内（--cap-drop=ALL），即使逃逸进程组也受容器生命周期约束。
 *
 * 借鉴：nanoclaw container/agent-runner/src/scheduling/task-script.ts
 *
 * 修改记录：2026-10-06 创建（P0-3：pre-task 脚本门控；修复 README 的 script-gate.ts 幻影引用）
 */

export interface TaskEnvelope {
  prompt: string;
  script: string | null;
  originSessionId: string | null;
}

const ENVELOPE_KEYS = ["prompt", "script", "originSessionId"] as const;

/** 与宿主 src/modules/scheduling/task-content.ts 同语义（两运行时无共享模块，需手工同步）。 */
export function parseTaskEnvelope(content: string): TaskEnvelope {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      if (typeof rec.prompt === "string" && Object.keys(rec).every((k) => (ENVELOPE_KEYS as readonly string[]).includes(k))) {
        return {
          prompt: rec.prompt,
          script: typeof rec.script === "string" ? rec.script : null,
          originSessionId: typeof rec.originSessionId === "string" ? rec.originSessionId : null,
        };
      }
    }
  } catch {
    /* 落入纯字符串兼容分支 */
  }
  return { prompt: content, script: null, originSessionId: null };
}

export interface ScriptGateResult {
  decision: "wake" | "skip";
  reason: string;
  data?: string;
  elapsedMs: number;
}

export interface ScriptGateOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  killGraceMs?: number;
  /**
   * 测试缝：注入脚本启动器（替代 BashSpawn）。生产路径用 BashSpawn 跑 `bash -c script`；
   * 单测注入可控进程，使决策逻辑（wakeAgent/坏 JSON/超时/超限）确定性可测，不依赖宿主机 bash。
   */
  spawnScript?: ScriptSpawn;
  /** 测试缝：注入进程组信号发送（生产 = signalGroup；单测 = no-op，避免真的 spawn bash）。 */
  killGroup?: (pid: number, signal: string) => void;
}

/** 脚本进程抽象（Bun.Subprocess 的最小面）。 */
export interface ScriptProcess {
  pid: number;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
}

export type ScriptSpawn = (script: string) => ScriptProcess;

const BashSpawn: ScriptSpawn = (script) => Bun.spawn(["bash", "-c", script], { stdout: "pipe", stderr: "pipe" });

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_KILL_GRACE_MS = 2_000;

/** 向 bash 的子进程组发信号（bash 内建 kill 支持负 pid = 进程组）。 */
function signalGroup(pid: number, signal: string): void {
  try {
    Bun.spawn(["bash", "-c", `kill -${signal} -- -${pid} 2>/dev/null || true`], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    /* 组信号失败不阻断主流程 */
  }
}

export async function runTaskScriptGate(script: string, opts: ScriptGateOptions = {}): Promise<ScriptGateResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const graceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const start = Date.now();

  let stdout = "";
  let stderr = "";
  let overLimit = false;
  let timedOut = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const proc = (opts.spawnScript ?? BashSpawn)(script);
  const killGroup = opts.killGroup ?? signalGroup;

  const pump = async (stream: ReadableStream<Uint8Array> | null, isOut: boolean): Promise<void> => {
    if (!stream) return;
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = new TextDecoder().decode(value);
        if (isOut) {
          stdout += chunk;
          if (stdout.length > maxBytes && !overLimit) {
            overLimit = true;
            killGroup(proc.pid, "TERM"); // 输出超限即停脚本，不再累积
          }
        } else {
          stderr += chunk;
        }
      }
    } catch {
      /* 流被关闭：忽略 */
    }
  };

  // 超时/正常完成二选一裁决：超时立即返回 skip，不等待进程真死
  // （进程组信号在部分环境（如 WSL 桥）是尽力而为，不能把决策绑在"杀得掉"上）。
  const outcome = await Promise.race([
    (async () => {
      await Promise.all([pump(proc.stdout, true), pump(proc.stderr, false)]);
      const exitCode = await proc.exited;
      return { done: true, exitCode } as const;
    })(),
    new Promise<{ done: false }>((resolve) => {
      const t = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        killGroup(proc.pid, "TERM");
        setTimeout(() => {
          if (!settled) killGroup(proc.pid, "KILL");
        }, graceMs);
        resolve({ done: false });
      }, timeoutMs);
      timer = t;
    }),
  ]);
  settled = true;
  if (timer) clearTimeout(timer);

  const elapsedMs = Date.now() - start;
  const trimmed = stdout.trim();

  if (!outcome.done || timedOut) {
    return { decision: "skip", reason: `script timeout after ${timeoutMs}ms`, elapsedMs };
  }
  if (overLimit) return { decision: "skip", reason: `output exceeded ${maxBytes} bytes`, elapsedMs };
  if (outcome.exitCode !== 0) {
    return { decision: "skip", reason: `script exited ${outcome.exitCode}: ${stderr.trim().slice(0, 200)}`, elapsedMs };
  }
  if (!trimmed) return { decision: "skip", reason: "script produced no output", elapsedMs };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { decision: "skip", reason: "script output is not valid JSON", elapsedMs };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { decision: "skip", reason: "script output JSON is not an object", elapsedMs };
  }
  const rec = parsed as Record<string, unknown>;
  if (rec.wakeAgent !== true) {
    return { decision: "skip", reason: "wakeAgent !== true", elapsedMs };
  }
  return {
    decision: "wake",
    reason: "ok",
    data: typeof rec.data === "string" ? rec.data : rec.data !== undefined ? JSON.stringify(rec.data) : undefined,
    elapsedMs,
  };
}
