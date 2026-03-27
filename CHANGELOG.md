# Changelog

All notable changes to Krythor are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

#### Automation: inbound webhooks + cron scheduler (2026-03-27)

- **Inbound webhook routes** (`POST /api/hooks/wake`, `POST /api/hooks/agent`): external systems can now trigger Krythor agent runs over HTTP. `/wake` logs a notification and returns an accepted confirmation; `/agent` runs an agent synchronously and returns the result. Both require a `webhookToken` configured via `PATCH /api/config`
- **`webhookToken` in app-config**: new `webhookToken` field in `app-config.json` and `PATCH /api/config`. The token is accepted as `Authorization: Bearer <token>` or `X-Krythor-Hook-Token: <token>`. The token is **never returned** in `GET /api/config` or `PATCH /api/config` responses (stripped before reply)
- **Per-IP auth failure tracking**: webhook endpoints count auth failures per remote IP address. After 10 failures within 60 seconds the IP is temporarily banned (HTTP 429), preventing credential brute-forcing. Ban windows expire automatically
- **Webhook rate limiting**: 60 requests/minute per IP on all `/api/hooks/*` routes
- **`CronStore`** (`packages/gateway/src/CronStore.ts`): new persistent store for user-defined scheduled jobs. Supports three schedule kinds — `at` (one-shot ISO 8601 timestamp), `every` (fixed interval in ms), and `cron` (5-field cron expression). Jobs are stored at `<dataDir>/config/cron-jobs.json` via atomic write
- **`CronScheduler`** (`packages/gateway/src/CronScheduler.ts`): polls `CronStore` every 30 s (with a 15 s startup delay to avoid firing on boot) and fires due jobs via `orchestrator.runAgent()`. At most one tick runs at a time (concurrency guard). Disabled in test environments (`KRYTHOR_TEST=1`). Bound to the gateway lifecycle (`onClose` stops the scheduler)
- **Cron REST API** (`GET/POST/PATCH/DELETE /api/cron`, `POST /api/cron/:id/run`): full CRUD for scheduled jobs plus a manual-trigger endpoint. `POST /api/cron` validates `at` timestamps are in the future and that `cron` expressions have exactly 5 fields. Manual triggers are fire-and-forget
- **One-shot job lifecycle**: `at`-scheduled jobs with `deleteAfterRun: true` (the default) are deleted from the store after their first successful run. Jobs with `deleteAfterRun: false` are disabled (not deleted) so they remain visible in the list
- **Minimal cron expression parser** (`nextCronFire`): implements standard 5-field cron semantics with no external dependencies. Supports `*`, `/` (step), `,` (list), and `-` (range) in all fields. DOM/DOW semantics: if only DOM is restricted → must match DOM; if only DOW is restricted → must match DOW; if both are restricted → either matching suffices (OR semantics, per POSIX cron)
- **`sessionPruneAfterDays` + `sessionMaxConversations` in `PATCH /api/config`**: two previously-missing config fields are now accepted by the update schema and persisted correctly
- **`CronStore` unit tests** (15 tests): covers `nextCronFire` (invalid expr, every-minute, 7am daily, next-day advancement, Monday-only), `computeNextRun` (all three schedule kinds), and `CronStore` CRUD, due-job detection, success/failure recording with auto-delete, and disk persistence

#### Skill system improvements (2026-03-27)

- **`enabled` flag per skill**: skills can now be disabled without deletion. `enabled: false` prevents execution (returns HTTP 409) and excludes the skill from `GET /api/skills` by default. Set via `POST /api/skills`, `PATCH /api/skills/:id`. Backfilled to `true` for all existing skills on load
- **`userInvocable` flag per skill**: new boolean field indicating whether the skill should be surfaced as a user-facing slash command. Defaults to `true`. Stored and returned in full skill objects; consumers (UI/channels) can use this to filter the command palette
- **`GET /api/skills?includeDisabled=true`**: disabled skills are excluded from list responses by default; pass `?includeDisabled=true` to include them for management UIs
- **`GET /api/skills/status`**: new lightweight endpoint returning `{ activeRuns }` — the count of currently-executing skill runs. Useful for monitoring dashboards and rate-limit decisions
- **Disabled-skill guard in `SkillRunner`**: attempting to run a disabled skill throws immediately (before model invocation or concurrency checks), ensuring no model tokens are consumed for disabled skills

