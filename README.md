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

### Other notable capabilities
- Heartbeat engine — background maintenance loop: stale run detection, memory hygiene, model signal checks, config integrity checks
- Privacy routing — classifies content sensitivity and reroutes private/restricted content to a local model
- Canvas — agent-editable HTML/CSS/JS pages served under the gateway
- Token spend history — ring buffer of last 1000 inferences with per-model sparklines
- Config hot reload — providers, agents, and guard policies can reload without restart
- LAN discovery — gateways on the same network find each other via UDP multicast

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
