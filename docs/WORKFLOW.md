# KRYTHOR RUNTIME WORKFLOW

> A comprehensive reference for how Krythor boots, wires its subsystems, and processes requests end-to-end.

---

## 1. LAUNCHER (`start.js`)

**File**: `start.js` (repo root)

### Execution Flow

1. **Node Binary Resolution**
   - Prefers bundled Node binary at `runtime/node.exe` (Windows) or `runtime/node` (Unix)
   - Falls back to system Node if bundled version doesn't exist
   - Ensures consistent ABI for native modules (critical for `better-sqlite3`)

2. **Constants**
   - `PORT`: 47200
   - `HOST`: 127.0.0.1 (loopback only)
   - `gatewayDist`: `packages/gateway/dist/index.js`

3. **Version Reading**
   - Reads `package.json` at runtime for current version string

4. **Auto-Update Check** *(non-blocking, background)*
   - Checks GitHub releases API for latest tag
   - Result cached 24 hours in data directory
   - Skip with `--no-update-check`

5. **Build Verification**
   - Validates `packages/gateway/dist/index.js` exists
   - Exits with clear error if not found (run `pnpm build` first)

6. **Health Check** (`isKrythorRunning()`)
   - PINGs `/health` with 800 ms timeout
   - Verifies `{ status: 'ok', version: string }` response

7. **Port Check** (`isPortInUse()`)
   - Detects if another process already occupies port 47200

8. **`krythor status` Command**
   - Hits `/health`; supports `--json` for machine-readable output
   - Displays: version, node version, uptime, provider/model/agent counts, memory entries, embedding status, heartbeat status

9. **`krythor repair` Command**
   - Checks: bundled Node, `better-sqlite3`, gateway health, `providers.json`, credentials, config dir, `agents.json`, `app-config.json`, logs dir
   - Auto-fixes with user confirmation or `--yes`

---

## 2. GATEWAY BOOTSTRAP (`packages/gateway/src/server.ts`)

### `buildServer()` — Phase by Phase

#### Phase 1 — Initialization
- **Data directory**: respects `KRYTHOR_DATA_DIR` env var; otherwise platform default (`%LOCALAPPDATA%\Krythor`, `~/Library/Application Support/Krythor`, `~/.local/share/krythor`)
- **Auth token**: `loadOrCreateToken(configDir)` — generates on first run, stores in `app-config.json`
- **Logger**: pino + pino-pretty in dev; `bodyLimit: 1 MB`

#### Phase 2 — Middleware Registration
| Plugin | Purpose |
|--------|---------|
| `registerErrorHandler` | Formats all throws as `{ code, message, hint?, requestId? }` |
| CORS | Origins: loopback + `CORS_ORIGINS` env var |
| CSP | Restricts WebSocket to loopback |
| Host header validation | Applied to `/api/*`, `/ws/*`, `/v1/*` |
| Rate limiting | Global: 300 req/min; command routes: 60 req/min |
| Auth prehandler | Public: `/health`, `/ready`; protected: `/api/*`, `/ws/*` |

#### Phase 3 — WebSocket & Static Files
- `fastifyWebsocket` plugin registered
- Control UI served from `packages/control/dist`
- `index.html`: injects token as `window.__KRYTHOR_TOKEN__`
- SPA fallback for non-asset routes

#### Phase 4 — Config Validation
- `validateProvidersConfig()` at startup; logs skipped/malformed entries

#### Phase 5 — Subsystem Initialization
| Subsystem | Details |
|-----------|---------|
| **MemoryEngine** | Opens `<dataDir>/memory/memory.db`; single shared SQLite connection; applies schema, decay, session-clear, pruning on startup; decay/prune every 24 h |
| **ModelEngine** | Loads `providers.json`; builds provider list + model registry |
| **GuardEngine** | Loads/creates `policy.json` on first run |
| **Ollama embedding** | Wired if any Ollama provider enabled; uses `nomic-embed-text` |
| **PreferenceStore / ModelRecommender** | User preference persistence + model recommendation engine |

#### Phase 6 — Config Hot Reload
- Watches `providers.json` with `fs.watch`
- Debounced 500 ms; reloads without restart

