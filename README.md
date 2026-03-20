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

Most AI tools hide what's happening.

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
* **Dual-auth support** — connect cloud providers with an API key or via OAuth in the app — your choice
* **Persistent memory** — semantic + keyword retrieval across sessions
* **Agent system** — custom prompts, memory scope, and model preferences
* **Skills** — reusable task templates with structured routing hints
* **Guard engine** — policy-based allow/deny control
* **Transparent execution** — see exactly which model ran, why, and fallback behavior
* **Heartbeat monitoring** — background provider health tracking
* **Local-first** — all data stays on your machine

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

Krythor requires **Node.js version 20 or higher**.

Download it free at **https://nodejs.org** — choose the "LTS" version.

> **Not sure if you have Node.js?**
> Open a terminal and type `node --version`. If you see a number like `v20.x.x` or higher, you're good. If not, visit nodejs.org and install it first.

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
- Install to `~/.krythor` (Mac/Linux) or `%USERPROFILE%\.krythor` (Windows)
- Add the `krythor` command to your terminal
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
| `krythor-linux-arm64.zip` | Linux ARM64 |
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

---

## 📖 Getting Started — Step by Step Guide

*This section is written for people who have never used a tool like this before. Technical users can skip ahead.*

---

### Step 1 — Install Node.js (if you haven't already)

Krythor is built on Node.js, a free runtime that lets software like Krythor run on your computer.

1. Go to **https://nodejs.org**
2. Click the big green **"Download LTS"** button
3. Run the installer — just click Next through all the steps
4. When it's done, close and reopen any terminal windows you have open

**How to check it worked:** Open a terminal (search for "Terminal" on Mac/Linux, or "PowerShell" on Windows) and type:
```
node --version
```
You should see something like `v20.11.0`. Any number starting with 20 or higher is fine.

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
Krythor gateway running at http://localhost:47200
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

**OAuth / in-app sign-in** (sign in with your browser — no key to copy-paste)
1. In the Krythor dashboard, go to the **Models** tab
2. Click **+ add provider**, choose **openai** or **anthropic**
3. Select **Connect with OAuth** and follow the browser prompts

> If you chose "Connect with OAuth later" during setup, you'll see a reminder banner in the Models tab — just click **Connect OAuth** to finish.

> **Your credentials are stored encrypted on your computer.** They are never sent anywhere except directly to the AI provider when you make a request.

---

### Step 6 — Send your first command

Click the **Command** tab in the dashboard. Type anything in the input box and press Enter (or click Send).

Krythor will:
1. Route your request to the best available model
2. Show you the response
3. Display which model was used and why (at the bottom of the response)

---

### Step 7 — Explore the features

The dashboard has several tabs:

| Tab | What it does |
|-----|-------------|
| **Command** | Send messages and get responses from AI |
| **Memory** | View and manage what Krythor remembers across sessions |
| **Models** | Add, test, and configure AI providers |
| **Agents** | Create custom AI assistants with their own instructions |
| **Guard** | Set rules for what Krythor is and isn't allowed to do |
| **Skills** | Reusable task templates |

---

### Stopping Krythor

Press **Ctrl + C** in the terminal where Krythor is running. The dashboard will become unavailable until you start it again.

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

**"Node.js is not installed"**
Go to https://nodejs.org, download and install the LTS version, then open a new terminal and try again.

**The dashboard won't load at http://localhost:47200**
Make sure Krythor is running — you should see activity in the terminal. If Krythor crashed, re-run `krythor`.

**"No AI provider configured"**
You need to add at least one AI provider in the Models tab before Krythor can respond to commands. See Step 5 above.

**Windows SmartScreen warning on the .exe installer**
This is expected — the installer is currently unsigned. Click "More info" then "Run anyway". Or use the PowerShell one-liner instead, which doesn't trigger this warning.

---

## 🧠 Supported Providers

| Provider | Type | Cost | Auth |
|----------|------|------|------|
| Ollama | Local | Free | None required |
| LM Studio | Local | Free | None required |
| llama-server (GGUF) | Local | Free | None required |
| OpenAI (GPT-4o, o1, etc.) | Cloud | Pay per use | API key or OAuth |
| Anthropic (Claude) | Cloud | Pay per use | API key or OAuth |
| Any OpenAI-compatible API | Cloud/Local | Varies | Optional API key |

Krythor auto-detects Ollama and LM Studio on first launch.

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
build-exe.js  — Windows SEA executable builder
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

All user data is stored locally, outside the application folder:

* **Windows:** `%LOCALAPPDATA%\Krythor\`
* **macOS:** `~/Library/Application Support/Krythor/`
* **Linux:** `~/.local/share/krythor/`

To uninstall: remove the application folder (`~/.krythor`) and the data folder above.

---

## 🗺️ Roadmap

* [x] Local-first runtime
* [x] Multi-provider model routing with automatic fallback
* [x] Persistent memory system
* [x] Agent system
* [x] Production hardening (crash recovery, structured logging, circuit breaker)
* [x] Cross-platform distribution (Windows, macOS, Linux)
* [x] Windows installer (Inno Setup)
* [x] Transparent execution (selectionReason, fallbackOccurred in all run paths)
* [x] One-line curl/PowerShell installers
* [x] Dual-auth system (API key + OAuth) for cloud providers
* [ ] Code signing (OV certificate — eliminates SmartScreen warning)
* [ ] Auto-updater UI
* [ ] macOS / Linux native installers
* [ ] Expanded observability

---

## 📜 License

MIT — see [LICENSE](LICENSE)

---

Built by Luxa Grid LLC
