# Krythor — Gap Analysis

**Date:** 2026-03-21
**Analyst:** AI pass (Claude Sonnet 4.6)
**Source:** Reference system public docs + full Krythor codebase read

---

## Legend

| Status | Meaning |
|---|---|
| **MISSING** | Reference system has it; Krythor has nothing equivalent |
| **PARTIAL** | Krythor has the concept but with meaningful gaps |
| **PRESENT-WEAKER** | Krythor has it, less depth than the reference |
| **PRESENT-STRONGER** | Krythor has it, better or differently positioned |
| **N/A** | Category does not apply to Krythor's product direction |

**Implement column:** `now` = Phase 0/1 target · `later` = Phase 2/3 · `skip` = out of scope

---

## 1. Install / Onboarding

**Reference capability:**
- One-line curl/ps1 installer auto-detects OS, installs Node if absent, launches onboarding
- `krythor onboard --install-daemon` — 2-minute wizard covering provider, key, workspace, channels, daemon registration
- Non-interactive mode with full flag coverage (`--anthropic-api-key`, `--gateway-port`, etc.)
- `krythor doctor` shows 5-command 60-second diagnostic sequence
- `krythor dashboard` auto-opens browser after onboarding

**Krythor capability:**
- One-line curl/ps1 installer present (`install.sh` / `install.ps1`) — auto-detects OS
- `SetupWizard.ts` covers provider selection, API key, model pick, agent creation, launch offer
- `doctor` command exists in `packages/setup/src/bin/setup.ts`
- Repair mode in `start.js` checks bundled Node + sqlite3 + gateway health
- No daemon registration (launchd/systemd) — gateway is manual-start
- Wizard prints "Setup Complete" even if provider was skipped entirely
- Node version check says "Node 18+" but README says "Node 20+" — inconsistency
- Non-interactive mode: absent (no `--flag` equivalents for CI/scripting)

**Status:** PARTIAL
**Why it matters:** First-run experience determines whether users succeed or bail. False success messages (printing "Setup Complete" with no provider) erode trust.
**Implement:** now (Phase 0)

---

## 2. Runtime / Bundled Distribution

**Reference capability:**
- npm global install; from-source build; Docker/Podman/Nix/Ansible alternatives
- Node 24 / Node 22.16+ requirement
- macOS menu bar app; iOS/Android native companion; Windows planned

**Krythor capability:**
- Platform release zips with bundled Node 20 runtime (Windows/macOS/Linux)
- SEA (Single Executable Application) build via `sea-config.json` + `build-exe.js`
- One-line installer from `install.sh` / `install.ps1`
- `Krythor.bat` auto-build wrapper for Windows
- No npm global publish yet (no `bin` field in published package)
- No mobile companion apps
- GitHub Actions release workflow in `.github/workflows/release.yml`

**Status:** PRESENT-WEAKER
**Why it matters:** npm global install is the lowest-friction path for developers. Bundled runtime is better for end-users who don't have Node.
**Implement:** later (Phase 2 — npm publish)

---

## 3. Gateway Core

**Reference capability:**
- Single always-on process: routing + control plane + channel connections
- Single multiplexed port: WebSocket control/RPC + HTTP API (OpenAI-compatible) + response streaming
- Hot reload modes: off / hot / restart / hybrid (default)
- Config watching: monitors active config path, auto-reloads on change
- Multiple instance support with isolated port/config/state/workspace
- mDNS/Bonjour service advertisement
- launchd (macOS) and systemd (Linux) daemon registration

**Krythor capability:**
- Fastify server on port 47200 (loopback only, not configurable via env/flag)
- WebSocket stream at `/ws/stream`; HTTP API at `/api/*`
- No hot reload — changes require manual restart
- No config watching
- No daemon registration (no launchd/systemd integration)
- CORS restricted to loopback origins — good security baseline
- Rate limiting: 300 req/min global
- Health endpoint at `/health` (public), readiness at `/ready`
- Token injection into index.html at serve time (good pattern)
- No OpenAI-compatible `/v1/chat/completions` endpoint

