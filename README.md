# Krythor

**Krythor — Local AI Gateway**

A self-hosted AI gateway with multi-agent orchestration, persistent memory, guard policies, approval flows, channel integrations, and tool access (file and shell).

---

## What it is

Krythor is a local-first AI gateway that runs entirely on your machine. It routes requests across AI providers, persists memory across sessions, enforces policy rules, and coordinates multi-agent workflows — all with full visibility into what ran, why, and with which model.

---

## Packages

| Package | Description |
|---------|-------------|
| `@krythor/gateway` | Local HTTP and WebSocket service layer — the main runtime process |
| `@krythor/core` | Orchestration runtime — agent runner, tool dispatch, session management |
| `@krythor/memory` | Persistent local memory with BM25 + semantic hybrid retrieval |
| `@krythor/models` | Model provider registry with fallback, circuit breaker, and learning |
| `@krythor/guard` | Security policy enforcement — allow/deny/warn/require-approval per operation |
| `@krythor/skills` | Tool and skill execution framework |
| `@krythor/setup` | Installer and interactive onboarding wizard |
| `@krythor/control` | Command dashboard UI (served by the gateway) |

---

## Requirements

- Node.js 20+
- pnpm 9+

Install pnpm: `npm install -g pnpm`

---

## Quick start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start the gateway
pnpm start
# or
node start.js
```

Then open `http://localhost:47200` in your browser.

For development (watch mode with hot-reload):

```bash
pnpm dev
```

Run setup wizard:

```bash
pnpm setup
```

---

## Key features

### Multi-agent orchestration
Agents have configurable system prompts, memory scope, model preferences, tool permissions, and handoff rules. Agents can coordinate with each other via `agents_list` and `agent_ping` tools. Sub-agent spawning emits `run:spawn_announced` before execution.

### Memory engine
BM25 + semantic hybrid retrieval. Memory persists across sessions. Supports tagging, search mode selection, export/import, bulk pruning, and a background janitor for retention enforcement.

### Guard policy engine
Policy-based allow/deny/warn/require-approval control per operation type. Policies are loaded from YAML or JSON at startup. Guard checks fire before every tool call. An append-only audit log is written to `<dataDir>/logs/audit.ndjson`.

### Approval flow
`require-approval` guard actions pause agent execution and surface a modal in the Control UI. Auto-deny fires after 30 seconds to prevent deadlock.

### Channel integrations
Connect inbound bot channels: Telegram, Discord, WhatsApp (Baileys), Slack (Socket Mode), Signal (signal-cli JSON-RPC), Mattermost (WebSocket), Google Chat (webhooks), BlueBubbles, and iMessage. Setup wizard includes step-by-step credential entry and credential masking in all API responses.

### File and shell tools
Nine file operation tools: read, write, edit, move, copy, delete, make_directory, list_directory, stat_path. Shell exec via the `exec` tool. All controlled by access profiles.

### Access profiles

| Profile | Scope |
|---------|-------|
| `safe` | Workspace directory only; no shell |
| `standard` | Workspace + non-system paths; shell with confirmation |
| `full_access` | Unrestricted file and shell access |

Profiles are set per agent. A file audit log is written to `~/.krythor/file-audit.log`.

### Model provider support
Anthropic, OpenAI, Ollama, GGUF (llama-server), OpenRouter, Groq, Venice, Kimi (Moonshot), Mistral, Google Gemini, AWS Bedrock, Google Vertex AI, and the Claude Agent SDK. Any OpenAI-compatible API is also supported. Automatic fallback with circuit breaker and per-provider retry configuration.

### Privacy routing
The PrivacyRouter classifies prompt sensitivity using pattern matching (PII, credentials, filesystem paths) and automatically re-routes `private` or `restricted` content to a configured local provider (Ollama, GGUF, or local OpenAI-compat). Enable via `privacyRoutingEnabled: true` in app-config.json.

### Workspace isolation
Agents with a `workspaceDir` set are restricted to that directory for all file tool operations (read, write, edit, etc.) unless their access profile is `full_access`. This enforces per-agent sandboxing at the file system level.

### Approvals UI
When the guard engine raises a `require-approval` verdict, the UI displays a modal immediately via WebSocket push. Pending approvals show a badge on the Guard tab. Responses (Allow Once / Allow for Session / Deny) are sent from the UI without polling delay.

### Cron job management
Schedule agents to run automatically. Supports 5-field cron expressions (`0 7 * * *`), fixed intervals (every N milliseconds), and one-shot timestamps. The Cron Jobs tab provides job creation, enable/disable toggles, manual run-now, and last-run history with error display.

