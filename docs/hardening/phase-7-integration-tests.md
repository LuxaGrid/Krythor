# Phase 7 — Integration Tests for Critical Flows

**Status:** Complete
**Scope:** `@krythor/gateway` — `integration.test.ts`, `vitest.config.ts`
**Blockers fixed:** No cross-subsystem tests; parallel test file execution caused auth-token races producing flaky 401s across the existing gateway test suite.

---

## Problem

Before this phase:

| Gap | Risk |
|-----|------|
| No integration tests | Each subsystem tested in isolation; interactions between guard, config, logger, heartbeat, and skill runner were untested |
| `vitest.config.ts` lacked `fileParallelism: false` | Multiple test files calling `buildServer()` in parallel raced on `loadOrCreateToken()` — one file could regenerate the token while another was mid-request, producing flaky 401 responses |

---

## Solution

### 1. fileParallelism: false in vitest.config.ts

```typescript
fileParallelism: false,
```

All gateway test files now run sequentially. Each `beforeAll` builds its own Fastify server, and because they run one file at a time, the shared auth token and SQLite DB on disk are never accessed concurrently.

**Why not a shared server setup?** The existing test files all follow the `buildServer() + app.inject()` pattern independently. Changing to a shared `globalSetup` would require refactoring all five existing test files. Sequential execution is the minimal, safe fix.

### 2. integration.test.ts — 13 New Tests

Five critical flows covered:

#### Flow 1 — Skill create → list (HTTP end-to-end)

```
POST /api/skills { name, systemPrompt, tags, timeoutMs }
  → 201 Created  (or 403 if guard denies)
  → id, version: 1, name present in response

GET /api/skills
  → skill appears in list

GET /api/skills/:id
  → skill retrievable by ID

POST /api/skills { timeoutMs: 500 }  (below minimum 1000)
  → 400 validation error
```

#### Flow 2 — Guard + command route validation

```
POST /api/command {}   (missing input)
  → 400 VALIDATION_ERROR with requestId field

POST /api/command { agentId: 123 }  (wrong type)
  → 400 with requestId string
```

Verifies `requestId` propagation from Phase 6 is present in all 400 responses.

#### Flow 3 — DB migration + integrity check (applySchema)

```
applySchema(freshDb)
  → applied: 3, total: 3, userVersion: 3
  → integrityStatus: 'ok'
  → integrityMessages: []

applySchema(db) twice
  → second.applied: 0  (idempotent)
  → userVersion still 3

MigrationRunner.run()
  → userVersion === total
  → getUserVersion() === userVersion

applySchema(db, dbPath) on file-backed DB
  → backupPath defined and ends with .bak
```

#### Flow 4 — Heartbeat stale_state with real AgentRunStore

```
AgentRunStore.save({ status: 'running', startedAt: 20 min ago })
check_stale_state()
  → 1 warning insight returned
  → DB row updated to status: 'failed'
  → errorMessage contains 'stale_state'

AgentRunStore.save({ status: 'completed' })
check_stale_state()
  → 0 insights (completed runs are not stale)
```

#### Flow 5 — Config PATCH round-trip including logLevel

```
PATCH /api/config { logLevel: 'warn' }
  → 200 { logLevel: 'warn' }
  → logger.getLevel() === 'warn'
  → (restored to 'info' after test)

PATCH /api/config { logLevel: 'verbose' }
  → 400 validation error (not in enum)

GET /api/config
  → 200 valid config object
```

---

## Test Counts

| Package | Before | After | Delta |
|---------|--------|-------|-------|
| guard | 10 | 10 | — |
| models | 30 | 30 | — |
| memory | 34 | 34 | — |
| core | 53 | 53 | — |
| setup | 10 | 10 | — |
| skills | 10 | 10 | — |
| gateway | 31 | 44 | +13 |
| **Total** | **178** | **191** | **+13** |

---

## Files Changed

| File | Change |
|------|--------|
| `packages/gateway/src/integration.test.ts` | Created — 13 integration tests across 5 suites |
| `packages/gateway/vitest.config.ts` | Added `fileParallelism: false` to eliminate auth-token race |

---

## Next

**Phase 8 — Installer + upgrade + rollback story**
Document and validate the end-to-end install, upgrade, and rollback paths. Add a pre-upgrade backup step to the installer, verify `PRAGMA user_version` guards against re-running completed migrations, and add a `--rollback` flag to the setup wizard that restores from the most recent `.bak` file.
