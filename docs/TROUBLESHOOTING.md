# Krythor Troubleshooting Guide

Step-by-step fixes for the most common issues.

Run `krythor doctor` first — it catches most problems automatically.

---

## Issue 1 — Gateway won't start

**Symptoms:** `krythor` exits immediately; nothing opens in the browser.

**Step-by-step:**

1. Check whether the build is present:
   ```bash
   ls packages/gateway/dist/index.js
   ```
   If missing, run `pnpm install && pnpm build`.

2. Check if port 47200 is already in use:
   ```bash
   # Mac / Linux
   lsof -i :47200
   # Windows
   netstat -ano | findstr :47200
   ```
   Kill the conflicting process or stop the existing Krythor daemon with `krythor stop`.

3. Run the repair tool:
   ```bash
   krythor repair
   ```
   This checks the bundled runtime, native modules, and config files.

4. Check the log output:
   ```bash
   krythor 2>&1 | head -60
   ```
   Look for `Error:` lines near the top.

---

## Issue 2 — 404 on / (Control UI not found)

**Symptoms:** Visiting `http://localhost:47200` returns 404 or a blank page.

**Step-by-step:**

1. Verify the Control UI was built:
   ```bash
   ls packages/control/dist/index.html
   ```
   If missing, run `pnpm build`.

2. Verify the gateway is running:
   ```bash
   krythor status
   ```
   If not running, start with `krythor`.

3. Check the URL — must be `http://127.0.0.1:47200` or `http://localhost:47200`, not HTTPS.

---

## Issue 3 — 401 Unauthorized on API calls

**Symptoms:** `curl /api/command` returns `{"error":"Unauthorized"}`.

**Step-by-step:**

1. Find the token:
   ```bash
   # Mac / Linux
   cat "$HOME/Library/Application Support/Krythor/config/app-config.json"   # macOS
   cat "$HOME/.local/share/krythor/config/app-config.json"                  # Linux
   # Windows
   type "%LOCALAPPDATA%\Krythor\config\app-config.json"
   ```
   The token is the `gatewayToken` field.

2. Pass it in the Authorization header:
   ```bash
   curl -H "Authorization: Bearer <token>" http://127.0.0.1:47200/api/agents
   ```

3. If `authDisabled: true` is set in `app-config.json`, no token is needed.

4. Run `krythor doctor` — it reports whether auth is enabled and the token is present.

---

## Issue 4 — ABI mismatch (better-sqlite3 won't load)

**Symptoms:** Error contains `was compiled against a different Node.js version`.

**Step-by-step:**

1. Run the repair tool — it detects and reports ABI mismatches:
   ```bash
   krythor repair
   ```

2. Recompile the native module against the bundled runtime:
   ```bash
   # From the Krythor installation directory
   ./runtime/node ./node_modules/.bin/node-gyp rebuild \
     --directory node_modules/better-sqlite3
   ```
   Or re-run the installer — it always recompiles.

3. If building from source:
   ```bash
   pnpm install
   ```
   This recompiles `better-sqlite3` against the system Node.

---

## Issue 5 — No AI providers configured

**Symptoms:** Chat returns "No AI provider is configured." The Models tab shows no providers.

**Step-by-step:**

1. Run the setup wizard:
   ```bash
   krythor setup
   ```

2. Or open the **Models tab** in the Control UI and click **Add Provider**.

3. Verify a provider is reachable:
   ```bash
   krythor doctor --test-providers
   ```

4. For local providers (Ollama), ensure Ollama is running:
   ```bash
   ollama serve
   ```

---

## Issue 6 — Auth fails after update

**Symptoms:** Token that worked before now returns 401.

**Step-by-step:**

1. The token is generated once and stored in `app-config.json`. It does not change between restarts.

2. If `app-config.json` was deleted (e.g. during a re-install), a new token was generated. Copy it:
   ```bash
   krythor status --json | jq -r '.configDir'
   ```
   Then read `app-config.json` from that path.

3. Force-refresh the Control UI (Ctrl+Shift+R) — stale token may be cached in localStorage.

---

## Issue 7 — Memory search returns no results

**Symptoms:** `GET /api/memory/search?q=<text>` returns empty results despite stored entries.

**Step-by-step:**

1. Check that entries exist:
   ```bash
   curl -H "Authorization: Bearer <token>" \
     "http://127.0.0.1:47200/api/memory/search?q=test"
   ```

2. If the query is very short (1–2 chars), stop-word filtering removes it — use longer terms.

3. For semantic search, verify Ollama embedding is active:
   ```bash
   krythor status
   # Look for "Embedding: active"
   ```

4. If embedding is degraded, search falls back to keyword-only (BM25). This still works but is less accurate.

---

## Issue 8 — Agent run fails / returns empty output

**Symptoms:** Agent run returns `status: "failed"` or `output: null`.

**Step-by-step:**

1. Check which model the agent is using:
   ```bash
   curl -H "Authorization: Bearer <token>" \
     "http://127.0.0.1:47200/api/agents"
   ```
   Look for the `modelId` and `providerId` fields.

2. Test the provider directly:
   ```bash
   krythor doctor --test-providers
   ```

3. Check the circuit breaker state:
   ```bash
   curl -H "Authorization: Bearer <token>" \
     "http://127.0.0.1:47200/health" | jq '.circuits'
   ```
   A provider with `state: "open"` is failing and being skipped.

4. Reset the circuit by waiting 30 seconds or restarting the gateway.

---

## Issue 9 — Config changes not taking effect

**Symptoms:** Edited `providers.json` but the new provider doesn't appear.

**Step-by-step:**

1. Krythor watches `providers.json` automatically with `fs.watch()` (500ms debounce).
   Wait 1 second and check again.

2. Trigger a manual reload:
   ```bash
   curl -X POST -H "Authorization: Bearer <token>" \
     http://127.0.0.1:47200/api/config/reload
   ```

3. If hot reload fails, restart the gateway:
   ```bash
   krythor restart
   ```

4. Validate your JSON syntax:
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('providers.json','utf-8'))"
   ```

---

## Issue 10 — TUI shows "not reachable"

**Symptoms:** `krythor tui` starts but shows "gateway not reachable" and no data.

**Step-by-step:**

1. The TUI polls `GET /health` every 5 seconds. Start the gateway first:
   ```bash
   krythor start --daemon
   ```
   Then open a new terminal and run `krythor tui`.

2. If the gateway is running but TUI can't reach it:
   ```bash
   curl http://127.0.0.1:47200/health
   ```
   If this works, the TUI should also connect — try quitting (press `q`) and restarting.

3. Check if a firewall or proxy is blocking loopback connections on port 47200.

---

## Additional resources

- `krythor doctor` — comprehensive system diagnostics
- `krythor repair` — check runtime, native modules, providers
- `krythor security-audit` — 7-point security check
- [ENV_VARS.md](./ENV_VARS.md) — environment variable reference
- [CONFIG_REFERENCE.md](./CONFIG_REFERENCE.md) — config file reference
- [DEPLOYMENT.md](./DEPLOYMENT.md) — daemon mode, Docker, systemd
