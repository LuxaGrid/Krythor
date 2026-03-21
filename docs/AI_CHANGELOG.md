# AI Changelog — Pass 2026-03-21

**Model:** Claude Sonnet 4.6
**Pass type:** Gap analysis + Phase 0 implementation + top Phase 1 items

---

## What Was Analyzed

### OpenClaw documentation (50+ pages fetched)
Extracted capabilities across: install/onboarding, platforms, channels (22 types),
providers (30+), models, tools/skills/plugins, web UI, gateway configuration,
gateway security, remote access, discovery/pairing, local models, getting started,
wizard reference, memory config, FAQ, troubleshooting, testing, environment variables,
AGENTS templates, TOOLS templates, Anthropic OAuth, dashboard.

### Krythor codebase (full read)
All packages analyzed:
- `packages/gateway/src/` — Fastify server, auth, routes, heartbeat, readiness
- `packages/setup/src/` — SetupWizard, Installer, SystemProbe, doctor command
- `packages/models/src/` — ModelEngine, ModelRegistry, ModelRouter, ModelRecommender, CircuitBreaker, providers
- `packages/core/src/` — AgentOrchestrator, AgentRegistry, AgentRunner, KrythorCore
- `packages/memory/src/` — MemoryEngine, multiple stores, migration system
- `packages/guard/src/` — GuardEngine, PolicyEngine, PolicyStore
- `packages/skills/src/` — SkillRegistry, SkillRunner
- `packages/control/src/` — React control UI (not read in detail)
- `start.js`, `bundle.js`, `install.sh`, `install.ps1`, `.github/workflows/release.yml`

---

## Documents Created

### `docs/OPENCLAW_GAP_ANALYSIS.md`
Full 25-category comparison matrix with:
- OpenClaw capability description
- Krythor capability description
- Status (MISSING/PARTIAL/PRESENT-WEAKER/PRESENT-STRONGER)
- Why it matters
- Implement priority (now/later/skip)

Key findings:
- **Channels**: intentionally missing (correct product decision, skip)
- **Node pairing/discovery**: intentionally missing (skip)
- **Tools/skills**: largest functional gap — no exec/browser/web tools
- **Model routing**: Krythor is stronger than OpenClaw (circuit breaker, learning recommender)
- **Memory**: solid but missing hybrid BM25+vector search
- **Security**: appropriate for local-only; guard engine is a strength
- **Documentation**: major gap — no getting-started, config reference, or templates

### `docs/KRYTHOR_PHASE_PLAN.md`
Four-phase plan:
- **Phase 0** (now): Stability and foundations — 8 specific items
- **Phase 1** (soon): Missing core parity — 8 items
- **Phase 2** (later): Krythor differentiation — exec tool, hot reload, OpenRouter, hybrid memory
- **Phase 3** (later): Advanced integrations — TUI, web search, Docker, live tests
- **Phase 4** (ongoing): Docs, polish, release hardening

### `docs/GETTING_STARTED.md`
5-step getting-started guide with:
- Prerequisites
- Install options
- Wizard walkthrough
- Gateway verification
- Control UI intro
- Common issues table
- Quick reference

### `docs/CONFIG_REFERENCE.md`
Full configuration reference documenting:
- Data directory locations (all platforms)
- `KRYTHOR_DATA_DIR` env var override
- All config files: `providers.json`, `agents.json`, `app-config.json`, `policy.json`
- All fields with types and descriptions
- Safe editing rules
- Backup and restore guidance
- Diagnostics command reference

### `docs/templates/AGENTS.md`
Agent workspace template with identity, memory rules, working rules, skills roster.

### `docs/templates/SOUL.md`
Identity configuration template with values, tone, and red lines.

### `docs/templates/TOOLS.md`
Local environment notes template for machine-specific config (API keys, devices, paths).

### `docs/templates/MEMORY.md`
Long-term memory starter template with user profile, preferences, ongoing projects, key decisions.

---

## Code Changes Implemented

### Phase 0 — Stability and Foundations

#### P0-1: Wizard — never print success after failure
**File:** `packages/setup/src/SetupWizard.ts`

Changed the post-wizard summary to show "Setup Incomplete" (not "Setup Complete") when the user skips the provider. The incomplete state shows a clear CTA directing users to the Models tab or `pnpm setup`.

Previously: Always printed `fmt.head('Setup Complete')` and `fmt.ok(...)` regardless of outcome.
Now: Checks `providerType !== 'skip' && firstModel !== undefined` before printing success messaging.

#### P0-2: Node version — reconcile 18 vs 20
**Files:** `packages/setup/src/SystemProbe.ts`, `packages/setup/src/SetupWizard.ts`, `packages/setup/src/bin/setup.ts`

