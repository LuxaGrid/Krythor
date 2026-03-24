# Krythor

![Krythor](./logo.png)

**Local-first AI command platform with intelligent model routing, memory, agent execution, and a live animated Command Center.**

---

## ⚡ What is Krythor?

Krythor is a local-first AI system designed to give you **full control** over how AI runs, remembers, and executes tasks.

Run agents. Route across models. Persist memory. Enforce rules. Watch it all happen in real time inside a live animated Command Center.

All from a single control interface running entirely on your machine.

No lock-in. No hidden cloud layer. No loss of visibility.

---

## 🚀 Why Krythor?

Most AI tools hide what's happening.

Krythor does the opposite.

* See which model ran your task
* Know why it was selected
* Track fallbacks in real time
* Watch agents move, work, and hand off tasks in the live scene
* Control memory and execution behavior

This is not just chat.
This is **AI you can operate**.

---

## ✨ Features

* **Multi-model routing** — OpenAI, Anthropic, Ollama, LM Studio, GGUF (llama-server), OpenRouter, Groq, Venice, and any OpenAI-compatible API
* **Automatic fallback** — seamless provider failover with circuit breaker and per-provider retry config
* **Provider priority ordering** — configure which providers are tried first via the ⚙ advanced settings panel (priority, maxRetries, enable/disable per provider)
* **Dual-auth support** — connect cloud providers with an API key; "Connect" button opens provider dashboard in a new tab
* **Persistent memory** — BM25 + semantic hybrid retrieval across sessions with tagging, export/import, and bulk pruning
* **Agent system** — custom prompts, memory scope, model preferences, tool permissions, chaining/handoff per agent
* **Agent import/export** — share agent configs as JSON files
* **Skills** — reusable task templates with structured routing hints, task profiles, and built-in templates (summarize, translate, explain)
* **Guard engine** — policy-based allow/deny control per operation with persistent audit trail and live test mode
* **Tool system** — exec (local commands), web_search (DuckDuckGo), web_fetch (URL content), user-defined webhook tools with one-click test-fire
* **Session management** — named conversations, archive/restore, pinning, idle detection, export as JSON/Markdown
* **Conversation search** — filter conversations by title in the sidebar
* **Token spend history** — ring buffer of last 1000 inferences; Dashboard shows per-model sparkline with token breakdown
* **Outbound channels** — webhook notifications on lifecycle events (agent runs, memory, providers); HMAC-SHA256 signed; compatible with Zapier, n8n, Discord/Slack incoming webhooks
* **LAN discovery** — gateways on the same network find each other automatically via UDP multicast; manual peer registration for cross-network pairing
* **Gateway identity** — stable UUID per installation; capability manifest at `GET /api/gateway/info`
* **Command Center** — live animated operations view; mythic-tech agent entities (Atlas, Voltaris, Aethon, Thyros, Pyron) move between zones, react to real events, and fall back to a cycling demo when the gateway is idle
* **Ctrl+K command palette** — global fuzzy-search command palette for instant tab navigation, new chat, and more
* **Slash commands** — type `/` in the chat input to autocomplete commands: `/new`, `/clear`, `/memory`, `/agents`, `/models`, `/skills`, `/guard`, `/dash`, `/logs`, `/settings`
* **Dashboard heartbeat + circuit breaker** — live view of background provider health checks, warnings, recent run stats, and per-circuit state (open/closed/half-open)
* **Web chat widget** — embeddable chat page at `/chat`; no React bundle required
* **Transparent execution** — see exactly which model ran, why, and fallback behavior; learning system improves recommendations from override feedback
* **Heartbeat monitoring** — background provider health tracking and anomaly detection with warning indicators in the status bar
* **Real-time event stream** — filterable event stream with timestamps, icons, type coloring, and payload detail extraction
* **Live log viewer** — filterable, searchable logs with pause, copy, and expandable raw JSON per entry
* **Terminal dashboard** — `krythor tui` for a live status view without a browser
* **Auto-update check** — notified at startup when a newer release is available
* **Config hot reload** — `providers.json` watched with `fs.watch()`; `POST /api/config/reload` for manual trigger
* **Config export/import** — portable provider config with secrets redacted
* **Daemon mode** — `krythor start --daemon`, `krythor stop`, `krythor restart`
* **Backup command** — `krythor backup` creates a timestamped archive of the data directory
* **Doctor + Repair** — comprehensive diagnostics with migration integrity check and credential validation
* **Local-first** — all data stays on your machine