#### Phase 7 — Core Systems Wiring
| System | Notes |
|--------|-------|
| **AgentOrchestrator** | `MAX_ACTIVE_RUNS=10`, `RUN_QUEUE_DEPTH=50`, `RUN_QUEUE_TIMEOUT_MS=5 min` |
| **KrythorCore** | Searches for `SOUL.md` at repo root; attaches memory, models, orchestrator |
| **Broadcast helper** | Sends to all WebSocket clients with `readyState === OPEN` |
| **Run tracking** | Maps `runId → startTime`, `runId → requestId` for correlation |
| **Event forwarding** | Agent + guard events → broadcast + disk logging |
| **SkillRunner** | Maps skill permissions to guard operations |
| **ExecTool** | Wired after orchestrator + guard are ready |
| **CustomToolStore** | Persists webhook tools to `custom-tools.json` |

#### Phase 8 — Route Registration
```
/api/command        POST  — command execution (streaming + non-streaming)
/api/agents         CRUD  — agent management
/api/models         GET   — model listing / management
/api/memory         CRUD  — memory operations
/api/conversations  CRUD  — conversation history
/api/stats          GET   — token usage snapshot
/api/config/reload  POST  — manual config hot-reload
/ws/stream          WS    — WebSocket streaming
```

---

## 3. AGENT ORCHESTRATION (`packages/core/src/agents/`)

### AgentOrchestrator

**Concurrency limits**

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_ACTIVE_RUNS` | 10 | Simultaneous in-flight runs |
| `RUN_QUEUE_DEPTH` | 50 | Max queued requests |
| `RUN_QUEUE_TIMEOUT_MS` | 300 000 (5 min) | Max wait time per queued request |

Queue is FIFO; `RunQueueFullError` (→ HTTP 429) when queue exceeds `RUN_QUEUE_DEPTH`.

**Idle timeout janitor**
- Runs every 15 s (`JANITOR_INTERVAL_MS = 15 000`)
- Stops any run exceeding `agent.idleTimeoutMs`
- Emits `run:stopped`

**Slot acquisition**
```
acquireSlot():
  if activeRunCount < MAX_ACTIVE_RUNS → return immediately
  if waitQueue.length >= RUN_QUEUE_DEPTH → throw RunQueueFullError
  enqueue promise with RUN_QUEUE_TIMEOUT_MS deadline

releaseSlot():
  pop next waiter → wake it
```

**Key methods**

| Method | Purpose |
|--------|---------|
| `runAgent(agentId, input, opts?)` | Non-streaming single run |
| `runAgentStream(agentId, input, opts?)` | Streaming single run |
| `runAgentsParallel(jobs[])` | Up to 5 concurrent agents |
| `runAgentsSequential(agentIds[], input)` | Pipeline — output becomes next input |
| `stopRun(runId)` | Interrupt a running agent |
| `getRun(runId)` | Memory then DB lookup |
| `listRuns(agentId?)` | Merged from memory + DB |
| `stats()` | `{ agentCount, activeRuns, queuedRuns, totalRuns }` |

**Run history**
- In-memory map capped at 500 entries (FIFO)
- Persisted to SQLite for restart survival

---

### AgentRunner

**Limits**

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_TOOL_CALL_ITERATIONS` | 3 | Prevent infinite tool loops |
| `MAX_HANDOFFS` | 3 | Prevent handoff cycles |
| `MAX_SPAWN_AGENT` | 2 | Prevent runaway sub-agent chains |
| `INFERENCE_TIMEOUT_MS` | 60 000 | 60 s per turn |

**Supported tools**

| Tool | Description |
|------|-------------|
| `exec` | Allowlisted shell command execution |
| `web_search` | DuckDuckGo search |
| `web_fetch` | URL content fetch (SSRF-protected) |
| `get_page_text` | Browser-rendered page text |
| `read_file`, `write_file`, `edit_file`, `apply_patch` | Filesystem access |
| `spawn_agent` | Invoke sub-agent by ID |
| `custom` | Webhook / registered custom tools |

**`run()` method lifecycle**

