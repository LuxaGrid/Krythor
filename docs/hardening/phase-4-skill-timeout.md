# Phase 4 — Skill Timeout + Per-Request Infer Timeout

**Status:** Complete
**Scope:** `@krythor/skills` — `SkillRunner.ts`, `types.ts`, `SkillRegistry.ts`; `@krythor/gateway` — `routes/skills.ts`
**Blockers fixed:** No typed timeout error (generic AbortError surfaced as 502); no per-skill timeout override; SkillRegistry used non-atomic writes.

---

## Problem

Before this phase:

| Gap | Risk |
|-----|------|
| Timeout threw a raw `AbortError` / `DOMException` | Route catch-all returned 502 "Skill run failed" — client had no way to distinguish a timeout from a model error |
| No per-skill `timeoutMs` field | All skills shared the fixed 120 s runner default — a fast utility skill and a slow research skill had identical ceilings |
| `SkillRegistry.save()` used `writeFileSync` | Crash mid-write → corrupt `skills.json`; same gap fixed in Phase 1 for agents and models |
| No tests for `SkillRunner` | Core execution logic (timeout, abort, concurrency, permissions) was untested |

---

## Solution

### 1. SkillTimeoutError

New typed error class exported from `@krythor/skills`:

```typescript
export class SkillTimeoutError extends Error {
  constructor(readonly skillId: string, readonly timeoutMs: number) {
    super(`Skill "${skillId}" exceeded execution timeout of ${timeoutMs}ms`);
    this.name = 'SkillTimeoutError';
  }
}
```

When the per-execution `setTimeout` fires, the runner now re-wraps whatever the model client threw into a `SkillTimeoutError`. This means:
- `timedOut` flag is set when the timer fires
- In the catch block: `const thrownErr = timedOut ? new SkillTimeoutError(...) : err`
- The emitted `skill:run:failed` event message matches the timeout error

### 2. Per-Skill timeoutMs

`Skill`, `CreateSkillInput`, and `UpdateSkillInput` now include `timeoutMs?: number`.

```typescript
// Skill type
timeoutMs?: number;  // per-skill execution timeout; overrides runner default (120 s)
```

`SkillRunner.run()` resolves the effective timeout:
```typescript
const effectiveTimeout = skill.timeoutMs ?? EXECUTION_TIMEOUT_MS; // 120 000 ms default
```

Range validation in gateway route schema: `minimum: 1000, maximum: 600_000` (1 s – 10 min).

### 3. Route — 408 on Timeout

`POST /api/skills/:id/run` catch block now checks `SkillTimeoutError` first:

```typescript
if (err instanceof SkillTimeoutError) {
  return sendError(reply, 408, 'SKILL_TIMEOUT', err.message,
    'Increase the skill timeoutMs or check that the model provider is responsive');
}
```

Error precedence: `SkillTimeoutError (408)` → `SkillConcurrencyError (429)` → `SkillPermissionError (403)` → generic `(502)`.

### 4. SkillRegistry — Atomic Writes

`SkillRegistry.save()` changed from:
```typescript
writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
```
to:
```typescript
atomicWriteJSON(this.configPath, Array.from(this.skills.values()));
```

`atomicWrite.ts` duplicated into `packages/skills/src/config/` (same pattern as `@krythor/models` — skills has no dep on core).

---

## Integration Points

| File | Change |
|------|--------|
| `packages/skills/src/types.ts` | Added `timeoutMs?` to `Skill`, `CreateSkillInput`, `UpdateSkillInput` |
| `packages/skills/src/SkillRunner.ts` | Added `SkillTimeoutError`; `effectiveTimeout = skill.timeoutMs ?? 120_000`; catch re-wraps to `SkillTimeoutError` when `timedOut` flag is set |
| `packages/skills/src/SkillRegistry.ts` | `save()` uses `atomicWriteJSON`; `create()` / `update()` pass through `timeoutMs` |
| `packages/skills/src/config/atomicWrite.ts` | Created (duplicated from core) |
| `packages/skills/src/index.ts` | Exports `SkillTimeoutError` |
| `packages/gateway/src/routes/skills.ts` | Imports `SkillTimeoutError`; returns 408 on timeout; `timeoutMs` field in POST/PATCH schema |

---

## Tests Added

| File | Tests | Coverage |
|------|-------|----------|
| `packages/skills/src/SkillRunner.test.ts` | 10 | happy path, skill not found, activeRunCount lifecycle, SkillTimeoutError (fires, message), abort before start, abort releases slot, concurrency limit, permission denied |

---

## Behaviour Reference

| Scenario | HTTP status | Error code |
|----------|-------------|------------|
| Skill not found | 404 | `SKILL_NOT_FOUND` |
| Guard denied | 403 | `GUARD_DENIED` |
| Execution timeout | 408 | `SKILL_TIMEOUT` |
| Concurrency limit | 429 | `SKILL_CONCURRENCY_LIMIT` |
| Permission denied | 403 | `SKILL_PERMISSION_DENIED` |
| Model/network error | 502 | `SKILL_RUN_FAILED` |

---

## Next

**Phase 5 — WebSocket resilience + UI degraded mode**
Add reconnection logic to the WebSocket client in `@krythor/control` (exponential backoff, max retries), surface a degraded-mode banner in the UI when the gateway is unreachable, and prevent the UI from silently swallowing connection errors.