### Session compaction
POST `/api/memory/compact` manually triggers session compaction (summarizing old conversation turns to free storage). Available as a "Compact Sessions" button in the Memory tab.

### Audit log persistence
Guard decisions are persisted to SQLite (migration 011). `GET /api/audit/log` supports `limit`, `offset`, `agentId`, `operation`, and `since` filters backed by indexed queries. Falls back to the in-memory ring buffer when the DB is unavailable.

### Per-agent rate limiting
Each agent has a configurable runs-per-minute cap (default: 20). Excess calls receive a `429 Too Many Requests` with `Retry-After: 60`. Set via `agentMaxRunsPerMinute` in `app-config.json` or call `orchestrator.setMaxRunsPerMinute()`.

### Streaming approval integration
Guard `require-approval` verdicts during streamed responses send an `approval_required` SSE event immediately (no buffering). The UI surfaces an inline approval prompt mid-stream; on resolution an `approval_granted` event fires and streaming continues.

### Agent-to-agent messaging bus
`AgentMessageBus` provides in-process `send()`, `subscribe()`, and `delegate()` methods. `POST /api/agents/:id/message`, `GET /api/agents/:id/messages`, and `POST /api/agents/delegate` expose the bus over HTTP.

### Scheduled memory cleanup UI
The Memory tab shows janitor status (last run, next scheduled run, pruning stats) and provides a "Run Now" button. `GET /api/memory/janitor/status` and `POST /api/memory/janitor/run` back the UI.

### Webhook inbound hardening
Inbound webhooks (`POST /api/hooks/wake`, `POST /api/hooks/agent`) now require HMAC-SHA256 replay-attack protection: `X-Krythor-Timestamp` (5-minute window), `X-Krythor-Nonce` (per-request dedup), and `X-Krythor-Signature` (`HMAC-SHA256(token:ts:nonce:body)`).

### Full config export / import
`GET /api/config/export/full` returns a complete snapshot of agents, guard policies, access profiles, cron jobs, channels, skills, and providers (keys redacted). `POST /api/config/import/full?dryRun=true` supports per-section import flags and dry-run validation. The Settings panel exposes both actions.

### First-run wizard security guidance
The onboarding wizard now includes four post-channel steps: Security Profile (Safe / Standard / Full Access), Guard Policy preset (Permissive / Balanced / Strict), Privacy Routing toggle with local-provider awareness, and Workspace path configuration. Selections are saved to `app-config.json`.

### Dashboard real-time metrics
`GET /api/dashboard/metrics/series` returns a 60-minute sliding window of per-minute request counts, error counts, and latency sums. The Dashboard panel renders three sparklines (req/min, errors, latency) with a totals row showing aggregate request count, error count, avg latency, and error rate.

### Other notable capabilities
- Heartbeat engine — background maintenance loop: stale run detection, memory hygiene, model signal checks, config integrity checks
- Canvas — agent-editable HTML/CSS/JS pages served under the gateway
- Token spend history — ring buffer of last 1000 inferences with per-model sparklines
- Config hot reload — providers, agents, and guard policies can reload without restart
- LAN discovery — gateways on the same network find each other via UDP multicast
- CLI policy commands — `krythor policy show`, `krythor policy check <op>`, `krythor audit tail`, `krythor approvals pending`

---

## Scripts

### `scripts/full-build-loop.ps1`
Runs the complete repo-wide validation pipeline: install, build, test, and runtime health checks. Exits 0 only when everything passes.

```powershell
.\scripts\full-build-loop.ps1            # full run
.\scripts\full-build-loop.ps1 -SkipTests # skip pnpm test (faster iteration)
```

### `scripts/check.ps1`
System health check. Validates runtime, DB, migrations, credentials, and configuration. Supports auto-fix mode.

```powershell
.\scripts\check.ps1           # full check
.\scripts\check.ps1 -Fix      # attempt to auto-fix issues
.\scripts\check.ps1 -Verbose  # extra detail
.\scripts\check.ps1 -Json     # output results as JSON
```

---

## Development

### Run tests

```bash
pnpm test
# or run tests for a single package
cd packages/gateway && pnpm test
```

### Typecheck

```bash
cd packages/gateway && node_modules/.bin/tsc --noEmit
# or from root for all packages
pnpm -r exec tsc --noEmit
```

### Diagnostics

```bash
pnpm doctor
```

---

## License

MIT License — Copyright (c) 2026 Luxa Grid LLC
