# Changelog

All notable changes to Krythor are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Tool system — web_search** (`WebSearchTool`): DuckDuckGo Instant Answer API, no key required, 5s timeout, up to 10 results; integrated into AgentRunner tool-call loop via `{"tool":"web_search","query":"..."}`; exposed at `POST /api/tools/web_search`
- **Tool system — web_fetch** (`WebFetchTool`): fetch any HTTP/HTTPS URL as plain text (HTML stripped), 8s timeout, 10,000 char limit; integrated into AgentRunner tool-call loop via `{"tool":"web_fetch","url":"..."}`; exposed at `POST /api/tools/web_fetch`
- **ToolRegistry**: central registry of all tools (exec, web_search, web_fetch) with name, description, parameters, `requiresGuard`, and `alwaysAllowed` fields; `GET /api/tools` returns the full registry
- **Terminal dashboard** (`krythor tui`): polls `/health` every 5 seconds, displays gateway status, providers, agents, memory, heartbeat, token count; uses only Node.js built-ins; press q to quit
- **Auto-update check**: background check against GitHub releases API on startup; prints `Update available: vX.Y.Z — run: krythor update` when a newer release is found; result cached 24h; skip with `--no-update-check`
- **`krythor update` command**: prints platform-specific one-line update instructions
- **Wizard "What You Can Do Now" section**: post-setup summary lists all commands, key API endpoints, and data locations

---

## [1.3.5] — 2026-03-21

### Added
- **GET /api/providers**: lists all configured providers as a safe summary (`id`, `name`, `type`, `endpoint`, `authMethod`, `modelCount`, `isDefault`, `isEnabled`, `setupHint?`) — never exposes API keys or OAuth tokens
- **POST /api/providers/:id/test**: tests a provider with a minimal `"Say: ok"` inference call; returns `{ ok, latencyMs, model, response }` or `{ ok: false, error }`; rate-limited to 10 req/min; 404 for unknown providers, 400 if disabled or no models
- **GET /api/models enrichment**: response now includes `provider` (display name), `providerType`, and `isDefault` in addition to all existing fields
- **GET /api/agents — `systemPromptPreview`**: first 100 chars of `systemPrompt` included as a preview field
- **Session idle metadata**: `GET /api/conversations` and `GET /api/conversations/:id` now return `sessionAgeMs` and `isIdle` (threshold: 30 minutes)
- **BM25 hybrid memory search**: `MemoryRetriever` uses a BM25-inspired weighted multi-word scorer (exact phrase → all-words → partial coverage), title-hit 1.5× bonus, stop-word filtering; replaces the simple substring scorer
- **ExecTool → AgentRunner integration**: agents can invoke exec via `{"tool":"exec","command":"...","args":[...]}` in their model response; result injected as user message; capped at 3 iterations per run to prevent loops; `ExecDeniedError` and `ExecTimeoutError` caught and injected gracefully

---

## [1.3.0] — 2026-03-21

### Added
- **ExecTool**: safe local command execution with allowlist enforcement (`ls, pwd, echo, cat, grep, find, git, node, python, python3, npm, pnpm`), guard-engine integration (`command:execute` operation), hard timeout (default 30s, max 5 minutes), `shell: false` (no injection risk), separate stdout/stderr capture
- **GET /api/tools**: lists available tools and exec allowlist
- **POST /api/tools/exec**: executes an allowlisted command (auth required, rate-limited 30 req/min)
- **Hot config reload**: `providers.json` watched via `fs.watch()` with 500ms debounce; reloads without restart
- **POST /api/config/reload**: manual hot reload trigger (auth required); returns `{ ok, message, providerCount, modelCount }`
- **TokenTracker**: records per-provider `inputTokens`, `outputTokens`, `requests`, `errors` per session; wired into `ModelEngine.infer()` and `inferStream()`
- **GET /api/stats**: per-provider token usage snapshot (auth required)
- **`/health` `totalTokens` field**: sum of all tokens used this session
- **Built-in skill templates**: `summarize`, `translate`, `explain` in `packages/skills/src/builtins/`
- **GET /api/skills/builtins**: returns all three built-in templates (auth required)
- **OpenRouter live model fetch**: wizard fetches up to 50 model IDs from `https://openrouter.ai/api/v1/models` during setup; falls back to curated list on network failure
- **LM Studio auto-detection**: `SystemProbe` probes port 1234 (LM Studio) and 8080 (llama-server) on startup; detected servers shown prominently in wizard

