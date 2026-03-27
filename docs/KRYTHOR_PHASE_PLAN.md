# Krythor Phase Plan

**Date:** 2026-03-21
**Based on:** Gap analysis + full codebase review

---

## PHASE 0 — Stability and Foundations

**Goal:** Fix things that erode user trust and produce confusing output today.
**Rule:** No new features. Only correctness, accuracy, and clarity.

### P0-1: Wizard — never print success after failure

**Problem:** `SetupWizard` prints `fmt.head('Setup Complete')` and `fmt.ok('Configuration saved')` even when the user selected "Skip" for the provider. This is misleading — setup is not complete if there is no provider.

**Fix:**
- Track whether a provider was actually configured
- Print a qualified success message when `onboardingComplete === false`
- Surface a clear CTA: "Add a provider via the Models tab before using Krythor"

**Files:** `packages/setup/src/SetupWizard.ts`
**Tests:** `packages/setup/src/SetupWizard.test.ts`

---

### P0-2: Node version check — reconcile 18 vs 20

**Problem:** `SystemProbe.ts` checks `major >= 18` and the error message says "Node 18+", but README.md says "Node.js 20 or higher", and server.ts comment says "18→20". The minimum is ambiguous.

**Fix:**
- Raise the minimum to Node 20 everywhere (align with README and CI)
- Update probe check and wizard error message

**Files:** `packages/setup/src/SystemProbe.ts`, `packages/setup/src/SetupWizard.ts`, `packages/setup/src/bin/setup.ts`
**Tests:** `packages/setup/src/doctor.test.ts`

---

### P0-3: Doctor — add provider auth validation

**Problem:** `krythor doctor` checks that `providers.json` exists and has entries, but does not validate that providers actually have credentials. Users with stale OAuth tokens or missing API keys get no warning from doctor.

