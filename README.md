<p align="center">
  <img src="./logo.png" alt="Krythor" width="200" />
</p>

<h1 align="center">Krythor</h1>

<p align="center">Local-first AI command platform — agents, memory, model routing, guardrails, and a live Command Center.</p>

---

Krythor runs entirely on your machine. No lock-in. No hidden cloud layer. Full visibility into everything your AI does.

**Current version: v0.7.0**

---

## What it does

- **Agents** — create, run, and monitor AI agents with configurable models, memory, tools, and safety profiles
- **Reasoning Engine** — structured plan → execute → verify loop; every agent run is decomposed into observable steps with timing and token tracking
- **Memory** — persistent semantic memory with importance scoring, decay, and recall across sessions
- **Model Routing** — connect any combination of OpenAI, Anthropic, Ollama, and other providers; automatic fallback and circuit breaking
- **Guardrails** — policy engine with approval flows, audit logging, and per-operation risk classification
- **Skills** — reusable task templates with input/output schemas and multi-skill chaining
- **Vault** — 40 official skills across 6 collections (Real Estate, Finance, Productivity, Communication, Business Workflow, Starter Pack)
- **Talent Marketplace** — private directory for vendors, contractors, referral agents, and service providers with trust scoring and explainable ranking
- **Chat Channels** — WhatsApp, webhooks, and other inbound/outbound communication channels
- **Peers** — gateway-to-gateway networking over LAN or Tailscale
- **Devices** — managed device registry with approval-based pairing
- **Command Center** — live animated dashboard showing agents, memory, models, and system health in real time

---

## Install

**One-line install (recommended):**

```bash
# Mac / Linux
curl -fsSL https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex
```

No Node.js required — the installer handles everything.

**From source:**

```bash
git clone https://github.com/LuxaGrid/Krythor
cd Krythor
pnpm install
pnpm run build
pnpm start
```

Requires Node.js 20+ and pnpm.

---

## Getting started

1. Install and run `pnpm start` (or use the installed launcher)
2. Open `http://localhost:47200` in your browser
3. Go to **Models** → add at least one provider (Ollama for local, or paste an API key for cloud)
4. Open **Chat** and send your first message

---

## Requirements

- Node.js 20 or 24 (auto-managed by installer)
- Windows, Mac, or Linux
- 4 GB RAM minimum; 8 GB recommended for local models

---

## Providers

| Provider | Type | Key required |
|---|---|---|
| Ollama | Local | No |
| LM Studio | Local | No |
| OpenAI | Cloud | Yes |
| Anthropic | Cloud | Yes |
| Google Gemini | Cloud | Yes |
| Mistral | Cloud | Yes |
| OpenRouter | Cloud | Yes |
| Any OpenAI-compatible | Local/Cloud | Optional |

---

## Project structure

```
packages/
  gateway/   — API server, agent runner, model routing, guardrails
  control/   — React control UI
  core/      — Agent orchestration, reasoning engine, tools
  memory/    — SQLite persistence, semantic search, knowledge base
  models/    — Provider adapters, model router, inference
  guard/     — Policy engine, approval flows, audit logging
  skills/    — Skill registry, runner, composer, vault
  setup/     — Installer and first-run wizard
vault/       — Official skill catalog (40 skills)
native/      — Platform-specific native binaries
```

---

## Development

```bash
pnpm install       # install dependencies
pnpm run build     # build all packages
pnpm run dev       # start gateway in dev mode
pnpm run test      # run all tests
pnpm run typecheck # type-check all packages
pnpm run lint      # lint all packages
```

---

## Documentation

Full docs are in the [`docs/`](./docs/) directory.

---

## License

See [LICENSE](./LICENSE).