### Changed
- `ModelRegistry.reload()` method committed and exported (was implemented but not committed)

---

## [1.2.0] — 2026-03-21

### Added
- **`krythor status`**: quick health summary — hits `/health`, pretty-prints version, Node, providers, models, agents, memory, embedding, heartbeat; `--json` flag for machine-readable output; exit 0 if healthy, exit 1 if unreachable
- **`krythor repair`**: six-check runtime health report — bundled Node runtime, better-sqlite3 native module, gateway health endpoint, `providers.json` existence and parseability, provider count, per-provider credential validation (API key presence, OAuth token expiry)
- **KRYTHOR_DATA_DIR environment variable**: override data directory in gateway, setup wizard, and start.js
- **Doctor — provider auth validation**: checks `api_key` providers for non-empty `apiKey`, `oauth` providers for access token and expiry, `none` providers for unexpected cloud types
- **Doctor — gateway config visibility**: doctor reads `dataDir` and `configDir` from live `/health` endpoint and shows them in output
- **Doctor — exit code hardening**: exits 1 on critical failures (bad Node version, missing runtime)
- **`/health` `dataDir` and `configDir` fields**: helps users and tooling locate the active data directory
- **Workspace templates**: `Installer.installTemplates()` copies `docs/templates/*.md` to `<dataDir>/templates/` on first setup without overwriting user edits
- **GET /api/templates**: lists template files with `name`, `filename`, `size`, `description` (extracted from first H1 or first non-empty line)
- **Provider recommendations expanded**: OpenRouter ("Best Multi-Model Access"), Groq ("Fastest Inference"), Venice ("Most Private"), Z.AI ("Best for Google Models"), Kimi ("Best for Large Context"), MiniMax ("Best Value") added to wizard
- **`krythor status --json`**: machine-readable health payload to stdout

### Changed
- Minimum Node.js version raised from 18 to 20 everywhere (probe check, error messages, wizard, CI)
- Wizard completion: shows "Setup Incomplete" (not "Setup Complete") when user skipped provider selection

### Fixed
- Gateway startup: logs `[WARN] No AI providers configured` when no providers are loaded
- Doctor: extended local-type allowlist to include `openai-compat` (prevents spurious credential warnings)
- Repair: normalized all six checks to `PASS / WARN / FAIL` with consistent label-width layout

---

## [1.0.0] — 2026-03-19

### Added

#### Gateway
- Fastify 5.2 HTTP + WebSocket server on port 47200 (loopback-only)
- CORS restricted to loopback origins; Host header validation; Content-Security-Policy headers
- Rate limiting (300 req/min global; tighter per sensitive route)
- Auth token system (load-or-generate on first run; injected into UI at serve time)
- WebSocket streaming with connection cap (MAX=10) and keepalive pings
- `KRYTHOR_VERSION` read from `package.json` — single source of truth
- `/health`, `/ready` endpoints (public); all `/api/*` endpoints require auth
- SPA fallback — serves React control UI from `packages/control/dist/`

#### Agent System
- `AgentOrchestrator` with concurrency cap (`MAX_ACTIVE_RUNS=10`, queue depth=50, queue timeout=30s)
- `AgentRegistry` — CRUD with persistent JSON storage (`agents.json`)
- `AgentRunner` — multi-turn conversation loop (non-streaming and streaming variants)
- `RunQueueFullError` → HTTP 429 when queue is full
- Per-turn inference timeout (60s) with parent AbortSignal chaining

