# AI Changelog

Tracks all AI-assisted implementation work on this codebase.

---

## 2026-03-28 — v0.7: Audit Persistence, Rate Limiting, Streaming Approvals, Agent Bus, Janitor UI, Webhook Hardening, Full Config Export/Import, Wizard Security Steps, Dashboard Metrics

### Feature 1 — Audit log persistence (packages: memory, gateway)
- Migration 011 adds `audit_log` table with indexes on `timestamp`, `agent_id`, `operation`
- `AuditStore` class: `insert()`, `query()`, `tail()`, `clear()`; exported from `@krythor/memory`
- `AccessProfileStore` wires AuditStore for dual write (ring buffer + SQLite)
- `GET /api/audit/log` uses SQLite primary path with in-memory fallback; supports `limit`, `offset`, `agentId`, `operation`, `since` filters

### Feature 2 — Per-agent rate limiting (package: core, gateway)
- `RunRateLimitError` in `AgentOrchestrator` — rolling 60s window, default 20 runs/min
- `setMaxRunsPerMinute(0)` disables the cap; `agentMaxRunsPerMinute` in `app-config.json` configures it at startup
- Gateway returns `429` with `Retry-After: 60` header on rate limit hit
- Agent message bus routes (`/api/agents/:id/message`, `/api/agents/:id/messages`, `/api/agents/delegate`) added

### Feature 3 — Streaming approval integration (package: gateway, control)
- `command.ts` writes SSE headers and sends `approval_required` event before blocking on approval
- `req['_sseAlreadyOpen']` flag prevents double `writeHead` in subsequent streaming blocks
- `CommandPanel.tsx` renders an inline approval prompt with Allow / Allow for Session / Deny buttons
- `respondApproval()` added to `api.ts`

### Feature 4 — Agent-to-agent messaging bus (package: core, gateway)
- `AgentMessageBus`: `send()`, `subscribe()`, `getMessages()`, `delegate()`
- Three new HTTP endpoints expose the bus; exported from `@krythor/core`

### Feature 5 — Scheduled memory cleanup UI (packages: gateway, control)
- `GET /api/memory/janitor/status` and `POST /api/memory/janitor/run`
- `JanitorStatus` tracks `lastRunAt`, `nextRunAt`, `lastResult`, `config`
- `MemoryPanel.tsx` shows last/next run times, pruning stats, and "Run Now" button

### Feature 6 — Webhook inbound hardening (package: gateway)
- `hooks.ts` rewritten with HMAC-SHA256 replay-attack protection
- Validates `X-Krythor-Timestamp` (±5 min), `X-Krythor-Nonce` (nonce dedup with auto-eviction), `X-Krythor-Signature` (`HMAC-SHA256(token:ts:nonce:body)`)
- Error codes: `MISSING_TIMESTAMP`, `TIMESTAMP_TOO_OLD`, `MISSING_NONCE`, `REPLAY_DETECTED`, `INVALID_SIGNATURE`

### Feature 7 — Full config export / import (packages: gateway, control)
- `config.portability.ts` adds `GET /api/config/export/full` and `POST /api/config/import/full`
- Exports: agents, guard policies, access profiles, cron jobs, channels, skills, providers (keys redacted)
- Import supports `?dryRun=true` and per-section boolean flags; returns per-section counts
- SettingsPanel exposes full export/import buttons

### Feature 8 — First-run wizard security guidance (package: control)
- Four new wizard steps after channels: `security_profile`, `guard_policy`, `privacy_routing`, `workspace`
- Each step calls `patchAppConfig()` with the chosen value
- `AppConfig` interface extended with `defaultProfile`, `guardPreset`, `privacyMode`, `workspacePath`
- Full Access profile shows a warning banner; privacy routing warns when no local provider is detected

### Feature 9 — Dashboard real-time metrics with trend lines (packages: gateway, control)
- `MetricsCollector`: 60-minute sliding window, per-minute buckets for requests, errors, latency sum
- `onResponse` hook in `server.ts` records all `/api/*` requests automatically
- `GET /api/dashboard/metrics/series` returns time-series payload
- `DashboardPanel.tsx` renders req/min, errors, and latency sparklines plus a totals row
- 7 new unit tests for `MetricsCollector`