---

## 🎛️ Command Center

The **Command Center** tab is a live animated scene that shows what your AI agents are doing right now.

Five mythic-tech agent entities inhabit the scene, each with a unique silhouette:

| Agent | Role | Zone | Color |
|-------|------|------|-------|
| **Atlas** | Orchestrator | Crown Platform | Forge gold |
| **Voltaris** | Builder / Execution | Forge Console | Electric blue |
| **Aethon** | Researcher / Knowledge | Archive Pillar | Blue-violet |
| **Thyros** | Archivist / Memory | Memory Core | Ice blue |
| **Pyron** | Monitor / Logs | Monitoring Node | Amber |

Each agent:
- Has a **distinct SVG body** — Atlas is a crowned hexagonal medallion, Voltaris an angular diamond with forge spikes, Aethon an arcane eye/lens, Thyros a stacked memory pillar, Pyron a diamond-shard sentinel with a sweep-scan line
- Reacts visually to its **current state** — idle, listening, thinking, working, speaking, handoff, error, offline
- **Moves between zones** when handed off tasks (smooth 700ms transition)
- Shows a **task bubble** during working/thinking states
- Displays a **local/remote badge** (LC / RM) and an active **model badge** (OPUS, SNT, etc.)
- Pulses with a **memory recall flash** when Thyros retrieves from the memory store

