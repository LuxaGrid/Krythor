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

## Screenshots

Screenshots coming soon — see [`assets/screenshots/CAPTURE.md`](./assets/screenshots/CAPTURE.md) for the capture guide.

---

## Status

Krythor is in active development and currently available as an early public preview.
The current release is intended for testers, technical users, and early adopters.

---

## 🔒 Trust & Safety

Krythor is built on a local-first principle:

- **Your data never leaves your machine** unless you configure a cloud AI provider (OpenAI, Anthropic). Even then, only the content of your requests is sent — nothing else.
- **No telemetry.** Krythor does not collect usage data, crash reports, or analytics of any kind.
- **No accounts required.** You do not need to create an account to use Krythor. Cloud provider API keys are stored locally in your OS user profile.
- **Transparent model selection.** Every run shows which model was used, why it was chosen, and whether a fallback occurred. Nothing is hidden.
- **Open source.** The full source is on GitHub. You can read, audit, and build it yourself.

Data is stored in your OS user profile, outside the application folder:
- **Windows:** `%LOCALAPPDATA%\Krythor\`
- **macOS:** `~/Library/Application Support/Krythor/`
- **Linux:** `~/.local/share/krythor/`

---

## ⚙️ Requirements

* **Node.js 20 or higher** — https://nodejs.org
* **pnpm** — `npm install -g pnpm` *(only needed for source builds)*

---

## ⚡ Install

### Windows — Installer (recommended)

Download and run **[Krythor-Setup.exe](https://github.com/LuxaGrid/Krythor/releases/latest)** from the releases page.

No Node.js required — the installer bundles everything.

### Windows — PowerShell one-liner

```powershell
iwr https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex
```

Installs to `%USERPROFILE%\.krythor\` and adds `krythor` to your PATH.

### Mac / Linux — curl one-liner

```bash
curl -fsSL https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.sh | bash
```

Installs to `~/.krythor/` and adds a `krythor` alias to your shell profile.

Requires Node.js 20+ on PATH. Auto-detects your OS and architecture — downloads the correct platform build automatically.

### Platform zip — direct download

Each release includes platform-specific zips. Download the one for your system:

| Asset | Platform |
|-------|----------|
| `krythor-win-x64.zip` | Windows x64 |
| `krythor-linux-x64.zip` | Linux x64 |
| `krythor-linux-arm64.zip` | Linux ARM64 |
| `krythor-macos-x64.zip` | macOS Intel |
| `krythor-macos-arm64.zip` | macOS Apple Silicon |

Extract and run:

```bash
node start.js          # Mac/Linux
Krythor.bat            # Windows
```

### From source

```bash
git clone https://github.com/LuxaGrid/Krythor
cd Krythor
pnpm install && pnpm build
node start.js
```

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
# Full release (build + bundle + exe + installer)
node build-release.js

# Or step by step:
pnpm build
node bundle.js           # creates krythor-dist/
node build-exe.js        # creates krythor.exe (Windows SEA)
node build-installer.js  # creates Krythor-Setup-{version}.exe
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
* [x] Multi-provider model routing with automatic fallback
* [x] Persistent memory system
* [x] Agent system
* [x] Production hardening (crash recovery, structured logging, circuit breaker)
* [x] Bundle-slimmed distribution (~8 MB)
* [x] Windows installer (Inno Setup)
* [x] Transparent execution (selectionReason, fallbackOccurred in all run paths)
* [ ] Code signing (OV certificate — eliminates SmartScreen)
* [ ] Auto-updater
* [ ] Expanded observability
* [ ] macOS / Linux installer

---

## 📜 License

MIT — see [LICENSE](LICENSE)

---

Built by Luxa Grid LLC
