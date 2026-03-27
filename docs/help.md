# Krythor Help & FAQ

Quick answers for common errors, setup problems, and runtime behaviour questions.
For step-by-step fixes see [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
For config options see [CONFIG_REFERENCE.md](./CONFIG_REFERENCE.md).
For env vars see [ENV_VARS.md](./ENV_VARS.md).

---

## First 60 seconds when something is broken

Run these commands in order and share the output when asking for help:

```bash
krythor status          # gateway + provider snapshot
krythor doctor          # validates config, auth, native modules, providers
krythor repair          # fixes ABI mismatches, missing files, corrupt state
krythor logs --follow   # live log tail (Ctrl-C to stop)
```

If the gateway is not reachable at all:

```bash
curl http://127.0.0.1:47200/health
```

If that fails, the gateway process is not running — start it with `krythor` or `krythor start --daemon`.

---

## Setup & first run

### Gateway won't start / exits immediately

1. Check the build is present:
   ```bash
   ls packages/gateway/dist/index.js   # dev — must exist
   ls ~/.krythor/gateway/dist/index.js # installed — must exist
   ```
   If missing: `pnpm install && pnpm build` (dev) or re-run the installer.

2. Check port 47200 is free:
   ```bash
   # Mac / Linux
   lsof -i :47200
   # Windows
   netstat -ano | findstr :47200
   ```
   If occupied, stop the other process or the existing Krythor daemon (`krythor stop`).

3. Run the repair tool — covers most startup failures:
   ```bash
   krythor repair
   ```

4. Inspect the raw log output:
   ```bash
   krythor 2>&1 | head -80
   ```

---

### Control UI shows 404 or blank page

`http://localhost:47200` requires the control panel to be built and deployed.

1. Check the build:
   ```bash
   ls packages/control/dist/index.html
   ```
   If missing: `pnpm build` (also deploys to `~/.krythor`).

2. Use HTTP, not HTTPS: `http://127.0.0.1:47200`

3. If running from source, the gateway serves UI from `packages/control/dist/`. After every `pnpm build`, the deploy script copies the UI automatically.

---

### 401 Unauthorized on API calls

The gateway enforces Bearer token auth on all `/api/*` routes by default.

1. Find your token:
   ```bash
   # macOS
   cat "$HOME/Library/Application Support/Krythor/config/app-config.json"
   # Linux
   cat "$HOME/.local/share/krythor/config/app-config.json"
   # Windows
   type "%LOCALAPPDATA%\Krythor\config\app-config.json"
   ```
   Look for `"gatewayToken"`.

2. Pass it in every request:
   ```bash
   curl -H "Authorization: Bearer <token>" http://127.0.0.1:47200/api/agents
   ```

3. If `authDisabled: true` is set in `app-config.json`, no token is needed (dev only — do not use in production).

4. Control UI stores the token in `localStorage` under `krythor_token`. If the token changed (e.g. after re-install), force-refresh the UI (`Ctrl+Shift+R`) and re-enter the token in Settings.

5. The token does **not** rotate between restarts. A new token is only generated if `app-config.json` is deleted or the gateway runs for the first time.

---

### Token was injected but dashboard still asks for it

The gateway injects `window.__KRYTHOR_TOKEN__` into `index.html` at serve time.
If the Control UI was opened directly from `file://` instead of `http://`, the injection does not run.
Always open via `http://127.0.0.1:47200`.

---

### SOUL.md not found (startup warning)

Non-breaking. The gateway prints:
```
[SystemIdentityProvider] SOUL.md not found — using built-in fallback identity.
```
Place a `SOUL.md` file in the repo root or `~/.krythor/` to customise agent identity. See [SOUL.md](../SOUL.md) for the format.

---

### ABI mismatch — better-sqlite3 won't load

**Symptom:** Error contains `was compiled against a different Node.js version` or `ERR_DLOPEN_FAILED`.

- The installer builds `better-sqlite3` against the **bundled** Node runtime (`~/.krythor/runtime/node.exe` on Windows). If you run the gateway with a *different* Node version, the ABI doesn't match.
- Always use `Krythor.bat` (Windows) or `krythor` (the launcher script) — they invoke the bundled runtime automatically.
- When building from source, use the same Node version you develop with:
  ```bash
  pnpm install   # recompiles better-sqlite3 against your system Node
  ```

---

## Providers & models

### No AI provider configured

**Symptom:** Chat replies "No AI provider is configured." or the Models tab is empty.

1. Open the **Models** tab → **Add Provider**, or run:
   ```bash
   krythor setup
   ```

2. For local providers (Ollama), ensure Ollama is running:
   ```bash
   ollama serve
   ollama list   # verify a model is pulled
   ```

3. Test all providers:
   ```bash
   krythor doctor --test-providers
   ```

---

### Provider returns 429 / rate limit

The provider is temporarily exhausted.

- If using an API key: check your usage/billing in the provider console.
- If using a subscription token: wait for the rate-limit window to reset.
- Set a fallback provider in the Models tab so Krythor can keep responding.
  The circuit breaker will automatically retry after the cooldown period.

---

### Circuit breaker is open — provider being skipped

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:47200/health | jq '.circuits'
```

A provider with `"state": "open"` is failing. The breaker resets automatically after ~30 s.
You can also restart the gateway to reset all breakers immediately.

---

### Unknown model / provider not found

**Symptom:** Error `Unknown model: <provider>/<model>`.

- Verify the provider is configured with a valid API key (Models tab).
- Model IDs are **case-sensitive** — check the exact ID shown in `GET /api/models`.
- For local models (Ollama), ensure the model is pulled: `ollama pull <model>`.

---

### No credentials / API key not found after adding a provider

- Env vars set in your shell are **not** automatically available to the gateway daemon.
  Add them to `~/.krythor/.env` so the service reads them:
  ```
  OPENAI_API_KEY=sk-...
  ANTHROPIC_API_KEY=sk-ant-...
  ```
  Then restart: `krythor restart`.

- Confirm the key is loaded:
  ```bash
  krythor doctor
  krythor status --json | jq '.models'
  ```

---

### Auth fails after update / new token generated

The token is generated once and persisted in `app-config.json`. It does not change between restarts.
A **new** token is only generated if `app-config.json` is missing (e.g. after a clean re-install).

1. Find the new token:
   ```bash
   krythor status --json | jq -r '.configDir'
   ```
   Then read `app-config.json` in that directory.

2. Update it in the Control UI Settings tab, or add it to any automation scripts.

---

## Devices & pairing

### Device stuck in "pending" — never approved

Pending devices appear in the **Devices** tab. Approve from the UI or via the API:

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  http://127.0.0.1:47200/api/devices/<deviceId>/approve
```

Devices broadcast `device:approved` / `device:denied` events over WebSocket immediately after the action — no polling needed.

---

### Approved device can't connect (403 on WS handshake)

1. Verify the device is `status: "approved"` in the Devices tab.
2. Confirm the device is sending the correct `deviceToken` in its `req:connect` frame.
   The token is issued once at approval — if the device lost it, remove and re-pair.
3. Token comparison uses constant-time `timingSafeEqual` — timing attacks are not a concern, but partial token strings (copy-paste errors) will always fail.

---

### Rename device accidentally issued a new token (old behaviour)

Fixed in v0.5. `PATCH /api/devices/:id` now calls `store.updateLabel()` which updates only the label — it no longer calls `store.approve()` and does not rotate the token.

---

### Node device connected but `/api/nodes` is empty

`GET /api/nodes` only lists devices with `role: node` that currently have an **active** WebSocket connection. A device that paired but closed the socket will not appear.

- Confirm the node device is connected and its WS socket is open.
- Check gateway logs for `[NodeRegistry] registered` / `unregistered` events.
- Use the **Devices** tab — the `live` badge indicates a currently-connected node.

---

### Node invoke returns 504

The node did not respond within the timeout (default 30 s).

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"command":"ping","timeoutMs":60000}' \
  http://127.0.0.1:47200/api/nodes/<deviceId>/invoke