The scene also features:
- **Energy paths** — animated dashed lines from Crown Platform to every active zone
- **Ambient reactor** — a central orb that grows and shifts color as more agents become active
- **Zone glow scaling** — zone platforms intensify their glow proportional to agent activity
- **Focus mode** — click any agent to dim everything else and center attention
- **Command log** — filterable live event log (all / tasks / tools / memory / errors) with pause toggle and auto-scroll
- **Demo mode** — when no gateway events arrive for 8 seconds, the scene runs a cycling demo scenario automatically; it seamlessly switches back to live data when the gateway reconnects

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` | Open command palette (fuzzy-search all tabs, actions) |
| `Ctrl+/` | Open About dialog |
| `Enter` | Send message (Command tab) |
| `Shift+Enter` | New line in message input |
| `/` | Begin a slash command in the chat input (autocomplete shows) |
| `↑` / `↓` | Navigate slash command or palette suggestions |
| `Tab` or `Enter` | Apply selected slash command or palette action |
| `Escape` | Close command palette or dismiss slash dropdown |

---

## 💬 Slash Commands

Type `/` in the chat input to see the autocomplete dropdown. Arrow keys or Tab to select, Enter to apply, Escape to dismiss.

| Command | Action |
|---------|--------|
| `/new` | Start a new conversation |
| `/clear` | Clear the current conversation |
| `/memory` | Jump to the Memory tab |
| `/agents` | Jump to the Agents tab |
| `/models` | Jump to the Models tab |
| `/skills` | Jump to the Skills tab |
| `/guard` | Jump to the Guard tab |
| `/dash` | Jump to the Dashboard tab |
| `/logs` | Jump to the Logs tab |
| `/settings` | Jump to Settings |

---

## Status

Krythor is in active development and currently available as an early public preview.
The current release is intended for testers, technical users, and early adopters.

---

## 🔒 Trust & Safety

Krythor is built on a local-first principle:

- **Your data never leaves your machine** unless you configure a cloud AI provider (OpenAI, Anthropic). Even then, only the content of your requests is sent — nothing else.
- **No telemetry.** Krythor does not collect usage data, crash reports, or analytics of any kind.
- **No accounts required.** You do not need to create an account to use Krythor. Cloud provider credentials (API keys and OAuth tokens) are stored encrypted in your OS user profile — never in the cloud.
- **Transparent model selection.** Every run shows which model was used, why it was chosen, and whether a fallback occurred. Nothing is hidden.
- **Open source.** The full source is on GitHub. You can read, audit, and build it yourself.

Data is stored in your OS user profile, outside the application folder:
- **Windows:** `%LOCALAPPDATA%\Krythor\`
- **macOS:** `~/Library/Application Support/Krythor/`
- **Linux:** `~/.local/share/krythor/`

---

## ⚙️ Requirements

**One-line installer and release zips:** No Node.js required — each release includes a bundled Node.js 20 runtime for your platform. Just download and run.

**Building from source:** Node.js 20 or higher is required. Download it free at **https://nodejs.org** — choose the "LTS" version.

> **Using the one-line installer?** You do not need to install Node.js. The installer downloads a release zip that already contains its own `runtime/node` binary.

---

## ⚡ Install

### ✅ Recommended — One-line install (all platforms)

This is the fastest and most transparent way to install Krythor. The script downloads directly from GitHub Releases, detects your platform automatically, and sets everything up.

**Mac or Linux** — open Terminal and run:

```bash
curl -fsSL https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.sh | bash
```

**Windows** — open PowerShell and run:

```powershell
iwr https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex
```

The script will:
- Detect your operating system and chip architecture
- Download the correct Krythor build from GitHub
- Extract the bundled Node.js runtime (no system Node.js needed)
- Install to `~/.krythor` (Mac/Linux) or `%USERPROFILE%\.krythor` (Windows)
- Compile the native database module against the bundled runtime
- Run first-time setup

After install, start Krythor with:

```bash
krythor
```

Then open **http://localhost:47200** in your browser.

---

### 🔄 Updates

Once installed, updating is one command:

```bash
krythor update
```

This downloads the latest release and replaces the application files. Your settings, memory, and data are always preserved.

---

### Alternative — Windows Installer *(may show a security warning)*

A Windows `.exe` installer is available on the [Releases page](https://github.com/LuxaGrid/Krythor/releases/latest).

**Important:** This installer is currently **unsigned** — it does not have a code signing certificate. Windows SmartScreen will show a warning when you run it ("Windows protected your PC"). This is expected for unsigned software, not evidence of a problem.

If you see this warning:
1. Click **"More info"**
2. Click **"Run anyway"**

We recommend the one-line install above as it is more transparent — you can read exactly what it does before running it.

---

### Manual install — platform zip

Download the zip for your platform from the [Releases page](https://github.com/LuxaGrid/Krythor/releases/latest):

| File | Platform |
|------|----------|
| `krythor-win-x64.zip` | Windows 64-bit |
| `krythor-linux-x64.zip` | Linux 64-bit |
| `krythor-macos-x64.zip` | macOS Intel |
| `krythor-macos-arm64.zip` | macOS Apple Silicon (M1/M2/M3) |

Extract the zip, open a terminal in the extracted folder, and run:

```bash
node start.js       # Mac / Linux
Krythor.bat         # Windows
```

---

### From source

```bash
git clone https://github.com/LuxaGrid/Krythor
cd Krythor
pnpm install && pnpm build
node start.js
```

> Requires Node.js 20+ and pnpm. Install pnpm with `npm install -g pnpm`.

---

### Docker

```bash
docker compose up -d
```

Then open **http://localhost:47200**. Data is persisted in a named Docker volume (`krythor-data`).

Or build and run directly:

```bash
docker build -t krythor .
docker run -p 47200:47200 -v krythor-data:/data krythor
```

See `docs/DEPLOYMENT.md` for environment variables, production setup, and backup strategy.

---

### npm global install *(coming soon)*

```bash
npm install -g krythor
krythor
```

> npm global install is not yet published. The `bin` field and `files` manifest are in place for a future release. Until then, use the one-line installer above.

---

## 🖥️ Terminal Commands Reference

All commands assume Krythor is installed via the one-line installer or a release zip. If running from source, prefix with `node start.js` or use the pnpm scripts listed separately.

### Runtime commands

| Command | Description |
|---------|-------------|
| `krythor` | Start Krythor (foreground — Ctrl+C to stop) |
| `krythor start --daemon` | Start Krythor in background (daemon mode) |
| `krythor stop` | Stop the running daemon |
| `krythor restart` | Stop and restart the daemon |
| `krythor status` | Show whether the daemon is running and its PID |
| `krythor update` | Download and install the latest release (preserves all data) |
| `krythor tui` | Open the terminal dashboard (live status without a browser) |

### Diagnostics and maintenance

| Command | Description |
|---------|-------------|
| `krythor doctor` | Run all diagnostics — prints pass/fail for runtime, DB, migrations, credentials |
| `krythor repair` | Auto-fix issues found by doctor (re-compiles native modules, reruns migrations) |
| `krythor backup` | Create a timestamped `.tar.gz` / `.zip` archive of the data directory |

### Source / development commands

Run these from the repository root with pnpm installed (`npm install -g pnpm`).

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all workspace dependencies |
| `pnpm build` | Build all packages (gateway + control UI + all libraries) |
| `pnpm dev` | Start gateway in watch mode with hot-reload; control UI auto-reloads on save |
| `pnpm test` | Run the full test suite across all packages |
| `pnpm doctor` | Run diagnostics via the pnpm script alias |

### Distribution / release commands

| Command | Description |
|---------|-------------|
| `node scripts/tag-release.js <version>` | Bump version in all package.json files, create and push a git tag — triggers GitHub Actions release CI |
| `node bundle.js` | Build a self-contained distribution folder (`krythor-dist-{platform}/`) for the current platform |
| `node build-installer.js` | Build a Windows `.exe` installer (Windows only; requires Inno Setup) |
| `node build-exe.js` | Build a Windows SEA (Single Executable Application) binary |

### Docker commands

| Command | Description |
|---------|-------------|
| `docker compose up -d` | Start Krythor in Docker (detached) |
| `docker compose down` | Stop and remove Docker containers |
| `docker compose logs -f` | Follow container logs |
| `docker build -t krythor .` | Build the Docker image from source |
| `docker run -p 47200:47200 -v krythor-data:/data krythor` | Run the image with persistent data volume |

### Git workflow (contributors)

| Command | Description |
|---------|-------------|
| `git clone https://github.com/LuxaGrid/Krythor` | Clone the repository |
| `git checkout -b my-feature` | Create a feature branch |
| `git push origin my-feature` | Push branch and open a pull request on GitHub |

