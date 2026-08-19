/**
 * setup/index.ts —— 安装向导入口（--step <name> [args] / --list）
 *
 * 职责：步骤分发器；步骤即独立可重跑单元（三级输出契约 L1 由调用方渲染）。
 * 关键导出：main
 * 借鉴：nanoclaw setup/index.ts
 *
 * 修改记录：
 *   2026-08-13 创建（阶段 8）
 */
import { listSteps, runStep } from "./runner.js";
import { registerBuiltinSteps } from "./steps.js";

registerBuiltinSteps();

export async function main(argv: string[]): Promise<void> {
  if (argv[0] === "--list") {
    console.log(listSteps().join("\n"));
    return;
  }
  if (argv[0] === "--step" && argv[1]) {
    const kv = await runStep(argv[1], argv.slice(2));
    console.log(JSON.stringify(kv));
    return;
  }
  console.log("usage: setup --step <name> [args] | --list");
}

import { basename } from "node:path";
const entry = process.argv[1] ? basename(process.argv[1]) : "";
if (entry === "index.ts" || entry === "index.js") {
  // 仅当以 setup 入口运行时执行（避免与主机 index.ts 冲突：文件名同为 index，靠 OPENCLAW_SETUP 环境变量区分）
  if (process.env.OPENCLAW_SETUP === "1") {
    main(process.argv.slice(2)).catch((err) => {
      console.error(String(err));
      process.exit(1);
    });
  }
}
