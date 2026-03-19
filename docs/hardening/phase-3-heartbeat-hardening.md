# Phase 3 — Heartbeat Hardening + stale_state Check

**Status:** Complete
**Scope:** `@krythor/gateway` — `HeartbeatEngine.ts`
**Blockers fixed:** stale_state no-op; DbJanitor not wired into heartbeat; fixed 60s polling interval (thundering-herd risk); unstructured console output.

---

## Problem

Before this phase:

| Gap | Risk |
|-----|------|
| `check_stale_state()` returned `[]` immediately | Runs stuck in `'running'` state after a crash were never cleaned up; next startup would see phantom running runs |
| `DbJanitor` constructed in `MemoryEngine` but never called by heartbeat | Retention rules only ran at startup; long-lived processes accumulated stale rows indefinitely |
| Fixed 60 s polling interval | All processes started at the same time hit the DB simultaneously (thundering herd) |
| `console.log` / `console.debug` / `console.info` scattered throughout | No consistent timestamp or level format; hard to filter in production logs |

---

## Solution

### 1. stale_state Check — Implemented

`check_stale_state()` now queries `agentRunStore.list()` for runs with:
- `status === 'running'`
- `startedAt < Date.now() - 10 minutes`

For each stale run it calls `agentRunStore.save()` with `status: 'failed'`, `completedAt: now`, and an explanatory `errorMessage`. This is auto-correction (advisory = `false`) — no human action required.

**Why `agentRunStore` rather than `orchestrator.listRuns()`:**
The in-memory list in `AgentOrchestrator` only covers the current process lifetime. A run that was `'running'` when a previous process crashed will not appear there. The DB is the source of truth.

```typescript
const staleRows = ctx.memory.agentRunStore
  .list()
  .filter(r => r.status === 'running' && r.startedAt < cutoff);

for (const run of staleRows) {
  ctx.memory.agentRunStore.save({
    ...run,
    status:       'failed',
    completedAt:  Date.now(),
    errorMessage: 'Marked failed by heartbeat stale_state check (exceeded 10 min without completing).',
  });
}
```

### 2. DbJanitor Wired into memory_hygiene

`check_memory_hygiene()` now calls `ctx.memory.runJanitor()` before the stats check. This enforces retention across all tables every 6 hours in long-running processes, supplementing the startup-time janitor run in `MemoryEngine`.

```typescript
const janitorResult = ctx.memory.runJanitor();
const totalPruned = janitorResult.memoryEntriesPruned +
                    janitorResult.conversationsPruned +
                    janitorResult.learningRecordsPruned;
if (totalPruned > 0) {
  this.log('info', `[memory_hygiene] Janitor pruned ${totalPruned} rows ...`);
}
```

### 3. Polling Jitter — 50–70s Window

`start()` replaced fixed `setInterval(60_000)` with a self-rescheduling `setTimeout` chain:

```typescript
const POLL_INTERVAL_BASE_MS   = 50_000;  // 50s base
const POLL_INTERVAL_JITTER_MS = 20_000;  // + 0–20s → 50–70s window

const scheduleNext = (): void => {
  const intervalMs = POLL_INTERVAL_BASE_MS + Math.random() * POLL_INTERVAL_JITTER_MS;
  this.timer = setTimeout(() => {
    void this.tick().finally(() => {
      if (this.timer !== undefined) scheduleNext();
    });
  }, intervalMs);
};
```

Each tick reschedules itself with a fresh random offset — spreads load across a cluster of instances.

### 4. Structured Logging

All `console.log` / `console.debug` / `console.info` / `console.warn` / `console.error` calls replaced with a private `log()` helper:

```typescript
private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
  const prefix = `[HeartbeatEngine] ${new Date().toISOString()}`;
  switch (level) {
    case 'debug': console.debug(`${prefix} DEBUG ${message}`); break;
    case 'info':  console.info(`${prefix} INFO  ${message}`); break;
    case 'warn':  console.warn(`${prefix} WARN  ${message}`); break;
    case 'error': console.error(`${prefix} ERROR ${message}`); break;
  }
}
```

Format: `[HeartbeatEngine] <ISO-8601> <LEVEL> <message>` — greppable, consistent, pipeable to log aggregators.

### 5. Run Duration Logged

Every tick logs its duration on completion:

```
[HeartbeatEngine] 2026-03-18T18:42:48.000Z INFO  Run complete — 3 checks, 1 insights, 42ms
[HeartbeatEngine] 2026-03-18T18:42:48.000Z INFO  Run complete — 0 checks, 0 insights, 1ms [TIMED OUT]
```

---

## Integration Points

| File | Change |
|------|--------|
| `HeartbeatEngine.ts` | `check_stale_state()` implemented; `check_memory_hygiene()` calls `runJanitor()`; polling uses jittered setTimeout chain; all logging via `log()` helper |
| `HeartbeatEngine.test.ts` | `setInterval` spy → `setTimeout` spy; 3 new describe blocks (9 total → 9 tests in HeartbeatEngine suite, 31 total in gateway) |

---

## Tests Added

| Suite | Tests | Coverage |
|-------|-------|----------|
| `HeartbeatEngine — stale_state check` | 2 | auto-corrects stale run to 'failed'; no insight when run is recent |
| `HeartbeatEngine — memory_hygiene check` | 1 | janitor called; no insight when entryCount < 5000 |

---

## Startup / Run Log Output

```
[HeartbeatEngine] 2026-03-18T18:30:00.000Z INFO  Started (polling every 50–70s with jitter).
[HeartbeatEngine] 2026-03-18T18:30:58.412Z INFO  Run complete — 2 checks, 0 insights, 15ms
[HeartbeatEngine] 2026-03-18T18:31:51.007Z WARN  [stale_state] Auto-corrected 1 stale run(s) to 'failed'.
[HeartbeatEngine] 2026-03-18T18:31:51.007Z WARN  [stale_state] WARNING: 1 agent run(s) were stuck ...
[HeartbeatEngine] 2026-03-18T18:31:51.020Z INFO  [memory_hygiene] Janitor pruned 7 rows (entries=4, conversations=2, learning=1).
[HeartbeatEngine] 2026-03-18T18:31:51.023Z INFO  Run complete — 3 checks, 1 insights, 30ms
```

---

## Next

**Phase 4 — Skill timeout + per-request infer timeout**
Add `AbortController`-based timeout to `SkillExecutor` (currently runs indefinitely), wire per-request `timeoutMs` from skill definition into the infer call, and surface timeout errors as structured `SkillError` rather than unhandled promise rejections.
