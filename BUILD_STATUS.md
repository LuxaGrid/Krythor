# Krythor — Build Status Check

**Version:** 0.1.1
**Date:** 2026-03-16
**Tests:** 44 passing across 6 packages
**Build:** All 8 packages compile clean

This document is the honest current state of the build — what works, what is incomplete, and what the priority order for next work is.

---

## Overall Health

| Package | Build | Tests | State |
|---------|-------|-------|-------|
| @krythor/core | ✅ | 13/13 | Complete |
| @krythor/gateway | ✅ | 5/5 | Complete |
| @krythor/memory | ✅ | 8/8 | Complete (stub embeddings) |
| @krythor/models | ✅ | 7/7 | Complete |
| @krythor/guard | ✅ | 10/10 | Complete |
| @krythor/skills | ✅ | — | **Stub only** |
| @krythor/setup | ✅ | — | Complete |
| @krythor/control | ✅ | — | Complete |

**Security:** Token auth, rate-limiting, API key masking, SSRF protection, ReDoS protection all shipped.

---

## What Works End-to-End

- Chat with persistent conversations (sidebar, rename, delete, history reload)
- Token-by-token SSE streaming with animated cursor and Stop button
- Agent management (create, edit, delete, run, temperature/maxTurns/maxTokens)
- Multi-turn agent reasoning loop (both streaming and non-streaming)
- Memory storage, search, pin/unpin, decay
- Model provider management (Ollama, OpenAI, Anthropic, OpenAI-compat)
- Guard policy with rule engine, audit log, 4 built-in rules
- Self-hosted fonts, dark UI, keyboard shortcuts, onboarding wizard
- Windows launcher (auto-build on first run), Mac/Linux install script
- Auth token auto-generated on first run; browser UI bootstraps silently
- Rate limiting (300 req/min), WebSocket auth

---

## Issues Found — Priority Order

### HIGH — Fix These Next

---

**H-1: No-provider placeholder leaks into chat as a "response"**
Files: `packages/core/src/agents/AgentRunner.ts:156–158, 283–286`

When no model provider is configured, the agent produces:
```
[Agent "Krythor" — no model provider configured. Input: hello]
```
This gets saved to the conversation history as an assistant message and streamed to the UI as if it were a real response. On next run the model then sees this garbage in its context.

Fix: Return a structured error / 503 response instead of a fake assistant message. Don't write it to conversation history.

---

**H-2: Regenerate sends stale failed response as context**
File: `packages/control/src/components/CommandPanel.tsx`

"Regenerate" replaces the last assistant message in the local React state but sends the conversation ID to the backend unchanged. The backend still has the old (failed/bad) assistant message in the database, so the model receives: `[user msg] → [bad response] → [user msg again]`. The regenerated response is therefore conditioned on the wrong history.

Fix: Before regenerating, delete the last assistant message from the conversation store via the API, then resubmit.

---

**H-3: Conversations can be created with a dangling agentId**
File: `packages/control/src/components/CommandPanel.tsx` (createConversation call)
File: `packages/memory/src/db/ConversationStore.ts`

If the user selects an agent, deletes it in AgentsPanel (different tab), then sends a message — a new conversation is created with the now-deleted agentId. No foreign key enforcement in SQLite schema.

Fix: Add `ON DELETE SET NULL` to `conversations.agent_id` foreign key reference (requires the schema to declare the FK properly), or validate agentId exists before creating the conversation.

---

**H-4: WebSocket reconnect after auth — token may not be set yet**
File: `packages/control/src/GatewayContext.tsx:54–63`

The WS reconnect timer fires 3 seconds after disconnect with `setTimeout(connect, 3000)`. The `connect` function reads `getGatewayToken()` at call time. On a fresh page load, if the WS disconnect happens before the first health poll returns (which sets the token), the reconnect attempt goes out without a token and gets closed with code 4001. The WS then closes again, triggers another 3-second reconnect, and loops until the health poll finally lands.

Fix: Delay first WS connect until after the first health poll resolves (token is available). Gate `connect()` on `_gatewayToken !== undefined`.

---

**H-5: Empty catch blocks hide critical failures in 4 places**
Files:
- `packages/gateway/src/auth.ts:31` — corrupted `app-config.json` silently treated as empty config; token regenerated on every start, breaking existing UI sessions
- `packages/gateway/src/routes/config.ts:16` — same for app config reads
- `packages/guard/src/PolicyStore.ts:88` — corrupted `policy.json` silently loads default policy with no user warning; all custom rules lost
- `packages/core/src/agents/AgentRegistry.ts:92` — corrupted `agents.json` silently loads as empty; all agents lost

Fix: Log a `console.error` with the path and error before falling back to default. User and operator need to know when their persistent data is unreadable.

---

### MEDIUM — Important But Not Blocking

---

**M-1: OllamaProvider streaming doesn't pass temperature/maxTokens**
File: `packages/models/src/providers/OllamaProvider.ts`

Non-streaming `infer()` passes `temperature` and `maxTokens` to Ollama. Streaming `inferStream()` does not. This means agent temperature settings are ignored when streaming mode is active (which is the default in CommandPanel).

Fix: Pass `options: { temperature, num_predict: maxTokens }` in the streaming request body.

---

**M-2: Guard policy corruption is silent**
File: `packages/guard/src/PolicyStore.ts:88`

If `policy.json` is corrupted (disk error, partial write), it silently loads the hardcoded default policy. All user-configured rules are lost without any indication. Covered in H-5 but the guard version is particularly bad because security rules are lost.

---

**M-3: Memory decay only runs at startup**
File: `packages/memory/src/MemoryEngine.ts:57`

`applyDecay()` is called once in `setImmediate()` on first start and never again. The design intent was periodic decay (30-day half-life). Entries never decay during a long-running session — only on restart.

