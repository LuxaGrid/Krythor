# Phase 8 — Installer + Upgrade + Rollback Story

**Status:** Complete
**Scope:** `@krythor/memory` — `MigrationRunner.ts`; `@krythor/setup` — `Installer.ts`, `bin/setup.ts`, `Installer.test.ts`
**Blockers fixed:** Backup failure was silent (non-fatal); no rollback path existed; no `--rollback` CLI flag; no tests for rollback helpers.

---

## Problem

Before this phase:

| Gap | Risk |
|-----|------|
| `MigrationRunner` treated backup failure as a `console.warn` and continued | A migration could run without a safety net; rollback was impossible if the migration corrupted data |
| No `findLatestBackup` / `restoreBackup` helpers | No programmatic way to identify or restore a backup from outside MigrationRunner |
| `bin/setup.ts` had no argument parsing | No CLI surface for rollback — users had to manually locate and copy `.bak` files |
| No tests for backup failure or rollback | The hard-stop branch was uncovered; `Installer` rollback logic was untestable |

---

## Solution

### 1. Hard Stop on Backup Failure (MigrationRunner)

Changed the backup failure path from a `console.warn` + continue to a thrown `Error`:

```typescript
// Before (Phase 7 comment: "In production this will be promoted to a hard stop")
console.warn(`[migrations] WARNING: Could not create backup...`);
backupPath = undefined;

// After
throw new Error(
  `[migrations] Aborting: could not create pre-migration backup at ${backupPath}: ...`
);
```

**Why:** Never migrate without a safety net. If the backup cannot be written (disk full, permissions, path error), it is safer to abort than to run a schema change with no rollback path. The server will not start — this surfaces as an immediately visible startup failure rather than silent data risk.

**PRAGMA user_version idempotency (already verified):** `MigrationRunner.run()` calls `getAppliedVersions()` before running any migration. If all versions are already in `schema_migrations`, `pending` is empty, no backup is attempted, and `applied: 0` is returned. This was validated in Phase 7's integration tests and Phase 8's existing `MigrationRunner.test.ts` coverage.

---

### 2. Rollback Helpers in Installer

Two new methods on `Installer`:

#### `findLatestBackup(dbFilePath: string): string | undefined`

Scans the directory containing `dbFilePath` for files matching the pattern `<basename>.<timestamp>.bak`, sorted lexicographically (ISO timestamps sort chronologically), and returns the newest match.

```
memory/
  memory.db
  memory.db.2026-03-17T10-00-00.bak   ← older
  memory.db.2026-03-18T18-30-00.bak   ← returned (newest)
```

#### `restoreBackup(backupPath: string, dbFilePath: string): void`

Copies `backupPath` over `dbFilePath` using `copyFileSync`. Throws with a clear message if `backupPath` does not exist. The backup file is **not deleted** after restore (non-destructive — preserves the audit trail).

**Caller responsibility:** The Krythor gateway must be stopped before calling `restoreBackup`. SQLite does not detect external file replacement at the OS level; a running process would continue reading from its open file handle referencing the old inode.

---

### 3. `--rollback` Flag in `bin/setup.ts`

`bin/setup.ts` now parses `process.argv` before delegating to `SetupWizard`:

```
krythor-setup            → normal interactive wizard (unchanged)
krythor-setup --rollback → rollback mode
```

**Rollback mode flow:**

```
1. probe() → resolve dataDir (platform-aware)
2. Installer.findLatestBackup(dataDir/memory/memory.db)
   → no backup found → print error, exit 1
   → backup found   → print path, confirm user intent (informational only)
3. Installer.restoreBackup(backupPath, dbFilePath)
   → success → print confirmation
   → failure → print error, exit 1
```

Rollback is **non-interactive** — the `--rollback` flag is explicit user intent. No confirmation prompt is required; the path is printed clearly before and after the restore.

---

## Upgrade Story (End-to-End)

The complete upgrade path is now:

```
1. Stop gateway:      Ctrl-C / kill $(lsof -ti:47200)
2. Pull new version:  git pull && pnpm -r build
3. Start gateway:     node packages/gateway/dist/index.js
   → MemoryEngine calls applySchema(db, dbFilePath)
   → MigrationRunner.run() detects pending migrations
   → Creates timestamped .bak backup (hard stop if backup fails)
   → Applies each pending migration in a transaction
   → Sets PRAGMA user_version to highest applied version
   → applySchema runs PRAGMA integrity_check
   → Gateway binds and serves

4. If anything goes wrong after step 3:
   Stop gateway
   krythor-setup --rollback
   Start gateway (back on previous schema version)
```

---

## Test Counts

| Package | Before | After | Delta |
|---------|--------|-------|-------|
| guard   | 10 | 10 | — |
| models  | 30 | 30 | — |
| memory  | 34 | 35 | +1 |
| core    | 53 | 53 | — |
| setup   | 10 | 17 | +7 |
| skills  | 10 | 10 | — |
| gateway | 44 | 44 | — |
| **Total** | **191** | **199** | **+8** |

---

## Files Changed

| File | Change |
|------|--------|
| `packages/memory/src/db/MigrationRunner.ts` | Backup failure → hard stop (throws instead of warns) |
| `packages/memory/src/db/MigrationRunner.test.ts` | Added hard-stop test (backup path pre-occupied by a directory → EISDIR) |
| `packages/setup/src/Installer.ts` | Added `findLatestBackup()` and `restoreBackup()` methods; added `readdirSync`, `copyFileSync` imports |
| `packages/setup/src/bin/setup.ts` | Argument parsing; `--rollback` mode using `probe()` + `Installer` rollback helpers |
| `packages/setup/src/Installer.test.ts` | Created — 7 tests covering `findLatestBackup` (no backups, single, multiple, unrelated files) and `restoreBackup` (success, missing file, non-destructive) |

---

## Next

All 8 hardening phases are complete. The system has moved from 4.5/10 to a production-ready baseline:

| Phase | Area |
|-------|------|
| 1 | Config validation + atomic writes |
| 2 | DB integrity checks + retention rules |
| 3 | Heartbeat hardening + stale_state auto-correction |
| 4 | Skill timeout + per-request infer timeout |
| 5 | WebSocket resilience + UI degraded mode |
| 6 | Structured logging + request ID propagation |
| 7 | Integration tests for critical flows |
| 8 | Installer + upgrade + rollback story |