```

Pass a higher `timeoutMs` for long-running commands. If the node is offline, you'll get 404 instead.

---

## Web chat & pairing links

### `/chat` page loads but messages don't stream

Streaming requires the gateway to be running and the auth token to be injected.

1. Open via `http://127.0.0.1:47200/chat` (not `file://`).
2. If the page says "no token" or responses never appear, the token injection failed.
   Check that `window.__KRYTHOR_TOKEN__` is set in the browser console.
3. The Stop button calls `abortCtrl.abort()` on the active stream — if it doesn't respond,
   the gateway is busy and will finish the current response before stopping.

---

### Pairing link expired or says "Invalid or expired"

Web chat pairing tokens are **in-memory only** — they do not survive a gateway restart.
After a restart, all pairing links are invalidated. Create a new link in **Settings → Web Chat Pairing**.

Default TTL is 24 hours. For longer-lived links, set a higher TTL (max 168 h / 1 week) when creating.

---

### Can't revoke an old pairing link (before v0.5)

Pre-v0.5 the list API only exposed token prefixes and the DELETE endpoint expected the full raw token (impossible to supply from the UI). As of v0.5:
- Each token has an opaque `id` (safe to expose in the list).
- Revoke by `id`: `DELETE /api/webchat/pair/<id>`.
- The Settings panel shows a **revoke** button next to every active link.

---

## Sessions & context

### "context too large" error

The model's context window is full. Options:

1. **Compact** the current session (summarises older turns):
   Type `/compact` in the chat input.

2. **Start fresh** (new session key):
   Type `/new` or `/reset`.

3. For long-running tasks, use `/subagents` to offload work to a sub-agent — its context is separate and doesn't grow your main session.

---

### Session keeps forgetting facts after a restart

Session history lives in the gateway's in-memory store (or SQLite if configured). If the gateway restarts and you rely on the in-memory store, history is lost.

- Write important facts to a memory entry: use the **Memory** tab or ask the agent to save them.
- Memory entries persist in the SQLite database at `~/.krythor/data/memory.db` across restarts.

---

### LLM error: tool_use block without required input field

