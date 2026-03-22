# Krythor API Reference

Base URL: `http://127.0.0.1:47200`

All endpoints under `/api/` require a Bearer token unless noted otherwise.

**Authentication:**

```
Authorization: Bearer <token>
```

The token is found in `<configDir>/app-config.json` under the `gatewayToken` key.
It is also injected into the control UI at startup.

---

## Public endpoints (no auth)

### GET /health

Returns gateway health and subsystem status.

**Response:**

```json
{
  "status": "ok",
  "version": "1.5.0",
  "nodeVersion": "v20.19.0",
  "timestamp": "2026-03-21T00:00:00.000Z",
  "memory": { "totalEntries": 0, "degraded": false, "providerName": null },
  "models": { "providerCount": 1, "modelCount": 5, "hasDefault": true },
  "circuits": { "<providerId>": { "state": "closed", "failures": 0 } },
  "guard": { "ruleCount": 0, "defaultAction": "allow" },
  "agents": { "agentCount": 1, "activeRunCount": 0 },
  "heartbeat": { "enabled": true, "recentRuns": 0, "warnings": [] },
  "soul": { "loaded": true, "version": "1.0" },
  "firstRun": false,
  "totalTokens": 0,
  "dataDir": "/home/user/.local/share/krythor",
  "configDir": "/home/user/.local/share/krythor/config"
}
```

### GET /ready

Returns 200 when the database and guard engine are ready; 503 otherwise.

---

## Command endpoint

### POST /api/command

Run a command through the AI system.

**Body:**

```json
{
  "input": "string (required)",
  "agentId": "string (optional — use a specific agent)",
  "modelId": "string (optional — override model, supports aliases: claude, gpt4, local, fast, best)",
  "conversationId": "string (optional — continue a conversation)",
  "stream": "boolean (optional — SSE streaming)"
}
```

**In-chat slash commands:** When `input` begins with `/`, the command is intercepted before inference and returns a synthetic response. No tokens are consumed.

| Command | Returns |
|---------|---------|
| `/clear` | `{ command: "clear", output: "(chat history cleared)" }` |
| `/model` | `{ command: "model:list", output: "Available models: ..." }` |
| `/model <id>` | `{ command: "model:switch", modelId: "<id>" }` |
| `/agent` | `{ command: "agent:status", output: "..." }` |
| `/agent <id>` | `{ command: "agent:switch", agentId: "<id>" }` |

**Model aliases for `modelId`:** Short aliases are resolved to real provider/model pairs before routing.

| Alias | Resolves to |
|-------|-------------|
| `claude` | First enabled Anthropic provider's default model |
| `gpt4` | First enabled OpenAI provider, gpt-4 model preferred |
| `local` | First enabled Ollama provider's first model |
| `fast` | Provider with lowest recorded average latency |
| `best` | Premium model (claude/gpt-4/gemini preferred) or first model |

**Response (non-streaming):**

```json
{
  "input": "hello",
  "output": "Hello! How can I help?",
  "timestamp": "2026-03-21T00:00:00.000Z",
  "processingTimeMs": 842,
  "modelUsed": "anthropic/claude-3-5-haiku-20241022",
  "agentId": "agent-abc",
  "runId": "run-xyz",
  "requestId": "req-1",
  "conversationId": "conv-abc",
  "status": "completed",
  "selectionReason": "default provider",
  "fallbackOccurred": false
}
```

**Streaming (SSE):** Pass `"stream": true`. Events:

- `{"type":"delta","content":"...","runId":"..."}` — token chunk
- `{"type":"done","output":"...","modelUsed":"...","selectionReason":"...","fallbackOccurred":false}` — run complete
- `{"type":"error","message":"..."}` — failure

---

## Providers

### GET /api/providers

List all configured providers (no secrets exposed).

**Response:** Array of `{ id, name, type, endpoint, authMethod, modelCount, isDefault, isEnabled, setupHint? }`

### POST /api/providers/:id

Update provider metadata (enable/disable, priority, maxRetries).

**Body:** `{ isEnabled?, isDefault?, priority?, maxRetries? }`

### POST /api/providers/:id/test

Test a provider with a real inference call. Rate-limited to 10 req/min.

**Response:** `{ ok, latencyMs, model, response }` or `{ ok: false, latencyMs, error }`

---

## Models

### GET /api/models

List all available models with provider info.

**Response:** Array of `{ id, name, provider, providerType, providerId, isDefault, isAvailable, circuitState, contextWindow, badges }`