---

## 📚 Documentation

**[docs/START_HERE.md](./docs/START_HERE.md)** — the single entry point for all documentation.

Covers: Quick Start, feature overview, installation options, configuration, all CLI commands, API quick reference, troubleshooting, and links to every doc.

Other key docs:
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) — top 10 issues with step-by-step fixes
- [docs/ENV_VARS.md](./docs/ENV_VARS.md) — every environment variable Krythor reads
- [docs/API.md](./docs/API.md) — complete API reference
- [docs/REMOTE_GATEWAY.md](./docs/REMOTE_GATEWAY.md) — SSH forwarding, Tailscale, Nginx

---

## 📖 Getting Started — Step by Step Guide

*This section is written for people who have never used a tool like this before. Technical users can skip ahead.*

---

### Step 1 — No Node.js installation needed

Krythor's installer downloads a release that includes its own bundled Node.js runtime. You do **not** need to install Node.js separately.

> **Building from source?** In that case you do need Node.js 20+. Download it at **https://nodejs.org** and choose the "LTS" version. This only applies if you are cloning the repository and running `pnpm build` yourself.

---

### Step 2 — Install Krythor

Open your terminal and paste the install command for your platform:

**Mac or Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex
```

Watch the output — it will tell you what it's doing at each step. The whole process takes about 30–60 seconds depending on your internet speed.

> **What does this command do?**
> It downloads a small script from GitHub and runs it. The script downloads Krythor, puts it in a folder in your home directory, and sets up the `krythor` command. Nothing is installed system-wide. To uninstall, just delete the `.krythor` folder.

---

### Step 3 — Start Krythor

After the installer finishes, type:

```bash
krythor
```

> **Windows users:** If you get "command not found", open a **new** PowerShell window and try again. The PATH update requires a fresh terminal.

Krythor will start a local server on your computer. You'll see output like:
```
✓ Krythor is running  →  http://127.0.0.1:47200
```

---

### Step 4 — Open the Dashboard

Open your web browser (Chrome, Firefox, Edge — any browser works) and go to:

**http://localhost:47200**

This is Krythor's control dashboard. It runs entirely on your machine — it's not a website, it's a local app that happens to use your browser as its interface.

---

### Step 5 — Connect an AI Provider

Krythor needs to know which AI to use. You have two options:

#### Option A — Use a local AI (free, runs on your computer)

**Ollama** is a free tool that runs AI models locally. Nothing is sent to the internet.

1. Go to **https://ollama.com** and install it
2. In a terminal, run: `ollama pull llama3.2` (downloads a free model)
3. In the Krythor dashboard, go to the **Models** tab
4. Click **+ add provider**, choose **ollama**, and click **Add**
5. Click **refresh** next to the provider to load your models

#### Option B — Use a cloud AI (OpenAI or Anthropic)

These require an account with the provider. You pay for what you use.

Krythor supports two ways to connect — pick whichever suits you:

**API Key** (works in the terminal setup wizard and the app)
1. Create an account at **https://platform.openai.com** (OpenAI) or **https://console.anthropic.com** (Anthropic)
2. Go to API Keys and create a new key
3. In Krythor, add a provider, choose **openai** or **anthropic**, and paste your key

**"Connect with OAuth later"** (deferred setup — opens provider dashboard in your browser)
1. During setup, choose **"Connect with OAuth later — opens provider dashboard to get your API key"**
2. Krythor saves a placeholder provider entry and shows an **OAuth Pending** badge in the Models tab
3. Click **Connect ↗** next to the provider — this opens the provider's API key page in a new browser tab
4. Copy your API key, then edit the provider in the Models tab to add it

> **Note:** The current "OAuth" option is a convenience shortcut that opens the provider's API key page in your browser. It is not a full OAuth browser sign-in flow. A full OAuth sign-in flow (no key copy-paste) is on the roadmap.

> **Your credentials are stored on your computer.** They are never sent anywhere except directly to the AI provider when you make a request.

---

### Step 6 — Send your first command

Click the **Command** tab in the dashboard. Type anything in the input box and press Enter (or click Send).

Krythor will:
1. Route your request to the best available model
2. Show you the response
3. Display which model was used and why (at the bottom of the response)

**Tips:**
- Press **Ctrl+K** to open the command palette and jump to any tab instantly
- Type `/` in the chat input to see a list of slash commands

---

### Step 7 — Explore the features

The dashboard has several tabs:

| Tab | What it does |
|-----|-------------|
| **Command** | Send messages and get AI responses; archive/restore conversations; slash commands |
| **Memory** | View and manage what Krythor remembers across sessions |
| **Models** | Add, test, and configure AI providers; set priority and retry settings with ⚙ |
| **Agents** | Create custom AI assistants with their own instructions |
| **Guard** | Set rules for what Krythor is and isn't allowed to do; live test mode |
| **Skills** | Reusable task templates with routing profiles |
| **Dashboard** | Token usage sparklines, heartbeat last-run, circuit breaker status |
| **Logs** | Live log stream with filter, search, pause, copy, and expandable JSON rows |
| **Events** | Real-time event stream with icons, timestamps, type coloring, and filter |
| **Workflow** | View agent run history and stop active runs |
| **Channels** | Configure outbound webhook notifications |
| **Custom Tools** | Define webhook tools; test-fire each one from the UI |
| **Config Editor** | Edit raw configuration files |
| **Command Center** | Live animated scene showing all agents working in real time |

---

### Stopping Krythor

Press **Ctrl + C** in the terminal where Krythor is running. The dashboard will become unavailable until you start it again.

To run in the background instead:
```bash
krythor start --daemon
krythor stop        # when you want to stop it
```

---

### Starting Krythor again later

Any time you want to use Krythor, open a terminal and run:
```bash
krythor
```
Then open **http://localhost:47200** in your browser.

---

### Updating Krythor

When a new version is available:
```bash
krythor update
```
Your settings and memory are preserved automatically.

---

### Uninstalling Krythor

To remove Krythor completely:

**Mac/Linux:**
```bash
rm -rf ~/.krythor
```
Then remove the line added to your `~/.bashrc` or `~/.zshrc` that contains `KRYTHOR`.

**Windows:**
Delete the folder `C:\Users\YourName\.krythor`

Your AI provider data (config, memory) is stored separately:
- **Windows:** `%LOCALAPPDATA%\Krythor\` — delete this too for a clean uninstall
- **Mac:** `~/Library/Application Support/Krythor/`
- **Linux:** `~/.local/share/krythor/`

---

### Troubleshooting

**"krythor: command not found"**
Open a new terminal window. The PATH update requires a fresh session. On Mac/Linux you can also run `source ~/.bashrc` (or `~/.zshrc`) to apply it immediately.

**The dashboard won't load at http://localhost:47200**
Make sure Krythor is running — you should see activity in the terminal. If Krythor crashed, re-run `krythor`.

**"No AI provider configured"**
You need to add at least one AI provider in the Models tab before Krythor can respond to commands. See Step 5 above.

**Windows SmartScreen warning on the .exe installer**
This is expected — the installer is currently unsigned. Click "More info" then "Run anyway". Or use the PowerShell one-liner instead, which doesn't trigger this warning.

**"Gateway did not start"**
Run the built-in repair check to identify the problem:
```bash
krythor repair
```
This verifies the bundled runtime, native modules, and gateway health, and prints a pass/fail for each. Follow the printed instructions if any check fails.

**Command Center shows "DEMO MODE"**
This is normal when no real agent runs are happening. The scene runs a pre-scripted cycling scenario. As soon as your gateway processes real events, it switches to live data automatically.

---

## 🧠 Supported Providers

| Provider | Type | Cost | Auth |
|----------|------|------|------|
| Ollama | Local | Free | None required |
| LM Studio | Local | Free | None required |
| llama-server (GGUF) | Local | Free | None required |
| OpenAI (GPT-4o, o1, etc.) | Cloud | Pay per use | API key or OAuth |
| Anthropic (Claude) | Cloud | Pay per use | API key or OAuth |
| OpenRouter | Cloud | Pay per use | API key |
| Groq | Cloud | Pay per use | API key |
| Venice | Cloud | Pay per use | API key |
| Any OpenAI-compatible API | Cloud/Local | Varies | Optional API key |

Krythor auto-detects Ollama and LM Studio on first launch.

---

## 🔌 Quick API Reference

All API endpoints are served at `http://127.0.0.1:47200`. Most require a Bearer token (auto-injected into the control UI, or found in `app-config.json`).

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | Public | Status, version, provider/model/agent counts, heartbeat, circuit info |
| GET | `/ready` | Public | Readiness check — 200 OK or 503 Not Ready |
| POST | `/api/command` | Required | Send a command to the default agent |
| GET | `/api/models` | Required | List all configured models |
| GET | `/api/providers` | Required | List providers (safe summary — no secrets) |
| POST | `/api/providers/:id` | Required | Update provider meta (priority, maxRetries, isEnabled) |
| POST | `/api/providers/:id/test` | Required | Test a provider with a minimal inference |
| GET | `/api/agents` | Required | List all defined agents |
| POST | `/api/agents` | Required | Create a new agent |
| GET | `/api/memory` | Required | Search agent memory |
| GET | `/api/tools` | Required | List available tools (exec, web_search, web_fetch) |
| POST | `/api/tools/exec` | Required | Execute a local command (allowlist-checked) |
| POST | `/api/tools/web_search` | Required | Search the web via DuckDuckGo |
| POST | `/api/tools/web_fetch` | Required | Fetch a URL as plain text |
| GET | `/api/skills` | Required | List registered skills |
| GET | `/api/stats` | Required | Token usage for this session |
| GET | `/api/conversations` | Required | List recent conversations |
| POST | `/api/conversations/:id/archive` | Required | Archive a conversation |
| POST | `/api/conversations/:id/restore` | Required | Restore an archived conversation |
| POST | `/api/config/reload` | Required | Reload providers.json without restart |
| GET | `/api/heartbeat/status` | Required | Heartbeat status and active warnings |
| GET | `/api/templates` | Required | List workspace template files |
| GET | `/api/channels` | Required | List outbound webhook channels |
| POST | `/api/channels` | Required | Create a webhook channel |
| PATCH | `/api/channels/:id` | Required | Update a webhook channel |
| DELETE | `/api/channels/:id` | Required | Delete a webhook channel |
| GET | `/api/channels/events` | Required | List supported channel event types |
| POST | `/api/channels/:id/test` | Required | Send a test delivery to a channel |
| POST | `/api/recommend/override` | Required | Report a model override for learning system feedback |
| GET | `/api/gateway/info` | Required | Gateway identity and capability manifest |
| GET | `/api/gateway/peers` | Required | List known remote gateway peers |
| POST | `/api/gateway/peers` | Required | Register a remote gateway peer |
| DELETE | `/api/gateway/peers/:id` | Required | Remove a registered peer |
| GET | `/api/gateway/probe` | Required | Probe connectivity to known peers |
| WS | `/ws/stream` | Required | Real-time event stream (used by Command Center and Event Stream panel) |

