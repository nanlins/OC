/**
 * cli/resources.ts —— 兼容 shim（R-6 拆分后）
 *
 * 职责：真实实现已拆到 src/cli/resources/（每个资源一个文件 + index.ts 编排桶）。
 *       本文件只做 re-export，避免旧导入路径（socket-server/web server）破坏。
 * 关键导出：registerAllResources（转发自 ./resources/index.js）
 *
 * 修改记录：
 *   2026-08-12 创建（阶段 7）
 *   2026-10-06 R-6：拆分为 src/cli/resources/*，本文件降级为 re-export shim
 */
export { registerAllResources } from "./resources/index.js";
