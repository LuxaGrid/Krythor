# Changelog

All notable changes to Krythor are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Heartbeat Visibility (Phase 5)**: `HeartbeatRunRecord` exported from `HeartbeatEngine` — includes `durationMs` field populated on every completed run
- **Heartbeat Visibility (Phase 5)**: `HeartbeatEngine.getLastRun()` — returns the most recent completed run record (null if none yet)
- **Heartbeat Visibility (Phase 5)**: `HeartbeatEngine.getActiveWarnings()` — returns all warning-severity insights from the last run
- **Heartbeat Visibility (Phase 5)**: `/health` response now includes `heartbeat.lastRun` (full run record) and `heartbeat.warnings` (active warnings array)
- **Heartbeat Visibility (Phase 5)**: `/api/heartbeat/status` endpoint — returns `enabled`, `lastRun`, `warnings`, `warningCount`; polled by UI
- **Heartbeat Visibility (Phase 5)**: Status bar warning indicator — amber dot + count badge appears when `getActiveWarnings()` is non-empty; clicking navigates to events tab; full warning messages surfaced via tooltip
- **Heartbeat Visibility (Phase 5)**: About dialog "System Health" section — shows last run time, duration, checks ran, timeout/error state, and all active warning messages
- **Release Prep (Phase 6)**: `KRYTHOR_VERSION` constant — read from `package.json` at module load time; `/health` `version` field is now the single source of truth from package.json instead of a hardcoded string
- **Observability (Phase 1)**: `requestId` threading from HTTP request through all disk logger calls (`agentRunStarted`, `agentRunCompleted`, `agentRunFailed`, `guardDenied`)
- **Observability (Phase 1)**: `requestId?` field on `AgentRun` and `RunAgentInput` types for end-to-end log correlation
- **Observability (Phase 1)**: Per-retry-attempt logging in `ModelRouter.inferWithRetry()` — logs provider, attempt number, delay, and error before each retry
- **Observability (Phase 1)**: Circuit breaker state-change logging — `closed→open`, `open→half-open`, `half-open→closed` transitions are now logged via injectable `warnFn`
- **Model Transparency (Phase 2)**: `retryCount`, `selectionReason`, `fallbackOccurred` fields added to `InferenceResponse`
- **Model Transparency (Phase 2)**: `ModelRouter.resolve()` now returns `selectionReason` (e.g. "default provider", "agent override modelId=...", "fallback from anthropic: ...")
- **Model Transparency (Phase 2)**: `DiskLogger.circuitStateChange()`, `modelRetry()`, and `modelSelected()` structured log methods
- **Heartbeat (Phase 5)**: Per-check success logging — checks returning 0 insights now log `[checkId] OK — no issues found (Nms)` instead of silently succeeding
- **Release Prep (Phase 6)**: `krythor doctor` diagnostic command — checks Node version, port, config files, DB, and running gateway; available via `pnpm doctor`
- **Release Prep (Phase 6)**: `CHANGELOG.md` with semver-ready template

### Improved
- `ModelRouter` fallback path now annotates the response with `fallbackOccurred: true` and a human-readable `selectionReason` explaining which provider failed and why
- `AgentRunner.run()` and `runStream()` both copy `requestId` from `RunAgentInput` into the created `AgentRun` record
- `CircuitBreaker` constructor accepts optional `warnFn` — `ModelRouter` now passes its own `warnFn` so all state transitions reach the disk logger

---

## [0.1.0] — 2026-03-18

### Initial release

#### Core
- Local-first AI command platform with multi-provider routing
- Per-provider circuit breakers with exponential backoff retry
- Multi-turn agent runner (non-streaming and SSE streaming)
- Agent registry with CRUD and persistent JSON storage
- Concurrency-capped agent orchestrator (MAX_ACTIVE_RUNS=10, queue depth=50)

#### Memory
- SQLite-backed memory store (WAL mode, atomic writes, integrity checks)
- Semantic memory search with scope isolation (session / agent / workspace / user)
- Conversation store with title auto-generation
- Learning record store for model recommendation signals
- DbJanitor for retention-based pruning

#### Models
- Multi-provider model registry (Anthropic, OpenAI, Ollama, OpenAI-compatible, GGUF, Kimi, MiniMax)
- ModelRouter with priority chain: explicit override → skill → agent → default → fallback
- ModelRecommender with task classification and pinned preference support
- Circuit breaker stats endpoint (`/api/models/circuits`)

#### Guard
- Policy engine with allow/deny rules, operation matching, and audit log
- Guard decision store for persistent audit trail
- WebSocket and HTTP guard enforcement

#### Skills
- Skill registry and runner with permission checking
- Skill event forwarding to WebSocket clients

#### Gateway
- Fastify 5.2 server with CORS, rate limiting, and Host header validation
- Auth token system (load-or-generate on first run, injected into UI)
- WebSocket stream endpoint with connection cap (MAX=10) and keepalive
- HeartbeatEngine with 7 checks: task_review, stale_state, failed_skills, memory_hygiene, learning_summary, model_signal, config_integrity
- Structured disk logger (daily rotating files, 7-day retention, secret redaction)
- Startup orphan recovery (marks in-flight runs as failed after crash)
- `/health`, `/ready`, and SSE diagnostic endpoints

#### Setup
- Interactive setup wizard with provider recommendations
- System probe (Node version, port availability, Ollama detection)
- `--rollback` mode for DB migration recovery
- `doctor` diagnostic command

#### Hardening
- DB backup before every migration (`.bak` files)
- Atomic config writes (write-to-temp + rename)
- Config schema validation with human-readable error messages
- WAL journal mode + integrity check on DB open
- MigrationRunner with version tracking

---

<!-- Template for future releases:

## [X.Y.Z] — YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Removed
- ...

-->
