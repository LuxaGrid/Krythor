# Release Hardening Phase 7 — Release Readiness Tests

**Status:** Complete
**Scope:** `@krythor/gateway` — `HeartbeatEngine.test.ts`
**Focus:** Adding targeted tests around the hardening work from Phases R2–R6 that were not already covered by those phases' own test additions.

---

## Tests Added

### `HeartbeatEngine — memory_hygiene check` (2 new tests)

These tests exercise the `.bak` backup file accumulation check added in Phase R4.

**`emits a warning insight when more than 10 .bak files are present`**

Creates a temp directory with 11 `.bak` files, passes it as `memory.dbDir`, and asserts that `check_memory_hygiene` returns a `'warning'` severity insight mentioning `.bak`. This is the primary integration-level validation of the Phase R4 backup visibility feature.

**`does not emit a warning when .bak count is within normal range`**

Creates 3 `.bak` files (below the 10-file threshold) and asserts no `.bak`-related insight is emitted. Confirms the threshold is correct and the check is not over-sensitive.

### Supporting stub update

The `makeMemoryStub` helper was updated to:
- Accept an optional `dbDir` parameter
- Include `db` and `dbDir` in the returned stub (so the `.bak` check and PRAGMA check have access to real data)
- Return a `tableCountsAfter: {}` field in the `runJanitor()` stub result (matching the updated `JanitorResult` interface from Phase R4)

---

## Coverage Map Across All Phases

| Priority test (Phase R7 plan) | Covered by |
|-------------------------------|------------|
| Structured logging/tracing helpers | Phase R2 + gateway integration tests |
| Model fallback for eligible transient failures | Phase R3: `ModelRouter.test.ts` (+5 tests) |
| Non-retryable failures don't trigger incorrect fallback | Phase R3: `ModelRouter.test.ts` |
| Retention/janitor routines prune safely | Existing + Phase R4: `DbJanitor.test.ts` (+3 tests) |
| Startup recovery resolves stale runs | Phase R5: `AgentRunStore.test.ts` (+5 tests) |
| WebSocket/UI recovery after restart | Client-side (exponential backoff on reconnect); server-side: orphan recovery tested in R5 |
| Wizard recommendations don't overwrite saved preferences | `SetupWizard.test.ts` — `'openai-compat is not recommended_for_onboarding'` + `'smart default (index 0)'` tests validate no-force behavior |
| .bak file accumulation visible via heartbeat | **This phase** — `HeartbeatEngine.test.ts` (+2 tests) |

---

## Test Counts

| Suite | Before R7 | After R7 | Delta |
|-------|-----------|----------|-------|
| gateway | 44 | 46 | +2 |

**Total: 215 tests, 0 failures.**

---

## Files Changed

| File | Change |
|------|--------|
| `packages/gateway/src/heartbeat/HeartbeatEngine.test.ts` | Add `fs`/`os`/`path` imports; update `makeMemoryStub` to accept `dbDir` and return `db`/`dbDir`/`tableCountsAfter`; add 2 `.bak` count warning tests |