Raised the minimum Node.js version from 18 to 20 to match README and CI requirements:
- `SystemProbe.ts`: `nodeVersionOk: major >= 20` (was 18)
- Error messages updated to say "Node 20+" with download link

#### P0-3: Doctor — provider auth validation
**File:** `packages/setup/src/bin/setup.ts`

Extended the doctor's Configuration section to check per-provider auth status:
- `api_key` providers: verifies `apiKey` is non-empty
- `oauth` providers: verifies `accessToken` is present AND checks expiry timestamp
- `none` providers: warns if the type is not a local provider (ollama/gguf)
- Reports count of providers needing attention
- Handles both wrapped and flat `providers.json` formats

#### P0-6: KRYTHOR_DATA_DIR environment variable
**Files:** `packages/setup/src/SystemProbe.ts`, `packages/gateway/src/server.ts`, `start.js`

Added `KRYTHOR_DATA_DIR` environment variable support across all three code paths:
- `SystemProbe.ts`: uses env var in both `getDataDir()` and `getConfigDir()`
- `gateway/server.ts`: uses env var in `getDataDir()`; also logs resolved data dir at startup
- `start.js`: uses env var when showing "Your data" path to user

#### P0-8: Gateway startup — log provider load warnings clearly
**File:** `packages/gateway/src/server.ts`

Added explicit startup logging after `ModelEngine` initialization:
- If 0 providers: logs a `WARN` with actionable guidance (`krythor setup` or Models tab)
- If providers present: logs `INFO` with providerCount, modelCount, hasDefault

Also added `dataDir` and `configDir` to the `/health` endpoint response, enabling:
- `krythor status` to show the data location
- Doctor to show config dir from the live gateway response
- Users to verify which data dir the gateway is using

#### P0-4 (partial): Doctor — show gateway config from live endpoint
**File:** `packages/setup/src/bin/setup.ts`

Updated the Gateway section of doctor to parse the richer `/health` response:
- Shows provider count and model count from the running gateway
- Shows `dataDir` and `configDir` from gateway
- Flags first-run state if detected
- Warns when no providers are configured from the live source

#### Exit code hardening
**File:** `packages/setup/src/bin/setup.ts`

Doctor now exits 1 on critical issues (bad Node version) and provides a clear next-action recommendation at the end of every run.

#### P1-6 (Phase 1 early): `krythor status` command
**File:** `start.js`

Added `krythor status` subcommand that:
- Hits `/health` endpoint with 2s timeout
- Pretty-prints: version, Node version, provider count, model count, agent count, memory entry count, embedding status, heartbeat status
- Shows data dir and config dir
- Shows first-run warning if applicable
- Exits 0 if healthy, exits 1 if gateway unreachable

---

## Tests Added / Updated

### `packages/setup/src/doctor.test.ts`
- Updated `nodeVersionOk` test from `>= 18` to `>= 20`
- Added `KRYTHOR_DATA_DIR` test suite:
  - Verifies `dataDir` is overridden when env var is set
  - Verifies `configDir` is `<dataDir>/config` when overridden
  - Verifies platform default is used when env var is absent

### `packages/setup/src/SetupWizard.test.ts`
- Added `Wizard setup completion logic` test suite:
  - Verifies `onboardingComplete = false` when providerType is 'skip'
  - Verifies `onboardingComplete = true` when providerType is set
  - Verifies anthropic is dual-auth
  - Verifies all `priority_rank` values are unique

### `packages/gateway/src/routes/health.test.ts`
- Added test: `/health` returns `dataDir` (string)
- Added test: `/health` returns `configDir` (string, subdirectory of dataDir)
- Added test: `/health` returns `firstRun` flag (boolean)

---

## Build Status

All changes compile cleanly with `pnpm build`.
All tests pass: 93 tests across 11 test files.

---

## What Remains for the Next Pass

### Phase 1 (not yet implemented)
- P1-1: Add OpenRouter, Groq, Venice, Z.AI to wizard provider list
- P1-4: Auto-install agent workspace templates on first run (currently docs-only)
- P1-5: Local model discovery UX improvements in wizard (GGUF server detection on port 8080)
- P1-7: Publish getting-started guide (currently `docs/GETTING_STARTED.md` only)
- P1-8: Gateway e2e smoke test (real port binding)

### Phase 2+ (not yet started)
- Exec tool (biggest functional gap)
- Hot config reload
- OpenRouter provider type
- Hybrid BM25+vector memory search
- npm global publish
- SSH remote access documentation

### Known gaps not tackled (intentional skips per product direction)
- Channels (Telegram/Discord/Slack/WhatsApp) — skip
- Node/device pairing — skip
- Multi-tenant isolation — skip
- Tailscale integration — skip
