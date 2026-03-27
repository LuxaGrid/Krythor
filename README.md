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

* **Multi-model routing** — OpenAI, Anthropic, Ollama, LM Studio, GGUF (llama-server), OpenRouter, Groq, Venice, Kimi (Moonshot), Mistral, and any OpenAI-compatible API
* **Quick-add provider presets** — one-click guided setup for Groq, OpenRouter, Google Gemini, Venice, Kimi, and Mistral
* **Automatic fallback** — seamless provider failover with circuit breaker and per-provider retry config
* **Provider priority ordering** — configure which providers are tried first via the ⚙ advanced settings panel (priority, maxRetries, enable/disable per provider)
* **Dual-auth support** — connect cloud providers with an API key; "Connect" button opens provider dashboard in a new tab
* **Persistent memory** — BM25 + semantic hybrid retrieval across sessions with tagging, export/import, and bulk pruning
* **Agent system** — custom prompts, memory scope, model preferences, tool permissions, chaining/handoff per agent
* **Agent import/export** — share agent configs as JSON files
* **Skills** — reusable task templates with structured routing hints, task profiles, and built-in templates (summarize, translate, explain)
* **Guard engine** — policy-based allow/deny control per operation with persistent audit trail and live test mode; three distinct safety modes (Guarded, Balanced, Power User) with color-coded cards showing per-mode behavior
* **Tool system** — exec (local commands), web_search (DuckDuckGo), web_fetch (URL content), user-defined webhook tools with one-click test-fire
* **Session management** — named conversations, archive/restore, pinning, idle detection, export as JSON/Markdown
* **Conversation search** — filter conversations by title in the sidebar
* **Token spend history** — ring buffer of last 1000 inferences; Dashboard shows per-model sparkline with token breakdown
* **Chat channel onboarding** — connect Telegram, Discord, and WhatsApp as inbound bot channels; setup wizard with step-by-step credential entry; WhatsApp pairing code flow; credential masking in all API responses
* **File & Computer Access (Access Profiles)** — 9 file operation tools (read, write, edit, move, copy, delete, make_directory, list_directory, stat_path); three access profiles per agent: `safe` (workspace only), `standard` (workspace + non-system paths, shell with confirmation), `full_access` (unrestricted); audit log at `~/.krythor/file-audit.log`
* **Outbound channels** — webhook notifications on lifecycle events (agent runs, memory, providers); HMAC-SHA256 signed; compatible with Zapier, n8n, Discord/Slack incoming webhooks
* **LAN discovery** — gateways on the same network find each other automatically via UDP multicast; manual peer registration for cross-network pairing
* **Gateway identity** — stable UUID per installation; capability manifest at `GET /api/gateway/info`
* **Command Center** — live animated operations view with a Cybernetic Brain Planet, mythic-tech agent entities (Atlas, Voltaris, Aethon, Thyros, Pyron), resizable panels, and real-time event-driven animation
* **Customizable tab bar** — pin/unpin any of the 16 tabs into the top bar; persisted to localStorage; `+ Tabs` dropdown to manage all panels
* **Resizable sidebars** — every panel with a sidebar has a draggable resize handle; widths persist across sessions
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
* **Auto-versioning** — build version is derived from git commit count and shown in the status bar; increments automatically on every push without manual version bumps
* **Config hot reload** — `providers.json` watched with `fs.watch()`; `POST /api/config/reload` for manual trigger
* **Config export/import** — portable provider config with secrets redacted
* **Config editor** — edit raw JSON config files directly in the UI with syntax validation and Ctrl+S to save
* **Daemon mode** — `krythor start --daemon`, `krythor stop`, `krythor restart`; `krythor service install` registers auto-start at login
* **Gateway sub-commands** — `krythor gateway status/stop/restart` as aliases for the common gateway operations
* **Reconfigure shortcut** — `krythor configure` re-runs the setup wizard; `krythor dashboard` opens the Control UI in a browser
* **Non-interactive setup** — `krythor setup --non-interactive` (or `KRYTHOR_NON_INTERACTIVE=1`) skips all prompts for automated installs; `--install-service` chains service registration
* **QuickStart vs Advanced setup** — wizard starts with a mode selector: QuickStart configures a provider and starts immediately; Advanced gives full control over gateway, channels, and web search
* **Section-specific reconfiguration** — `krythor setup --section provider|gateway|channels|web-search` reconfigures only one section without re-running the full wizard; `--reset` bypasses the overwrite prompt
* **Agent CLI** — `krythor agents add [name]` creates an agent from the terminal (live via API if gateway is running, or writes to agents.json directly); `krythor agents list` shows all agents
* **Tool security guidance** — setup surfaces a note during onboarding reminding users to use capable models when agents will run tools, reducing prompt injection risk
* **Backup command** — `krythor backup` creates a timestamped archive of the data directory
* **Doctor + Repair** — comprehensive diagnostics with migration integrity check and credential validation
* **Local-first** — all data stays on your machine

