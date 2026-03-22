# Krythor Environment Variable Reference

All environment variables that Krythor reads, with description, default, and example.

---

See also: [`docs/examples/.env.example`](./examples/.env.example) — copy-paste template for all variables.

---

## Data and config location

| Variable | Description | Default | Example |
|---|---|---|---|
| `KRYTHOR_DATA_DIR` | Override the data directory for all Krythor data (memory, config, logs, backups). Affects gateway, setup wizard, doctor, and start.js. | Platform default (see below) | `KRYTHOR_DATA_DIR=/mnt/data/krythor` |

**Platform defaults for `KRYTHOR_DATA_DIR`:**

| Platform | Default path |
|---|---|
| Windows | `%LOCALAPPDATA%\Krythor\` |
| macOS | `~/Library/Application Support/Krythor/` |
| Linux | `~/.local/share/krythor/` |

---

## Gateway network and security

| Variable | Description | Default | Example |
|---|---|---|---|
| `CORS_ORIGINS` | Comma-separated list of additional allowed CORS origins beyond the loopback defaults. Useful when accessing the API from a local dev tool on a different port. | (none — loopback only) | `CORS_ORIGINS=http://my-tool.local:3000,http://192.168.1.10:47200` |

---

## Authentication

| Variable | Description | Default | Example |
|---|---|---|---|
| *(none currently)* | Auth token is loaded from `<configDir>/app-config.json`, not from an env var. Use `KRYTHOR_DATA_DIR` to point to a different config location. | — | — |

---

## Provider credentials (via substitution in providers.json)

Krythor supports `${ENV_VAR_NAME}` substitution in `providers.json` string fields. This allows keeping API keys in environment variables rather than plaintext config files.

**Example providers.json:**
```json
[
  {
    "id": "my-anthropic",
    "name": "Anthropic",
    "type": "anthropic",
    "apiKey": "${ANTHROPIC_API_KEY}",
    "models": ["claude-opus-4-5"],
    "isEnabled": true,
    "authMethod": "api_key"
  }
]
```

**Supported variables (user-defined):**

| Variable | Common use | Example |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key in providers.json | `sk-ant-api03-...` |
| `OPENAI_API_KEY` | OpenAI API key in providers.json | `sk-...` |
| `OPENROUTER_API_KEY` | OpenRouter API key | `sk-or-...` |
| Any name | Any string field in a provider config | `${MY_CUSTOM_KEY}` |

If a variable is not set, Krythor logs a warning and leaves the placeholder in place.

---

## Memory system

| Variable | Description | Default | Example |
|---|---|---|---|
| `KRYTHOR_MEMORY_NO_DECAY` | Set to `1` to disable temporal decay scoring in memory search. When disabled, all entries score equally on recency — useful for testing or when you always want oldest entries to rank equally with new ones. | (not set — decay enabled) | `KRYTHOR_MEMORY_NO_DECAY=1` |

---

## Setup and install

| Variable | Description | Default | Example |
|---|---|---|---|
| `KRYTHOR_NON_INTERACTIVE` | Set to `1` to skip all interactive prompts during install and setup. The wizard exits immediately. Use `krythor setup` or the Control UI to configure providers after install. | `0` | `KRYTHOR_NON_INTERACTIVE=1` |

---

## Development and testing

| Variable | Description | Default | Example |
|---|---|---|---|
| `NODE_ENV` | When set to `test`, disables the config file watcher, session cleanup interval, and heartbeat timer to prevent timer leaks in tests. | (not set) | `NODE_ENV=test` |
| `KRYTHOR_TEST_ANTHROPIC_KEY` | Anthropic API key for live provider tests (`pnpm test:live`). Tests skip cleanly when not set. | (not set) | `KRYTHOR_TEST_ANTHROPIC_KEY=sk-ant-...` |
| `KRYTHOR_TEST_OPENAI_KEY` | OpenAI API key for live provider tests. Tests skip cleanly when not set. | (not set) | `KRYTHOR_TEST_OPENAI_KEY=sk-...` |
| `KRYTHOR_TEST_OLLAMA_URL` | Ollama base URL for live provider tests. Tests skip when not set. | (not set) | `KRYTHOR_TEST_OLLAMA_URL=http://127.0.0.1:11434` |

---

## Inherited Node.js / system variables

These are standard environment variables that Krythor respects but does not set:

| Variable | How Krythor uses it |
|---|---|
| `LOCALAPPDATA` | Windows data directory fallback (if `KRYTHOR_DATA_DIR` not set) |
| `HOME` / `USERPROFILE` | macOS/Linux home directory for default data path |
| `PATH` | Used by exec tool to resolve command binaries |
| `HTTP_PROXY` / `HTTPS_PROXY` | Not currently read by Krythor's fetch calls (Node built-in `fetch` reads these on some platforms) |

---

## Using env vars with daemon mode

When running Krythor as a daemon (`krythor start --daemon`), set env vars before starting:

**Mac / Linux:**
```bash
KRYTHOR_DATA_DIR=/data/krythor krythor start --daemon
```

Or in a systemd unit file:
```ini
[Service]
Environment=KRYTHOR_DATA_DIR=/data/krythor
Environment=KRYTHOR_NON_INTERACTIVE=1
ExecStart=/home/user/.krythor/start.js
```

**Windows (PowerShell):**
```powershell
$env:KRYTHOR_DATA_DIR = "D:\KrythorData"
krythor start --daemon
```

See [DEPLOYMENT.md](./DEPLOYMENT.md) for full daemon configuration examples.
