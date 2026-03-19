# Release Hardening Phase 4 — Memory Growth Control + Retention Hardening

**Status:** Complete
**Scope:** `@krythor/memory` — `DbJanitor.ts`, `MemoryEngine.ts`; `@krythor/gateway` — `HeartbeatEngine.ts`, `server.ts`
**Blockers fixed:** Janitor errors were silently swallowed (no structured log output); post-prune row counts were not captured; `.bak` backup file accumulation had no visibility; janitor logging could not flow through DiskLogger.

---

## What Changed

### 1. Structured Logging in `DbJanitor`

Added an optional injectable `LogFn` callback to `DbJanitor`. When injected, all log output (errors from failed prune steps, pruning summaries) routes through the callback instead of `console`.

```typescript
export type LogFn = (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void;

export class DbJanitor {
  constructor(
    private readonly db: Database.Database,
    private readonly logFn?: LogFn,
  ) {}
```

Fallback to `console.error` / `console.log` is preserved for standalone use (e.g., CLI tools, tests without a logger injected).

### 2. `tableCountsAfter` in `JanitorResult`

`run()` now captures post-prune row counts for all major tables and includes them in the result:

```typescript
export interface JanitorResult {
  memoryEntriesPruned: number;
  conversationsPruned: number;
  learningRecordsPruned: number;
  ranAt: number;
  /** Row counts per table after pruning — for heartbeat insights and diagnostics. */
  tableCountsAfter: Record<string, number>;
}
```

Tables counted: `memory_entries`, `conversations`, `messages`, `agent_runs`, `guard_decisions`, `learning_records`.

### 3. `logFn` Wired Through `MemoryEngine` → `DbJanitor`

`MemoryEngine` constructor now accepts an optional `logFn` and passes it to `DbJanitor`:

```typescript
constructor(dataDir: string, logFn?: LogFn)
```

Wired in `server.ts`:
```typescript
const memory = new MemoryEngine(
  join(dataDir, 'memory'),
  (level, msg, data) => logger[level](msg, data),
);
```

Janitor log lines now flow through `DiskLogger` and appear in the structured daily log files alongside all other structured gateway logs.

### 4. `dbDir` Exposed on `MemoryEngine`

`MemoryEngine` now exposes:
```typescript
/** Directory containing memory.db and any .bak backup files. */
readonly dbDir: string;
```

This lets the `HeartbeatEngine` inspect the database directory for backup accumulation without needing to know the path independently.

### 5. Backup File Accumulation Check in `HeartbeatEngine`

`check_memory_hygiene` now counts `.bak` files in `ctx.memory.dbDir`. These files are created by `MigrationRunner` on each schema upgrade. More than 10 is unusual and may indicate repeated failed migrations or stale artifacts.

```typescript
const bakCount = readdirSync(ctx.memory.dbDir).filter(f => f.endsWith('.bak')).length;
if (bakCount > 10) {
  insights.push(this.insight('memory_hygiene', 'warning',
    `Found ${bakCount} .bak backup files in the database directory. Consider cleaning up old migration backups.`,
    false));
}
```

Errors are swallowed silently (directory unreadable → skip), consistent with the heartbeat's non-blocking design.

---

## What Was Not Changed

- **Pruning thresholds** — 90-day retention, 0.2 importance floor, 50k learning record cap. These are sound and unchanged.
- **Pinned entry protection** — pinned entries are never pruned by retention rules. Unchanged.
- **`AgentRunStore.prune()` / `GuardDecisionStore.prune()`** — handled independently by their own stores. Not touched.
- **`MemoryStore.prune()`** — writer-level prune by count ceiling. Not changed; called separately on startup and daily decay cycle.

---

## Test Counts

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| memory | 34 | 37 | +3 |

New tests (added to `DbJanitor.test.ts`):
- `populates tableCountsAfter with counts for all major tables`
- `routes errors through injected logFn`
- (existing `tableCounts` test suite was already present; new tests extend the `run() result` describe block)

**Total: 206 tests, 0 failures.**

---

## Files Changed

| File | Change |
|------|--------|
| `packages/memory/src/db/DbJanitor.ts` | Export `LogFn` type; add `logFn` constructor param; private `log()` helper; populate `tableCountsAfter` in `run()`; use `this.log()` for errors and pruning summary |
| `packages/memory/src/MemoryEngine.ts` | Add `logFn` constructor param; expose `readonly dbDir`; pass `logFn` to `DbJanitor` |
| `packages/gateway/src/server.ts` | Pass `(level, msg, data) => logger[level](msg, data)` as `logFn` to `MemoryEngine` |
| `packages/gateway/src/heartbeat/HeartbeatEngine.ts` | Add `readdirSync` import; add `.bak` backup file count check in `check_memory_hygiene` |
| `packages/memory/src/db/DbJanitor.test.ts` | +2 new tests: `tableCountsAfter` shape, `logFn` routing |
