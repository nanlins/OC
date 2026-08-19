# OC ?”â€?ä¸ªäºº AI ?©æ?å¹³å°
?¶æ?ä¸€?¥è?
?•è?ç¨?Node ä¸»æœºç¼–æ??Œæ?ä¼šè?ä¸€ä¸?Docker å®¹å™¨?ç? Agent ?†ç¾¤?‚ä¸»?ºä?å®¹å™¨ä¹‹é—´**æ²¡æ? IPC**ï¼Œå”¯ä¸€ IO ?¢æ˜¯æ¯ä?è¯ä¸¤??SQLite?”â€”`inbound.db`ï¼ˆä¸»?ºå?/å®¹å™¨?ªè¯»ï¼‰å? `outbound.db`ï¼ˆå®¹?¨å?/ä¸»æœº?ªè¯»ï¼‰ï??„æ?ä»¶æ°å¥½ä?ä¸ªå??…ã€?
## å¿«é€Ÿå?å§?
```bash
# 1. å®‰è?ä¾è?
pnpm install

# 2. ?ç½® .envï¼ˆå???.env.example ä¸?.envï¼Œå¡« LLM ?­æ®ï¼?#    OpenAI ?¼å®¹ç«¯ç‚¹ï¼ˆDeepSeek/GLM/Qwen?¦ï?ï¼?#    OPENAI_API_KEY=sk-xxx
#    OPENAI_BASE_URL=https://api.deepseek.com/v1
#    ??key ä½“é?ï¼šå»ºç»„æ—¶ --provider mockï¼ˆçº¯ echoï¼Œé?è¯å…¨?¾è·¯ï¼?
# 3. ?„å»º Agent å®¹å™¨?œå?
pnpm build:container

# 4. ?¯åŠ¨ï¼ˆå??¥å£ï¼ŒWeb ?§åˆ¶?°é?ä¸»æœº?åŠ¡äº?http://127.0.0.1:8080ï¼?pnpm start

# 5. ?„å»º?ç«¯ï¼ˆReact äº§ç‰©?±ä¸»??8080 ?´æ¥?åŠ¡ï¼Œæ??€?•ç‹¬è·‘å?ç«¯ï?
pnpm build:web

# 6. ä¸?Agent å¯¹è?
pnpm exec tsx scripts/chat.ts "ä½ å¥½ï¼Œä?ç»ä?ä¸‹ä??ªå·±"

# 7. ç®¡ç? CLI
pnpm oc -- groups list
pnpm oc -- groups create --name demo --folder demo --provider openai
pnpm oc -- help
```

é¦–æ¬¡å¯¹è?ä¼šå†·?¯åŠ¨å®¹å™¨ï¼ˆçº¦? ç?ï¼‰ã€‚è¯¦ç»?API ?‚è€ƒè? `docs/api-reference.md`??
## ?®å?ç»“æ?

