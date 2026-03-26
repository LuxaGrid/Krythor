# Krythor Guardrails — Overview

The Guardrails Stack is a layered safety and compliance system that sits between agents, tools, and external resources. It enforces policy rules, requires human approval for high-risk actions, routes sensitive content to local models, records a tamper-evident audit trail, and provides CLI tools for operators.

---

## Architecture

```
Agent / Skill
     |
     v
GuardEngine  ──── PolicyEngine ──── PolicyStore (policy.json / policy.yaml)
     |
     | check() / assert()
     v
ActionNormalizer  ──  NormalizedAction  ──  GuardContext
     |
     v
ApprovalManager  (require-approval actions block until user responds)
     |
     v
PrivacyRouter  (classifies content; reroutes to local model if sensitive)
     |
     v
ModelEngine / ExecTool / WebSearchTool / WebhookTool / ...
     |
     v
AuditLogger  (append-only NDJSON; SHA-256 content hashing)
     |
     v
GET /api/audit  ──── AuditPanel (Control UI)
```

---

## Components

### GuardEngine (packages/guard)
Core guard runtime. Evaluates `GuardContext` against `PolicyEngine` rules and returns a `GuardVerdict`. Pre-existing; the Guardrails Stack builds on top of it.

### PolicyLoader (packages/guard/src/PolicyLoader.ts)
Loads YAML or JSON policy files, validates all fields, and normalizes rules. See [policy-format.md](./policy-format.md).

### ActionNormalizer (packages/guard/src/ActionNormalizer.ts)
Converts raw action inputs (type, actor, target, content) into a `NormalizedAction` and `GuardContext` for evaluation. Maps all supported operation types; defaults unknown operations to `command:execute`.

### ApprovalManager (packages/gateway/src/ApprovalManager.ts)
Manages pending human approvals. When a `require-approval` verdict is returned, the gateway blocks the action and waits up to 30 seconds for the operator to respond. Supports session-level overrides. See [approval-flow.md](./approval-flow.md).

### PrivacyRouter (packages/models/src/PrivacyRouter.ts)
Wraps `ModelEngine`. Classifies request content by sensitivity (public / internal / private / restricted) and reroutes to a local provider (Ollama, GGUF, localhost OpenAI-compat) when the content is not safe for cloud transmission. See [privacy-routing.md](./privacy-routing.md).

### AuditLogger (packages/gateway/src/AuditLogger.ts)
Append-only NDJSON audit log. Keeps the last 10,000 events in a ring buffer for fast in-process queries; all events are also written to `<dataDir>/logs/audit.ndjson`. See [audit-logs.md](./audit-logs.md).

### SandboxProvider (packages/core/src/sandbox/)
Interface abstraction for execution environments. `LocalSandboxProvider` wraps `child_process.spawn` (no isolation). `DockerSandboxProvider` is a stub for future implementation. Activated via `KRYTHOR_SANDBOX=docker` env var.

### GuardrailsCLI (packages/setup/src/GuardrailsCLI.ts)
Five CLI operator commands exposed through `start.js`. See [CLI commands](#cli-commands) below.

---

## CLI Commands

| Command | Description |
|---|---|
| `krythor policy check` | Validate the active policy file |
| `krythor policy doctor` | Deep policy health diagnostics |
| `krythor audit tail` | Print recent audit events |
| `krythor audit explain <id>` | Full detail for one audit event |
| `krythor config init-guardrails` | Scaffold default policy YAML files |

Run `krythor help <command>` for full flag documentation.

### Quick Start

```bash
# 1. Create default policy
krythor config init-guardrails

# 2. Validate it
krythor policy check

# 3. Run diagnostics
krythor policy doctor

# 4. Start the gateway and use agents
krythor

# 5. Inspect audit events
krythor audit tail --limit 20
krythor audit tail --outcome blocked
krythor audit explain <id>
```

---

## Guard Interception Points

### Agent tool calls (AgentRunner)
Before `web_search`, `web_fetch`, and custom/webhook tool calls, the runner calls `guard.check()`. If the verdict is `deny`, the tool call is blocked and a policy-blocked message is returned to the agent. The guard instance is injected via `AgentOrchestrator.setGuard()`.

### Direct guard.check() usage
Any code that holds a `GuardEngine` reference (or any object that satisfies `GuardLike`) can call:

```typescript
const verdict = guard.check({
  operation: 'network:fetch',
  source: 'agent',
  sourceId: agentId,
  content: url,
});
if (!verdict.allowed) throw new BlockedActionError(verdict, normalizedAction);
```

---

## Supported Operations

| Operation | Default risk | Notes |
|---|---|---|
| `file:read` | low | |
| `file:write` | medium | |
| `file:delete` | high | |
| `memory:read` | low | |
| `memory:write` | medium | |
| `memory:delete` | high | |
| `memory:export` | high | Full memory dump |
| `command:execute` | high | Shell command execution |
| `command:list` | low | |
| `network:fetch` | low | Outbound HTTP fetch |
| `network:search` | low | Web search |
| `webhook:call` | medium | Outbound webhook |
| `agent:spawn` | high | Sub-agent creation |
| `agent:kill` | medium | |
| `model:infer` | low | LLM inference |
| `config:read` | low | |
| `config:write` | high | |

---

## Configuration Files

Default policy location (in order of discovery):

```
<configDir>/policy.json
<configDir>/policy.yaml
<configDir>/policy.yml
<configDir>/guardrails/policy.yaml
<configDir>/guardrails/policy.yml
```

`configDir` defaults to:
- Windows: `%LOCALAPPDATA%\Krythor\config`
- macOS: `~/Library/Application Support/Krythor/config`
- Linux: `~/.local/share/krythor/config`

Override with `KRYTHOR_DATA_DIR` environment variable.

---

## Environment Variables

| Variable | Effect |
|---|---|
| `KRYTHOR_DATA_DIR` | Override the data directory root |
| `KRYTHOR_SANDBOX` | Set to `docker` to use `DockerSandboxProvider` (throws NotImplementedError until Docker integration is built) |

---

## Security Notes

- `AuditLogger.hashContent()` computes SHA-256 of content. Raw content is never stored in audit events — only the hash.
- `ApprovalManager` auto-denies after 30 seconds to prevent deadlock.
- `LocalSandboxProvider` provides **no isolation** — processes run on the host. Use only for development. Wait for `DockerSandboxProvider` for production isolation.
- Policy files are read-only at runtime; changes require a gateway restart.

---

## Related Docs

- [policy-format.md](./policy-format.md) — Policy file schema reference
- [approval-flow.md](./approval-flow.md) — Approval lifecycle and API
- [privacy-routing.md](./privacy-routing.md) — Sensitivity classification and local rerouting
- [audit-logs.md](./audit-logs.md) — Audit log format and query API