#### Plugin system improvements (2026-03-27)

- **Plugin load status tracking**: `PluginLoader` now records a `PluginLoadRecord` (`{ file, status, name?, description?, reason? }`) for every file scanned — including failures and skipped entries. `listRecords()` returns the full record set from the last `load()` pass
- **`GET /api/plugins` now returns full record list**: response includes `status: 'loaded' | 'error' | 'skipped'` and a `reason` string for non-loaded entries, enabling the UI to surface plugin load failures without restarting the gateway
- **`POST /api/plugins/reload`**: new endpoint that hot-reloads all plugins from disk and returns the updated record list — no gateway restart required. Plugin cache is cleared before reload so changed files are picked up
- **`PluginLoadRecord` exported from `@krythor/core`**: available for typed use in custom gateway extensions and tests

#### Message delivery improvements (2026-03-27)

- **Message deduplication** in TelegramInbound and DiscordInbound: short-lived in-memory caches (`seenUpdateIds` / `seenMessageIds`, bounded at 500 entries, FIFO eviction) prevent the same message from triggering a second agent run on reconnect or poll overlap
- **Retry with exponential backoff + jitter** on `sendMessage` for both channels: Telegram retries on 429 and transient network errors (up to 3 attempts, 400ms–30s, 10% jitter), respecting `retry_after` from API responses; Discord retries on 429 with `retry_after` or backoff fallback
- **Code-fence-aware chunking** (`splitIntoChunks`): long replies containing ` ``` ` code blocks are now never split inside a fence — if a split is forced at the chunk boundary, the current chunk is closed with ` ``` ` and the next chunk reopens it, keeping Markdown valid across both Telegram and Discord

#### Multi-agent control improvements (2026-03-27)

- **`deniedTools` per agent**: new `AgentDefinition` field that explicitly blocks named tools regardless of `allowedTools`. Evaluated before `allowedTools` — a tool in both lists is always denied. Set via `POST /api/agents`, `PATCH /api/agents/:id`, and import. Enforced in `AgentRunner.handleToolCall()` with a clear policy denial message
- **`allowedAgentTargets` per agent**: new field restricting which agent IDs this agent may delegate to via `handoff` or `spawn_agent`. `undefined` = unrestricted (default, fully backward compatible); `[]` = delegation disabled; `["id1","id2"]` = allowlist. Enforced in `AgentRunner` for both spawn_agent tool calls and the handoff loop
- **`workspaceDir` and `skipBootstrap` in CRUD API**: both fields are now accepted by `POST /api/agents`, `PATCH /api/agents/:id`, and `POST /api/agents/import`. Previously these fields existed on `AgentDefinition` but could not be set or changed via the API

#### Session management improvements (2026-03-27)

- **Configurable session retention**: `sessionPruneAfterDays` and `sessionMaxConversations` added to `app-config.json`. When set, they override the default 90-day conversation retention and enforce a hard conversation count cap (oldest-first, pinned conversations pruned last). Both fields are configurable via `PATCH /api/config` and applied live without restart via `memory.setJanitorConfig()`
- **Session maintenance API**: new `GET /api/sessions/maintenance` (dry-run estimate — returns `wouldPruneByAge`, `wouldPruneByCount`, `currentCount`) and `POST /api/sessions/maintenance/run` (trigger full janitor cleanup immediately). Both routes respect guard policy (`conversation:read` / `conversation:write`)
- **Agent session tools**: agents can now inspect conversation history via two new tool calls — `sessions_list` (lists conversations with idle status, supports `limit`, `agentId`, `includeArchived`) and `sessions_history` (returns user/assistant messages for a given conversation, supports `limit`). Dispatched via `customToolDispatcher` in the gateway
- **`DbJanitor` runtime config**: new `DbJanitorConfig` interface and `setConfig()` method on `DbJanitor` allow retention settings to be updated at runtime without restarting. `MemoryEngine` exposes `setJanitorConfig()` and `dryRunMaintenance()` as its public API