Build status: 880 tests passing, all packages typecheck clean, 15 pre-existing gateway failures (migration SQL not loadable in test runner — unrelated to this session's changes).

---

## 2026-03-28 — v0.6: Privacy Routing, Workspace Isolation, CLI Policy/Audit, Compaction UI, Approvals WS Push, Cron UI

### Feature 1 — PrivacyRouter wiring (packages: core, gateway)
The `PrivacyRouter` class in `@krythor/models` was built but never instantiated. Wired into the gateway server:
- Added `privacyRoutingEnabled` and `privacyBlockOnSensitive` fields to `AppConfigRaw` in `packages/core/src/config/validate.ts` and `AppConfig` in `packages/gateway/src/routes/config.ts`
- Instantiated in `server.ts` behind a config flag; direct command requests route through `privacyRouter.infer()` when enabled
- Sensitive prompts (PII, credentials, keys) are re-routed to local providers (Ollama/GGUF/LMStudio) automatically
- `privacyDecision` metadata included in SSE `done` event

### Feature 2 — CLI policy and audit commands (package: setup)
Extended `packages/setup/src/bin/cli.ts` with four new subcommands:
- `krythor policy show` — prints all guard policy rules
- `krythor policy check <operation>` — evaluates a guard check and shows verdict; exits 0/1
- `krythor audit tail [--n=20]` — prints last N audit log entries
- `krythor approvals pending` — lists pending approval requests with expiry countdown

### Feature 3 — Agent workspace isolation (package: gateway)
Agents with `workspaceDir` set now have that directory enforced for all file tool operations:
- Added `AgentLookup` interface to `tools.file.ts`; `gate()` resolves agent workspaceDir and passes to `checkPathPermission()`
- Blocked paths return `WORKSPACE_BOUNDARY` error code; `full_access` profile bypasses the restriction
- `orchestrator` passed as agentLookup from `server.ts`
- Two new tests in `tools.file.test.ts`

### Feature 4 — Memory compaction UI trigger (packages: gateway, control)
- Added `POST /api/memory/compact` endpoint calling `memory.compactSessions()`, returns `{ compacted, rawPruned }`
- Added `compactMemory()` to control `api.ts`
- Added "Compact Sessions" button to `MemoryPanel.tsx` beside the prune button

### Feature 5 — Approvals WebSocket push + nav badge (packages: gateway, control)
- `ApprovalManager.setOnNewApproval(cb)` — new callback invoked immediately when a pending approval is created
- `server.ts` wires broadcast into this callback; UI receives `approval:pending` WS event instantly
- `App.tsx` polls `/api/approvals` every 3s and reacts to WS events; red badge on Guard tab when pending
- Badge cleared when Guard tab is opened

### Feature 6 — Model fallback UI visibility (package: control)
Verified existing implementation in `CommandPanel.tsx`: `selectionReason` and `fallbackOccurred` are already shown on each assistant message with `[fallback]` indicator.

### Feature 7 — Cron job management UI (packages: control)
Created `packages/control/src/components/CronPanel.tsx`:
- Lists cron jobs with schedule, next-run, run count, last run/fail times, error display
- Enable/disable toggle, run-now, delete per job
- Inline create form: cron expression, fixed interval, one-shot timestamp
- Added cron API helpers to `api.ts`; 'Cron Jobs' tab added to ADVANCED_TABS in `App.tsx`

Build status: all packages clean, tsc --noEmit pass, 526 tests passing (no regressions).

---

## 2026-03-26 — v0.2.1: Shell Execution + Live Channels + Wizard Channels Step

### Shell Execution (access profile enforced)
- `packages/gateway/src/routes/tools.shell.ts` — new file
  - `POST /api/tools/shell/exec` — spawn commands, safe=denied, standard+full allowed
  - `GET /api/tools/shell/processes` — list processes via wmic (Windows) / ps aux (Unix)
  - `POST /api/tools/shell/kill` — terminate by PID, full_access only
  - Audit logged, 1 MB output cap, 5 min timeout max, shell:false (no injection risk)
- `packages/gateway/src/routes/tools.shell.test.ts` — 15 tests
- `packages/control/src/api.ts` — added `shellExec()`, `listProcesses()`, `killProcess()`

### Live Inbound Channel Sessions
- `packages/gateway/src/TelegramInbound.ts` — new file
  - Long-poll `getUpdates` loop, typing indicator, AbortController stop, seeds offset on start
- `packages/gateway/src/WhatsAppInbound.ts` — new file
  - Dynamic import of `@whiskeysockets/baileys` (install-on-demand)
  - QR code pairing via `getPairingQR()`, reconnect with exponential backoff
- `packages/gateway/src/InboundChannelManager.ts` — new file
  - Starts/stops all enabled channels from ChatChannelRegistry on boot
  - Records health check status to registry on start/fail
- `packages/gateway/src/routes/chatChannels.ts` — added `POST /api/chat-channels/:id/restart`
- `packages/gateway/src/ChatChannelRegistry.ts` — made `recordHealthCheck` public
- `packages/gateway/src/server.ts` — wired InboundChannelManager, cleanup on close

### Setup Wizard Channels Step
- `packages/control/src/components/OnboardingWizard.tsx` — added channels step
  - New flow: welcome → provider → channels → done
  - Provider cards (Telegram/Discord/WhatsApp) with inline credential forms
  - Saves configured channels via API, "Skip for now" option
  - Done summary row shows channels configured count

### Deploy Fix
- `packages/control/scripts/deploy-dist.js` — now copies gateway dist to `~/.krythor` on every build

---

## 2026-03-26 — v0.2.0: Channel Onboarding + File Access + Access Profiles

### A. Chat Channel Onboarding
- `packages/gateway/src/ChatChannelRegistry.ts` — Telegram/Discord/WhatsApp provider registry, 6-state status, credential masking
- `packages/gateway/src/routes/chatChannels.ts` — 9 REST endpoints
- `packages/control/src/components/ChatChannelsPanel.tsx` — full UI panel
- `packages/control/src/api.ts` — Chat Channels API bindings

### B. File + Computer Access (9 operations)
- `packages/gateway/src/routes/tools.file.ts` — read/write/edit/move/copy/delete/mkdir/list/stat + audit

### C. Access Profiles
- `packages/gateway/src/AccessProfileStore.ts` — safe/standard/full_access, 500-entry ring buffer
- `packages/gateway/src/routes/agents.ts` — GET/PUT `/api/agents/:id/access-profile`
- `packages/control/src/components/AgentsPanel.tsx` — access profile badge with dropdown

### D. UI
- `packages/control/src/App.tsx` — Chat Channels tab added
- `packages/control/src/components/command-center/` — dynamic user agents in Command Center

### E. Tests
- 108 new tests: AccessProfileStore (24), ChatChannelRegistry (34), tools.file (22), chatChannels (28)

### F. Documentation
- `README.md`, `docs/channels.md`, `docs/permissions.md`, `CHANGELOG.md`

---

## 2026-03-22 — v0.4: UI Surface Pass

- Ctrl+K command palette, slash commands
- Log copy/expand
- EventStream rewrite
- Heartbeat/circuit dashboard
- Provider advanced settings
- Webhook test-fire
- reportOverride learning

---

## 2026-03-19 — v0.3: Distribution + Auto-provider Detection

- Node SEA executable build
- selectionReason/fallbackOccurred wired end-to-end
- Auto-provider detection
- Branding polish
- Migration 005

---

## 2026-03-19 — v0.2: Polish Pass

- Windows launch fix
- First-run readiness card
- Model ping lastUnavailableReason
- Memory search mode indicator
- 18 new tests

---

## 2026-03-18 — v0.1: Core Platform

- SOUL.md, HeartbeatEngine, LearningRecordStore, ModelRecommender
- Release hardening: structured logging, model fallback, memory retention, crash recovery