**Status:** PARTIAL
**Why it matters:** No config hot-reload means every provider change requires a restart. No daemon means the gateway dies on shell exit.
**Implement:** now (daemon docs/scripts), later (hot reload — Phase 2)

---

## 4. Provider System

**Reference capability:**
- 30+ providers: Anthropic, OpenAI, Google Gemini, xAI, Mistral, Groq, Perplexity, Moonshot/Kimi, MiniMax, Venice, Z.AI, Amazon Bedrock, and more
- `provider/model` format for addressing
- Config validation with per-provider error reporting at startup

**Krythor capability:**
- Providers: Anthropic, OpenAI, Ollama, OpenAI-compat (covers Kimi, MiniMax, LM Studio, etc.), GGUF
- `validateProviderConfig` + `parseProviderList` — malformed entries are skipped with error log, startup never crashes
- Wizard covers: anthropic, openai, kimi, minimax, ollama, openai-compat
- No Venice, Z.AI, OpenRouter, Groq, Mistral, Gemini, xAI, Bedrock, etc. as named providers
- Provider validation already robust (Phase 0 goal already met here)
- No `provider/model` address format — model is stored in provider's `models[]` list

**Status:** PARTIAL
**Why it matters:** Named providers with known model lists enable better wizard UX and auto-completion. Generic openai-compat covers many but gives no guidance.
**Implement:** later (Phase 2 — add Venice, OpenRouter, Groq, Gemini as named types)

---

## 5. OAuth + API Key Support

**Reference capability:**
- Anthropic: API key or OAuth via CLI `setup-token` flow
- OpenAI: API key or OAuth browser flow
- Token expiry detection and re-auth prompts
- Out-of-band token paste for remote/CI scenarios

**Krythor capability:**
- Dual-auth UI in wizard: API key or "OAuth later" (sets `setupHint: 'oauth_available'`)
- `connectOAuth`, `disconnectOAuth`, `refreshOAuthTokens` methods on `ModelEngine`
- OAuth account stored in provider entry (`oauthAccount` field with `accessToken`, `refreshToken`, `expiresAt`)
- No actual OAuth browser flow in CLI — deferred to desktop UI (correct product decision)
- No token expiry detection or re-auth prompt
- Wizard truthfully presents auth choices for anthropic/openai

**Status:** PRESENT-WEAKER
**Why it matters:** Token expiry is silent — users get 401 errors with no in-wizard guidance. UI CTA for OAuth (via `setupHint`) is a good pattern.
**Implement:** now (Phase 0 — expiry detection in health check; warn users)

---

## 6. Model Registry and Model Routing

**Reference capability:**
- `provider/model` format for primary model assignment
- Model aliases (opus, sonnet, gpt, gemini) for quick switching
- In-chat model switching without restart
- Per-agent model assignment

**Krythor capability:**
- `ModelRegistry` + `ModelRouter` with circuit breaker per provider
- `ModelRecommender` — learning-based recommendation engine with `PreferenceStore`
- Per-agent model assignment via `agentId` in `RoutingContext`
- Automatic fallback to next enabled provider on circuit open
- `selectionReason` and `fallbackOccurred` surfaced end-to-end
- No model aliases / shorthand names
- No in-chat `/model` switch command
- `ModelEngine.listModels()` returns full model catalog

**Status:** PRESENT-STRONGER
**Why it matters:** Krythor's learning-based recommendation and circuit breaker fallback exceed the reference's routing capabilities. Model aliases and in-chat switching are missing but lower priority.
**Implement:** later (Phase 2 — aliases; Phase 3 — in-chat commands)

---

## 7. Local Model Support

**Reference capability:**
- Ollama, vLLM, SGLang, LM Studio — all via OpenAI-compatible endpoint
- Fallback merge mode keeps hosted providers when local is down
- Local models skip provider-side safety filters — warned in docs

**Krythor capability:**
- Ollama provider with live model discovery (`/api/tags`)
- `OllamaProvider` + `OllamaEmbeddingProvider` (nomic-embed-text)
- GGUF provider (llama-server) via `gguf` type
- OpenAI-compat covers LM Studio, vLLM
- Wizard detects Ollama at setup and pre-configures it
- No hardware guidance in docs
- No explicit local-first fallback merge mode