**Fix:**
- Load providers via `parseProviderList`
- For each enabled provider, check:
  - `authMethod === 'api_key'` → has `apiKey` (non-empty)
  - `authMethod === 'oauth'` → has `oauthAccount` with `accessToken`
  - `authMethod === 'none'` → warn if type is not `ollama` (local providers don't need auth)
- Report per-provider auth status in doctor output

**Files:** `packages/setup/src/bin/setup.ts`
**Tests:** `packages/setup/src/doctor.test.ts`

---

### P0-4: Provider config validation — log skipped providers at startup

**Problem:** `parseProviderList` silently skips invalid providers. The gateway logs a warning at the model engine level, but the user sees no actionable guidance.

**Fix:**
- In `ModelRegistry` (or `ModelEngine` constructor), log each skipped provider with its validation errors
- Include a hint: "Fix or remove this provider in providers.json, then restart"
- Already implemented defensively — this is a logging/message quality fix

**Files:** `packages/models/src/ModelRegistry.ts` (check current logging), `packages/gateway/src/server.ts`

---

### P0-5: Config reference documentation

**Problem:** Users have no reference for what config files exist, what fields they contain, or how to safely edit them. This causes support burden and config corruption.

**Fix:** Create `docs/CONFIG_REFERENCE.md` documenting:
- All config file paths per OS
- `providers.json` schema (all fields)
- `agents.json` schema
- `app-config.json` schema
- `policy.json` schema
- Environment variables: `NODE_ENV`, gateway port, data dir override
- Safe edit guidance

**Files:** `docs/CONFIG_REFERENCE.md` (new)

---

### P0-6: Environment variable for data directory override

**Problem:** Krythor hard-codes data dir based on platform. Users cannot relocate data (for backup, multi-user, or test scenarios) without code changes.

**Fix:**
- Support `KRYTHOR_DATA_DIR` environment variable in `getDataDir()` in:
  - `packages/gateway/src/server.ts`
  - `packages/setup/src/SystemProbe.ts`
- Log the resolved data dir at startup
- Document in `docs/CONFIG_REFERENCE.md`

**Files:** `packages/gateway/src/server.ts`, `packages/setup/src/SystemProbe.ts`
**Tests:** Update `doctor.test.ts`

---

### P0-7: Onboarding — truthful auth choice presentation

**Problem:** The auth choice UI says "Connect with OAuth later (in the app)" but there is no in-app button shown in the control UI unless a `setupHint: 'oauth_available'` is present. The wording creates an expectation that may not be met.

**Fix:**
- Verify that `setupHint: 'oauth_available'` is correctly surfaced in the Control UI
- If not, update the wizard wording to: "Connect with OAuth later — you'll see a prompt in the Models tab"
- Add a field to `AppConfig` to track pending OAuth providers for the first-run card

**Files:** `packages/setup/src/SetupWizard.ts`, `packages/setup/src/Installer.ts`

---

### P0-8: Gateway startup — log provider load warnings clearly

**Problem:** If providers.json is missing, empty, or has invalid entries, the gateway starts successfully but quietly. Users need to see a clear startup-time warning.

**Fix:**
- After `ModelEngine` initialization in `server.ts`, check `models.stats().providerCount`
- If 0: log `[WARN] No providers configured — inference will fail. Run: krythor setup`
- If `registry.skippedCount > 0`: log which providers were skipped and why

**Files:** `packages/gateway/src/server.ts`
**Tests:** `packages/gateway/src/routes/health.test.ts`

---

## PHASE 1 — Missing Core Parity

**Goal:** Close the highest-value gaps without destabilizing architecture.

### P1-1: Provider/model directory UX in wizard

**Add to wizard:**
- OpenRouter as a named provider (covers 100+ models via single API key)
- Groq (fast inference, free tier, covers Llama/Mixtral)
- Venice (privacy-preserving inference)
- Z.AI (Gemini-equivalent)
- Display model count or context window for each model in picker
- "Why this model?" hint for recommended models

**Files:** `packages/setup/src/SetupWizard.ts`

---

### P1-2: Gateway configuration visibility

**Add to doctor:**
- Show current port and bind address
- Show gateway version
- Show data dir path
- Show whether auth token is present and how long it is
- Show whether a control UI build exists

**Add to `/health` endpoint:**
- `configDir` in response (helps users find their config)
- `dataDir` in response

**Files:** `packages/setup/src/bin/setup.ts`, `packages/gateway/src/server.ts`

---

### P1-3: Improved doctor/repair workflow

**Add to doctor:**
- `--fix` flag: when present, attempt safe auto-fixes:
  - Create `agents.json` with default agent if missing
  - Create `providers.json` (empty) if missing
  - Write default `policy.json` if missing
- Show next-action recommendation at end of doctor run
- Exit code 1 if any critical check fails, 0 if only warnings

**Files:** `packages/setup/src/bin/setup.ts`

---

### P1-4: Config templates and examples

**Create:**
- `docs/templates/AGENTS.md` — example agent workspace file
- `docs/templates/SOUL.md` — example identity file
- `docs/templates/TOOLS.md` — local environment notes template
- `docs/templates/MEMORY.md` — long-term memory starter
- These are reference templates, not auto-installed

**Files:** `docs/templates/` (new directory, 4 files)

---

### P1-5: Local model discovery improvements

**In wizard for Ollama:**
- Already lists installed models via `/api/tags` (good)
- Add: warn if no models are installed (`ollama pull <model>` hint)
- Add: show model size if available from tags response
- Add: detect if GGUF server (llama-server) is running on common ports (8080, 8000)

**Files:** `packages/setup/src/SetupWizard.ts`

---

### P1-6: `krythor status` CLI command

**Add to `start.js`:**
- `krythor status` — quick health summary without full doctor
- Hits `/health` endpoint and pretty-prints: running status, version, provider count, model count, memory status, last heartbeat
- Exit 0 if healthy, exit 1 if not responding

**Files:** `start.js`

---

### P1-7: Getting-started guide

**Create:** `docs/GETTING_STARTED.md`
- 5-step flow: install → setup wizard → verify gateway → open control UI → first command
- Common first commands
- Next steps (add providers, explore memory, check doctor)
- Link to CONFIG_REFERENCE.md

**Files:** `docs/GETTING_STARTED.md` (new)

---

### P1-8: Gateway e2e smoke test

**Create:** A test that starts the actual gateway process on a random port, hits `/health` and `/ready`, and confirms responses. Tears down cleanly.

**Files:** `packages/gateway/src/e2e.test.ts` (new)
**Config:** Vitest workspace, separate `pnpm test:e2e` script

---

## PHASE 2 — Krythor Differentiation

**Goal:** Build on Krythor's strengths — local-first, observable, controllable.

### P2-1: Exec tool (safe local command execution)

Build a basic exec tool that agents can invoke via skills:
- `exec` with allowlist-based command control via GuardEngine
- Output streaming to WebSocket
- Workspace-scoped working directory
- No Docker sandbox yet — use process-level isolation with allowlist

---

### P2-2: Hot config reload

Support `SIGHUP`-triggered provider reload without full restart:
- Re-read `providers.json` on signal
- Re-initialize `ModelEngine` with updated provider list
- Log reload event

---

### P2-3: OpenRouter provider type

Add OpenRouter as a named provider type:
- Endpoint: `https://openrouter.ai/api/v1`
- API key auth
- Model discovery via OpenRouter's `/models` API
- Wizard support

---

### P2-4: Model aliases

Support shorthand model aliases in wizard and routing:
- `anthropic/sonnet` → resolves to latest Sonnet model in provider's list
- `openai/gpt4` → latest GPT-4 variant
- Store aliases in a separate `model-aliases.json` config

---

### P2-5: Enhanced memory — hybrid search

Add BM25+vector hybrid search to `MemoryEngine`:
- BM25 over stored entries (pure JS implementation, no native dep)
- Combine with cosine similarity when embedding is available
- MMR re-ranking (optional, configurable)

---

### P2-6: SSH remote access documentation

Document the recommended pattern for remote access to a home-server Krythor:
- SSH port forwarding: `ssh -L 47200:127.0.0.1:47200 user@server`
- VS Code remote tunnel pattern
- Security considerations

---

### P2-7: npm global publish

Add `bin` field to root `package.json`, configure npm publish workflow.

---

## PHASE 3 — Advanced Integrations

### P3-1: TUI for local chat

Build a Node.js terminal UI using `blessed` or `ink`:
- Input box + streaming response area
- Model/agent selector
- Memory search display

### P3-2: Web search tool

Add `web_search` and `web_fetch` skill tools:
- `web_search`: Brave Search API (configurable) or DuckDuckGo (no key needed)
- `web_fetch`: HTTP GET with content extraction (cheerio/unfluff)
- GuardEngine policy: `tool:web_search:allow`

### P3-3: Docker image

Create a `Dockerfile` for the Krythor gateway:
- Multi-stage build
- Non-root user
- Environment variable configuration

### P3-4: Live provider tests

Add `pnpm test:live` tier:
- Discovers credentials from `$KRYTHOR_DATA_DIR/config/providers.json`
- Tests each enabled provider with a minimal inference call
- Reports latency, token count, success/fail per provider

### P3-5: Session idle timeout

Add configurable session idle timeout:
- `session.idleMinutes` in `app-config.json` (default: 60)
- Background worker clears idle conversations from active state
- WebSocket notification when session expires

---

## PHASE 4 — Docs, Polish, Release Hardening

### P4-1: Full user documentation site

Consider Docusaurus or VitePress to host:
- Getting started
- Config reference
- Provider directory
- API reference (auto-generated from routes)
- Troubleshooting guide

### P4-2: Auto-update mechanism

- `krythor update` CLI command
- Checks GitHub releases API for newer version
- Downloads and replaces bundled runtime + dist

### P4-3: End-to-end release test suite

Automated tests that:
- Verify install.sh on Linux (Docker)
- Verify install.ps1 on Windows (GitHub Actions)
- Run setup wizard non-interactively
- Start gateway, verify /health
- Run a provider inference (with test credentials)
- Run doctor, verify exit 0

### P4-4: Telemetry opt-in (privacy-respecting)

Optional anonymous usage metrics:
- Provider type counts (not keys)
- Gateway uptime
- No request content ever

### P4-5: Config schema JSON Schema file

Publish `krythor-config.schema.json` for IDE autocomplete:
- providers.json schema
- agents.json schema
- app-config.json schema

---

## Timeline Guidance

| Phase | Effort | Precondition |
|---|---|---|
| Phase 0 | 1–2 days | None — start immediately |
| Phase 1 | 3–5 days | Phase 0 complete |
| Phase 2 | 2–4 weeks | Phase 1 complete, exec tool architecture decision |
| Phase 3 | 4–8 weeks | Phase 2 exec tool shipped |
| Phase 4 | Ongoing | Parallel with Phase 2/3 |

---

## What NOT to Build

- **Channels (Telegram/Discord/WhatsApp/Slack):** Architecture not ready. Krythor's value prop is a local AI platform, not a messaging bridge.
- **Node/device pairing:** Mobile companion apps are a separate product. Out of scope.
- **Multi-tenant isolation:** Krythor is personal/team local-first. Not designed for adversarial multi-tenant.
- **Feature parity for its own sake:** Only build what serves Krythor's identity — Atlas-first, local-first, observable, controllable.