```
1. Generate or use provided runId
2. Create AgentRun, register in activeRuns, emit run:started

3. Build memory context
   - Query by agent scope + scope_id
   - Limit: 8 agent-scoped + 4 user-scoped (10 total max)
   - Record use with recordUse()

4. Build messages
   - System: agent.systemPrompt + memory context
   - History: contextMessages (conversation history)
   - User: input

5. Conversation loop (while turn < agent.maxTurns and not stopped)
   a. infer()          → ModelRouter → provider → response chunks
   b. Record metadata  → modelUsed, selectionReason, fallbackOccurred, retryCount
   c. Tool-call loop   (up to MAX_TOOL_CALL_ITERATIONS)
      - Extract tool call from response
      - Check allowedTools
      - Execute tool, append result, re-infer
   d. Handoff loop     (up to MAX_HANDOFFS)
      - Extract handoff directive
      - Dispatch to target agent, append result
   e. [CONTINUE] check → loop if present

6. Completion
   - completed: write agent memory, emit run:completed, record learning signal
   - stopped:   emit run:stopped, record learning signal
   - failed:    emit run:failed,   record learning signal
   - Always: delete from activeRuns
```

**Memory write** (on success)
```
title:    "Agent {name}: {input[:60]}"
content:  run.output
scope:    agent.memoryScope
scope_id: agent.id
tags:     ['agent-run', agent-name, ...agent.tags]
source:   'agent_output'
```

**`runStream()` method**
- Yields chunks via `models.inferStream()`
- Emits `run:stream:chunk` events
- No mid-stream tool-call or handoff retry

---

## 4. MODEL ROUTING (`packages/models/src/ModelRouter.ts`)

### Routing Hierarchy

1. Skill/task model override (`context.skillModelId`)
2. Agent model override (`context.agentModelId`)
3. Global default provider (`registry.getDefaultProvider()`)
4. Fallback: first enabled provider

### Retry Logic

| Constant | Value |
|----------|-------|
| `DEFAULT_MAX_RETRIES` | 2 (3 total attempts) |
| `RETRY_BASE_MS` | 500 |
| `RETRY_JITTER_MS` | 100 |

### `infer()` flow

```
{ provider, model, selectionReason } = resolve(request, context)

try:
  response = inferWithRetry(provider, request)    // up to 3 attempts
  return { ...response, selectionReason, fallbackOccurred: false }

catch primaryErr:
  if signal.aborted || isClientError → rethrow

  fallback = resolveExcluding(primaryProviderId)
  if not fallback → rethrow primaryErr

  fallbackResponse = inferWithRetry(fallback.provider, request)
  return { ...fallbackResponse, fallbackOccurred: true }
```

### `inferStream()` flow
- No mid-stream retry (output already sent)
- Exception: if circuit is **open before** first chunk, pre-stream fallback is safe

---

## 5. CIRCUIT BREAKER (`packages/models/src/CircuitBreaker.ts`)

### State Machine

```
States:
  closed    — normal operation
  open      — provider known down, requests fail immediately
  half-open — one probe allowed

Transitions:
  closed    → open      after FAILURE_THRESHOLD (3) consecutive failures
  open      → half-open after RESET_TIMEOUT_MS (30 s)
  half-open → closed    on probe success
  half-open → open      on probe failure
```

### Latency tracking
- Rolling window of last 50 successful calls
- Average latency exposed in `stats()` for observability

### Methods

| Method | Purpose |
|--------|---------|
| `execute<T>(fn)` | Wrap call; transitions state, records latency/failure |
| `recordSuccess(ms)` | External success (streaming path) |
| `recordFailure()` | External failure (streaming path) |
| `isOpen()` | Query circuit state |
| `stats()` | `CircuitStats` with state/failures/avgLatency |

---

## 6. MEMORY ENGINE (`packages/memory/src/`)

### Core Stores

| Store | Purpose |
|-------|---------|
| `MemoryStore` | Primary storage — BM25 + semantic retrieval |
| `ConversationStore` | Conversation history |
| `AgentRunStore` | Agent run records |
| `LearningRecordStore` | Learning signals |
| `HeartbeatInsightStore` | Heartbeat system insights |

Single SQLite connection at `<dataDir>/memory/memory.db` (eliminates WAL contention).

### Initialization (on startup)
```
setImmediate:
  1. Clear session-scoped memories
  2. Apply decay
  3. Prune to MAX_ENTRIES (10 000)
  4. Run retention janitor
```

