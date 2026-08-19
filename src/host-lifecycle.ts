/**
 * host-lifecycle.ts —— 主机模块启停编排注册表
 *
 * 职责：模块在导入期惰性注册 start/shutdown 回调；index.ts 统一编排。
 * 关键导出：onHostStart, onHostShutdown, startHostModules, stopHostModules
 * 核心模式：start 串行执行、一个失败即中止启动；shutdown 逆序执行、单个失败只记日志不阻断。
 * 借鉴：nanoclaw src/host-lifecycle.ts
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 2）
 */
import { log } from "./log.js";

type Hook = () => void | Promise<void>;

const startHooks: Array<{ name: string; fn: Hook }> = [];
const shutdownHooks: Array<{ name: string; fn: Hook }> = [];

export function onHostStart(name: string, fn: Hook): void {
  startHooks.push({ name, fn });
}

export function onHostShutdown(name: string, fn: Hook): void {
  shutdownHooks.push({ name, fn });
}

/** 串行启动；任一失败抛错中止主机（fail-fast） */
export async function startHostModules(): Promise<void> {
  for (const h of startHooks) {
    log.info(`host start: ${h.name}`);
    await h.fn();
  }
}

/** 逆序关停；单个失败只记日志（保证后续清理继续） */
export async function stopHostModules(): Promise<void> {
  for (const h of [...shutdownHooks].reverse()) {
    try {
      await h.fn();
    } catch (err) {
      log.error(`host shutdown hook failed: ${h.name}`, { err });
    }
  }
}

/** 仅供测试 */
export function clearHostLifecycleHooksForTest(): void {
  startHooks.length = 0;
  shutdownHooks.length = 0;
}
