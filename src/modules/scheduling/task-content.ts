/**
 * modules/scheduling/task-content.ts —— 任务内容信封
 *
 * 职责：任务内容统一为 JSON 信封 {prompt, script, originSessionId}；解析时对纯字符串
 *       旧任务向后兼容（视为只有 prompt）。
 * 关键导出：TaskEnvelope, parseTaskContent, composeTaskContent
 * 借鉴：nanoclaw src/modules/scheduling/task-content.ts
 *
 * 修改记录：2026-10-06 创建（P0-3：任务信封 + pre-task 脚本门控）
 */
export interface TaskEnvelope {
  prompt: string;
  /** pre-task 脚本（容器在唤醒 LLM 前执行；失败/超时/wakeAgent=false 按 script-skip 处理）。 */
  script: string | null;
  originSessionId: string | null;
}

const ENVELOPE_KEYS = ["prompt", "script", "originSessionId"] as const;

/** 解析任务内容：JSON 信封或纯字符串（旧任务兼容）。非法 JSON 按纯字符串处理（不丢任务）。 */
export function parseTaskContent(content: string): TaskEnvelope {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rec = parsed as Record<string, unknown>;
      if (
        typeof rec.prompt === "string" &&
        Object.keys(rec).every((k) => (ENVELOPE_KEYS as readonly string[]).includes(k))
      ) {
        return {
          prompt: rec.prompt,
          script: typeof rec.script === "string" ? rec.script : null,
          originSessionId: typeof rec.originSessionId === "string" ? rec.originSessionId : null,
        };
      }
    }
  } catch {
    /* 落入字符串兼容分支 */
  }
  return { prompt: content, script: null, originSessionId: null };
}

export function composeTaskContent(env: Pick<TaskEnvelope, "prompt"> & Partial<TaskEnvelope>): string {
  // 无 script / originSessionId 时保持纯字符串形态（旧容器直接读 content 当 prompt，完全兼容）
  if (!env.script && !env.originSessionId) return env.prompt;
  return JSON.stringify({
    prompt: env.prompt,
    script: env.script ?? null,
    originSessionId: env.originSessionId ?? null,
  });
}