---

## 🎛️ Command Center

The **Command Center** tab is a live animated scene that shows what your AI agents are doing right now.

### Cybernetic Brain Planet

The centerpiece of the Command Center viewscreen is a **Cybernetic Brain Planet** — a fully animated canvas-rendered sphere that visualizes the gateway's processing activity:

- **Rotating latitude bands** — multiple elliptical rings rotate at different speeds, clipped to the sphere, giving the impression of a scanning or processing globe
- **Meridian arcs** — longitude lines rotate in the opposite direction, creating a cross-hatched neural grid
- **Circuit nodes** — pulsing dot nodes placed along the sphere surface, connected to the grid lines, representing active computation points
- **Data pulse runners** — bright particles that race along the meridian lines, simulating data traveling through the brain
- **Orbiting ring** — a tilted elliptical ring orbits the sphere, echoing a planet's equatorial band
- **Radial shockwave pulses** — periodic expanding rings emanate from the sphere center, representing broadcast events
- All elements glow in Krythor's signature cyan/teal palette (`#1eaeff`) against a deep space background

### Agent Entities

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

### Scene Features

- **Energy paths** — animated dashed lines from Crown Platform to every active zone
- **Ambient reactor** — a central orb that grows and shifts color as more agents become active
- **Zone glow scaling** — zone platforms intensify their glow proportional to agent activity
- **Focus mode** — click any agent to dim everything else and center attention
- **Resizable panels** — drag the divider between the left info panel and the scene, and between the scene and the command log, to customize the layout
- **Command log** — filterable live event log (all / tasks / tools / memory / errors) with pause toggle and auto-scroll
- **Demo mode** — when no gateway events arrive for 8 seconds, the scene runs a cycling demo scenario automatically; it seamlessly switches back to live data when the gateway reconnects

---

## 🛡️ Safety Modes

The **Guard** tab provides three visually distinct safety modes, each displayed as a color-coded card explaining exactly what it does:

| Mode | Color | Default Action | Rules |
|------|-------|---------------|-------|
| **🔒 Guarded** | Red | DENY | All custom rules enabled — anything not explicitly allowed is blocked |
| **⚖️ Balanced** | Amber | ALLOW | Warn rules active, deny rules off — flags risky requests without blocking |
| **⚡ Power User** | Blue | ALLOW | All custom rules disabled — unrestricted access, full control |

The active mode is highlighted with a colored ring and an "active" badge. Switching modes immediately applies the correct default action and rule state to the gateway.

### Guardrails Stack

Beyond the Guard tab, Krythor includes a full Guardrails Stack:

* **Policy files** — YAML or JSON policy files loaded at startup; supports `allow`, `deny`, `warn`, and `require-approval` actions per operation type
* **Tool interception** — guard checks fire before every web_search, web_fetch, and webhook call in AgentRunner
* **Approval flow** — `require-approval` actions pause execution and show a modal in the Control UI; auto-deny after 30 seconds prevents deadlock
* **Privacy routing** — `PrivacyRouter` classifies content sensitivity (public/internal/private/restricted) and reroutes to a local model (Ollama, GGUF) when content should not leave the machine
* **Audit log** — append-only NDJSON log at `<dataDir>/logs/audit.ndjson`; visible in the Audit Log tab; queryable via `krythor audit tail`
* **Sandbox abstraction** — `SandboxProvider` interface for future Docker/Firecracker isolation; `LocalSandboxProvider` available today
* **CLI tools** — `krythor policy check`, `krythor policy doctor`, `krythor audit tail`, `krythor audit explain`, `krythor config init-guardrails`

See [docs/guardrails.md](./docs/guardrails.md) for full documentation.

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
| `Ctrl+S` | Save in Config Editor |

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

**Skip setup wizard** (CI / automation):

