/**
 * setup/status.ts ?”â€?ä¸‰çº§è¾“å‡ºå¥‘çº¦ä¹?L2 ?¶æ€å?
 *
 * ?Œè´£ï¼šemitStatus ?“å° `=== OC SETUP: TYPE ===` KEY: value `=== END ===` ?—ï?
 *       ä¾?runner è§??ï¼›æ­¥éª¤ä?ç¼–æ??¨ä??´æ??…å??±äº«ï¼ˆå¯?•ç‹¬?è?ï¼‰ã€? * ?³é”®å¯¼å‡ºï¼šemitStatus, STATUS_BEGIN, STATUS_END
 * ?Ÿé‰´ï¼šnanoclaw setup/status.ts + docs/setup-flow.md ä¸‰çº§è¾“å‡ºå¥‘çº¦
 *
 * ä¿®æ”¹è®°å?ï¼? *   2026-08-13 ?›å»ºï¼ˆé˜¶æ®?8ï¼? */
export const STATUS_BEGIN = (type: string) => `=== OC SETUP: ${type} ===`;
export const STATUS_END = "=== END ===";

export function emitStatus(type: string, kv: Record<string, string | number | boolean>): void {
  const lines = [STATUS_BEGIN(type)];
  for (const [k, v] of Object.entries(kv)) lines.push(`${k}: ${String(v)}`);
  lines.push(STATUS_END);
  process.stdout.write(lines.join("\n") + "\n");
}
