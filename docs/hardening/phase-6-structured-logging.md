# Phase 6 — Structured Logging + Request ID Propagation

**Status:** Complete
**Scope:** `@krythor/gateway` — `logger.ts`, `server.ts`, `routes/config.ts`, `routes/skills.ts`; `@krythor/core` — `config/validate.ts`
**Blockers fixed:** No log levels (everything written regardless of verbosity); `requestId` missing from disk log lines; scattered `console.*` calls in `server.ts` bypassing the structured logger; no runtime log-level configuration.

---

## Problem

Before this phase:

| Gap | Risk |
|-----|------|
| `DiskLogger` wrote every line regardless of level | No way to reduce disk I/O / log noise in production; debug output always written |
| `requestId` absent from `skillRunCompleted` / `skillRunFailed` / `guardDenied` / agent run logs | Could not correlate a disk log entry back to the originating HTTP request |
| `console.log` / `console.warn` in `server.ts` | Bootstrap messages (auth token, embedding wiring, LearningRecorder failures) bypassed the structured JSON log; invisible to log aggregators |
| `AppConfig` had no `logLevel` field | Log verbosity could not be changed without a code deploy |

---

## Solution

### 1. Log Level Support in DiskLogger

```typescript
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
```

- `setLevel(level)` / `getLevel()` added — callable at runtime
- Each `write()` call checks `LEVEL_RANK[level] >= LEVEL_RANK[this.minLevel]` before writing
- Default minimum level: `'info'` (unchanged behaviour — no debug spam by default)
- `debug()` method added for future diagnostic use

### 2. requestId Propagation

The following `DiskLogger` methods now accept an optional `requestId?: string` parameter, included in the JSON log line when present:

| Method | Caller |
|--------|--------|
| `skillRunCompleted` | `routes/skills.ts` → passes `req.id` |
| `skillRunFailed` | `routes/skills.ts` → passes `req.id` |
| `agentRunStarted` | `server.ts` event listener |
| `agentRunCompleted` | `server.ts` event listener |
| `agentRunFailed` | `server.ts` event listener |
| `guardDenied` | `server.ts` event listener |

**Note:** Agent runs are initiated asynchronously (orchestrator events fire after the HTTP response has been sent), so `requestId` is not available at the event level — it's included where it is available (skill runs are request-scoped). Agent run IDs already cross-reference back to the originating command via `runId`.

### 3. console.* → logger.* in server.ts

All `console.*` calls replaced with structured logger calls:

| Before | After |
|--------|-------|
| `console.error('SECURITY WARNING...')` | `logger.warn('SECURITY WARNING...', { host, port })` |
| `console.log('Gateway bound to loopback...')` | `logger.info('Gateway bound to loopback only...', { host, port })` |
| `console.log('Auth token generated')` | `logger.info('Auth token generated (first run)...')` |
| `console.warn('Auth is DISABLED...')` | `logger.warn('Auth is DISABLED...')` |
| `console.log('[embeddings] Using Ollama...')` | `logger.info('Ollama embedding provider wired', { endpoint, model })` |
| `console.warn('[LearningRecorder] Failed...')` | `logger.warn('LearningRecorder failed...', { error })` |
| `console.warn('[GuardDecisionStore] Failed...')` | `logger.warn('GuardDecisionStore failed...', { error })` |

Remaining `console.error` calls:
- `auth.ts:34` — runs before logger is constructed (bootstrap); acceptable
- `index.ts:56` — fatal startup error going to stderr before `process.exit(1)`; acceptable
- `HeartbeatEngine.ts` — intentional, uses its own structured prefix format

### 4. logLevel in AppConfig

`AppConfigRaw` in `@krythor/core/config/validate.ts`:
```typescript
logLevel?: 'debug' | 'info' | 'warn' | 'error';
```

`PATCH /api/config` schema now accepts `logLevel`. When set:
- Config route calls `logger.setLevel(updated.logLevel)` immediately
- Level persists across routes for the lifetime of the process
- On startup, `registerConfigRoute()` reads the stored value and applies it before routes are called

---

## Log Line Format

Every disk log line is a single-line JSON object:

```json
{"ts":"2026-03-18T18:42:48.006Z","level":"INFO","message":"Skill run completed","skillId":"skill-1","skillName":"Test Skill","durationMs":42,"requestId":"req-7"}
{"ts":"2026-03-18T18:42:49.100Z","level":"WARN","message":"Guard denied","context":{"operation":"skill:execute"},"reason":"blocked by policy","requestId":"req-8"}
```

Fields: `ts` (ISO-8601), `level` (INFO/WARN/ERROR/DEBUG), `message`, then any structured data fields. Secrets are redacted via `redactSecrets()`.

---

## Integration Points

| File | Change |
|------|--------|
| `logger.ts` | `LogLevel` type + `LEVEL_RANK`; `setLevel()` / `getLevel()`; `debug()` method; `write()` filters by level; `requestId?` on skill/agent/guard methods |
| `routes/config.ts` | `AppConfig.logLevel` field; startup `logger.setLevel()`; PATCH schema + handler for `logLevel` |
| `routes/skills.ts` | Passes `req.id` to `skillRunCompleted` and `skillRunFailed` |
| `server.ts` | 7 `console.*` → `logger.*` replacements |
| `core/config/validate.ts` | `AppConfigRaw.logLevel` field + validation |

---

## Next

**Phase 7 — Integration tests for critical flows**
Write end-to-end tests covering: (1) full skill run flow via HTTP; (2) agent run via command route with guard check; (3) migration + integrity check on startup; (4) heartbeat stale_state auto-correction with real DB; (5) config PATCH round-trip including logLevel.
