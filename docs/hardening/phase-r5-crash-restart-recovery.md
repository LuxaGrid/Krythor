# Release Hardening Phase 5 — Crash/Restart Recovery Validation

**Status:** Complete
**Scope:** `@krythor/memory` — `AgentRunStore.ts`; `@krythor/gateway` — `server.ts`
**Blockers fixed:** After a process crash or kill signal, any in-flight `'running'` agent runs remained permanently stuck in that state in the DB until the first heartbeat tick (~50–70s after restart). These appeared as "forever running" ghosts in the UI.

---

## What Changed

### 1. `resolveOrphanedRuns()` on `AgentRunStore`

New method that atomically marks all `status = 'running'` rows as `'failed'`:

```typescript
resolveOrphanedRuns(errorMessage = 'Process restarted — run interrupted.'): number {
  const result = this.db.prepare(`
    UPDATE agent_runs
    SET status = 'failed', completed_at = ?, error_message = ?
    WHERE status = 'running'
  `).run(Date.now(), errorMessage);
  return result.changes;
}
```

- Sets `completed_at` to the moment of resolution so run duration is measurable.
- Accepts an optional custom error message (for testing and future flexibility).
- Returns the count of resolved rows (0 if none — idempotent).
- Single SQL UPDATE — safe for concurrent callers.

### 2. Startup Recovery in `server.ts`

Called immediately at startup, before the heartbeat loop begins:

```typescript
const orphansResolved = memory.agentRunStore.resolveOrphanedRuns();
if (orphansResolved > 0) {
  logger.warn('Startup recovery: orphaned runs resolved', { count: orphansResolved });
}
```

This places the system in a known-safe state within milliseconds of startup — not within the first heartbeat window (50–70s). Orphan count is logged at `WARN` level so operators can tell how many runs were interrupted.

---

## Relationship to Existing Heartbeat Check

The existing `check_stale_state` heartbeat check already auto-corrects runs stuck `> 10 min`. This is complementary:

| Mechanism | When it runs | Latency | Purpose |
|-----------|-------------|---------|---------|
| `resolveOrphanedRuns()` at startup | Immediately on boot | ~0ms | Fix ALL orphans from crash immediately |
| `check_stale_state` heartbeat check | Every 60 min | 0–70s after boot | Fix runs that get stuck mid-session (not crash-related) |

The heartbeat check remains useful for non-crash stuckness (e.g., a run that started successfully but never completed due to an upstream timeout). Both mechanisms can run safely — the startup call resolves all `'running'` rows, so the heartbeat finds 0 on its first tick after a clean restart.

---

## What Was Not Changed

- **Migration interruption safety** — `MigrationRunner` already creates a backup before applying migrations and runs in a transaction. The pre-migration backup exists precisely for crash-during-migration scenarios. No changes needed.
- **Partial config write safety** — `atomicWrite` in `@krythor/core` already writes to a temp file and renames atomically. No changes needed.
- **WebSocket reconnect** — handled by the client with exponential backoff. No server-side changes needed.
- **Heartbeat recovery** — heartbeat checks run at startup's first tick. No changes needed.

---

## Test Counts

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| memory | 42 | 42 | 0 |

New test file: `packages/memory/src/db/AgentRunStore.test.ts` (+5 tests):
- `marks all running rows as failed and returns count`
- `sets completed_at and a default error message on resolved rows`
- `accepts a custom error message`
- `returns 0 when there are no running rows`
- `is idempotent — second call returns 0`

**Total: 211 tests, 0 failures.**

---

## Files Changed

| File | Change |
|------|--------|
| `packages/memory/src/db/AgentRunStore.ts` | Add `resolveOrphanedRuns()` method |
| `packages/gateway/src/server.ts` | Call `resolveOrphanedRuns()` at startup; log if orphans found |
| `packages/memory/src/db/AgentRunStore.test.ts` | New file — 5 tests for orphan recovery behavior |