---

## 📡 Outbound Channels

Krythor can push lifecycle events to any webhook endpoint — Zapier, n8n, Discord, Slack, or your own server.

**Create a channel:**
```bash
curl -X POST http://localhost:47200/api/channels \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Slack Hook",
    "url": "https://hooks.slack.com/services/...",
    "events": ["agent_run_complete", "memory_saved", "provider_added"]
  }'
```

**Supported events:** `agent_run_complete`, `agent_run_failed`, `memory_saved`, `memory_deleted`, `provider_added`, `provider_removed`, `conversation_created`, `guard_denied`, `heartbeat_warning`, `heartbeat_recovery`

**Delivery:** POST with JSON body, `Content-Type: application/json`, and a `X-Krythor-Signature: sha256=<hex>` HMAC-SHA256 header for verification.

---

## 🌐 LAN Discovery & Peer Registry

Krythor gateways on the same network automatically discover each other using UDP multicast (mDNS on `224.0.0.251:5353`). For cross-network pairing, register peers manually:

```bash
# Register a remote gateway
curl -X POST http://localhost:47200/api/gateway/peers \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"url": "http://192.168.1.50:47200", "label": "Home server"}'

# List all known peers (LAN-discovered + manual)
curl http://localhost:47200/api/gateway/peers \
  -H "Authorization: Bearer <token>"
```

