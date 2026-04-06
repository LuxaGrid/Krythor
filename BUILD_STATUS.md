# Krythor — Build Status

**Version:** 0.9.0
**Date:** 2026-04-06
**Tests:** 191 passing across 6 packages
**Build:** All 8 packages compile clean

This document is the honest current state of the build — what works, what is incomplete, and what the priority order for next work is.

---

## Overall Health

| Package | Build | Tests | State |
|---------|-------|-------|-------|
| @krythor/core | ✅ | 191/191 | Complete |
| @krythor/gateway | ✅ | passing | Complete |
| @krythor/memory | ✅ | passing | Complete (stub embeddings) |
| @krythor/models | ✅ | passing | Complete |
| @krythor/guard | ✅ | passing | Complete |
| @krythor/skills | ✅ | — | **Stub only** |
| @krythor/setup | ✅ | — | Complete |
| @krythor/control | ✅ | — | Complete |

**Security:** Timing-safe token auth, rate-limiting, API key masking, SSRF protection, ReDoS protection, AES-256-GCM credential encryption all shipped.

---

## What Works End-to-End

- Chat with persistent conversations (sidebar, rename, delete, history reload)
- Token-by-token SSE streaming with animated cursor and Stop button
- Agent management (create, edit, delete, run, temperature/maxTurns/maxTokens)
- Multi-turn agent reasoning loop (both streaming and non-streaming)
- Memory storage, search, pin/unpin, decay
- Model provider management (Ollama, OpenAI, Anthropic, OpenAI-compat, GGUF)
- Quick Add presets: OpenAI, Anthropic, Groq, OpenRouter, Google Gemini, Venice, Kimi, Mistral, Ollama
- Model lists auto-refresh from provider APIs on startup; non-chat models filtered out automatically
- Chat dropdown groups models by provider, sorts flagship before mini/preview
- Guard policy with rule engine, audit log, built-in rules
- Credential encryption: AES-256-GCM with per-installation random key (`credential.key`)
- Self-hosted fonts, dark UI, keyboard shortcuts, onboarding wizard
- Windows launcher, Mac/Linux install script
- Auth token auto-generated on first run; browser UI bootstraps silently
- Rate limiting (300 req/min), WebSocket auth with explicit token on reconnect
- Agent health gate: auto-pause on repeated failures; config faults (400/401/403, bad model) excluded from health scoring
- Extended thinking via `supportsThinking()` — correctly scoped to Anthropic providers by type, not name
- agentId validated against orchestrator before conversation creation (H-3 fix)
- SafeCore `LocalSandboxProvider`: `ISOLATION_LEVEL = 'none'`, one-time console warning on use

---

## Resolved Issues (previously listed as open)

| ID | Issue | Fixed in |
|----|-------|---------|
| H-1 | No-provider placeholder leaked into chat as a fake response | v0.3 |
| H-2 | Regenerate sent stale failed response as context | v0.4 |
| H-3 | Conversations could be created with a dangling agentId | v0.9 |
| H-4 | WebSocket reconnect passed no token (race on page load) | v0.9 |
| H-5 | Empty catch blocks hid critical failures in 4 places | v0.5 |
| M-1 | OllamaProvider streaming didn't pass temperature/maxTokens | v0.5 |
| — | API key encryption at rest (was listed as deferred) | v0.8 |
| — | Agent paused by config faults (bad model ID → 400 loop) | v0.9 |
| — | Gemini `models/` prefix and non-chat models in dropdown | v0.9 |

---

## Open Issues — Priority Order

### HIGH

*(No HIGH issues currently open.)*

---

### MEDIUM — Important But Not Blocking

---

**M-2: Guard policy corruption is silent**
File: `packages/guard/src/PolicyStore.ts`

If `policy.json` is corrupted, it silently loads the hardcoded default policy. All user-configured rules are lost without any indication. Particularly bad because security rules are lost silently.

Fix: Log a `console.error` with path and error before falling back to default.

---

**M-3: Memory decay only runs at startup**
File: `packages/memory/src/MemoryEngine.ts`

`applyDecay()` is called once in `setImmediate()` on first start and never again. Entries never decay during a long-running session — only on restart.

Fix: Schedule periodic decay with `setInterval` every 24 hours.

---

**M-4: Agent run history silently drops old entries**
File: `packages/core/src/agents/AgentOrchestrator.ts`

`storeRun()` caps at 500 entries in memory. After 500 runs, history appears to truncate with no indication.

Fix: Persist run history to SQLite, or show a "history truncated" indicator in the UI.

---

**M-5: OllamaProvider `listModels()` returns stale config on API failure**
File: `packages/models/src/providers/OllamaProvider.ts`

When Ollama is offline, `listModels()` returns `this.config.models` (last-saved list). User tries to use a model and gets an error only at inference time.

Fix: Return empty array on failure so the provider correctly shows as unreachable.

---

**M-6: `as any` in route handlers**
Files: `packages/gateway/src/routes/agents.ts`, `memory.ts`, `models.ts`, `guard.ts`

Fastify validates request bodies against schema but then casts to `as any`. Type errors in service functions are silent at compile time.

---

**M-7: Conversation list ordering edge case**
File: `packages/memory/src/db/ConversationStore.ts`

If two empty conversations are created in rapid succession, secondary ordering by `created_at` may not be reliable.

Fix: Call `touchConversation()` on creation, or add `created_at DESC` as secondary sort.

---

### LOW — Polish / Nice to Have

**L-1:** WS `onclose` teardown is a no-op (comment says "Phase 7")
**L-2:** No per-turn timeout on agent inference (can block indefinitely on slow model)
**L-3:** StatusBar model picker shows no "Add provider →" link when empty
**L-4:** About dialog doesn't expose the auth token for API users
**L-5:** No request correlation ID through agent events
**L-6:** Guard built-in rules look identical to custom rules — no badge, delete fails with confusing error
**L-7:** Memory create/edit not available in UI (backend supports it, panel is read-only)
**L-8:** Conversation export not implemented

---

## What Is Deliberately Deferred

These are not bugs — they are documented future work:

| Feature | Notes |
|---------|-------|
| `@krythor/skills` vault | Entire package is a stub — Phase 5 |
| Real embedding provider | Stub produces no semantic meaning — Phase 4 |
| DockerSandboxProvider | `LocalSandboxProvider` has no isolation; Docker/Firecracker planned |
| Full-text search (FTS5) | Currently uses `LIKE` |
| Light/dark mode toggle | Hardcoded dark |
| `require-approval` guard action | Currently treated as deny |
| React component tests | No Vitest+Testing Library tests for UI |
| Agent run history persistence | In-memory, capped at 500 |
| Conversation export | No route or UI |
| Audit log rotation | Grows indefinitely; rotate manually for now |