#### Agent runtime improvements (2026-03-27)

- **Bootstrap truncation warning**: when any workspace bootstrap file (AGENTS.md, SOUL.md, TOOLS.md, etc.) is truncated to fit the context window, a warning block is appended to Project Context telling the agent which files were truncated and to use `read_file` for full content. Controlled by `bootstrapTruncationWarning` in `app-config.json` (`'off'` | `'once'` | `'always'`; default `'once'`). Configurable at runtime via `PATCH /api/config`
- **User timezone in system prompt**: the Date/Time section of the agent system prompt can now show local time when `userTimezone` is set (IANA timezone string, e.g. `America/New_York`). `timeFormat` controls `'auto'` | `'12'` | `'24'` hour display. Configurable via `PATCH /api/config` and applied live without restart
- **`NO_REPLY` silent token**: when a model response consists solely of the string `NO_REPLY`, the output is suppressed from the final run result and the `run:completed` event payload — the run still completes successfully but with no outbound payload. Useful for agents that handle events silently. The constant is exported from `@krythor/core`
- **`AgentOrchestrator.setUserTimezone()`**: new setter that updates timezone/time-format at runtime and rebuilds the runner
- **`AgentOrchestrator.setBootstrapTruncationWarning()`**: new setter that updates truncation warning mode at runtime and rebuilds the runner

#### Chat channel configuration API improvements (2026-03-27)

- **`groupAllowFrom` config field**: new channel-wide group sender allowlist. Used when `groupPolicy: 'allowlist'` and a group does not have its own per-group `allowFrom`. Simplifies configuration when the same sender set applies to all groups. Available in `ChatChannelConfig`, `TelegramInboundConfig`, and `DiscordInboundConfig`
- **`sanitiseConfig` now includes access policy fields**: `GET /api/chat-channels` and `GET /api/chat-channels/:id` now return `dmPolicy`, `groupPolicy`, `allowFrom`, `groupAllowFrom`, `groups`, `resetTriggers`, `historyLimit`, `textChunkLimit`, `chunkMode`, and `ackReaction`. Previously these were stored in config but invisible to API clients
- **`PUT /api/chat-channels/:id` accepts access policy fields**: `dmPolicy`, `groupPolicy`, `allowFrom`, `groupAllowFrom`, `resetTriggers`, `historyLimit`, `textChunkLimit`, `chunkMode`, and `ackReaction` can now all be updated via the REST API with schema validation. Previously `additionalProperties: false` blocked these fields entirely
- **Groups API includes `allowFrom`**: `GET /api/chat-channels/:id/groups` now returns `allowFrom` per group; `POST /api/chat-channels/:id/groups` accepts `allowFrom` and merges it into the stored group config. Existing group entries without `allowFrom` are preserved
- **`groupAllowFrom` wired end-to-end**: flows from `ChatChannelRegistry` → `InboundChannelManager` → `TelegramInbound` / `DiscordInbound`. For Telegram, per-group `allowFrom` takes priority; `groupAllowFrom` is the fallback. For Discord, `groupAllowFrom` takes priority over `allowFrom` when enforcing guild `allowlist` policy

#### Chat channel improvements (2026-03-27)