### GET /api/models/providers

List providers with full config (API keys masked as `***`).

### POST /api/models/providers

Add a new provider.

**Body:** Full `ProviderConfig` object (see `docs/CONFIG_REFERENCE.md`).

### DELETE /api/models/providers/:id

Remove a provider.

### POST /api/models/providers/:id/oauth/connect

Connect an OAuth account to a provider.

### POST /api/models/providers/:id/oauth/disconnect

Remove OAuth credentials from a provider.

---

## Agents

### GET /api/agents

List all agents with `systemPromptPreview`.

### POST /api/agents

Create an agent.

**Body:** `{ name, description?, systemPrompt, modelId?, providerId?, memoryScope?, maxTurns?, temperature?, maxTokens?, tags?, allowedTools? }`

### GET /api/agents/:id

Get a single agent.

### PATCH /api/agents/:id

Update an agent.

### DELETE /api/agents/:id

Delete an agent.

### GET /api/agents/:id/run

Run an agent with a message.

**Query:** `?message=<text>`

**Response:** `{ output, modelUsed, status, runId }`

### GET /api/agents/export

Export all agents as JSON.

### POST /api/agents/import

Import agents from JSON.

**Agent tool: `spawn_agent`**

Agents can spawn sub-agents using the built-in `spawn_agent` tool. The agent emits a JSON blob in its response:

```json
{"tool":"spawn_agent","agentId":"<child-id>","message":"<message>"}
```

The orchestrator intercepts this, runs the target agent, and injects the result back as a tool result. Capped at 2 spawns per run to prevent runaway chains.

---

## Memory

### GET /api/memory

Search memory entries.

**Query params:** `text`, `scope`, `scope_id`, `tags` (comma-separated), `pinned`, `minImportance`, `limit` (max 500), `offset`

### GET /api/memory/search

Paginated search with total count envelope.

**Query params:** `q` (search text), `page` (default 1), `limit` (default 20, max 200), plus all params from `/api/memory`

**Response:**

```json
{ "results": [...], "total": 42, "page": 1, "limit": 20 }
```

### GET /api/memory/stats

Memory statistics including `oldest`, `newest`, `sizeEstimateBytes`.

### GET /api/memory/tags

All unique tags across memory entries.

### GET /api/memory/export

Export all entries as a JSON array (downloadable).

### POST /api/memory/import

Import memory entries (deduplicates by content hash).

**Body:** Array of `{ content, source, tags?, title?, scope?, importance?, pinned? }`

### POST /api/memory

Create a memory entry.

### GET /api/memory/:id

Get a single memory entry with tags, usage, and sources.

### PATCH /api/memory/:id

Update a memory entry.

### DELETE /api/memory

Bulk delete with filters (at least one required): `?olderThan=<ISO>&tag=<tag>&source=<source>`

### DELETE /api/memory/:id

Delete a single entry.

### POST /api/memory/prune

Prune lowest-importance entries.

**Body:** `{ maxEntries? }`

### POST /api/memory/summarize

Summarize and consolidate low-importance entries (requires a provider).

---

## Conversations

### GET /api/conversations

List all conversations (includes `sessionAgeMs`, `isIdle`).

### POST /api/conversations

Create a conversation.

**Body:** `{ agentId? }`

### GET /api/conversations/:id

Get a conversation.

### PATCH /api/conversations/:id

Update title, name, or pinned state.

**Body:** `{ title?, name?, pinned? }` (at least one required)

### DELETE /api/conversations/:id

Delete a conversation.

### GET /api/conversations/:id/messages

Get messages in a conversation — paginated.

**Query params:** `?page=1&limit=50` (limit capped at 500, default 50)

**Response:**

```json
{ "messages": [...], "total": 42, "page": 1, "limit": 50, "hasMore": false }
```

### POST /api/conversations/:id/messages

Add a message without triggering inference (import / seeding).

**Body:** `{ role, content, modelId?, providerId? }`

### DELETE /api/conversations/:id/messages/last-assistant

Remove the most recent assistant message (for Regenerate feature).

### GET /api/conversations/:id/export

Export a conversation as JSON or Markdown.

**Query:** `?format=json` (default) or `?format=markdown`

---

## Skills

### GET /api/skills/builtins

List built-in skill templates (summarize, translate, explain).

### GET /api/skills

List user skills. **Query:** `?tags=comma,separated`

### GET /api/skills/:id

Get a single skill.

### POST /api/skills

