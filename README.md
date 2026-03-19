# Krythor

![Krythor Banner](./assets/krythor-banner.png)

**Local-first AI command platform with intelligent model routing, memory, and agent execution.**

---

## ⚡ What is Krythor?

Krythor is a local-first AI system designed to give you **full control** over how AI runs, remembers, and executes tasks.

Run agents. Route across models. Persist memory. Enforce rules.

All from a single control interface running entirely on your machine.

No lock-in. No hidden cloud layer. No loss of visibility.

---

## 🚀 Why Krythor?

Most AI tools hide what’s happening.

Krythor does the opposite.

* See which model ran your task
* Know why it was selected
* Track fallbacks in real time
* Control memory and execution behavior

This is not just chat.
This is **AI you can operate**.

---

## ✨ Features

* **Multi-model routing** — OpenAI, Anthropic, Ollama, LM Studio, GGUF (llama-server), and OpenAI-compatible APIs
* **Automatic fallback** — seamless provider failover
* **Persistent memory** — semantic + keyword retrieval across sessions
* **Agent system** — custom prompts, memory scope, and model preferences
* **Skills** — reusable task templates with structured routing hints
* **Guard engine** — policy-based allow/deny control
* **Transparent execution** — see exactly which model ran, why, and fallback behavior
* **Heartbeat monitoring** — background provider health tracking
* **Local-first** — all data stays on your machine

---

## ⚙️ Requirements

* **Node.js 20 or higher** — https://nodejs.org
* **pnpm** — `npm install -g pnpm`

---

## ⚡ Quick Start

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

Then open: **http://localhost:47200**

**Windows users:**
Use `Krythor-Setup.bat` and `Krythor.bat` instead of steps 4–5.

---

## 🧠 Supported Providers

| Provider                  | Type        | API Key Required |
| ------------------------- | ----------- | ---------------- |
| Anthropic (Claude)        | Cloud       | Yes              |
| OpenAI (GPT)              | Cloud       | Yes              |
| Ollama                    | Local       | No               |
| LM Studio                 | Local       | No               |
| llama-server (GGUF)       | Local       | No               |
| Any OpenAI-compatible API | Cloud/Local | Optional         |

Krythor auto-detects local providers (Ollama, LM Studio, llama-server) on first launch.

---

## 🏗️ Project Structure

```
packages/
  gateway/    — Fastify HTTP + WebSocket server, all API routes
  control/    — React control UI (served by gateway)
  core/       — Agent orchestration, runner, SOUL identity
  memory/     — SQLite memory engine, embeddings, conversation store
  models/     — Model registry, router, circuit breaker, providers
  guard/      — Policy engine (allow/deny rules per operation)
  skills/     — Skill registry and runner
  setup/      — CLI setup wizard and diagnostics
start.js      — Launcher (starts gateway, opens browser)
bundle.js     — Distribution packager (creates krythor-dist/)
build-exe.js  — Windows SEA executable builder (creates krythor.exe)
```

---

## 🧪 Development

```bash
pnpm dev        # gateway in watch mode
pnpm test       # run all tests
pnpm build      # build all packages
pnpm doctor     # run diagnostics
```

---

## 📦 Distribution

```bash
pnpm build
node bundle.js        # creates krythor-dist/
node build-exe.js     # creates krythor.exe (Windows)
```

---

## 📁 Data Location

All data is stored locally, outside the project folder:

* **Windows:** `%LOCALAPPDATA%\Krythor\`
* **macOS:** `~/Library/Application Support/Krythor/`
* **Linux:** `~/.local/share/krythor/`

To uninstall: remove the app folder and the data folder above.

---

## 🗺️ Roadmap

* [x] Local-first runtime
* [x] Multi-provider model routing
* [x] Persistent memory system
* [x] Agent system
* [ ] Production hardening
* [ ] Installer polish
* [ ] Expanded observability
* [ ] Advanced memory controls

---

## 📜 License

MIT — see [LICENSE](LICENSE)

---

Built by Luxa Grid LLC