- **`historyLimit` config field**: `ChatChannelConfig`, `TelegramInboundConfig`, and `DiscordInboundConfig` now accept `historyLimit` (default 50). Context messages injected per turn are capped at the last N messages, preventing unbounded growth that would eventually exceed model context windows
- **`textChunkLimit` + `chunkMode` config fields**: replies longer than the channel limit are now split into multiple messages instead of being silently truncated at `MAX_REPLY_LEN`. `chunkMode: 'newline'` prefers paragraph boundaries (blank lines) before hard splitting; `'length'` (default) hard-splits at the limit
- **`ackReaction` config field for Telegram**: an acknowledgment emoji reaction (default `👀`) is sent on the triggering message as soon as it is accepted for processing, giving the user immediate visual feedback. Set to `""` to disable. Uses the Telegram Bot API `setMessageReaction` endpoint
- **Discord `groupPolicy` enforcement**: guild channel messages now respect `groupPolicy` (`'open'` default / `'allowlist'` / `'disabled'`) just like DMs respect `dmPolicy`. Previously, guild channels were always open regardless of config
- **Telegram per-group sender `allowFrom`**: groups configured with a `groups.<id>.allowFrom` array now filter senders within that group. Previously the per-group allowlist field was stored but never checked at message time
- **All new fields wired through `InboundChannelManager`**: `historyLimit`, `textChunkLimit`, `chunkMode`, `ackReaction`, and `groupPolicy` are now passed from `ChatChannelRegistry` through `InboundChannelManager` to each channel instance

#### Maintenance & update improvements (2026-03-27)

- **`krythor update status`**: new sub-command that shows `installKind` (git/binary), `currentVersion`, `latestVersion`, and `updateAvailable` without performing an update; supports `--json` for scripted use
- **`krythor update --dry-run`**: previews the planned update (download URL, current → new version) without applying it; supports `--json`; useful in CI pipelines before scheduling a maintenance window
- **Post-update hints**: after a successful binary update, Krythor now prints a reminder to run `krythor doctor` and `krythor restart`
- **TLS-hardened binary self-update**: the inline update curl commands now use `--proto '=https' --tlsv1.2` to prevent protocol downgrade attacks during the update download
- **`krythor uninstall --yes` / `--non-interactive`**: skip the confirmation prompt for unattended / scripted uninstalls
- **`krythor uninstall --all`**: also delete the data directory (settings, memory, agent state); shows an explicit warning before proceeding; requires `--yes` or interactive confirmation
- **`krythor doctor --non-interactive`**: passes through to the underlying setup.js doctor call so automated post-update checks never block on a prompt
- **COMMAND_HELP: update & uninstall**: both entries now document all flags and sub-commands shown by `krythor help update` / `krythor help uninstall`
- **README: Migrating to a New Machine**: new troubleshooting section with 5-step guide (backup → fresh install with `--no-onboard` → restore archive → `krythor repair --fix` → start)

#### Install, Docker & Health hardening (2026-03-27)

- **`/healthz` and `/liveness` endpoints**: lightweight liveness probes (always 200 while the process is alive, no auth required); intended for Docker `HEALTHCHECK`, k8s liveness probes, and load balancers that need a fast signal without the full `/health` payload
- **`/readyz` alias**: mirrors `/ready` for k8s readiness convention
- **Dockerfile: Node 22-alpine**: base image updated from `node:20-alpine` to `node:22-alpine` (LTS); aligns with the `engines: ">=20"` field while using a more current runtime
- **Dockerfile: built-in `HEALTHCHECK`**: Docker image now includes a `HEALTHCHECK` directive that pings `/healthz` every 30 s; Docker marks the container unhealthy if 3 consecutive probes fail, enabling orchestration-layer restart
- **install.sh: `--no-onboard` / `--no-setup` flags**: skip the first-time setup wizard without needing the env var; equivalent to `KRYTHOR_NON_INTERACTIVE=1` but more discoverable for CI pipelines
- **install.sh: `--no-prompt` flag**: skips all interactive prompts (implies `--no-onboard`)
- **install.ps1: `-NoOnboard` / `-NoPrompt` parameters**: same flags for the Windows PowerShell installer; `param()` block added so they work whether the script is sourced or invoked directly
- **install.sh: TLS-pinned curl in launcher update**: the embedded `krythor update` command in the generated launcher now uses `--proto '=https' --tlsv1.2` to prevent protocol downgrade attacks
- **`krythor doctor --non-interactive`**: the flag now passes through to the setup.js doctor sub-command; useful for post-upgrade automated checks that should never block on a prompt

