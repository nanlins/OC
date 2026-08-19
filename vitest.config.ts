// vitest.config.ts ?”â€?æµ‹è?è¿è??¨é?ç½?// è¯´æ?ï¼šåªè·?tests/ ä¸‹ç? Node ä¾§æ?è¯•ï?å®¹å™¨ä¾?agent-runner æµ‹è???bun:testï¼Œä??¨æ­¤è¿è?ï¼ˆå€Ÿé‰´ nanoclaw ?Œæ?è¯•æ?çºªå?ï¼‰ã€?// ä¿®æ”¹è®°å?ï¼?//   2026-08-12 ?›å»ºï¼ˆé˜¶æ®?0ï¼?//   2026-08-12 ?¶æ®µ 2ï¼štest.env æ³¨å…¥ OC_DATA_DIR ?”ç¦»æµ‹è??°æ®?®å?
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**", "container/**"],
    testTimeout: 10000,
    // æµ‹è??°æ®?®å?ä¸é¡¹??data/ ?”ç¦»ï¼ˆconfig.ts ? è½½?Ÿè¯»?–ï?ï¼›WEB_TOKEN ?ºå?ä¾›æ?è¯•é‰´?ƒï?fix-plan P0 fail-closedï¼?    env: {
      OC_DATA_DIR: `${process.env.TEMP ?? "/tmp"}/OC-test-data`,
      WEB_TOKEN: "test-web-token",
    },
  },
});