The session history is stale or corrupted — usually after a long thread or a tool/schema change.

**Fix:** start a fresh session (`/new`).

---

## Audit log

### Audit log growing without bound

The audit log (`~/.krythor/logs/audit.ndjson`) rotates at **50 MB**: the active file is renamed to `audit.ndjson.1` and a fresh file starts. Only one archive is kept.

If your log exceeded 50 MB before v0.5, rotate it manually:

```bash
mv ~/.krythor/logs/audit.ndjson ~/.krythor/logs/audit.ndjson.old
krythor restart
```

---

## Config & environment

### Config changes not taking effect

The gateway watches `providers.json` with `fs.watch()` (500 ms debounce). Wait 1 s and check again. If the change still doesn't apply:

```bash
# Trigger a manual reload via API
curl -X POST -H "Authorization: Bearer <token>" \
  http://127.0.0.1:47200/api/config/reload

# Or restart
krythor restart
```

Validate JSON syntax before reloading:

```bash
node -e "JSON.parse(require('fs').readFileSync('providers.json','utf-8'))"
```

---

### Env vars missing when running as a daemon (systemd / launchd / Windows service)

The gateway daemon does **not** inherit your interactive shell's environment.
Put missing vars in `~/.krythor/.env`:

```
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
KRYTHOR_GATEWAY_TOKEN=<token>
```

Neither `.env` file overrides variables already set in the process environment.
Restart after editing: `krythor restart`.

---

### KRYTHOR_GATEWAY_TOKEN vs gatewayToken in app-config.json

`KRYTHOR_GATEWAY_TOKEN` (env var) takes priority over `gatewayToken` in `app-config.json`.
If both are set and differ, the env var wins.

---

### Windows — garbled output (mojibake / Chinese characters in exec output)

Console code page mismatch. Run in PowerShell before starting the gateway:

```powershell
chcp 65001
[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding           = [System.Text.UTF8Encoding]::new($false)
```

Then: `krythor restart`.

---

### Windows — `krythor` not recognized after install

The npm global bin folder is not on your PATH.

```powershell
npm config get prefix
```

Add that directory to your user PATH (Settings → Environment Variables). Close and reopen PowerShell.
If you prefer, use `Krythor.bat` in the install directory directly.

---

## Docker / sandbox

### DockerSandboxProvider throws NotImplementedError

Docker sandboxing is a stub — it is not yet implemented.
Set `KRYTHOR_SANDBOX` to nothing (or omit it) to use the default `LocalSandboxProvider`.

```bash
unset KRYTHOR_SANDBOX   # or remove from ~/.krythor/.env
krythor restart
```

**LocalSandboxProvider** satisfies the interface but provides **no isolation** — spawned processes run directly on the host. Use this only in trusted environments until Docker sandboxing ships.

---

## TUI

### TUI shows "gateway not reachable"

The TUI polls `GET /health` every 5 seconds. The gateway must be running first:

```bash
krythor start --daemon   # start in background
krythor tui              # open TUI in a new terminal
```

If the gateway is running but TUI still can't reach it:

```bash
curl http://127.0.0.1:47200/health
```

If that succeeds, press `q` to quit the TUI and relaunch — a stale WS connection sometimes needs a fresh reconnect.

---

## Slash commands (Control UI)

| Command | Action |
|---|---|
| `/new` | Start a new conversation |
| `/clear` | Clear the current conversation |
| `/compact` | Compact context (summarise older turns) |
| `/memory` | Open Memory panel |
| `/agents` | Open Agents panel |
| `/models` | Open Models panel |
| `/skills` | Open Skills panel |
| `/guard` | Open Guard panel |
| `/dash` | Open Dashboard |
| `/logs` | Open Logs panel |
| `/settings` | Open Settings panel |
| `/devices` | Open Devices panel |

Type `/` in the chat input to see the autocomplete list.

---

## Health endpoint reference

`GET /health` (no auth required) returns a live snapshot:

```json
{
  "status": "ok",
  "version": "0.2.0",
  "devices": { "total": 3, "approved": 2, "pending": 1 },
  "nodes": 1,
  "circuits": { "<providerId>": { "state": "closed", ... } },
  "memory": { "totalEntries": 42 },
  "agents": { "agentCount": 2, "activeRuns": 0 }
}
```

Key fields to check when diagnosing:
- `devices.pending > 0` — devices awaiting approval
- `nodes` — count of live WebSocket-connected role:node devices
- `circuits.<id>.state === "open"` — that provider is currently failing
- `memory.embeddingDegraded: true` — semantic search is falling back to keyword-only

---

## Additional resources

| Resource | Description |
|---|---|
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Step-by-step fixes for the top 10 issues |
| [KNOWN_ISSUES.md](../KNOWN_ISSUES.md) | Active bugs and workarounds |
| [CONFIG_REFERENCE.md](./CONFIG_REFERENCE.md) | Full config file reference |
| [ENV_VARS.md](./ENV_VARS.md) | Environment variable reference |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Daemon mode, Docker, systemd |
| [API.md](./API.md) | REST API reference |
| [SECURITY.md](../SECURITY.md) | Security model and hardening |