Each gateway has a stable UUID identity visible at `GET /api/gateway/info`. The capability manifest lists which features (channels, peers, tools, etc.) are available on that gateway.

---

## 🛠️ Tools

Krythor agents can use three built-in tools via a structured JSON call in their response:

### exec — local command execution

```json
{"tool":"exec","command":"git","args":["status"]}
```

Runs an allowlisted local command. Default allowlist: `ls, pwd, echo, cat, grep, find, git, node, python, python3, npm, pnpm`. Guard-engine checked before execution.

Direct API: `POST /api/tools/exec`

### web_search — DuckDuckGo search

```json
{"tool":"web_search","query":"latest Node.js LTS release"}
```

Searches using the DuckDuckGo Instant Answer API. No API key required. Returns up to 10 results with title, URL, and snippet. Read-only — always allowed.

Direct API: `POST /api/tools/web_search`

### web_fetch — fetch a URL

```json
{"tool":"web_fetch","url":"https://nodejs.org/en/about/releases"}
```

Fetches a URL and returns plain text (HTML stripped). Content truncated at 10,000 characters. Read-only — always allowed.

Direct API: `POST /api/tools/web_fetch`

---

## 🏗️ Project Structure

```
packages/
  gateway/    — Fastify HTTP + WebSocket server, all API routes
  control/    — React control UI (served by gateway)
    src/components/command-center/
      agents/     — AgentBody, AgentEntity, AgentLayer, AgentRings, AgentGlyph, AgentTooltip, TaskBubble
      scene/      — CommandScene, SceneGrid, SceneZone, EnergyPaths, AmbientReactor, HandoffArc
      panels/     — LeftPanel, BottomPanel, CommandLog
      agents.ts   — DEFAULT_AGENTS, SCENE_ZONES, ZONE_MAP, createAgent()
      types.ts    — all Command Center types
      events.ts   — AGENT_STATE_TRANSITIONS, makeEvent()
      eventAdapter.ts  — gateway → CCEvent adapter
      demoAdapter.ts   — 12-step cycling demo scenario
      useCommandCenter.ts — master hook
  core/       — Agent orchestration, runner, SOUL identity
  memory/     — SQLite memory engine, embeddings, conversation store
  models/     — Model registry, router, circuit breaker, providers
  guard/      — Policy engine (allow/deny rules per operation)
  skills/     — Skill registry and runner
  setup/      — CLI setup wizard and diagnostics
start.js      — Launcher (starts gateway, opens browser)
bundle.js     — Distribution packager (creates krythor-dist/)
build-exe.js  — Windows SEA executable builder
Dockerfile    — Docker image (node:20-alpine, non-root user)
```