### Decay & Pruning
- Every 24 h:
  - Exponential decay: `multiplier = 2^(-age / HALF_LIFE_MS)` where `HALF_LIFE_MS = 90 days`
  - Clamped to `[0.10, 1.0]`; pinned entries use `1.0`
  - Prune non-pinned entries beyond `MAX_ENTRIES`

### BM25 Text Scoring Tiers

| Score | Condition |
|-------|-----------|
| 1.00 | Exact phrase match in title |
| 0.85 | Exact phrase match in body |
| 0.55–0.75 | All query words present (title gets 1.5× boost) |
| 0.10–0.40 | Partial word coverage |
| 0.00 | No match |

### `retrieve()` Method
```
1. Fetch 3× limit from store (scoring flexibility)
2. If embedding provider available + taskText:
   - Embed query text
   - Score entries semantically (cosine similarity)
3. Compute BM25 text score
4. Composite score = semantic + text + importance + pinned bonus
5. Apply temporal decay (if >5 entries)
6. Sort, return top `limit`
```

Embedding cache (`EmbeddingCache`) stores computed embeddings in memory, invalidated on entry update.

---

## 7. GUARD ENGINE (`packages/guard/src/`)

### Components
- `PolicyStore`: loads/saves `policy.json`
- `PolicyEngine`: evaluation logic
- `GuardAuditLog`: append-only NDJSON at `<dataDir>/logs/guard-audit.ndjson`

### `check()` flow
```
verdict = engine.evaluate(ctx)

if not verdict.allowed → emit 'guard:denied'
if verdict.warnings    → emit 'guard:warned'
emit 'guard:decided'   (always, for observability)
auditLog.record(ctx, verdict)

return verdict
```

`assert()` is a convenience wrapper that throws `GuardDeniedError` if denied.

### Safety Modes (applied via `setDefaultAction` + rule toggles)

| Mode | Default Action | Rule Behavior |
|------|---------------|---------------|
| `guarded` | deny | All deny rules enabled |
| `balanced` | allow | Non-builtin deny rules disabled; warn rules enabled |
| `power-user` | allow | No rules enforced |

---

## 8. GATEWAY ROUTE — `POST /api/command`

**File**: `packages/gateway/src/routes/command.ts`

**Request schema**
```json
{
  "input":          "string (required, minLength: 1)",
  "agentId":        "string (optional)",
  "modelId":        "string (optional)",
  "stream":         "boolean (optional)",
  "conversationId": "string (optional)"
}
```

**Rate limit**: 60 req/min

**Slash command handling** (before inference)
- `/clear` → synthetic 'cleared' signal
- `/model` → list or switch model
- `/agent` → list or switch agent
- Other → fall through to inference

**Processing pipeline**
```
1. Schema validation
2. Rate limit check
3. Auth check (Bearer token)
4. Slash command check
5. Guard check (operation: 'command:execute')
   → 403 if denied
6. Model alias resolution
   ("claude" → "claude-sonnet-4-6", "gpt4" → "gpt-4o", ...)
7. Provider availability check
8. Load conversation history (if conversationId)

Streaming path:
  9.  Generate runId
  10. Save user message to ConversationStore
  11. Set response: text/event-stream
  12. Listen to orchestrator 'agent:event' for this runId
  13. orchestrator.runAgentStream(agentId, input, { contextMessages, runId })
  14. For each event:
        run:stream:chunk → SSE: {"type":"delta","content":"..."}
        run:completed    → SSE: {"type":"done","output":"...","modelUsed":"..."}
        run:failed       → SSE: {"type":"error","message":"..."}
  15. Save assistant message to ConversationStore
  16. End stream, remove listener

Non-streaming path:
  9.  orchestrator.runAgent(agentId, input, contextMessages)
  10. Save messages to ConversationStore
  11. Return full run result as JSON
```

---

## 9. COMPLETE REQUEST-TO-RESPONSE FLOW

### Example: `POST /api/command` with `stream: true`