#### Setup & CLI improvements (2026-03-27)

- **QuickStart vs Advanced setup mode**: wizard opens with a mode selector — QuickStart configures a provider and starts immediately with secure defaults; Advanced gives full control over gateway port/bind/auth, chat channels, and web search
- **Section-specific reconfiguration**: `krythor setup --section <name>` (or `krythor configure --section <name>`) reconfigures only one section — `provider`, `gateway`, `channels`, or `web-search` — without re-running the full wizard
- **`--reset` flag on setup**: forces reconfiguration without the interactive "overwrite existing config?" prompt; useful for scripted re-provisioning
- **`krythor agents add [name]`**: creates a new agent from the terminal; prompts for name, description, system prompt, and model; uses the gateway API if the gateway is running (live update without restart), or writes directly to agents.json when offline
- **`krythor agents list`**: lists all configured agents with their IDs and assigned models; uses gateway API if running, else reads agents.json directly
- **`ensureGatewayDefaults` in Installer**: QuickStart mode writes a secure default gateway.json (127.0.0.1:47200, token auth, auto-generated token) if one does not already exist
- **Tool security note in setup**: when a cloud provider is configured, setup surfaces a reminder to use capable models for agents that will run tools, reducing prompt injection risk
- **`getAuthHeader()` helper in start.js**: reads the gateway auth token from app-config.json or gateway.json for CLI commands that call gateway APIs (agents add/list)

#### Chat Channels & File Access (2026-03-26)

- **Chat channel onboarding — Telegram**: built-in Telegram bot integration; enter Bot Token (from @BotFather) in Settings → Chat Channels → + Add Channel; polling-based message delivery; no pairing step required
- **Chat channel onboarding — Discord**: built-in Discord bot integration; requires Bot Token + Application ID from the Discord Developer Portal; Message Content Intent must be enabled; no pairing step required
- **Chat channel onboarding — WhatsApp**: on-demand npm package install for the WhatsApp library; pairing code flow — Krythor displays a code that the user enters in WhatsApp → Settings → Linked Devices; session credentials persist after first pair
- **Chat channel setup wizard**: step-by-step guided setup UI in the Chat Channels panel; platform-specific instruction panels; credential validation before saving
- **Chat Channels panel**: new tab in the control UI listing all configured inbound channels with their current status badge and connect/disconnect controls
- **Chat channel status model**: six statuses tracked per channel — `not_installed`, `installed`, `credentials_missing`, `awaiting_pairing`, `connected`, `error`
- **Credential masking**: all `/api/chat-channels/` responses replace secret fields with `"••••••••"` — credentials never leak through the API
- **Chat channels REST API** (9 endpoints): `GET /api/chat-channels/`, `POST /api/chat-channels/`, `GET /api/chat-channels/:id`, `PUT /api/chat-channels/:id`, `DELETE /api/chat-channels/:id`, `POST /api/chat-channels/:id/connect`, `POST /api/chat-channels/:id/disconnect`, `GET /api/chat-channels/:id/status`, `POST /api/chat-channels/:id/pairing-code`
- **File operation tools** (9 tools): `read_file`, `write_file`, `edit_file`, `move_file`, `copy_file`, `delete_file`, `make_directory`, `list_directory`, `stat_path`; exposed via REST at `POST /api/tools/files/:tool`
- **Agent access profiles**: three profiles per agent — `safe` (workspace only, no shell), `standard` (workspace + non-system paths, shell with confirmation hooks), `full_access` (unrestricted filesystem + shell); default is `safe` for all new agents
- **Access profile enforcement**: path resolution and workspace boundary check for `safe`; system directory blocklist for `standard`; all checks happen in the tool layer before any filesystem call
- **Access profile API**: `GET /api/agents/:id/access-profile` and `PUT /api/agents/:id/access-profile`
- **Access profile badge in the Agents panel**: colored badge on each agent card showing its current profile; `full_access` displayed in red with a warning indicator; click badge to change profile
- **File operation audit log**: every file tool call (allowed or denied) appended as newline-delimited JSON to `~/.krythor/file-audit.log`; queryable via `GET /api/tools/files/audit` with `limit`, `page`, `agentId`, `outcome`, and `since` filters
- **docs/channels.md**: full chat channel setup guide covering Telegram, Discord, and WhatsApp (pairing code flow), status reference, API reference, and credential security notes
- **docs/permissions.md**: full access profile reference covering safe/standard/full_access behavior, path enforcement, system directory blocklist, audit log format, API reference, and security recommendations
- **Tests**: 108 new test cases across 4 test files covering chat channel lifecycle, credential masking, pairing code flow, file tool path enforcement, access profile API, and audit log query

