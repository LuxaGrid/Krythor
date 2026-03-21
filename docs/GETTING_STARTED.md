# Getting Started with Krythor

Krythor is a local-first AI command platform. This guide walks you through
installation to your first AI interaction in five steps.

---

## Prerequisites

- **Node.js 20 or higher** — download at https://nodejs.org (choose LTS)
- An API key from a supported AI provider, OR Ollama installed locally (free)

---

## Step 1 — Install

### One-line installer (recommended)

**macOS / Linux / WSL2:**
```sh
curl -fsSL https://raw.githubusercontent.com/your-org/krythor/main/install.sh | bash
```

**Windows PowerShell:**
```powershell
iwr -useb https://raw.githubusercontent.com/your-org/krythor/main/install.ps1 | iex
```

The installer downloads Krythor with a bundled Node.js runtime — no system
Node.js required for the installer itself.

### From source (developers)
```sh
git clone https://github.com/your-org/krythor
cd krythor
pnpm install
pnpm build
```

---

## Step 2 — Run the Setup Wizard

```sh
krythor setup
# or from source:
pnpm setup
```

The wizard will:
1. Scan your system for Node.js version and Ollama
2. Ask which AI provider you want to configure
3. Ask for your API key (or let you skip to connect OAuth later)
4. Let you pick a default model
5. Offer to launch the gateway immediately

**Provider options:**
- **Anthropic** (Claude) — best overall for reasoning and code
- **OpenAI** (GPT-4) — broad model selection
- **Kimi** — best for long context windows
- **MiniMax** — best value
- **Ollama** — free, fully local, no API key needed
- **OpenAI-compatible** — LM Studio, Together.ai, and any other compatible API

**If you skip the provider during setup:**
The gateway will start but cannot run AI tasks. You can add a provider later
in the Models tab of the Control UI.

---

## Step 3 — Verify the Gateway

```sh
krythor status
# or check the health endpoint:
curl http://127.0.0.1:47200/health
```

A healthy response looks like:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "models": { "providerCount": 1, "modelCount": 5 },
  ...
}
```

---

## Step 4 — Open the Control UI

Open your browser to:
```
http://127.0.0.1:47200
```

The Control UI is Krythor's primary interface. From here you can:
- Chat with your AI agent
- Manage providers and models (Models tab)
- View conversation history
- Monitor agent runs and heartbeat status
- Configure agents and guard policies

---

## Step 5 — Your First Command

In the Control UI, type a message in the input box and press Enter.

**Try these:**
- `What can you do?`
- `Summarize this text: [paste something]`
- `Write a Python function that reverses a string`

---

## Next Steps

### Add more providers
Go to the **Models tab** → click **Add Provider** → paste your API key.
Multiple providers enable automatic failover and model selection.

### Explore memory
Krythor remembers things across sessions. Ask:
- `Remember that I prefer TypeScript over JavaScript`
- `What do you remember about my preferences?`

### Run diagnostics
```sh
krythor doctor    # full diagnostic report
krythor repair    # check bundled runtime health
```

### Check your data
Your data is stored at:
- **Windows:** `%LOCALAPPDATA%\Krythor\`
- **macOS:** `~/Library/Application Support/Krythor/`
- **Linux:** `~/.local/share/krythor/`

See [CONFIG_REFERENCE.md](./CONFIG_REFERENCE.md) for full configuration details.

---

## Common Issues

| Problem | Fix |
|---|---|
| `Gateway did not start within 10 seconds` | Run `krythor doctor` to see the error |
| `No providers configured` | Run `krythor setup` to add a provider |
| `Port 47200 is in use` | Another process is using the port — check with `krythor status` |
| `Node.js version too old` | Download Node.js 20 LTS from https://nodejs.org |
| `API key rejected` | Check the key in your provider's console; re-enter in Models tab |

---

## Quick Reference

```sh
krythor            # start the gateway + open browser
krythor setup      # run the setup wizard
krythor doctor     # run diagnostics
krythor status     # quick health check (requires running gateway)
krythor repair     # check bundled runtime
krythor stop       # (coming soon) stop the gateway
```