#### Memory
- `MemoryEngine` — SQLite-backed (WAL mode, atomic writes, integrity check on open)
- `MemoryStore` — semantic + keyword search with scope isolation (session / agent / workspace / user)
- `ConversationStore` — conversation history with title auto-generation
- `LearningRecordStore` — captures outcome signals from every agent run
- `HeartbeatInsightStore` — persisted heartbeat warnings for trend analysis
- `GuardDecisionStore` — persistent guard audit trail
- `AgentRunStore` — run lifecycle tracking with startup orphan recovery
- `OllamaEmbeddingProvider` — semantic embeddings via Ollama's `nomic-embed-text`
- `DbJanitor` — retention-based memory pruning
- `MigrationRunner` — versioned DB migrations with `.bak` backup before each migration

#### Models
- `ModelEngine` — multi-provider registry with `reloadProviders()` hot-reload support
- `ModelRouter` — priority chain: explicit override → skill → agent → default → fallback
- `CircuitBreaker` — per-provider failure tracking with open/half-open/closed transitions
- `ModelRecommender` — task classification and pinned preference support
- `PreferenceStore` — persistent per-agent model preferences
- Providers: Anthropic, OpenAI, Ollama, GGUF (llama-server), OpenAI-compatible, Kimi, MiniMax
- Dual-auth: API key or OAuth (browser flow) for OpenAI and Anthropic

#### Guard
- `GuardEngine` — policy-based allow/deny per operation (`policy.json`)
- `PolicyEngine` — rule evaluation with operation pattern matching
- `guard:decided` and `guard:denied` events forwarded to WebSocket clients

#### Skills
- `SkillRegistry` — file-backed skill storage and lookup
- `SkillRunner` — permission-checked skill execution with guard integration
- Skill lifecycle events forwarded to WebSocket clients

#### Setup
- Interactive terminal setup wizard (`krythor setup`)
- `SystemProbe` — checks Node version, port availability, Ollama detection, existing config
- `Installer` — writes `providers.json`, `agents.json`, `app-config.json`, `policy.json`
- `--rollback` flag for DB migration recovery
- `krythor doctor` — checks Node version, port, config files, DB, running gateway

#### Observability
- `DiskLogger` — pino-based JSON logging with daily rotation (7-day retention) and secret redaction
- `requestId` threading through all agent run log calls
- Per-retry-attempt logging in `ModelRouter.inferWithRetry()`
- Circuit breaker state-change logging on transition

#### Model Transparency
- `selectionReason`, `fallbackOccurred`, `retryCount` on `InferenceResponse`
- `run:completed` event includes `modelUsed` for UI display
- `AgentRun` records `selectionReason` and `fallbackOccurred` from the last inference

#### SOUL Identity
- `SystemIdentityProvider` — loads SOUL.md file at startup; used by `KrythorCore`
- `/health` reports `soul.loaded` and `soul.version`

#### Heartbeat
- `HeartbeatEngine` — background maintenance loop with 7 checks:
  `task_review`, `stale_state`, `failed_skills`, `memory_hygiene`, `learning_summary`, `model_signal`, `config_integrity`
- `getLastRun()`, `getActiveWarnings()` for UI polling
- `/api/heartbeat/status` endpoint

#### Distribution
- Cross-platform ZIP releases: Windows x64, Linux x64, macOS x64 + arm64
- Bundled Node.js 20 runtime in each release (no system Node required)
- `install.sh` — one-line curl installer for Mac/Linux
- `install.ps1` — one-line PowerShell installer for Windows
- Windows `.exe` installer built with Inno Setup
- `bundle.js` — distribution packager
- `build-exe.js` — Windows SEA executable builder
- GitHub Actions release workflow triggered by version tags
- `scripts/tag-release.js` — version bump + tag + push helper

---

<!-- Links -->
[Unreleased]: https://github.com/LuxaGrid/Krythor/compare/v1.3.5...HEAD
[1.3.5]: https://github.com/LuxaGrid/Krythor/compare/v1.3.0...v1.3.5
[1.3.0]: https://github.com/LuxaGrid/Krythor/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/LuxaGrid/Krythor/compare/v1.0.0...v1.2.0
[1.0.0]: https://github.com/LuxaGrid/Krythor/releases/tag/v1.0.0