#### Items A–J (2026-03-21)

- **Documentation consolidation (A)**: `docs/START_HERE.md` (quick-start, feature table, CLI/API reference, troubleshooting); `docs/TROUBLESHOOTING.md` (10 common issues with step-by-step fixes); `docs/ENV_VARS.md` (all environment variables with types and defaults); README.md updated with documentation links section
- **Sub-agent spawning (B)**: `spawn_agent` tool in `AgentRunner`; agents can emit `{"tool":"spawn_agent","agentId":"...","message":"..."}` to invoke any registered agent as a sub-agent; capped at 2 spawns per run; `SpawnAgentResolver` callback wired from `AgentOrchestrator` to avoid circular imports; 4 tests
- **Plugin/tool architecture (C)**: `PluginLoader` class scans `<dataDir>/plugins/*.js`, validates `{name, description, run}` shape, registers into `TOOL_REGISTRY`; `GET /api/plugins` returns `[{name, description, file}]`; hot-reload via `require.cache` clearing; 6 core tests + 3 gateway tests
- **TUI interactive chat improvements (D)**: `/agent <name>`, `/clear`, `/models` commands in the TUI; message history display (last 5 messages with role labels); `selectionReason` shown below AI responses; active agent indicator; "Thinking…" during inference
- **Remote gateway documentation (E)**: `docs/REMOTE_GATEWAY.md` — SSH tunnel, Tailscale mesh, Nginx TLS proxy; security guidance, multi-gateway setup, troubleshooting table
- **Memory temporal decay (F)**: `temporalDecayMultiplier()` with 90-day half-life (exponential, 2^(-age/halfLife)); applied to BM25 scores when >5 results exist; pinned entries exempt; `KRYTHOR_MEMORY_NO_DECAY=1` disables; 7 unit tests
- **Per-agent DB memory scope enforcement (G)**: agents with `memoryScope='agent'` now query ONLY their own memories (`scope_id=agent.id`); user/global scope is excluded to enforce isolation; workspace/session scopes continue to include user-global context; 4 tests
- **Model routing aliases (H)**: `ModelEngine.resolveModelAlias(alias)` maps `claude`, `gpt4`, `local`, `fast`, `best` to real provider/model pairs; case-insensitive; unknown aliases pass through unchanged; gateway `/api/command` resolves aliases before routing; 10 tests
- **Conversation management improvements (I)**: `GET /api/conversations/:id/messages` now returns paginated `{messages, total, page, limit, hasMore}` envelope (`?page=&limit=`, capped at 500); `POST /api/command` intercepts `/clear`, `/model`, `/agent` in-chat slash commands and returns synthetic JSON responses without inference; 12 integration tests

#### Batch 5 — Deferred items (2026-03-21)