**Status:** PRESENT-WEAKER
**Why it matters:** Krythor has good local model support but lacks discovery UX improvements (auto-listing installed models is done; auto-detecting GGUF servers is not).
**Implement:** later (Phase 1 — improve local model discovery UX in wizard)

---

## 8. Agent System

**Reference capability:**
- Multi-agent routing with isolated sessions per agent/workspace/sender
- Sub-agent spawning and management
- Session management with idle timeout
- Heartbeat for periodic proactive agent work
- SOUL.md, USER.md, BOOTSTRAP.md identity files
- Per-agent model assignment
- Per-agent tool profiles (allow/deny lists)
- Per-agent sandbox mode

**Krythor capability:**
- `AgentRegistry` + `AgentOrchestrator` + `AgentRunner`
- Per-agent systemPrompt, memoryScope (session/workspace/global), maxTurns, temperature, tags
- Per-agent model preference (stored in RoutingContext)
- `HeartbeatEngine` for background monitoring
- SOUL.md for identity (`KrythorCore` / `SystemIdentityProvider`)
- Learning recorder captures per-run signals for recommendation engine
- No sub-agent spawning
- No session idle timeout
- No per-agent tool profiles / sandbox
- No USER.md / BOOTSTRAP.md templates

**Status:** PARTIAL
**Why it matters:** Krythor's agent system is solid for single-agent use. Multi-agent orchestration and per-agent tool isolation are gaps for power users.
**Implement:** later (Phase 2/3 — sub-agents; Phase 1 — config templates)

---

## 9. Tools / Skills / Plugins

**Reference capability:**
- Built-in tools: exec/process, browser (Chromium CDP), web_search/web_fetch, read/write/edit, apply_patch, message, canvas, nodes, cron/gateway, image/image_generate, sessions/agents
- Skills: markdown files injected into system prompt; workspace/shared/plugin scoped
- Plugins: channels, model providers, custom tools, speech/image generation
- Tool access profiles: full, coding, messaging, minimal
- Tool allow/deny lists per agent
- Docker sandbox with workspace access modes

**Krythor capability:**
- `SkillRegistry` + `SkillRunner` with permission checking via GuardEngine
- Skills loaded from config dir; SOUL.md is the primary identity skill
- Skill events broadcast to WebSocket clients
- GuardEngine enforces `skill:permission:*` operations
- No built-in exec/browser/web_search tools
- No in-process file read/write tools
- No plugin architecture
- No Docker sandbox

**Status:** PARTIAL
**Why it matters:** Tools are the primary value-add for an agentic system. Without exec or web tools, Krythor is limited to LLM inference + memory. This is the largest functional gap.
**Implement:** later (Phase 2 — exec tool; Phase 3 — browser/web tools; plugins skip for now)

---

## 10. Memory System

**Reference capability:**
- SQLite per-agent memory store
- Semantic search via embeddings (OpenAI, Gemini, Voyage, Mistral, Ollama)
- Hybrid BM25+vector retrieval with optional MMR re-ranking
- Daily memory files (`memory/YYYY-MM-DD.md`) auto-created
- MEMORY.md curated long-term facts
- Temporal decay option for boosting recent memories

**Krythor capability:**
- `MemoryEngine` with shared SQLite (`memory.db`) for all agents
- `MemoryStore` (entries), `ConversationStore`, `AgentRunStore`, `GuardDecisionStore`, `LearningRecordStore`, `HeartbeatInsightStore`
- Embedding support via `OllamaEmbeddingProvider` (nomic-embed-text)
- Keyword + semantic search when Ollama is active
- Migration system with backup + rollback support
- `--rollback` flag for DB restoration
- No hybrid BM25+vector; just keyword fallback when no embedding
- No daily memory files managed by the system
- No temporal decay
- No per-agent DB isolation (shared DB with scoped queries)

**Status:** PRESENT-WEAKER
**Why it matters:** Krythor's memory architecture is solid. Shared DB vs per-agent DB is a deliberate trade-off (simpler ops). Missing hybrid search and daily file automation are gaps.
**Implement:** later (Phase 2 — hybrid search; Phase 1 — document memory config)