Create a skill.

**Body:** `{ name, systemPrompt, description?, tags?, permissions?, modelId?, providerId?, timeoutMs?, taskProfile? }`

### PATCH /api/skills/:id

Update a skill.

### DELETE /api/skills/:id

Delete a skill.

### POST /api/skills/:id/run

Run a skill. Rate-limited to 60 req/min.

**Body:** `{ input }`

---

## Guard

### GET /api/guard/policy

Full policy configuration.

### GET /api/guard/stats

Guard engine statistics.

### GET /api/guard/rules

List all policy rules.

### POST /api/guard/rules

Add a policy rule.

**Body:** `{ name, description, priority, condition, action, reason, enabled? }`

### PATCH /api/guard/rules/:id

Update a policy rule.

### DELETE /api/guard/rules/:id

Delete a policy rule.

### POST /api/guard/check

Evaluate a context without executing (dry run).

**Body:** `{ operation, source, sourceId?, scope?, content?, metadata? }`

### PATCH /api/guard/policy/default

Set the default action.

**Body:** `{ action: "allow" | "deny" }`

### POST /api/guard/reload

Reload policy from disk.

### GET /api/guard/decisions

Audit log of all guard decisions. **Query:** `?limit=100&offset=0`

---

## Plugins

### GET /api/plugins

List loaded plugins (from `<dataDir>/plugins/*.js`).

**Response:** Array of `{ name, description, file }` (the `run` function is not serialized).

Plugins are CommonJS modules loaded at gateway startup. See [START_HERE.md](./START_HERE.md) for plugin format.

---

## Tools

### GET /api/tools

List available tools with allowlists.

### POST /api/tools/exec

Execute a local command (auth required, rate-limited 30 req/min).

**Body:** `{ command, args?, cwd?, timeoutMs? }`

### POST /api/tools/web_search

Search via DuckDuckGo (rate-limited 60 req/min).

**Body:** `{ query }`

### POST /api/tools/web_fetch

Fetch and extract text from a URL (rate-limited 30 req/min).

**Body:** `{ url }`

### GET /api/tools/custom

List user-defined webhook tools.

### POST /api/tools/custom

Register a webhook tool.

**Body:** `{ name, description, url, headers?, bodyTemplate? }`

### DELETE /api/tools/custom/:name

Remove a webhook tool.

---

## Stats

### GET /api/stats

Token usage snapshot for this session.

### GET /api/stats/history

Inference history ring buffer (last 1000 entries).

**Response:** `{ history: [{ timestamp, provider, model, inputTokens, outputTokens }], windowSize: 1000 }`

---

## Dashboard

### GET /api/dashboard

Consolidated system metrics.

**Response:** `{ uptime, version, providerCount, modelCount, agentCount, memoryEntries, conversationCount, totalTokensUsed, activeWarnings, lastHeartbeat }`

---

## Heartbeat

### GET /api/heartbeat/status

Heartbeat engine status and active warnings.

### GET /api/heartbeat/history

Per-provider rolling health history (last 100 entries per provider).

**Response:** `{ "<providerId>": [{ timestamp, ok, latencyMs }] }`

---

## Gateway

### GET /api/gateway/info

Gateway identity and capabilities.

**Response:** `{ version, platform, arch, nodeVersion, gatewayId, startTime, capabilities }`

### GET /api/gateway/peers

Peer gateways (placeholder — always returns `{ peers: [] }`).

---

## Config

### GET /api/config

Current app config.

### POST /api/config/reload

Trigger hot reload of providers.json.

### GET /api/config/export

Export providers config with secrets redacted.

### POST /api/config/import

Import a providers config (merges; skips `***` keys).

---

## Templates

### GET /api/templates

List workspace template files in `<dataDir>/templates/`.

**Response:** `{ templates: [{ name, filename, size, description }] }`

---

## Recommendations

### GET /api/recommend

Get model recommendation for a context.

### POST /api/recommend/feedback

Submit outcome feedback to the recommendation engine.

---

## Local model discovery

### GET /api/local-models

Probe for locally running model servers (Ollama, LM Studio, llama-server).

**Response:** `{ ollama: { detected, models }, lmStudio: { detected, models }, llamaServer: { detected } }`

---

## WebSocket stream

### WS /ws/stream

Real-time event stream for agent events, skill events, and guard denials.

**Auth:** Pass token as `?token=<token>` query param.

**Events:** `agent:event`, `skill:event`, `guard:denied`