- **Docker support**: `Dockerfile` (node:20-alpine, non-root user, `VOLUME /data`), `docker-compose.yml` (single service, named volume, restart policy), `.dockerignore`; CI release workflow now runs a docker build-only verification job before publishing
- **npm global publish foundation**: `bin: { "krythor": "./start.js" }` and `files` array added to root `package.json`; `.npmignore` added; README notes upcoming `npm install -g krythor` support
- **Live provider test infrastructure**: `providers.live.test.ts` with `it.skipIf(!ENV_VAR)` guards for Anthropic, OpenAI, Ollama — skips cleanly in CI, runs when keys are set; `docs/help/testing.md` documents all three test tiers
- **Model routing transparency in UI**: `selectionReason` and `fallbackOccurred` now surface in command API responses (both streaming and non-streaming); Command panel shows selection reason as dimmed italic text below each assistant reply; "copy model info" button copies `{ model, selectionReason, fallbackOccurred }` to clipboard
- **Memory search pagination**: `GET /api/memory/search` now returns `{ results, total, page, limit }` envelope; `?page=` and `?limit=` (max 200) query params supported
- **Provider health history**: `HeartbeatEngine` accumulates per-provider health entries (cap 100) from circuit breaker state; `GET /api/heartbeat/history` (auth required) returns full history map; `ProviderHealthEntry { timestamp, ok, latencyMs }` interface
- **Settings UI tab**: new Settings tab in the control panel — sections for Gateway info (port, dataDir, configDir), Auth status, Appearance (dark/light theme toggle with localStorage persistence), About (version, platform, arch, Node.js, gatewayId, uptime, capabilities), Provider Health History (colored dot sparkline for last 10 checks)
- **DEPLOYMENT.md**: systemd and launchd configs, Docker quickstart, env vars reference, backup strategy, update flow, production checklist
- **API.md**: full API reference for every endpoint with method, auth, and request/response shapes

#### Batch 4 — Items 3, 4, 6, 7 (2026-03-21)

- **Token spend history** (`GET /api/stats/history`): `TokenTracker` extended with a ring buffer of last 1000 inferences; each entry has `{ timestamp, provider, model, inputTokens, outputTokens }`; endpoint returns `{ history, windowSize: 1000 }`; auth required
- **Dashboard sparkline**: Dashboard tab now shows last 20 token datapoints as a unicode sparkline (`▁▂▃▄▅▆▇█` scaled to max value), labelled "Token usage (last 20 requests)"
- **Remote gateway foundation** (`GET /api/gateway/info`): returns `{ version, platform, arch, nodeVersion, gatewayId, startTime, capabilities }`; `gatewayId` is a stable UUID persisted to `<configDir>/gateway-id.json`; `capabilities: ['exec','web_search','web_fetch','memory','agents','skills','tools']`; auth required
- **Gateway peers placeholder** (`GET /api/gateway/peers`): returns `{ peers: [] }` — foundation for future multi-gateway mesh; auth required
- **OAuth Pending badge**: providers with `setupHint='oauth_available'` now show an amber "OAuth Pending" badge inline in the Models tab provider list
- **Provider Connect button**: each OAuth-pending provider shows a "Connect ↗" button that opens the correct provider dashboard URL in a new browser tab (Anthropic → `console.anthropic.com/settings/keys`; OpenAI → `platform.openai.com/api-keys`; others → provider endpoint)
- **Honest OAuth copy in setup wizard**: "Connect with OAuth later" option text updated to "Connect with OAuth later — opens provider dashboard to get your API key" to set accurate expectations
- **Web chat widget** (`GET /chat`): minimal self-contained HTML chat page served by the gateway; auth token injected at serve time as `window.__KRYTHOR_TOKEN__`; sends messages to `POST /api/command` via vanilla fetch; no React bundle required; also provides `packages/control/src/WebChat.tsx` React component

#### Batch 4 — Items 1, 2, 5 (previously completed)