```bash
# Mac / Linux
curl -fsSL https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.sh | bash -s -- --no-onboard

# Windows
iwr https://raw.githubusercontent.com/LuxaGrid/Krythor/main/install.ps1 | iex -NoOnboard

# Or via env var (both platforms)
KRYTHOR_NON_INTERACTIVE=1 curl -fsSL ... | bash
```

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

The Docker image includes a built-in `HEALTHCHECK` that probes the `/healthz` liveness endpoint every 30 seconds. Three additional probe endpoints are available:

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /healthz` | None | Liveness probe — fast, always 200 while process is alive |
| `GET /liveness` | None | Alias for `/healthz` |
| `GET /ready` or `/readyz` | None | Readiness — returns 503 until DB + guard are initialised |
| `GET /health` | None | Full health snapshot (version, models, agents, memory, etc.) |

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
| `krythor status [--deep] [--json]` | Show gateway health. `--deep` also probes `/api/models`, `/api/channels`, `/api/agents`. `--json` for scripting. |
| `krythor gateway status` | Alias for `krythor status` |
| `krythor gateway stop` | Alias for `krythor stop` |
| `krythor gateway restart` | Alias for `krythor restart` |
| `krythor dashboard` | Open the Control UI in the browser |
| `krythor update` | Download and install the latest release (preserves all data) |
| `krythor tui` | Open the terminal dashboard (live status without a browser) |

### Setup and configuration

| Command | Description |
|---------|-------------|
| `krythor setup` | Run the interactive setup wizard (QuickStart or Advanced mode) |
| `krythor setup --non-interactive` | Run setup non-interactively (uses defaults / env vars) |
| `krythor setup --install-service` | Run setup, then register Krythor to start at login |
| `krythor setup --section provider` | Reconfigure only the AI provider / API key |
| `krythor setup --section gateway` | Reconfigure only gateway port / bind / auth |
| `krythor setup --section channels` | Reconfigure only chat channels |
| `krythor setup --section web-search` | Reconfigure only web search provider |
| `krythor setup --reset` | Force reconfiguration without the "overwrite?" prompt |
| `krythor configure` | Reconfigure Krythor — alias for `krythor setup` |
| `krythor configure --section provider` | Quick provider reconfiguration |
| `krythor service install` | Register Krythor to auto-start at login (without re-running setup) |
| `krythor service uninstall` | Remove the auto-start registration |

### Agent management

| Command | Description |
|---------|-------------|
| `krythor agents add [name]` | Create a new agent (uses gateway API if running, else writes to agents.json) |
| `krythor agents list` | List all configured agents with IDs and models |

### Diagnostics and maintenance

| Command | Description |
|---------|-------------|
| `krythor doctor` | Run all diagnostics — prints pass/fail for runtime, DB, migrations, credentials |
| `krythor repair` | Auto-fix issues found by doctor (re-compiles native modules, reruns migrations) |
| `krythor backup` | Create a timestamped `.tar.gz` / `.zip` archive of the data directory |

### Guardrails commands

| Command | Description |
|---------|-------------|
| `krythor policy check` | Validate the active guardrails policy file |
| `krythor policy doctor` | Deep policy health diagnostics (directory, rules, strict mode) |
| `krythor audit tail [--limit N] [--outcome X] [--agent X] [--json]` | Print recent audit log entries |
| `krythor audit explain <event-id>` | Print full detail for one audit event |
| `krythor config init-guardrails [--yes]` | Scaffold a default policy YAML file |

See [docs/guardrails.md](./docs/guardrails.md) for full documentation.

### Source / development commands

Run these from the repository root with pnpm installed (`npm install -g pnpm`).

| Command | Description |
|---------|-------------|
| `pnpm install` | Install all workspace dependencies |
| `pnpm build` | Build all packages (gateway + control UI + all libraries) and auto-bump version |
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
- [docs/channels.md](./docs/channels.md) — Chat channel setup (Telegram, Discord, WhatsApp)
- [docs/permissions.md](./docs/permissions.md) — Agent access profiles, file tools, and audit log

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

**Quick add** (for popular cloud providers)
1. Click the **Quick add** button in the Models tab header
2. Choose from Groq, OpenRouter, Google Gemini, Venice, Kimi, or Mistral
3. Click the provider's dashboard link to get your API key
4. Paste the key and click Connect

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
- Click **+ Tabs** in the top bar to pin or unpin panels

---

### Step 7 — Explore the features

The dashboard has a customizable tab bar — click **+ Tabs** to pin or unpin any panel. Available panels:

| Tab | What it does |
|-----|-------------|
| **Command** | Send messages and get AI responses; archive/restore conversations; slash commands |
| **Memory** | View and manage what Krythor remembers across sessions |
| **Models** | Add, test, and configure AI providers; quick-add presets for popular services |
| **Agents** | Create custom AI assistants with their own instructions |
| **Guard** | Set safety mode (Guarded / Balanced / Power User); define allow/deny/warn rules |
| **Skills** | Reusable task templates with routing profiles |
| **Dashboard** | Token usage sparklines, heartbeat last-run, circuit breaker status |
| **Logs** | Live log stream with filter, search, pause, copy, and expandable JSON rows |
| **Events** | Real-time event stream with icons, timestamps, type coloring, and filter |
| **Workflow** | View agent run history and stop active runs |
| **Channels** | Configure outbound webhook notifications |
| **Chat Channels** | Connect Telegram, Discord, or WhatsApp as inbound bot channels |
| **Custom Tools** | Define webhook tools; test-fire each one from the UI |
| **Config Editor** | Edit raw configuration files with JSON validation |
| **Command Center** | Live animated scene with Cybernetic Brain Planet, agent entities, and command log |

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

## 🔗 Connecting Providers — Detailed Guide

The **Models** tab is where you connect AI providers. Krythor supports local models (free, no internet) and cloud models (pay-per-use, require API keys).

---

### Understanding the Fields

When adding a provider manually (via **+ custom**), you'll see these fields:

| Field | What it means |
|-------|---------------|
| **Name** | A label you give this provider — e.g. "My OpenAI" or "Ollama Local" |
| **Type** | The protocol: `ollama`, `openai`, `anthropic`, `openai-compat`, or `gguf` |
| **Endpoint URL** | The base URL of the API. Pre-filled for known types; leave as-is unless you use a custom host |
| **Authentication** | How to authenticate: **No auth** (local), **API Key**, or **OAuth** |
| **API Key** | Your secret key from the provider's dashboard — only shown when API Key auth is selected |
| **Set as default** | Makes this provider the first choice for all requests |

---

### Local Providers (Free, No API Key)

#### Ollama

Ollama runs open-source models (Llama, Mistral, Gemma, etc.) entirely on your machine. Nothing is sent to the internet.

1. Download and install Ollama from **https://ollama.com**
2. Pull a model — open a terminal and run:
   ```bash
   ollama pull llama3.2        # ~2GB, good general model
   ollama pull mistral         # ~4GB, strong reasoning
   ollama pull phi4            # ~2GB, fast and compact
   ```
3. In Krythor, go to **Models → + custom**
4. Set **Name** to anything (e.g. `Ollama Local`)
5. Set **Type** to `ollama`
6. **Endpoint** auto-fills to `http://localhost:11434` — leave it unless Ollama is on a different port
7. **Authentication** → `No auth (local)`
8. Click **Add**
9. Click **refresh** next to the provider to load your available models
10. Click **ping** to verify the connection

