# Phase 2 — DB Integrity Checks + Retention Rules

**Status:** Complete
**Scope:** `@krythor/memory`
**Blockers fixed:** No schema version tracking; no pre-migration safety net; no retention for memory entries, conversations, or learning records.

---

## Problem

Before this phase:

| Gap | Risk |
|-----|------|
| No `PRAGMA user_version` | No fast O(1) way to check schema version; upgrade detection had to query `schema_migrations` |
| No pre-migration backup | Schema migration failure → corrupted DB with no recovery path |
| No startup integrity check | Silent corruption could go undetected until data loss occurred |
| `memory_entries` had no retention rule | Stale low-value memories accumulated indefinitely |
| `conversations` / `messages` had no retention rule | Conversation history grew unbounded |
| `learning_records` had no retention rule | Signal data for model recommender grew without limit |

`agent_runs` (30 days / 2000 rows) and `guard_decisions` (90 days / 10 000 rows) already had retention — Phase 2 fills in the remaining tables.

---

## Solution

### 1. PRAGMA user_version

`MigrationRunner.run()` now sets `PRAGMA user_version = N` after every migration batch, where N is the highest applied migration version number.

```typescript
const userVersion = Math.max(...allApplied);
db.pragma(`user_version = ${userVersion}`);
```

- Fast O(1) read: `db.pragma('user_version', { simple: true })`
- Consistent with migration count: version 3 = all 3 migrations applied
- Accessible via `MigrationRunner.getUserVersion()` without querying `schema_migrations`

### 2. Pre-migration Backup

`MigrationRunner.run(dbFilePath?)` now creates a timestamped backup **before** applying any pending migrations.

```
memory.db  →  memory.db.2026-03-18T18-21-22.bak
```

- Only created when there are pending migrations AND the DB file exists on disk
- Backup failure is logged as a warning but does not halt startup (promoted to hard stop in Phase 8)
- Backup path is returned in `MigrationResult.backupPath`
- Second call with no pending migrations: no backup created

### 3. Startup Integrity Check

`applySchema()` now runs `PRAGMA integrity_check` after migrations complete.

```typescript
const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
const messages = rows.map(r => r.integrity_check).filter(m => m !== 'ok');
```

- `'ok'` result → `integrityStatus: 'ok'`, logged at info level
- Any other result → `integrityStatus: 'warning'`, all messages logged at error level
- Does not halt startup (reads may still be possible from a partially corrupted DB)
- Returns `StartupCheckResult` with `{ migration, integrityStatus, integrityMessages, userVersion }`

### 4. DbJanitor — Retention Rules

New class `packages/memory/src/db/DbJanitor.ts` enforces retention across all unguarded tables.

| Table | Rule |
|-------|------|
| `memory_entries` | Prune entries older than 90 days with `importance < 0.2` and `pinned = 0` |
| `conversations` | Prune conversations with `updated_at` older than 90 days |
| `messages` | Cleaned automatically via `ON DELETE CASCADE` from conversations |
| `learning_records` | Prune records older than 90 days; enforce 50 000-row ceiling |
| `agent_runs` | Handled by `AgentRunStore` (30 days / 2000 rows) — unchanged |
| `guard_decisions` | Handled by `GuardDecisionStore` (90 days / 10 000 rows) — unchanged |

**Pinned entries are never pruned** by `DbJanitor` regardless of age or importance.

`DbJanitor.run()` is:
- Safe to call multiple times (idempotent)
- Non-throwing — catches per-table errors so one failure doesn't skip the rest
- Returns `JanitorResult` with per-table pruned counts and a `ranAt` timestamp

### 5. Integration Points

| File | Change |
|------|--------|
| `MigrationRunner.ts` | `run(dbFilePath?)` returns `MigrationResult`; sets `user_version`; creates backup |
| `schema.ts` | `applySchema(db, dbFilePath?)` runs integrity check; returns `StartupCheckResult` |
| `MemoryEngine.ts` | Passes `dbPath` to `applySchema`; constructs `DbJanitor`; calls `janitor.run()` on startup; exposes `runJanitor()` for heartbeat |
| `index.ts` | Exports `DbJanitor`, `JanitorResult`, `applySchema`, `StartupCheckResult`, `MigrationResult` |

---

## Retention Rule Reference

| Table | Max Age | Max Rows | Extra condition |
|-------|---------|----------|-----------------|
| `memory_entries` | 90 days | — | `importance < 0.2` AND `pinned = 0` |
| `conversations` | 90 days | — | — |
| `messages` | (cascade) | — | — |
| `learning_records` | 90 days | 50 000 | — |
| `agent_runs` | 30 days | 2 000 | — |
| `guard_decisions` | 90 days | 10 000 | — |

---

## Tests Added

| File | Tests | Coverage |
|------|-------|----------|
| `packages/memory/src/db/MigrationRunner.test.ts` | 8 | user_version, idempotency, backup creation/skipping, backup filename |
| `packages/memory/src/db/DbJanitor.test.ts` | 10 | memory_entries rules (pin/age/importance), conversation CASCADE, learning_records, tableCounts, result shape |

---

## Startup Log Output

On a clean first-run (all migrations pending):

```
[migrations] Backup created: /path/to/memory.db.2026-03-18T18-21-22.bak
[migrations] Applied migration 1: initial
[migrations] Applied migration 2: agent_runs
[migrations] Applied migration 3: learning_records
[db] Integrity check passed. Schema version: 3
```

On subsequent starts (no pending migrations):

```
[db] Integrity check passed. Schema version: 3
```

---

## Next

**Phase 3 — Heartbeat hardening + stale_state check**
Implement the `stale_state` heartbeat check (currently a no-op), wire `DbJanitor.run()` into `memory_hygiene`, add polling jitter, and replace `console.log` in `HeartbeatEngine` with structured logger calls.