- **Agent import/export**: `POST /api/agents/import` + `GET /api/agents/:id/export`; export includes all fields except internal timestamps; import deduplicates by name
- **Memory tagging**: `GET /api/memory/tags` returns all distinct tags; memory search accepts `?tags=` filter; `PATCH /api/memory/:id` accepts `tags` array
- **Input validation**: Fastify JSON Schema validation on all `POST`/`PATCH` bodies in agents, memory, guard, skills, tools routes; 400 `VALIDATION_FAILED` responses with field-level messages

#### Batch 3 (2026-03-21)

- **Models tab — Test + Enable/Disable buttons**: "Test" calls `POST /api/providers/:id/test` and shows latency inline; "Enable/Disable" toggle per provider
- **Memory tab improvements**: Export button, bulk Prune modal with olderThan/tag/source filters, detailed stats showing `sizeEstimateBytes`
- **Dashboard tab**: new tab (`GET /api/dashboard`) with 8 stat cards — uptime, providers, models, agents, memory entries, conversations, tokens used, active warnings; auto-refreshes every 30s
- **Skills tab — built-in skills + Run button**: built-in skills panel from `GET /api/skills/builtins`; Run button per user skill opens dialog with input textarea
- **Local model discovery**: `GET /api/local-models` probes Ollama/LM Studio/llama-server; "Discover local" button in Models tab with pre-fill shortcuts
- **TUI command input**: command input line on every TUI frame; typed chars accumulate; single-key shortcuts (`r`, `s`, `h`, Escape); Enter sends to `/api/command`
- **E2E integration test skeleton**: 5 tests on real port 47299

#### Batch 2 (2026-03-21)

- **Provider priority ordering** (`priority?: number`) and **per-provider retry config** (`maxRetries?: number`); `ModelRouter` sorts by priority descending; `POST /api/providers/:id` accepts both fields
- **Memory export/import**: `GET /api/memory/export`, `POST /api/memory/import` with SHA-256 dedup
- **Memory pruning controls**: `DELETE /api/memory` with `olderThan`/`tag`/`source` filters; `GET /api/memory/stats` enriched with `oldest`, `newest`, `sizeEstimateBytes`
- **Session naming and pinning**: migration 006 adds `name` and `pinned` columns; `PATCH /api/conversations/:id` accepts both; list ordered by `pinned DESC, updated_at DESC`
- **Agent chaining/handoff**: `{"handoff":"<agentId>","message":"..."}` directive in model responses; capped at 3 handoffs; `GET /api/agents/:id/run?message=<text>`
- **User-defined webhook tools**: `WebhookTool` + `CustomToolStore`; `GET/POST /api/tools/custom`, `DELETE /api/tools/custom/:name`
- **Tool permission scoping per agent**: `allowedTools?: string[]` on agent definition; `AgentRunner` enforces; `POST/PATCH /api/agents` schema extended
- **Dashboard endpoint**: `GET /api/dashboard` consolidating all key system metrics

#### Batch 1 (2026-03-21)

- **Daemon mode**: `krythor start --daemon` spawns gateway detached, writes PID; `krythor stop` kills and removes PID file; `krythor restart`
- **Data backup command**: `krythor backup [--output <dir>]` — zip/tar.gz of data directory
- **Uninstall command**: `krythor uninstall` with confirmation prompt; preserves data directory
- **`krythor help [<command>]`**: full command listing with single-line descriptions; detailed help per command
- **Config schema validation**: `validateProvidersConfig()` at gateway startup — structured error logging for invalid/skipped entries
- **Config export/import**: `GET /api/config/export` (secrets redacted), `POST /api/config/import` (merge with dedup)
- **`CORS_ORIGINS` env var**: comma-separated additional allowed origins for CORS
- **Doctor — migration integrity check**: checks `schema_migrations` table against SQL files; reports applied count
- **Doctor — stale agent model detection**: flags agents referencing model IDs not in any configured provider

#### Prior batches (web tools, TUI, auto-update)

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