---

## 11. Sessions / Conversation Isolation

**Reference capability:**
- Session isolation per channel peer (prevents cross-user context leakage)
- Session idle timeout (configurable, default 60 min)
- In-channel session reset commands
- Session transcript storage with permission constraints

**Krythor capability:**
- `ConversationStore` for conversation history per conversation ID
- `AgentRunStore` for tracking run lifecycle
- Orphaned run recovery on startup (marks `running` rows as `failed`)
- No session idle timeout
- No in-chat `/new` command
- No per-session reasoning mode override
- Session list API exists via conversation routes

**Status:** PARTIAL
**Why it matters:** Session isolation is critical for multi-user scenarios. Single-user local tool can tolerate missing idle timeout, but the gap matters for the roadmap.
**Implement:** later (Phase 2)

---

## 12. Web Control UI

**Reference capability:**
- Vite-based dashboard at `http://<host>:<port>/`
- Real-time chat with streaming responses, tool call visualization, abort
- Channel status + QR login + per-channel config
- Session list with reasoning mode overrides
- Cron job lifecycle management
- Skills status, enable/disable, install, API key updates
- Node inventory with capability display
- JSON config editor with schema rendering + concurrent edit protection
- Live gateway log tailing
- Device pairing approval
- 6-language localization
- Package/git update with automated restart

**Krythor capability:**
- React control UI in `packages/control/` served by gateway at `/`
- Token injected into `index.html` at serve time
- Real-time WebSocket stream (`/ws/stream`)
- API routes for: agents, memory, models, guard, config, conversations, skills, recommendations
- Models tab with provider CRUD + OAuth CTA (via `setupHint`)
- No channel management (no channel integrations)
- No cron job UI
- No live log viewer in UI
- No schema-validated config editor
- No localization
- No update manager