```
Client ──POST /api/command──────────────────────────────────────────► Gateway
        { input, agentId, stream: true, conversationId }

Gateway:
  ├─ Validate schema
  ├─ Rate limit check
  ├─ Auth (Bearer token)
  ├─ Guard.check({ operation:'command:execute', content:input })
  │    └─ PolicyEngine evaluates rules
  │    └─ AuditLog records decision
  ├─ Resolve model aliases
  ├─ Load conversation history from ConversationStore
  ├─ Generate runId, save user message
  ├─ Set Content-Type: text/event-stream
  └─ orchestrator.runAgentStream(agentId, input, { contextMessages, runId })
       │
       ▼
  AgentOrchestrator:
  ├─ acquireSlot()  (blocks if 10 active runs)
  ├─ Create AgentRun { id:runId, status:'running', ... }
  ├─ Register in activeRuns
  └─ Spawn AgentRunner.runStream()
       │
       ▼
  AgentRunner:
  ├─ Build memory context
  │    └─ MemoryEngine.retrieve(query, { scope:'agent', scope_id:agentId })
  │         ├─ BM25 text scoring
  │         ├─ Semantic embedding scoring (if provider available)
  │         └─ Composite score + decay → top 10 entries
  ├─ Build messages [system+memory, ...history, user:input]
  │
  └─ Conversation loop:
       │
       ├─ models.inferStream(messages, model, ...)
       │    └─ ModelRouter.inferStream()
       │         ├─ Resolve provider/model (hierarchy check)
       │         ├─ CircuitBreaker.execute():
       │         │    ├─ State: closed → call provider
       │         │    ├─ Record latency on success
       │         │    └─ Record failure + transition on error
       │         └─ Provider yields StreamChunk[]
       │
       ├─ For each chunk:
       │    ├─ Emit run:stream:chunk
       │    └─ Gateway listener → SSE: {"type":"delta","content":"..."}
       │
       ├─ Tool-call loop (≤3 iterations)
       │    ├─ Extract tool call from response
       │    ├─ Check agent.allowedTools
       │    ├─ Execute (exec / web_search / web_fetch / ...)
       │    └─ Re-infer with tool result
       │
       ├─ Handoff loop (≤3 handoffs)
       │    └─ Dispatch to target agent, append result
       │
       └─ [CONTINUE] check → loop or break
            │
            ▼
       Completion:
       ├─ Write agent memory to MemoryEngine
       ├─ Emit run:completed
       └─ Record learning signal to LearningRecordStore

Gateway (on run:completed):
  ├─ SSE: {"type":"done","output":"...","modelUsed":"..."}
  ├─ Save assistant message to ConversationStore
  └─ End stream

Client receives:
  data: {"type":"delta","content":"Hello"}
  data: {"type":"delta","content":", how can I help?"}
  data: {"type":"done","output":"Hello, how can I help?","modelUsed":"anthropic/claude-sonnet-4-6"}
```

---

## 10. KEY TYPESCRIPT INTERFACES

### `AgentRun`
```typescript
interface AgentRun {
  id: string;
  agentId: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  input: string;
  messages: AgentMessage[];
  output?: string;
  modelUsed?: string;           // "provider/model"
  startedAt: number;            // Unix ms
  completedAt?: number;
  errorMessage?: string;
  memoryIdsUsed: string[];
  memoryIdsWritten: string[];
  requestId?: string;           // for HTTP log correlation
  selectionReason?: string;
  fallbackOccurred?: boolean;
  retryCount?: number;
}

interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: number;
}
```

### `MemoryEntry`
```typescript
interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  scope: 'session' | 'user' | 'agent' | 'workspace' | 'skill';
  scope_id: string | null;
  source: string;               // 'user' | 'agent' | 'skill' | 'system'
  importance: number;           // 0.0 – 1.0
  pinned: boolean;
  created_at: number;
  last_used: number;
  access_count: number;
}

interface MemoryQuery {
  text?: string;
  scope?: MemoryScope;
  scope_id?: string;
  tags?: string[];
  pinned?: boolean;
  minImportance?: number;
  limit?: number;
  offset?: number;
}

interface MemorySearchResult {
  entry: MemoryEntry;
  tags: string[];
  score: number;                // BM25 + semantic composite
}
```

