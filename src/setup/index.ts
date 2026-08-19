/**
 * setup/index.ts ?”â€?å®‰è??‘å¯¼?¥å£ï¼?-step <name> [args] / --listï¼? *
 * ?Œè´£ï¼šæ­¥éª¤å??‘å™¨ï¼›æ­¥éª¤å³?¬ç??¯é?è·‘å??ƒï?ä¸‰çº§è¾“å‡ºå¥‘çº¦ L1 ?±è??¨æ–¹æ¸²æ?ï¼‰ã€? * ?³é”®å¯¼å‡ºï¼šmain
 * ?Ÿé‰´ï¼šnanoclaw setup/index.ts
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-13 ?›å»ºï¼ˆé˜¶æ®?8ï¼? */
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
  // ä»…å?ä»?setup ?¥å£è¿è??¶æ‰§è¡Œï??¿å?ä¸ä¸»??index.ts ?²ç?ï¼šæ?ä»¶å??Œä¸º indexï¼Œé? OC_SETUP ?¯å??˜é??ºå?ï¼?  if (process.env.OC_SETUP === "1") {
    main(process.argv.slice(2)).catch((err) => {
      console.error(String(err));
      process.exit(1);
    });
  }
}