**Status:** PARTIAL
**Why it matters:** The control UI is Krythor's primary differentiator. Missing: live logs, config schema editor, cron management.
**Implement:** later (Phase 2/3 — live logs; Phase 1 — document what's there)

---

## 13. Dashboard / Monitoring

**Reference capability:**
- Health snapshots and event logging
- Manual RPC call execution for troubleshooting
- Package/git updates with automated restart
- Execution approval workflow for elevated tool calls

**Krythor capability:**
- `/health` endpoint with full subsystem stats (memory, models, circuits, guard, agents, heartbeat, soul)
- `/ready` readiness check (db + guard; 503 if not ready)
- `/api/heartbeat/status` endpoint
- Circuit breaker stats per provider
- Learning record store for model performance tracking
- No execution approval workflow
- No update mechanism from UI
- No RPC call browser

**Status:** PRESENT-WEAKER
**Why it matters:** Health and monitoring are solid. The execution approval gap matters when tools with side-effects are added.
**Implement:** later (Phase 2 — execution approval when exec tool lands)

---

## 14. Web Chat / Chat Surfaces

**Reference capability:**
- Control UI web chat with streaming, tool visualization, abort
- Dedicated public-facing web chat surface
- TUI (terminal UI) for local chat

**Krythor capability:**
- WebSocket stream for real-time agent output
- `/api/command` POST endpoint for single-turn inference
- Control UI includes chat capability (via React frontend)
- No standalone WebChat surface
- No TUI

**Status:** PARTIAL
**Why it matters:** A TUI would improve the developer experience significantly. WebChat is lower priority.
**Implement:** later (Phase 3 — TUI; skip WebChat)

---

## 15. TUI / CLI Surfaces

**Reference capability:**
- Global CLI with onboard, doctor, gateway, status, dashboard, logs, config, models, pairing, cron, nodes, security audit subcommands
- TUI for interactive chat in terminal
- `--verbose`, `--non-interactive` flags

**Krythor capability:**
- `krythor` / `start.js` launcher: start, setup, doctor, repair subcommands
- `krythor-setup` binary for wizard + doctor + rollback
- No interactive TUI
- No `config set` / `config get` subcommands
- No `models` CLI (only via UI/API)
- No `status` subcommand (only UI/health endpoint)

**Status:** PRESENT-WEAKER
**Why it matters:** The CLI is the entry point for power users and CI. Missing subcommands reduce scriptability.
**Implement:** later (Phase 1 — `krythor status` CLI command)

---

## 16. Channels / Messaging Integrations

**Reference capability:**
- 22 channels: WhatsApp, Telegram, Discord, Slack, iMessage, Signal, Matrix, LINE, Google Chat, Teams, Mattermost, Nostr, IRC, Twitch, and more
- Channel routing: bind senders/groups to distinct agents
- Group allow/deny lists; mention gating
- Per-channel pairing/allowlist/open DM modes

**Krythor capability:**
- No channel integrations
- No messaging platform support
- Architecture not ready per product direction

**Status:** MISSING (intentional)
**Why it matters:** Channels are a differentiator for messaging-first products. Krythor's value prop is different (local AI platform, not messaging bridge). Adding channels would require a separate architecture decision.
**Implement:** skip (document as a deliberate product boundary)

---

## 17. Remote Gateway / Multi-Gateway

**Reference capability:**
- Remote CLI with `--url` flag for pointing at remote gateway
- SSH forwarding + Tailscale Serve for secure remote access
- Multiple instances with isolated port/config/state/workspace
- Tailscale integration (MagicDNS, Funnel, identity headers)

**Krythor capability:**
- Gateway binds to loopback only (127.0.0.1:47200) — intentionally local
- No remote CLI flag
- No Tailscale integration
- No multi-instance support documented
- CORS and Host header validation lock to loopback

**Status:** MISSING (partially intentional)
**Why it matters:** For local-first use, remote access is not needed. But power users wanting a home server setup have no path.
**Implement:** later (Phase 3 — document SSH forward approach; skip Tailscale)

---

## 18. Discovery / Node Pairing

**Reference capability:**
- Bonjour/mDNS LAN advertisement with metadata (hostname, ports, TLS fingerprints)
- Tailnet discovery via MagicDNS
- SSH fallback for any SSH-accessible host
- Node pairing: mobile nodes (iOS/Android) offer camera, screen, canvas tools
- Device pairing approval at gateway level with TLS fingerprint pinning

**Krythor capability:**
- No node discovery
- No device pairing
- No mobile companion
- No mDNS advertisement

**Status:** MISSING
**Why it matters:** Node pairing enables powerful multi-device workflows (mobile camera, screen capture). Out of scope for Krythor's current direction.
**Implement:** skip (document as future consideration)

---

## 19. Security / Permissions

**Reference capability:**
- DM access modes: pairing (default), allowlist, open, disabled
- Per-gateway trust boundary model
- Tool-level profiles: messaging, minimal, custom allow/deny per agent
- Docker sandbox with workspace access modes (none/read/read-write)
- Security audit command with `--deep` / `--fix` flags
- SSRF policy for browser tool
- Filesystem permission enforcement (700 dirs, 600 files)
- Credential rotation guidelines
- Redaction patterns for sensitive data in logs

**Krythor capability:**
- `GuardEngine` + `PolicyEngine` — rule-based allow/deny with default action
- `GuardDecisionStore` — every decision audited to SQLite
- Bearer token auth for all API routes (except /health, /ready)
- Host header validation (DNS rebinding prevention)
- CORS restricted to loopback
- CSP headers with `frame-ancestors 'none'`
- Rate limiting (300 req/min)
- `redact.ts` for error message sanitization
- `warnIfNetworkExposed` for non-loopback bind detection
- File permissions on config: not explicitly enforced
- No DM access control (no channels)
- No Docker sandbox
- No security audit command
- No `--deep` / `--fix` equivalents

**Status:** PRESENT-WEAKER (relative to scope)
**Why it matters:** For a local-only tool, Krythor's security is appropriate. When tools with side-effects land, the guard engine will need expansion.
**Implement:** now (Phase 0 — security audit as part of doctor command)

---

## 20. Config Schema / Templates

**Reference capability:**
- Single JSON5 config file with full coverage
- AGENTS.md, SOUL.md, USER.md, TOOLS.md, MEMORY.md, HEARTBEAT.md templates
- BOOTSTRAP.md for first-run initialization
- Workspace as git repository (recommended practice)
- Safe partial update commands
- `${VAR_NAME}` env var substitution in config strings
- SecretRef objects for sensitive fields

**Krythor capability:**
- Config split across multiple JSON files: `providers.json`, `agents.json`, `app-config.json`, `policy.json`
- No TOOLS.md, USER.md, BOOTSTRAP.md templates
- No env var substitution in config values
- No SecretRef pattern (API keys stored in plaintext in providers.json)
- Atomic writes via `atomicWrite.ts` in core and models packages
- Schema validation exists for providers (validateProviderConfig)
- No formal JSON schema / documentation of config fields

**Status:** PARTIAL
**Why it matters:** Users need to know what config files exist, what fields they can set, and how to safely edit them. This is a documentation gap more than a code gap.
**Implement:** now (Phase 0 — config reference doc; Phase 1 — env var support in providers)

---

## 21. Troubleshooting / Doctor / Repair

**Reference capability:**
- `krythor doctor` — auto-repair config and state
- `krythor status` / `krythor status --all` — quick 60-second diagnostic
- `krythor gateway probe` — gateway-specific probe
- `krythor channels status --probe` — per-channel health check
- `krythor logs --follow` — live log tailing
- `krythor security audit --deep --fix` — security audit with auto-fix

**Krythor capability:**
- `krythor doctor` — system probe + config + DB + gateway + embedding checks
- `krythor repair` — checks bundled Node + sqlite3 + gateway health
- No `logs --follow` equivalent (restart required to see logs)
- Doctor checks: node version, port, ollama, config files, DB, gateway health, embedding status
- Doctor does not check: provider auth validity, agent config validity, guard policy correctness
- No auto-fix in doctor (it's read-only; tells user what to run)
- No `--verbose` flag on doctor

**Status:** PARTIAL
**Why it matters:** Doctor is a critical user rescue path. Missing provider auth check is a key gap — users with expired OAuth tokens or wrong API keys get no diagnostic.
**Implement:** now (Phase 0 — add provider auth check to doctor)

---

## 22. Help / Docs / Examples

**Reference capability:**
- Full docs site with 50+ pages
- Getting started guide with 5-step flow
- Reference pages for defaults, wizard, memory-config, token-use
- Templates for AGENTS.md, TOOLS.md
- FAQ covering common issues
- Troubleshooting guide with repair workflow table
- Environment variables reference
- Testing guide (unit/e2e/live)
- Scripts reference

**Krythor capability:**
- README.md with feature list, install, trust/safety, requirements
- SOUL.md, HEARTBEAT.md in repo root
- `docs/hardening/` with phase-by-phase hardening notes
- ARCHITECTURE.md, BUILD_STATUS.md, CHANGELOG.md, SECURITY.md
- No dedicated getting-started guide
- No config field reference
- No environment variables reference
- No troubleshooting guide (separate from doctor)
- No template files for users (no TOOLS.md example, no AGENTS.md example)

**Status:** PARTIAL
**Why it matters:** Documentation is the single highest-leverage item for user success after the wizard. Missing references cause support burden.
**Implement:** now (Phase 0 — config reference, env vars reference; Phase 1 — getting-started guide)

---

## 23. Testing / Diagnostics / Resilience

**Reference capability:**
- Three test tiers: unit/integration, e2e (gateway smoke), live (real providers)
- Live provider/model validation with credential discovery
- Plugin/channel interface verification
- Multi-model matrix coverage
- Intentionally-unstable live tier (catches format changes, auth issues, rate limits)

**Krythor capability:**
- Vitest across all packages
- Unit + integration tests: gateway, setup, models, core, skills, guard, memory
- Health endpoint tests, readiness tests, heartbeat tests
- Integration test (`integration.test.ts`) and phase tests (`phase4.test.ts`, `v0.2.test.ts`)
- No e2e gateway smoke test (no real port binding in tests)
- No live provider tests
- No contract tests
- Circuit breaker tests in `ModelEngine.availability.test.ts`

**Status:** PRESENT-WEAKER
**Why it matters:** No live tests means provider API changes go undetected until users report failures. The circuit breaker tests are a strength.
**Implement:** later (Phase 1 — add basic gateway e2e; Phase 3 — live tests)

---

## 24. Release / Packaging / Updater

**Reference capability:**
- npm global publish
- Docker image
- Nix, Ansible alternatives
- Auto-update from UI
- Tag-based GitHub releases

**Krythor capability:**
- GitHub Actions `release.yml` with platform-specific zip artifacts
- `build-release.js`, `build-exe.js`, `build-installer.js` scripts
- `tag-release` helper script
- `sea-launcher.js` for Node SEA distribution
- One-line installers (`install.sh`, `install.ps1`)
- No npm global publish
- No auto-update mechanism
- No Docker image

**Status:** PRESENT-WEAKER
**Why it matters:** Self-contained zip with bundled Node is a strong end-user distribution. npm publish is needed for developer adoption.
**Implement:** later (Phase 2 — npm publish; Phase 3 — Docker)

---

## 25. Data Migration / Backward Compatibility

**Reference capability:**
- Migration on startup with doctor for state repair
- `$STATE_DIR` portability — copy to new machine + doctor = full restore
- Workspace git repo as backup strategy
- Config kept/modify/reset flow in wizard (no silent overwrites)

**Krythor capability:**
- `MigrationRunner` with numbered migrations and pre-migration `.bak` snapshots
- `--rollback` flag in `krythor-setup` for DB restoration
- `Installer.findLatestBackup` + `restoreBackup` methods tested
- Wizard detects existing config and offers keep/overwrite choice (good)
- No `KRYTHOR_STATE_DIR` env var override for portability
- No documented backup strategy for users

**Status:** PRESENT-WEAKER
**Why it matters:** Migration safety is solid (bak snapshots + rollback). Portability story (state dir override, backup docs) is missing.
**Implement:** now (Phase 0 — add KRYTHOR_DATA_DIR env var support; document backup strategy)

---

## Summary Table

| # | Category | Status | Implement |
|---|---|---|---|
| 1 | Install / onboarding | PARTIAL | **now** |
| 2 | Runtime / bundled distribution | PRESENT-WEAKER | later |
| 3 | Gateway core | PARTIAL | now (daemon docs) |
| 4 | Provider system | PARTIAL | later |
| 5 | OAuth + API key support | PRESENT-WEAKER | **now** |
| 6 | Model registry and routing | PRESENT-STRONGER | later |
| 7 | Local model support | PRESENT-WEAKER | later |
| 8 | Agent system | PARTIAL | later |
| 9 | Tools / skills / plugins | PARTIAL | later |
| 10 | Memory system | PRESENT-WEAKER | later |
| 11 | Sessions / conversation isolation | PARTIAL | later |
| 12 | Web control UI | PARTIAL | later |
| 13 | Dashboard / monitoring | PRESENT-WEAKER | later |
| 14 | Web chat / chat surfaces | PARTIAL | later |
| 15 | TUI / CLI surfaces | PRESENT-WEAKER | later |
| 16 | Channels / messaging | MISSING (intentional) | **skip** |
| 17 | Remote gateway / multi-gateway | MISSING (partial intent) | later |
| 18 | Discovery / node pairing | MISSING | **skip** |
| 19 | Security / permissions | PRESENT-WEAKER | **now** |
| 20 | Config schema / templates | PARTIAL | **now** |
| 21 | Troubleshooting / doctor / repair | PARTIAL | **now** |
| 22 | Help / docs / examples | PARTIAL | **now** |
| 23 | Testing / diagnostics | PRESENT-WEAKER | later |
| 24 | Release / packaging / updater | PRESENT-WEAKER | later |
| 25 | Data migration / compatibility | PRESENT-WEAKER | **now** |

**Phase 0 targets (now):** 1, 5, 19, 20, 21, 22, 25
**Phase 1 targets (soon):** 3, 4, 7, 15, 23
**Phase 2+ targets (later):** 2, 6, 8, 9, 10, 11, 12, 13, 14, 17, 24
**Intentional skip:** 16, 18
