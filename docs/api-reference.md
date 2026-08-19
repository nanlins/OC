# OC API ?‚è€?
> CLI ç®¡ç??½ä»¤?Web REST API?Agent å¯¹è?å®¢æˆ·ç«¯ç?å®Œæ•´?‚è€ƒã€?
## 1. CLI ç®¡ç??½ä»¤ï¼ˆ`oc`ï¼?
```bash
npm run oc -- <resource> <verb> [--flags]
# ?–ï?pnpm oc -- <resource> <verb> [--flags]
```

### èµ„æ??—è¡¨

| èµ„æ? | ?¨è? | è¯´æ? |
|------|------|------|
| `groups` | `list` `get` `create` | Agent ç¾¤ç?ç®¡ç??‚`create --name X --folder Y --provider openai` |
| `messaging-groups` | `list` `get` | æ¶ˆæ¯ç¾¤ç?ï¼ˆåªè¯»ï? |
| `wirings` | `list` `get` `create` | ?¥çº¿ç®¡ç??‚`create --messaging-group <id> --agent-group <id> --engage pattern` |
| `users` | `list` `get` | ?¨æˆ·ï¼ˆåªè¯»ï? |
| `roles` | `list` `grant` `revoke` | è§’è‰²ç®¡ç? |
| `members` | `list` `add` `remove` | ç¾¤ç??å? |
| `sessions` | `list` `get` | ä¼šè?ï¼ˆåªè¯»ï? |
| `tasks` | `list` `cancel` | ä»»åŠ¡ç®¡ç? |
| `approvals` | `list` `get` `resolve` | å®¡æ‰¹ç®¡ç? |
| `dropped` | `list` | ä¸¢å?æ¶ˆæ¯ï¼ˆåªè¯»ï? |
| `kb` | `add` `sync` | ?¥è?åº“ã€‚`add --kb X --title Y --text Z`ï¼›`sync --kb X --group <id>` |
| `eval` | `run` `report` | è¯„ä¼°?‚`run --kb X`ï¼›`report` |
| `help` | ??| ?—å‡º?€?‰å‘½ä»?|

### ç¤ºä?

```bash
oc groups list
oc groups create --name demo --folder demo --provider openai
oc groups get <group-id>
oc wirings create --messaging-group <mg-id> --agent-group <ag-id>
oc kb add --kb kb --title "?€æ¬¾æ”¿ç­? --text "å¦‚ä??³è¯·?€æ¬¾â€?
oc eval run --kb kb
oc help
```

## 2. Web REST API

?ºç? URLï¼š`http://127.0.0.1:8080`?‚é‰´?ƒï?`Authorization: Bearer <token>`ï¼ˆtoken ??`data/web-token` ??`.env` ??`WEB_TOKEN`ï¼‰ã€?
### ?ªè¯»?•å½±

| ç«¯ç‚¹ | è¯´æ? |
|------|------|
| `GET /api/groups` | Agent ç¾¤ç??—è¡¨ |
| `GET /api/messaging-groups` | æ¶ˆæ¯ç¾¤ç??—è¡¨ |
| `GET /api/wirings` | ?¥çº¿?—è¡¨ |
| `GET /api/sessions` | ä¼šè??—è¡¨ |
| `GET /api/sessions/:id/messages` | ä¼šè?æ¶ˆæ¯?—è¡¨ |
| `GET /api/approvals` | å®¡æ‰¹?—è¡¨ |
| `GET /api/audit` | å®¡è®¡è®°å? |
| `GET /api/usage` | ?¨é?ç»Ÿè®¡ |
| `GET /api/traces/:sessionId` | Agent è½¨è¿¹ï¼ˆJSONLï¼?|

### ?¨ä?

| ç«¯ç‚¹ | ?¹æ? | è¯´æ? |
|------|------|------|
| `/api/approvals/resolve` | POST | å®¡æ‰¹?³è®®?‚`{id, decision: "approve"\|"reject"}` |
| `/api/wirings` | POST | ?›å»º?¥çº¿?‚`{messagingGroupId, agentGroupId}` |

### SSE äº‹ä»¶

| ç«¯ç‚¹ | è¯´æ? |
|------|------|
| `GET /events` | äº‹ä»¶?´æ’­ï¼ˆ`text/event-stream`ï¼‰ï??‘å? `hello` / `test-event` ç­?|

### ?™è¯¯?å?

```json
{ "error": "?¬åœ°?–é?è¯¯æ?æ¡?, "code": "api.err.unauthorized" }
```

?¶æ€ç?ï¼?01ï¼ˆæœª?ˆæ?ï¼‰ã€?03ï¼ˆCSRFï¼‰ã€?04ï¼ˆæœª?¾åˆ°ï¼‰ã€?13ï¼ˆè¯·æ±‚ä?è¿‡å¤§ï¼‰ã€?05ï¼ˆæ–¹æ³•ä??è®¸ï¼‰ã€?00ï¼ˆå??¨é?è¯¯ï???
## 3. Agent å¯¹è?

### CLI ?šé?å¯¹è?

```bash
pnpm exec tsx scripts/chat.ts "ä½ ç?æ¶ˆæ¯"
```

è¿æ¥ CLI ?½å?ç®¡é?ï¼Œå??æ??¯å¹¶ç­‰å??å??‚é??¡å?å¤å??™é? 3 ç§’é€€?ºã€?
### ç®¡ç?å·¥å…·

```bash
pnpm exec tsx scripts/send-once.ts "init"     # ?‘ä??¡å³?€ï¼ˆè§¦??MG ?ªåŠ¨?›å»ºï¼?pnpm exec tsx scripts/set-group-model.ts <group-id> <provider> <model>
pnpm exec tsx scripts/delete-wiring.ts <wiring-id>
```

## 4. æµ‹è??½ä»¤

```bash
pnpm test                    # ä¸»æœº vitestï¼?09 ?¨ä?ï¼?pnpm typecheck               # ä¸»æœº tsc --noEmit
pnpm lint                    # eslint src/ tests/
pnpm format                  # prettier --write
pnpm format:check            # prettier --check

cd container/agent-runner
bun test                     # å®¹å™¨æµ‹è?ï¼?8 ?¨ä?ï¼?bun run typecheck            # å®¹å™¨ tsc --noEmit

cd web/frontend
pnpm test                    # ?ç«¯æµ‹è?ï¼?5 ?¨ä?ï¼?pnpm build                   # ?ç«¯?„å»º
```

## 5. ?„å»º?½ä»¤

```bash
pnpm build                   # ç¼–è?ä¸»æœº TypeScript ??dist/
pnpm build:container         # ?„å»º Agent å®¹å™¨ Docker ?œå?
pnpm build:web               # ?„å»º React ?ç«¯ ??web/frontend/dist/
```