| ?®å? | è¯´æ? |
|------|------|
| `src/` | ä¸»æœºæºç?ï¼šå…¥????’ã€è·¯?±ã€æ??’ã€ä?è¯ç®¡?†ã€å®¹?¨è?è¡Œã€å·¡æ£€?CLI?guard?æ¨¡??|
| `src/db/` | ä¸­å¤® DB å±‚ï?è¿æ¥ç®¡ç??è¡¨ç»“æ??è?ç§»ç³»ç»Ÿã€å?è¡?CRUD |
| `src/db/migrations/` | è¿ç§»è¿è??¨ï?name ?»é? + FK å®‰å…¨?è®® + 001 ?å?è¿ç§»ï¼?|
| `src/channels/` | 9 ä¸ªé€šé??‚é??¨ï?Telegram/Discord/Slack/é£ä¹¦/?‰é?/ä¼å¾®/Email/Webhook/CLIï¼?|
| `src/cli/` | CLI ç®¡ç?å·¥å…·ï¼šå¸§?è®®?å‘½ä»¤æ³¨?Œè¡¨?dispatch ?†å??¨ã€CRUD ?Ÿæ??¨ã€socket ?åŠ¡ |
| `src/guard/` | guard fail-closed ?ˆæ?ï¼šå†³ç­–å‡½?°ã€åŠ¨ä½œå€¼ã€ç±»?‹å?ä¹?|
| `src/providers/` | Provider ä¸»æœºä¾§å®¹?¨è´¡?®ï?openai/claude å¯†é’¥æ³¨å…¥ï¼?|
| `src/modules/` | 11 ä¸ªæ¨¡?—ï??ƒé??å®¡?¹ã€è?åº¦ã€A2A?äº¤äº’ã€è‡ª?¹ã€RAG(memory-kb)?æ?è½½å??¨ã€è?æµ‹ã€é?é¢ã€æ?å­?|
| `src/eval/` | è¯„ä¼°ä½“ç³»ï¼šæ?ç´¢æ??‡ã€Judgeï¼ˆMock/Llmï¼‰ã€è½¨è¿?JSONL?è¯­?™ç???|
| `src/i18n/` | ä¸‰è¯­è¿è??¶ï?zh/en/jaï¼‰ï?t/negotiateLocale/LocalizedError |
| `src/web/` | Web ç®¡ç??§åˆ¶?°ï?REST APIï¼ˆfail-closed ?´æ?+CSRF+413ï¼‰ã€SSE äº‹ä»¶?é??æ???|
| `src/skills/` | nc: ?‡ä»¤å¼•æ?ï¼šè¯­æ³•è§£?ã€ç??¥å??ã€å?è£…æ‰§è¡Œå™¨ |
| `src/setup/` | å®‰è??‘å¯¼ï¼ˆenvironment/timezone/set-env/verify ?›æ­¥ï¼?|
| `container/` | Docker ?œå??„å»º?šæœ¬ + Dockerfileï¼ˆoven/bun:debian + æºç?/?€?½ç??™ï? |
| `container/agent-runner/src/` | å®¹å™¨??Agent ?§è?å¼•æ?ï¼ˆBunï¼‰ï?è½®è¯¢å¾ªç¯?æ??¯æ ¼å¼å??Provider ?½è±¡?MCP å·¥å…·?KB æ£€ç´¢ã€æ??½å?è½½ã€è®°å¿?|
| `container/agent-runner/src/db/` | å®¹å™¨ä¼šè? DB ?ä?ï¼šè??¥ç®¡?†ã€å…¥ç«??ºç?è¯»å??ä?è¯çŠ¶?ã€è¡¨ç»“æ? |
| `container/agent-runner/src/providers/` | å®¹å™¨ä¾?Provider å®ç°ï¼šclaude/openaiï¼ˆæ?å¼å??è§£?ï?/ollama/mock + å·¥å…·å¾ªç¯ |
| `container/agent-runner/src/mcp-tools/` | MCP å·¥å…·?†ï??ºç??›ä»¶å¥—ã€æ?ä»?Bash?äº¤äº?è°ƒåº¦/Web?kb_search |
| `container/skills/` | 20 ä¸ªå®¹?¨æ??½ï?SKILL.mdï¼?|
| `scripts/` | è¿ç»´?šæœ¬ï¼šchat/send-once/set-group-model/delete-wiring/kb ç®¡ç? |
| `tests/` | ä¸»æœºæµ‹è?ï¼?09 ?¨ä?ï¼‰ï??•å?/?†æ?/eval |
| `web/frontend/` | React ?ç«¯ï¼ˆVite 7ï¼‰ï?6 é¡µé¢ç®¡ç??§åˆ¶??+ ä¸‰è¯­ i18n + SSE äº‹ä»¶?´æ’­ |
| `bin/` | CLI ?¥å£ï¼ˆocï¼?|
| `docs/` | é¡¹ç›®?‡æ¡£ï¼šæ¶?„è®¾è®¡ã€å??¨æ¨¡?‹ã€API ?‚è€?|

## è´¨é??½ä»¤

```bash
pnpm typecheck && pnpm lint && pnpm test   # ä¸»æœºï¼štsc + eslint + vitestï¼?09 ?¨ä?ï¼?cd container/agent-runner && bun test       # å®¹å™¨ï¼šbun testï¼?8 ?¨ä?ï¼?pnpm format:check                           # prettier ?¼å?æ£€??```

## è¯šå????

- **RAG**ï¼šå…³?®è??¬å?ï¼ˆBM25-liteï¼? ?¯æ³¨??embedding ?‘é?æ£€ç´¢ï?cosine + ?ˆå€¼æ?ç­”ï?ï¼Œ`kb_search` å·²æ¥??agent?‚æœªä½¿ç”¨ sqlite-vec/pgvectorï¼Œembedding ?Ÿäº§?€?¥ç?å®?APIï¼ˆæ¥??·²?™ï???- **å¯†é’¥æ¨¡å?**ï¼š`.env` ??0600 env-file æ³¨å…¥å®¹å™¨ï¼ˆä?è¿?docker argvï¼‰ã€‚å¼±äºåŸºçº?OneCLI ç½‘å…³??token ä¸è?å®¹å™¨"ï¼Œå?å·²è®°å½•ç??–è???- **æµå?**ï¼šprovider å±‚æ?å¼?+ ç¼–è?å¼å??æ??’ï?telegram ?¯æ? editMessageTextï¼›å…¶ä½™æ???operation/editTarget å·²é€ä?ï¼‰ã€?- **æµ‹è?**ï¼šå…¨ Mockï¼Œä??Ÿè? LLM/Docker/ç½‘ç?ï¼›ç?å®?DeepSeek ç«¯åˆ°ç«¯æ?å·¥è??šã€?
## ?´å??‡æ¡£

- `docs/architecture.md` ???¶æ?è®¾è®¡ï¼šå?ä½“æ¨¡?‹ã€å? DB ä¼šè??è¯·æ±‚æ??å®¹?¨é?ç¦»ã€æ¨¡?—å?
- `docs/security.md` ??å®‰å…¨æ¨¡å?ï¼šguard fail-closed?å®¹?¨æ?ç®±ã€Web å®‰å…¨?å??¥ç®¡?†ã€å®¡?¹æ?
- `docs/api-reference.md` ??API ?‚è€ƒï?CLI ?½ä»¤?Web REST API?Agent å¯¹è??æ?è¯•ä??„å»º?½ä»¤