---

## 🧪 Development

```bash
pnpm install    # install all dependencies
pnpm dev        # gateway in watch mode + control UI hot-reload
pnpm test       # run all tests
pnpm build      # build all packages
pnpm doctor     # run diagnostics
```

The control UI auto-reloads on save during `pnpm dev`. The Command Center connects to the gateway WebSocket at `ws://localhost:47200/ws/stream` and falls back to demo mode after 8 seconds of silence.

---

## 📦 Distribution

Releases are built automatically by GitHub Actions when a version tag is pushed:

```bash
node scripts/tag-release.js 1.2.1   # bump version, tag, push — triggers CI
```

To build a local distribution bundle manually:

```bash
pnpm build
node bundle.js                       # creates krythor-dist-{platform}/
node build-installer.js              # creates Krythor-Setup-{version}.exe (Windows only)
```

---

## 📁 Data Location

All user data is stored locally, outside the application folder:

* **Windows:** `%LOCALAPPDATA%\Krythor\`
* **macOS:** `~/Library/Application Support/Krythor/`
* **Linux:** `~/.local/share/krythor/`

To uninstall: remove the application folder (`~/.krythor`) and the data folder above.

---

## 🗺️ Roadmap

* [x] Local-first runtime
* [x] Multi-provider model routing with automatic fallback and circuit breaker
* [x] Persistent memory system with BM25 + semantic hybrid search
* [x] Agent system with tool-call loop (exec, web_search, web_fetch)
* [x] Production hardening (crash recovery, structured logging, circuit breaker)
* [x] Cross-platform distribution (Windows, macOS, Linux)
* [x] Windows installer (Inno Setup)
* [x] Transparent execution (selectionReason, fallbackOccurred in all run paths)
* [x] One-line curl/PowerShell installers
* [x] Dual-auth system (API key + OAuth) for cloud providers
* [x] Guard engine (policy-based allow/deny per operation) with live test mode
* [x] Tool system (exec, web_search, web_fetch) with webhook custom tools and test-fire
* [x] Terminal dashboard (krythor tui)
* [x] Auto-update check on startup
* [x] Outbound webhook channels (10 event types, HMAC signing, delivery stats)
* [x] LAN peer discovery (mDNS UDP multicast) + manual peer registry
* [x] Command Center — live animated agent scene with distinct silhouettes, state machine, zone transitions, energy paths, ambient reactor, focus mode, and command log
* [x] Ctrl+K global command palette with fuzzy search
* [x] Slash commands in chat input (/new, /clear, /memory, /agents, /models, /skills, /guard, /dash, /logs, /settings)
* [x] Provider advanced settings panel (priority, maxRetries, enable/disable per provider)
* [x] Dashboard heartbeat last-run info and circuit breaker summary
* [x] LogsPanel copy to clipboard and expandable raw JSON per entry
* [x] EventStream filter, timestamps, icons, and payload detail extraction
* [x] Model override feedback wired into learning system (reportOverride)
* [ ] Code signing (OV certificate — eliminates SmartScreen warning)
* [ ] Auto-updater UI (download and replace in-place)
* [ ] macOS / Linux native installers
* [ ] Docker image on GitHub Container Registry (ghcr.io)
* [ ] npm global package publish
* [ ] Full OAuth browser sign-in flow (no copy-paste)

---

## 📜 License

MIT — see [LICENSE](LICENSE)

---

Built by Luxa Grid LLC
