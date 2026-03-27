# Krythor — Start Here

The single entry point for all Krythor documentation.

---

## Quick Start (3 steps)

**Step 1 — Install**

```bash
# Mac / Linux
curl -fsSL https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.sh | bash

# Windows (PowerShell)
iwr https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex
```

**Step 2 — Configure a provider**

The setup wizard runs automatically after install. Pick a provider (Anthropic, OpenAI, Ollama, etc.) and enter your API key.

Skip it? Run `krythor setup` later, or use the **Models** tab in the Control UI.

**Step 3 — Start Krythor**

```bash
krythor
```

Then open **http://localhost:47200** in your browser.

---

## What Krythor Can Do

| Feature | Description | Doc |
|---|---|---|
| Multi-model routing | Route requests across Anthropic, OpenAI, Ollama, local models, and any OpenAI-compatible API | [API.md](./API.md) |
| Automatic fallback | Circuit breaker + provider fallback — if one provider fails, the next takes over | [API.md](./API.md) |
| Persistent memory | BM25 + semantic hybrid search across sessions; tag, export, import, bulk prune | [API.md](./API.md) |
| Agent system | Custom system prompts, model preferences, tool permissions, chaining/handoff | [API.md](./API.md) |
| Guard engine | Policy-based allow/deny per operation; every decision logged for audit | [API.md](./API.md) |
| Tool system | exec (local commands), web_search, web_fetch, user-defined webhook tools | [API.md](./API.md) |
| Skills | Reusable task templates; built-in summarize / translate / explain | [API.md](./API.md) |
| Session management | Named conversations, pinning, idle detection, export as JSON/Markdown | [API.md](./API.md) |
| OpenAI compatibility | `/v1/chat/completions` — point any OpenAI SDK at Krythor | [API.md](./API.md) |
| Remote access | SSH forwarding, Tailscale, Nginx reverse proxy | [REMOTE_GATEWAY.md](./REMOTE_GATEWAY.md) |
| Plugin/tool loading | Drop JS files into `<dataDir>/plugins/`; auto-loaded as agent tools | [API.md](./API.md) |

---

## Installation Options

### One-line (recommended)

```bash
# Mac / Linux
curl -fsSL https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.sh | bash

# Windows
iwr https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex
```

### Manual zip

Download from [Releases](https://github.com/LuxaGrid/Krythor/releases/latest):

| File | Platform |
|------|----------|
| `krythor-win-x64.zip` | Windows 64-bit |
| `krythor-linux-x64.zip` | Linux 64-bit |
| `krythor-macos-x64.zip` | macOS Intel |
| `krythor-macos-arm64.zip` | macOS Apple Silicon |

Extract and run:
```bash
node start.js       # Mac / Linux
Krythor.bat         # Windows
```

### Docker

```bash
docker compose up -d
```

### From source

```bash
git clone https://github.com/LuxaGrid/Krythor
cd Krythor
pnpm install && pnpm build
node start.js
```

---

## Configuration

### Data directory locations

| Platform | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\Krythor\` |
| macOS | `~/Library/Application Support/Krythor/` |
| Linux | `~/.local/share/krythor/` |

Override with `KRYTHOR_DATA_DIR=/custom/path`.

### Config files

| File | Purpose |
|---|---|
| `config/providers.json` | AI providers and API keys |
| `config/agents.json` | Agent definitions |
| `config/app-config.json` | Gateway token and settings |
| `config/policy.json` | Guard engine rules |
| `config/custom-tools.json` | User-defined webhook tools |

Full reference: [CONFIG_REFERENCE.md](./CONFIG_REFERENCE.md) · Environment variables: [ENV_VARS.md](./ENV_VARS.md)

---

## Key Commands

| Command | Description |
|---|---|
| `krythor` | Start the gateway and open the Control UI |
| `krythor start --daemon` | Start gateway in background |
| `krythor stop` | Stop the background daemon |
| `krythor restart` | Stop + start in background |
| `krythor status` | Quick health check (add `--json` for machine output) |
| `krythor tui` | Terminal dashboard (live status, inline chat) |
| `krythor setup` | Run or re-run the setup wizard |
| `krythor doctor` | Full system diagnostics |
| `krythor doctor --test-providers` | Live API key validation for each provider |
| `krythor repair` | Check bundled runtime, sqlite, gateway, providers |
| `krythor security-audit` | 7-point security check with score |
| `krythor backup [--output <dir>]` | Create a timestamped backup archive |
| `krythor update` | Print the one-line update command |
| `krythor uninstall` | Remove the installation (data preserved) |
| `krythor help [<command>]` | Show help for a command |

---

## API Quick Reference

Base URL: `http://127.0.0.1:47200`

Auth: `Authorization: Bearer <token>` (token in `config/app-config.json`)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/health` | no | Full gateway health and subsystem status |
| GET | `/ready` | no | 200 = ready; 503 = not ready |
| POST | `/api/command` | yes | Run a command / chat message |
| GET | `/api/agents` | yes | List all agents |
| POST | `/api/agents` | yes | Create an agent |
| GET | `/api/agents/:id/run` | yes | Run an agent with `?message=` |
| GET | `/api/memory/search` | yes | Search memory (paginated) |
| GET | `/api/models` | yes | List all configured models |
| GET | `/api/providers` | yes | List all providers (safe — no secrets) |
| POST | `/v1/chat/completions` | yes | OpenAI-compatible completions |

Full reference: [API.md](./API.md)

---

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for step-by-step fixes.

**Quick checks:**

1. **Gateway won't start** — run `krythor repair`
2. **404 on /api/...** — check the token: `Authorization: Bearer <token>`
3. **No providers** — run `krythor setup` or open the Models tab
4. **ABI mismatch (better-sqlite3)** — run `krythor repair` to recompile
5. **Auth fails** — run `krythor doctor` to verify the token

---

## Full Documentation Index

| Document | Description |
|---|---|
| [START_HERE.md](./START_HERE.md) | This file — single entry point |
| [GETTING_STARTED.md](./GETTING_STARTED.md) | Step-by-step first-run walkthrough |
| [API.md](./API.md) | Complete API reference for all endpoints |
| [CONFIG_REFERENCE.md](./CONFIG_REFERENCE.md) | All config files and fields |
| [ENV_VARS.md](./ENV_VARS.md) | All environment variables |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Top 10 issues with fixes |
| [REMOTE_GATEWAY.md](./REMOTE_GATEWAY.md) | SSH forwarding, Tailscale, Nginx |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Daemon mode, Docker, systemd/launchd |
| [GAP_ANALYSIS.md](./GAP_ANALYSIS.md) | Feature gap analysis and roadmap context |
| [KRYTHOR_PHASE_PLAN.md](./KRYTHOR_PHASE_PLAN.md) | Roadmap and phase plan |
| [help/testing.md](./help/testing.md) | How to run and write tests |
| [templates/AGENTS.md](./templates/AGENTS.md) | Agent workspace template |
| [templates/SOUL.md](./templates/SOUL.md) | Identity configuration template |
| [templates/TOOLS.md](./templates/TOOLS.md) | Local environment notes template |
| [templates/MEMORY.md](./templates/MEMORY.md) | Long-term memory starter template |