### `ProviderConfig`
```typescript
interface ProviderConfig {
  id: string;
  name: string;
  type: 'ollama' | 'openai' | 'anthropic' | 'openai-compat' | 'gguf';
  endpoint: string;
  authMethod: 'api_key' | 'oauth' | 'none';
  apiKey?: string;              // AES-256-GCM encrypted
  oauthAccount?: OAuthAccount;
  isDefault: boolean;
  isEnabled: boolean;
  models: string[];
  priority?: number;            // higher = preferred
  maxRetries?: number;          // default 2
}
```

### `InferenceRequest` / `InferenceResponse` / `StreamChunk`
```typescript
interface InferenceRequest {
  messages: Message[];
  model?: string;
  providerId?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

interface InferenceResponse {
  content: string;
  model: string;
  providerId: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs: number;
  retryCount?: number;
  selectionReason?: string;
  fallbackOccurred?: boolean;
}

interface StreamChunk {
  delta: string;
  done: boolean;
  model?: string;               // populated on final chunk
  selectionReason?: string;
  fallbackOccurred?: boolean;
  retryCount?: number;
}

interface RoutingContext {
  agentModelId?: string;
  skillModelId?: string;
  taskType?: string;
}
```

### `AgentDefinition`
```typescript
interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId?: string;
  providerId?: string;
  memoryScope: 'session' | 'agent' | 'workspace';
  maxTurns: number;             // default 10
  temperature?: number;
  maxTokens?: number;
  tags: string[];
  allowedTools?: string[];      // null = all allowed
  idleTimeoutMs?: number;
  createdAt: number;
  updatedAt: number;
}
```

---

## 11. CONCURRENCY LIMITS SUMMARY

| Limit | Value | Location |
|-------|-------|----------|
| Max active agent runs | 10 | `AgentOrchestrator.MAX_ACTIVE_RUNS` |
| Run queue depth | 50 | `AgentOrchestrator.RUN_QUEUE_DEPTH` |
| Run queue timeout | 5 min | `AgentOrchestrator.RUN_QUEUE_TIMEOUT_MS` |
| Max parallel agents | 5 | `runAgentsParallel` |
| Idle timeout check | every 15 s | Janitor interval |
| Max tool iterations | 3 | `AgentRunner.MAX_TOOL_CALL_ITERATIONS` |
| Max handoffs | 3 | `AgentRunner.MAX_HANDOFFS` |
| Max sub-agent spawns | 2 | `AgentRunner.MAX_SPAWN_AGENT` |
| Inference timeout | 60 s | `AgentRunner.INFERENCE_TIMEOUT_MS` |
| Model retry attempts | 3 total | `ModelRouter.DEFAULT_MAX_RETRIES = 2` |
| Circuit breaker threshold | 3 failures | `CircuitBreaker.FAILURE_THRESHOLD` |
| Circuit breaker reset | 30 s | `CircuitBreaker.RESET_TIMEOUT_MS` |
| Memory entries cap | 10 000 | `MemoryStore.MAX_ENTRIES` |
| Memory per query | 10 | Runner: 8 agent + 4 user → top 10 |
| Latency rolling window | 50 calls | `CircuitBreaker` latency tracker |
| Global rate limit | 300 req/min | Gateway middleware |
| Command rate limit | 60 req/min | `/api/command` route |
| Request body limit | 1 MB | Fastify `bodyLimit` |

---

## 12. CRITICAL PATHS

| Scenario | Path |
|----------|------|
| Normal streaming response | Gateway → Orchestrator → Runner → ModelRouter → Provider → SSE |
| Provider failure + fallback | ModelRouter retry → CircuitBreaker open → fallback provider |
| Queue full | Orchestrator → `RunQueueFullError` → HTTP 429 |
| Guard denied | GuardEngine → `GuardDeniedError` → HTTP 403 |
| Tool call | Runner → ToolDispatcher → Tool → re-infer (up to 3×) |
| Handoff | Runner → AgentOrchestrator.runAgent(targetId) → append result |
| Memory miss | BM25 keyword fallback (embedding degraded) |
| Circuit open | Immediate `CircuitOpenError` → fallback or 503 |
| Config change | `fs.watch` debounced 500 ms → `providers.json` hot-reload |
| Idle timeout | Janitor (15 s interval) → `orchestrator.stopRun(runId)` |
