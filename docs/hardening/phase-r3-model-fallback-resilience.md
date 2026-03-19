# Release Hardening Phase 3 — Model Fallback + Retry Resilience

**Status:** Complete
**Scope:** `@krythor/models` — `ModelRouter.ts`, `ModelEngine.ts`, `ModelRouter.test.ts`
**Blockers fixed:** Retry backoff had no jitter (thundering herd risk); when a primary provider exhausted all retries, the error surfaced to the user with no fallback attempt; fallback decisions were not logged.

---

## What Changed

### 1. Jitter Added to Retry Backoff

Before: deterministic exponential backoff — 500ms, 1000ms.

After: backoff + up to 100ms of random jitter per attempt:
```typescript
const base   = RETRY_BASE_MS * Math.pow(2, attempt - 1); // 500ms, 1000ms
const jitter = Math.random() * RETRY_JITTER_MS;           // 0–100ms
await sleep(base + jitter, signal);
```

This prevents multiple concurrent callers (multiple agent runs retrying simultaneously) from all re-hitting the same provider at the exact same moment.

### 2. Cross-Provider Fallback in `infer()`

When `inferWithRetry()` exhausts retries against the primary provider, `infer()` now attempts a single call on the next available provider before surfacing the error.

**Fallback is only attempted for transient errors:**
- Aborted (`signal.aborted`) → throws immediately, no fallback
- 4xx client errors (`HTTP 4xx`) → throws immediately, no fallback (misconfiguration; retrying won't help)
- Transient errors (connection refused, timeout, 5xx, circuit open) → fallback attempted

**Resolution is transparent:** `resolveExcluding()` walks providers in the same priority order as `resolve()`, skipping the failed provider. Circuit state is respected — an already-open circuit on the fallback provider is also skipped.

**Fallback is bounded:** one attempt on the fallback provider, using the same retry logic. No infinite chains.

### 3. Fallback Logging

Added optional `infoFn` parameter to `ModelRouter` and `ModelEngine` (alongside existing `warnFn`). When a fallback is triggered, a structured log line is emitted:

```json
{
  "ts": "...",
  "level": "INFO",
  "message": "[ModelRouter] Primary provider failed — attempting fallback provider.",
  "primaryProviderId": "anthropic",
  "fallbackProviderId": "openai",
  "fallbackModel": "gpt-4o-mini",
  "reason": "ECONNREFUSED"
}
```

Wired in `server.ts`:
```typescript
const models = new ModelEngine(
  join(dataDir, 'config'),
  (msg, data) => logger.warn(msg, data),   // model-not-found warnings
  (msg, data) => logger.info(msg, data),   // fallback decisions
);
```

### 4. `resolveExcluding()` Private Method

New private method used exclusively by the fallback path. Accepts a `Set<string>` of provider IDs to skip. Follows the same priority ordering as `resolve()` so fallback selection is predictable and consistent with normal routing.

---

## What Was Not Changed

- **Streaming fallback** — `inferStream()` is intentionally not retried or fallen back (partial output already sent to client; documented in comments). Unchanged.
- **Circuit breaker thresholds** — 3 failures → open, 30s reset. These are sound and unchanged.
- **Retry count** — MAX_RETRIES = 2 (3 total attempts). Unchanged.
- **4xx non-retry** — `isClientError()` function unchanged; auth errors never retried or fallen back.

---

## Test Counts

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| ModelRouter | 7 | 12 | +5 |

New tests:
- `falls back to secondary provider when primary fails with transient error`
- `does NOT fall back on 4xx client error`
- `does NOT fall back when aborted`
- `throws original error when no fallback provider is available`
- `logs fallback decision with primary and fallback provider IDs`

**Total: 204 tests, 0 failures.**

---

## Files Changed

| File | Change |
|------|--------|
| `packages/models/src/ModelRouter.ts` | Added `infoFn` param; jitter in retry backoff; cross-provider fallback in `infer()`; `resolveExcluding()` method |
| `packages/models/src/ModelEngine.ts` | Added `infoFn` param; passed through to `ModelRouter` |
| `packages/gateway/src/server.ts` | Pass `logger.info` as `infoFn` to `ModelEngine` |
| `packages/models/src/ModelRouter.test.ts` | +5 fallback behaviour tests |
