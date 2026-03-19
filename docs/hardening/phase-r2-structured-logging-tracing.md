# Release Hardening Phase 2 — Structured Logging + Tracing

**Status:** Complete
**Scope:** `@krythor/gateway` — `HeartbeatEngine.ts`, `server.ts`; `@krythor/models` — `ModelRouter.ts`, `ModelEngine.ts`
**Blockers fixed:** HeartbeatEngine used raw `console.*` bypassing DiskLogger; agent run events logged without agent name; `ModelRouter` fallback warnings bypassed structured logger; DB file size not tracked.

---

## What Changed

### 1. HeartbeatEngine → DiskLogger

`HeartbeatEngine` previously had a private `log()` helper that always wrote to `console.*`, bypassing the `DiskLogger` entirely. All heartbeat log output was invisible to the rotating daily log files.

**Fix:** Added optional `diskLogger?: DiskLogger | null` parameter (6th constructor arg). When injected, the private `log()` method routes through it; when absent (e.g. in tests), falls back to the existing console path unchanged.

**Wired in `server.ts`:**
```typescript
const heartbeat = new HeartbeatEngine(memory, models, orchestrator, undefined, recommender, logger);
```

All heartbeat output — polling intervals, check results, stale-state corrections, memory hygiene janitor output, timeouts — now appears in `krythor-YYYY-MM-DD.log`.

### 2. Agent Run Events: agent name included

`agentRunStarted` was called with an empty string for `agentName`. Fixed to look up the agent from the registry at event time:

```typescript
const agentName = orchestrator.registry.getById(event.agentId)?.name ?? '';
logger.agentRunStarted(event.runId, event.agentId, agentName);
```

Log lines for agent runs now include the human-readable agent name alongside the ID.

### 3. ModelRouter.resolveModel → structured warn

`ModelRouter.resolveModel()` fell back to the provider's first model when the requested model was not found, but logged via `console.warn` — invisible to DiskLogger.

**Fix:** Added optional `warnFn?: (message, data) => void` to `ModelRouter` constructor and `ModelEngine` constructor. When provided, model fallback warnings flow through the structured logger. When absent, falls back to `console.warn` (safe default).

**Wired in `server.ts`:**
```typescript
const models = new ModelEngine(
  join(dataDir, 'config'),
  (msg, data) => logger.warn(msg, data),
);
```

Model fallback log line format:
```json
{"ts":"...","level":"WARN","message":"[ModelRouter] Requested model \"claude-3-5-sonnet\" not found on provider \"anthropic\" — using \"claude-sonnet-4-6\" instead.","requestedModel":"claude-3-5-sonnet","providerId":"anthropic","fallbackModel":"claude-sonnet-4-6"}
```

### 4. DB File-Size Check in check_memory_hygiene

`check_memory_hygiene` previously only tracked row counts. Added PRAGMA-based file size check:

```typescript
const pageCount = ctx.memory.db.pragma('page_count', { simple: true });
const pageSize  = ctx.memory.db.pragma('page_size',  { simple: true });
const dbSizeMb  = Math.round((pageCount * pageSize) / (1024 * 1024));
```

Thresholds:
- `> 500 MB` → `warning` insight: "Database file is N MB. Consider running VACUUM or tightening retention policies."
- `> 100 MB` → `info` insight: "Database file is N MB."
- `≤ 100 MB` → debug log only (no insight surface)

Uses SQLite PRAGMA — no `fs.statSync`, no platform path dependency.

---

## Files Changed

| File | Change |
|------|--------|
| `packages/gateway/src/heartbeat/HeartbeatEngine.ts` | Added `diskLogger` param; `log()` routes through it when present; added DB size check in `check_memory_hygiene` |
| `packages/gateway/src/server.ts` | Pass `logger` to `HeartbeatEngine`; pass `logger.warn` to `ModelEngine`; fix `agentRunStarted` agent name |
| `packages/models/src/ModelRouter.ts` | Added `warnFn` param; `resolveModel` uses it instead of `console.warn` |
| `packages/models/src/ModelEngine.ts` | Added `warnFn` param; passed through to `ModelRouter` |

---

## What Remains Untouched

- `DiskLogger` itself — no changes; already sound
- `requestId` threading in async agent events — intentionally not changed (event fires after HTTP response; no request context available; runId already provides correlation)
- `console.*` in `memory/` and `core/` packages — those packages cannot depend on gateway's logger; the right fix is a shared logger interface package (non-goal for this pass per Phase 8 non-goals)