#### LM Studio

LM Studio provides a local OpenAI-compatible API for GGUF models.

1. Download LM Studio from **https://lmstudio.ai**
2. Load a model in LM Studio and start the local server (Server tab → Start Server)
3. In Krythor, go to **Models → + custom**
4. Set **Type** to `openai-compat`
5. Set **Endpoint** to `http://localhost:1234/v1` (LM Studio's default)
6. **Authentication** → `No auth (local)`
7. Click **Add**, then **refresh** to load models

#### llama-server (GGUF files)

For running a single GGUF model file directly via llama.cpp:

1. Install llama.cpp and start llama-server:
   ```bash
   llama-server --model your-model.gguf --port 8080
   ```
2. In Krythor, go to **Models → + custom**
3. Set **Type** to `gguf`
4. Set **Endpoint** to `http://localhost:8080`
5. **Authentication** → `No auth (local)`
6. Click **Add**

---

### Cloud Providers (Require API Key)

All cloud providers follow the same pattern: **get an API key from their dashboard → paste it into Krythor**.

> **Where are keys stored?** Encrypted in your OS user profile — never in the cloud, never logged.

---

#### OpenAI (GPT-4o, o1, GPT-4 Turbo)

1. Go to **https://platform.openai.com/api-keys**
2. Click **Create new secret key** — copy it (you won't see it again)
3. In Krythor: **Models → + custom**
   - **Type:** `openai`
   - **Endpoint:** auto-fills to `https://api.openai.com/v1`
   - **Authentication:** `API Key`
   - **API Key:** paste your key (starts with `sk-`)
4. Click **Add** → then **test** to verify

Or use **Quick add → OpenAI** if available in your build.

---

#### Anthropic (Claude Sonnet, Claude Opus, Claude Haiku)

1. Go to **https://console.anthropic.com/settings/keys**
2. Click **Create Key** — copy it
3. In Krythor: **Models → + custom**
   - **Type:** `anthropic`
   - **Endpoint:** auto-fills to `https://api.anthropic.com`
   - **Authentication:** `API Key`
   - **API Key:** paste your key (starts with `sk-ant-`)
4. Click **Add** → then **test** to verify

---

#### Groq (fastest Llama / Mixtral inference)

1. Go to **https://console.groq.com/keys**
2. Click **Create API Key** — copy it (starts with `gsk_`)
3. In Krythor: **Models → Quick add → Groq**
4. Click **Open Groq Console ↗** to get your key if you haven't already
5. Paste the key → click **Connect**

Available models: `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768`, `gemma2-9b-it`

Or manually: **Type** `openai-compat`, **Endpoint** `https://api.groq.com/openai/v1`, **API Key** your Groq key.

---

#### OpenRouter (100+ models — one key for GPT, Claude, Gemini, Llama)

1. Go to **https://openrouter.ai/keys**
2. Click **Create Key** — copy it (starts with `sk-or-`)
3. In Krythor: **Models → Quick add → OpenRouter**
4. Paste the key → click **Connect**

Available models include: `openai/gpt-4o`, `anthropic/claude-sonnet-4-5`, `google/gemini-2.5-pro`, `meta-llama/llama-3.3-70b-instruct`, `mistralai/mixtral-8x7b-instruct`

Or manually: **Type** `openai-compat`, **Endpoint** `https://openrouter.ai/api/v1`, **API Key** your OpenRouter key.

---

#### Google Gemini (Gemini 2.5 Pro, Flash)

1. Go to **https://aistudio.google.com/app/apikey**
2. Click **Create API key** — copy it (starts with `AIza`)
3. In Krythor: **Models → Quick add → Google Gemini**
4. Paste the key → click **Connect**

Available models: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`

Or manually: **Type** `openai-compat`, **Endpoint** `https://generativelanguage.googleapis.com/v1beta/openai`, **API Key** your Gemini key.

---

#### Venice (privacy-first, no logs)

1. Go to **https://venice.ai/settings/api**
2. Generate an API key — copy it
3. In Krythor: **Models → Quick add → Venice**
4. Paste the key → click **Connect**

Available models: `llama-3.3-70b`, `llama-3.1-405b`, `mistral-31-24b`, `deepseek-r1-671b`

Or manually: **Type** `openai-compat`, **Endpoint** `https://api.venice.ai/api/v1`, **API Key** your Venice key.

---

#### Kimi / Moonshot (128K context, long documents)

1. Go to **https://platform.moonshot.cn/console/api-keys**
2. Create a key — copy it
3. In Krythor: **Models → Quick add → Kimi (Moonshot)**
4. Paste the key → click **Connect**

Available models: `moonshot-v1-128k`, `moonshot-v1-32k`, `moonshot-v1-8k`

Or manually: **Type** `openai-compat`, **Endpoint** `https://api.moonshot.cn/v1`, **API Key** your Moonshot key.

---

#### Mistral (Mistral Large, Codestral)

1. Go to **https://console.mistral.ai/api-keys**
2. Create a key — copy it
3. In Krythor: **Models → Quick add → Mistral**
4. Paste the key → click **Connect**

Available models: `mistral-large-latest`, `mistral-small-latest`, `codestral-latest`, `open-mistral-nemo`

Or manually: **Type** `openai-compat`, **Endpoint** `https://api.mistral.ai/v1`, **API Key** your Mistral key.

---

#### Any OpenAI-compatible API

For Together AI, Fireworks, Perplexity, Anyscale, or any other API that speaks the OpenAI chat completions format:

1. In Krythor: **Models → + custom**
2. Set **Type** to `openai-compat`
3. Set **Endpoint** to the provider's base URL (ending in `/v1`)
4. Set **Authentication** to `API Key` and paste your key
5. Click **Add** → then **refresh** to list models, or **test** to run a probe

---

### After Adding a Provider

Once a provider is added, you'll see action buttons next to it:

| Button | What it does |
|--------|-------------|
| **ping** | Sends a connectivity check to the endpoint — shows latency or error |
| **test** | Sends a minimal inference request to verify the model actually responds |
| **refresh** | Fetches the live list of available models from the provider |
| **default** | Makes this provider the first-choice for all requests |
| **disable / enable** | Temporarily excludes this provider from routing without deleting it |
| **⚙** | Opens advanced settings: **Priority** (lower number = tried first) and **Max retries** |
| **✕** | Deletes the provider permanently |

**Tips:**
- Run **ping** first to check the endpoint is reachable
- Run **test** to confirm your API key works and the model responds
- Use **Priority** in ⚙ to control which provider Krythor prefers when multiple are available — e.g. set your local Ollama to priority `1` and cloud providers to `10` so local is always tried first
- **Disable** a provider to take it offline temporarily (e.g. if you're out of credits) without losing its configuration

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
| Google Gemini | Cloud | Pay per use | API key |
| Venice | Cloud | Pay per use | API key |
| Kimi (Moonshot) | Cloud | Pay per use | API key |
| Mistral | Cloud | Pay per use | API key |
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
| GET | `/api/chat-channels/` | Required | List all configured inbound chat channels |
| POST | `/api/chat-channels/` | Required | Create a new inbound chat channel |
| GET | `/api/chat-channels/:id` | Required | Get a channel (credentials masked) |
| PUT | `/api/chat-channels/:id` | Required | Update a channel's configuration |
| DELETE | `/api/chat-channels/:id` | Required | Remove a channel |
| POST | `/api/chat-channels/:id/connect` | Required | Trigger a (re)connection attempt |
| POST | `/api/chat-channels/:id/disconnect` | Required | Disconnect a channel without deleting it |
| GET | `/api/chat-channels/:id/status` | Required | Get the current connection status |
| POST | `/api/chat-channels/:id/pairing-code` | Required | Request a new WhatsApp pairing code |
| GET | `/api/tools/files/` | Required | List available file operation tools |
| POST | `/api/tools/files/:tool` | Required | Invoke a file tool (read_file, write_file, etc.) |
| GET | `/api/tools/files/audit` | Required | Query the file operation audit log |
| GET | `/api/agents/:id/access-profile` | Required | Get an agent's current access profile |
| PUT | `/api/agents/:id/access-profile` | Required | Set an agent's access profile (safe / standard / full_access) |
| GET | `/api/gateway/info` | Required | Gateway identity and capability manifest |
| GET | `/api/gateway/peers` | Required | List known remote gateway peers |
| POST | `/api/gateway/peers` | Required | Register a remote gateway peer |
| DELETE | `/api/gateway/peers/:id` | Required | Remove a registered peer |
| GET | `/api/gateway/probe` | Required | Probe connectivity to known peers |
| WS | `/ws/stream` | Required | Real-time event stream (used by Command Center and Event Stream panel) |

---

## 💬 Chat Channels

Krythor can act as an inbound bot on Telegram, Discord, and WhatsApp. Messages sent to your bot are routed to a Krythor agent, and the agent's response is delivered back to the user on the same platform.

### Supported Channels

| Channel | Install | Credentials Needed | Pairing |
|---------|---------|-------------------|---------|
| Telegram | Built-in | Bot Token (from @BotFather) | No |
| Discord | Built-in | Bot Token + Application ID | No |
| WhatsApp | npm install (on-demand) | Phone / account credentials | Yes (pairing code) |

### How to add a channel

Go to **Settings → Chat Channels** tab and click **+ Add Channel**. Select your platform and follow the guided setup steps.

### Channel status meanings

| Status | Meaning |
|--------|---------|
| `not_installed` | Required package not yet installed (WhatsApp only) |
| `installed` | Package installed; no credentials entered yet |
| `credentials_missing` | Configuration incomplete — required fields are empty |
| `awaiting_pairing` | Waiting for the WhatsApp pairing code to be confirmed on the device |
| `connected` | Active and receiving messages |
| `error` | Runtime error — check the Logs panel for details |

See [docs/channels.md](./docs/channels.md) for the full per-platform setup guide, pairing code flow, and API reference.

---

## 🗂️ Agent Access Profiles

Each agent has an **access profile** that controls what files and system resources it can touch. The profile is enforced by the gateway before any file operation executes.

| Profile | File Access | Shell Access | Default |
|---------|-------------|--------------|---------|
| `safe` | Workspace directory only | No | Yes |
| `standard` | Workspace + non-system paths | With confirmation hooks | |
| `full_access` | Unrestricted local filesystem | Yes | |

- **safe** — new agents start here. Paths are resolved and checked to stay inside the workspace root.
- **standard** — workspace plus any non-system path. System directories (e.g., `/etc`, `C:\Windows\System32`) are blocklisted. Shell execution is available with confirmation hooks.
- **full_access** — no restrictions. Displayed as a red badge with a warning indicator in the Agents panel.

**To change an agent's profile:** click the access profile badge on the agent card in the Agents panel.

**Audit log:** every file operation (allowed or denied) is recorded at `~/.krythor/file-audit.log` and queryable via `GET /api/tools/files/audit`.

**Available file tools:** `read_file`, `write_file`, `edit_file`, `move_file`, `copy_file`, `delete_file`, `make_directory`, `list_directory`, `stat_path`

See [docs/permissions.md](./docs/permissions.md) for the full reference including path enforcement details, audit log format, and security recommendations.

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
    src/components/
      command-center/
        agents/     — AgentBody, AgentEntity, AgentLayer, AgentRings, AgentGlyph, AgentTooltip, TaskBubble
        scene/      — CommandScene, SceneGrid, SceneZone, EnergyPaths, AmbientReactor, HandoffArc, MythicCanvas
        panels/     — LeftPanel, BottomPanel, CommandLog
        agents.ts   — DEFAULT_AGENTS, SCENE_ZONES, ZONE_MAP, createAgent()
        types.ts    — all Command Center types
        events.ts   — AGENT_STATE_TRANSITIONS, makeEvent()
        eventAdapter.ts  — gateway → CCEvent adapter
        demoAdapter.ts   — 12-step cycling demo scenario
        useCommandCenter.ts — master hook
      hooks/
        useSidebarResize.ts — shared drag-resize hook with localStorage persistence
      SidebarResizeHandle.tsx — shared drag handle component (cyan highlight, col-resize cursor)
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
pnpm build      # build all packages + auto-bump version from git commit count
pnpm doctor     # run diagnostics
```

The control UI auto-reloads on save during `pnpm dev`. The Command Center connects to the gateway WebSocket at `ws://localhost:47200/ws/stream` and falls back to demo mode after 8 seconds of silence.

Version is derived from `git rev-list --count HEAD` at build time — every push automatically produces a higher patch version with no manual bumping needed. The version is visible in the status bar and served by the gateway health endpoint.

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
* [x] Quick-add provider presets (Groq, OpenRouter, Gemini, Venice, Kimi, Mistral)
* [x] Guard engine (policy-based allow/deny per operation) with live test mode
* [x] Three distinct safety modes — Guarded (red), Balanced (amber), Power User (blue) with color-coded cards
* [x] Tool system (exec, web_search, web_fetch) with webhook custom tools and test-fire
* [x] Terminal dashboard (krythor tui)
* [x] Auto-update check on startup
* [x] Auto-versioning from git commit count — version always reflects latest push
* [x] Outbound webhook channels (10 event types, HMAC signing, delivery stats)
* [x] LAN peer discovery (mDNS UDP multicast) + manual peer registry
* [x] Command Center — live animated agent scene with Cybernetic Brain Planet, distinct agent silhouettes, state machine, zone transitions, energy paths, ambient reactor, focus mode, resizable panels, and command log
* [x] Customizable tab bar — pin/unpin any of 16 panels; persisted to localStorage
* [x] Resizable sidebars on all panels — drag handles persist widths across sessions
* [x] Ctrl+K global command palette with fuzzy search
* [x] Slash commands in chat input (/new, /clear, /memory, /agents, /models, /skills, /guard, /dash, /logs, /settings)
* [x] Provider advanced settings panel (priority, maxRetries, enable/disable per provider)
* [x] Dashboard heartbeat last-run info and circuit breaker summary
* [x] LogsPanel copy to clipboard and expandable raw JSON per entry
* [x] EventStream filter, timestamps, icons, and payload detail extraction
* [x] Model override feedback wired into learning system (reportOverride)
* [x] Chat channel onboarding — Telegram, Discord, WhatsApp inbound bots with guided setup wizard
* [x] File & Computer Access — 9 file operation tools with safe/standard/full_access profiles per agent and full audit log
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