Fix: Schedule periodic decay with `setInterval` every 24 hours.

---

**M-4: Agent run history silently drops old entries**
File: `packages/core/src/agents/AgentOrchestrator.ts`

`storeRun()` caps at 500 entries. When cap is hit, oldest runs are evicted silently. The UI fetches run history from this in-memory store. After 500 runs, history appears to truncate with no indication.

Fix: Either persist run history to SQLite (preferred) or show a "history truncated" indicator in the UI.

---

**M-5: OllamaProvider `listModels()` returns stale config on API failure**
File: `packages/models/src/providers/OllamaProvider.ts`

When Ollama is offline and `listModels()` fails, it returns `this.config.models` (the last-saved list). The UI shows these as "available" models. User tries to use one and gets an error only at inference time.

Fix: On failure, return empty array (or a typed error) rather than stale data, so the UI correctly shows the provider as unreachable.

---

**M-6: `as any` in 14 route handler locations**
Files: `packages/gateway/src/routes/agents.ts`, `memory.ts`, `models.ts`, `guard.ts`

Fastify validates the request body against the schema but then casts to `as any` to pass to service functions. Type errors in service function signatures will be silent at compile time.

Fix: Define typed interfaces for each route's body and use them instead of `as any`. Low risk but makes the codebase harder to refactor safely.

---

**M-7: Conversation list ordering — new empty conversations don't sort correctly**
File: `packages/memory/src/db/ConversationStore.ts:148`

`listConversations()` orders by `updated_at DESC`. New conversations are created with `updated_at = created_at`. Only after the first message is added does `touchConversation()` update `updated_at`. A freshly created conversation appears at the top only because its `created_at` matches `updated_at` — but if the user quickly creates two empty conversations, the second may appear below the first.

Fix: `listConversations()` should order by `created_at DESC` as a secondary sort, or `touchConversation()` should be called on conversation creation.

---

### LOW — Polish / Nice to Have

---

**L-1: WS `onclose` teardown is empty**
File: `packages/gateway/src/ws/stream.ts:46`
Comment says "Phase 7: tear down streaming sessions here." No practical consequence right now since streaming sessions are managed by the SSE route, not WS. But the comment is a red herring. Either implement or remove.

**L-2: No per-turn timeout on agent inference**
File: `packages/core/src/agents/AgentRunner.ts`
The `AbortController` exists for run-level abort (Stop button) but there is no per-turn wall-clock timeout. A single slow model turn can block a run indefinitely. Consider a 60-second per-turn timeout that aborts and emits `run:failed`.

**L-3: StatusBar model/agent picker: no way to add provider from status bar**
File: `packages/control/src/components/StatusBar.tsx`
When no provider is configured, the model picker shows `none ⚠` in red. The user must know to navigate to the Models tab. A small "Add provider →" link in the picker dropdown would reduce confusion.

**L-4: About dialog doesn't show the auth token**
File: `packages/control/src/App.tsx`
Advanced users who want to call the API directly (e.g., from curl or a script) need the auth token. It's in `app-config.json` but not surfaced in the UI. Add a "Copy API token" button to the About dialog.

**L-5: No request correlation ID**
Across all routes: a request comes in, spawns an agent run, and if something goes wrong there's no ID to correlate the HTTP request with the log entries. Fastify's built-in `req.id` is available — passing it through to agent events would make debugging much easier.

**L-6: Guard built-in rules show no visual distinction in UI**
File: `packages/control/src/components/GuardPanel.tsx`
Built-in rules cannot be deleted (backend rejects the request with 400). But in the UI they look identical to custom rules. The user gets a confusing error when trying to delete one. Add a "built-in" badge and hide/disable the delete button for built-in rules.

**L-7: Memory create/edit not available in UI**
File: `packages/control/src/components/MemoryPanel.tsx`
The backend supports `POST /api/memory` and `PATCH /api/memory/:id` but the Memory panel is read-only. Users can only view and delete entries — not create or edit them manually. Useful for seeding an agent's knowledge base.

**L-8: Conversation export not implemented**
No route or UI for exporting a conversation as Markdown or JSON. Referenced in roadmap.

---

## What Is Deliberately Deferred (Phase 3+)

These are not bugs — they are documented future work:

| Feature | Notes |
|---------|-------|
| `@krythor/skills` | Entire package is a stub — Phase 5 |
| Real embedding provider | Stub produces no semantic meaning — Phase 4 |
| API key encryption at rest | Platform keychain (DPAPI/Keychain) — future |
| Full-text search (FTS5) | Currently uses `LIKE` — future |
| Light/dark mode toggle | Hardcoded dark — future |
| `require-approval` guard action | Currently treated as deny — future |
| React component tests | No Vitest+Testing Library tests for UI — future |
| Agent run history persistence | Currently in-memory, capped at 500 — future |
| Conversation export | No route or UI — future |

---

## Summary: What to Build Next

**Immediate fixes (H-1 through H-5):**
1. No-provider error handling — return 503/error, don't fake an assistant message
2. Regenerate — delete last assistant message from DB before resubmitting
3. Dangling agentId on conversations — schema FK or pre-validation
4. WS reconnect race — gate connect() on token being available
5. Silent data corruption — log errors before falling back to defaults

**Near-term improvements (M-1 through M-7):**
1. Ollama streaming — pass temperature/maxTokens
2. Memory decay — run on schedule, not just startup
3. Stale model list on Ollama failure — return empty, not stale
4. Per-turn inference timeout — 60s abort

**UI polish (L-1 through L-8):**
1. Memory create/edit form
2. Guard built-in rule badge + disabled delete
3. About dialog — copy API token button
4. StatusBar — "Add provider →" link in empty model picker
