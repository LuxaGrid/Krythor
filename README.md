# Krythor

Local-first AI command platform with intelligent model routing, memory, and agent execution.

## What is Krythor?

Krythor is a local-first AI system that lets you run agents, manage memory, and route tasks across multiple AI models — all from a single control interface running entirely on your machine. No cloud accounts required beyond the providers you choose to use.

## Features

- **Multi-model routing** — OpenAI, Anthropic, Ollama, LM Studio, GGUF (llama-server), or any OpenAI-compatible API
- **Automatic fallback** — if your primary provider fails, Krythor routes to the next available one
- **Persistent memory** — semantic or keyword search across conversation history, agent runs, and user-defined entries
- **Agent system** — create agents with custom system prompts, memory scope, and model preferences
- **Skills** — reusable task templates with structured model routing hints
- **Guard engine** — per-operation policy rules with allow/deny control
- **Transparent execution** — every run shows which model was used, why it was chosen, and whether a fallback occurred
- **Heartbeat monitoring** — background health checks with persistent warnings across restarts
- **Local-first** — all data stored on your machine, never sent anywhere beyond your chosen providers

## Requirements

- **Node.js 20 or higher** — [nodejs.org](https://nodejs.org)
- **pnpm** — `npm install -g pnpm`

## Quick Start

```bash
# 1. Clone
git clone https://github.com/LuxaGrid/Krythor
cd krythor

# 2. Install dependencies
pnpm install

# 3. Build
pnpm build

# 4. Run setup wizard (first time only)
node packages/setup/dist/bin/setup.js

# 5. Launch
node start.js
```

Then open **http://localhost:47200** in your browser.

**Windows users:** after building, you can use `Krythor-Setup.bat` and `Krythor.bat` instead of steps 4–5.

## Supported Providers

| Provider | Type | API Key Required |
|---|---|---|
| Anthropic (Claude) | Cloud | Yes |
| OpenAI (GPT) | Cloud | Yes |
| Ollama | Local | No |
| LM Studio | Local | No |
| llama-server (GGUF) | Local | No |
| Any OpenAI-compatible API | Cloud/Local | Optional |

Krythor auto-detects locally running providers (Ollama, LM Studio, llama-server) on first launch.

## Project Structure

```
packages/
  gateway/    — Fastify HTTP + WebSocket server, all API routes
  control/    — React control UI (served by gateway)
  core/       — Agent orchestration, runner, SOUL identity
  memory/     — SQLite memory engine, embeddings, conversation store
  models/     — Model registry, router, circuit breaker, providers
  guard/      — Policy engine (allow/deny rules per operation)
  skills/     — Skill registry and runner
  setup/      — CLI setup wizard and doctor diagnostics
start.js      — Launcher (starts gateway, opens browser)
bundle.js     — Distribution packager (produces krythor-dist/)
build-exe.js  — Windows SEA executable builder (produces krythor.exe)
```

## Development

```bash
pnpm dev        # gateway in watch mode
pnpm test       # run all tests
pnpm build      # build all packages
pnpm doctor     # run diagnostics
```

## Distribution

```bash
pnpm build
node bundle.js        # creates krythor-dist/ — zip and share
node build-exe.js     # Windows only — creates krythor.exe (no Node required on PATH)
```

## Data Location

All data is stored locally, never in this folder:

- **Windows:** `%LOCALAPPDATA%\Krythor\`
- **macOS:** `~/Library/Application Support/Krythor/`
- **Linux:** `~/.local/share/krythor/`

To uninstall: delete this folder and optionally delete the data folder above.

## License

MIT — see [LICENSE](LICENSE)

---

Built by Luxa Grid LLC
