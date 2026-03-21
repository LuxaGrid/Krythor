# Krythor Configuration Reference

## Data Directory

Krythor stores all configuration and data in a platform-specific directory:

| Platform | Default Location |
|---|---|
| Windows | `%LOCALAPPDATA%\Krythor\` |
| macOS | `~/Library/Application Support/Krythor/` |
| Linux | `~/.local/share/krythor/` |

### Override the Data Directory

Set the `KRYTHOR_DATA_DIR` environment variable to use a custom location:

```sh
# macOS / Linux
export KRYTHOR_DATA_DIR=/path/to/my/krythor-data
pnpm start

# Windows PowerShell
$env:KRYTHOR_DATA_DIR = "C:\Users\me\my-krythor-data"
node start.js
```

This is useful for:
- Relocating data to a different drive
- Keeping multiple Krythor profiles
- Running integration tests without touching your live config
- Backup and restore workflows

---

## Config Files

All config files live inside `<dataDir>/config/`.

### providers.json

Stores the list of AI providers.

**Format:** Either a flat array `[...]` or a wrapped object `{ "version": "1", "providers": [...] }`.
Both formats are accepted at load time.

**Provider entry fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string (UUID) | yes | Unique provider identifier (auto-generated) |
| `name` | string | yes | Display name (e.g. "Anthropic", "My Ollama") |
| `type` | string | yes | One of: `anthropic`, `openai`, `ollama`, `openai-compat`, `gguf` |
| `endpoint` | string | yes | API base URL |
| `authMethod` | string | yes | One of: `api_key`, `oauth`, `none` |
| `apiKey` | string | no | API key (required when `authMethod = "api_key"`) |
| `oauthAccount` | object | no | OAuth credentials (set when `authMethod = "oauth"`) |
| `isDefault` | boolean | no | Whether this is the default provider (default: `false`) |
| `isEnabled` | boolean | no | Whether this provider is active (default: `true`) |
| `models` | string[] | no | List of known model names for this provider |
| `setupHint` | string | no | UI hint (e.g. `"oauth_available"` for OAuth CTA) |

**oauthAccount fields:**

| Field | Type | Description |
|---|---|---|
| `accountId` | string | Provider account identifier |
| `displayName` | string | Human-readable account name |
| `accessToken` | string | OAuth access token (encrypted at rest) |
| `refreshToken` | string | OAuth refresh token (encrypted at rest) |
| `expiresAt` | number | Token expiry as Unix timestamp (ms) |
| `connectedAt` | string | ISO timestamp when account was connected |

**Valid provider types:**

| Type | Use For |
|---|---|
| `anthropic` | Claude models via Anthropic API |
| `openai` | GPT models via OpenAI API |
| `ollama` | Local models via Ollama |
| `openai-compat` | Any OpenAI-compatible API (Kimi, MiniMax, LM Studio, etc.) |
| `gguf` | Local GGUF models via llama-server |

**Example:**

```json
{
  "version": "1",
  "providers": [
    {
      "id": "a1b2c3d4-...",
      "name": "Anthropic",
      "type": "anthropic",
      "endpoint": "https://api.anthropic.com",
      "authMethod": "api_key",
      "apiKey": "sk-ant-...",
      "isDefault": true,
      "isEnabled": true,
      "models": ["claude-sonnet-4-5", "claude-opus-4-5"]
    }
  ]
}
```

**Safe editing:**
- Use the Models tab in the Control UI for all provider changes
- If editing by hand, validate JSON syntax before saving
- The gateway skips invalid providers at startup (bad entries do not crash the server)
- Run `krythor doctor` after editing to verify

---

### agents.json

Stores the list of agent definitions.

**Format:** A plain JSON array `[...]`.

**Agent entry fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | yes | Unique agent identifier |
| `name` | string | yes | Display name |
| `description` | string | no | Short description |
| `systemPrompt` | string | no | System prompt injected at conversation start |
| `memoryScope` | string | no | One of: `session`, `workspace`, `global` |
| `maxTurns` | number | no | Maximum conversation turns per session |
| `temperature` | number | no | Model temperature override (0.0–2.0) |
| `tags` | string[] | no | Tags for filtering/grouping agents |
| `preferredModel` | string | no | Model to prefer for this agent |
| `createdAt` | number | no | Unix timestamp (ms) |
| `updatedAt` | number | no | Unix timestamp (ms) |

**Example:**

```json
[
  {
    "id": "krythor-default",
    "name": "Krythor",
    "description": "General-purpose AI assistant",
    "systemPrompt": "You are Krythor, a helpful local-first AI assistant.",
    "memoryScope": "session",
    "maxTurns": 10,
    "temperature": 0.7,
    "tags": ["default"],
    "createdAt": 1711000000000,
    "updatedAt": 1711000000000
  }
]
```

---

### app-config.json

Stores application-level settings.

**Fields:**

| Field | Type | Description |
|---|---|---|
| `selectedAgentId` | string | ID of the currently selected agent |
| `selectedModel` | string | Currently selected model name |
| `onboardingComplete` | boolean | Whether the setup wizard completed with a provider |
| `authToken` | string | Gateway auth token (auto-generated on first run) |
| `authDisabled` | boolean | Set `true` to disable auth (development only — dangerous) |

**Note:** `authToken` is written here by the gateway on first run and injected into `index.html` at serve time. You should not need to edit this manually.

---

### policy.json

Stores the guard policy rules.

**Fields:**

| Field | Type | Description |
|---|---|---|
| `version` | string | Policy schema version |
| `defaultAction` | string | Either `"allow"` or `"deny"` (applied when no rule matches) |
| `rules` | array | Array of rule objects |

**Rule fields:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique rule ID |
| `operation` | string | Operation pattern (e.g. `"skill:permission:filesystem"`) |
| `action` | string | `"allow"` or `"deny"` |
| `source` | string | Source type filter (e.g. `"skill"`, `"api"`) |

**Default policy:** The gateway creates a permissive default policy on first run. Edit via the Guard tab in the Control UI.

---

## Environment Variables

| Variable | Description |
|---|---|
| `KRYTHOR_DATA_DIR` | Override the data directory (default: OS-specific path above) |
| `NODE_ENV` | Set to `production` to disable pretty-printing in logs |

**Environment variables take precedence over config file values.**

---

## Backup and Restore

### What to back up

Back up the entire `<dataDir>/` directory. This includes:
- `config/` — all provider, agent, and policy configuration
- `memory/memory.db` — all conversation history and stored memories

**Credentials are encrypted at rest** using a machine-derived key. If you restore to a different machine, you will need to re-enter API keys and reconnect OAuth providers.

### Automated backup strategy

```sh
# Copy the Krythor data dir to a backup location
cp -r "$LOCALAPPDATA/Krythor" ~/Backups/krythor-$(date +%Y-%m-%d)
```

On Linux/macOS:
```sh
cp -r ~/.local/share/krythor ~/Backups/krythor-$(date +%Y-%m-%d)
```

### Database rollback

If a migration fails or the database becomes corrupted, you can roll back to the most recent pre-migration backup:

```sh
# Stop the gateway first, then:
krythor-setup --rollback
```

Backups are created automatically before each migration and named `memory.db.<ISO-timestamp>.bak`.

---

## Safe Config Editing Rules

1. **Always stop the gateway before editing config files by hand.** The gateway holds open file handles; editing while running can cause data loss.
2. **Validate JSON before saving.** Use a JSON validator or `node -e "JSON.parse(require('fs').readFileSync('providers.json', 'utf8'))"`.
3. **Use the Control UI for most changes.** Provider and agent management via the UI is safer than manual editing.
4. **Run `krythor doctor` after editing.** It will catch missing fields, auth issues, and malformed files.
5. **Keep a backup.** Copy `<dataDir>/config/providers.json` before making significant changes.

---

## Diagnostics

```sh
krythor doctor    # Full diagnostic report
krythor status    # Quick health summary (requires running gateway)
krythor repair    # Check bundled runtime + sqlite3
krythor setup     # Re-run setup wizard
```
