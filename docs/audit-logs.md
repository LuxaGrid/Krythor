# Audit Logs

Krythor records a structured, append-only audit log of agent runs, guard decisions, approval events, and model inference calls. The log is stored as NDJSON (newline-delimited JSON) and can be queried via CLI or REST API.

---

## Log Location

```
<dataDir>/logs/audit.ndjson
```

Default paths:
- Windows: `%LOCALAPPDATA%\Krythor\logs\audit.ndjson`
- macOS: `~/Library/Application Support/Krythor/logs/audit.ndjson`
- Linux: `~/.local/share/krythor/logs/audit.ndjson`

Override with `KRYTHOR_DATA_DIR`.

---

## Event Schema

Each line in `audit.ndjson` is a JSON object:

```typescript
interface AuditEvent {
  id: string;                          // UUID assigned on write
  timestamp: string;                   // ISO 8601 UTC
  requestId?: string;                  // Correlated request ID
  agentId?: string;
  agentName?: string;
  toolName?: string;
  skillName?: string;
  actionType: string;                  // e.g. 'agent:run', 'model:infer', 'guard:decided'
  target?: string;                     // URL, file path, command, etc.
  policyDecision?: 'allow' | 'deny' | 'warn' | 'require-approval';
  approvalResult?: string;
  executionOutcome?: 'success' | 'error' | 'blocked' | 'timeout';
  modelUsed?: string;
  providerId?: string;
  fallbackOccurred?: boolean;
  reason?: string;
  durationMs?: number;
  contentHash?: string;                // SHA-256 hex of content (never raw content)
  privacyDecision?: {
    sensitivityLabel: string;
    remoteAllowed: boolean;
    reroutedTo?: string;
    reason: string;
  };
}
```

---

## Action Types

| actionType | Source | Description |
|---|---|---|
| `agent:run:started` | Gateway | Agent run began |
| `agent:run:completed` | Gateway | Agent run finished successfully |
| `agent:run:failed` | Gateway | Agent run encountered an error |
| `guard:decided` | GuardEngine | Policy evaluation produced a non-trivial verdict |
| `model:infer` | PrivacyRouter | LLM inference (includes privacyDecision) |
| Custom | Any | Tools and skills may emit their own action types |

---

## CLI Commands

### audit tail

Print recent events to stdout:

```bash
krythor audit tail
krythor audit tail --limit 50
krythor audit tail --outcome blocked
krythor audit tail --outcome error
krythor audit tail --agent my-agent-name
krythor audit tail --json                 # raw JSON array
```

Flags:
- `--limit N` — number of events to show (default: 20)
- `--outcome <value>` — filter by `executionOutcome`: success, error, blocked, timeout
- `--agent <id>` — substring filter on `agentId` or `agentName`
- `--json` — output raw JSON array

### audit explain

Show full detail for a single event:

```bash
krythor audit explain 3f2a1b
```

Matches any event ID that starts with the given prefix. Displays a human-readable summary and the full raw JSON.

---

## REST API

All audit API routes require the gateway auth token:

```
Authorization: Bearer <token>
```

### GET /api/audit

Filtered query, most-recent-first:

```
GET /api/audit?limit=50&agentId=agent-1&actionType=guard&executionOutcome=blocked
GET /api/audit?from=2026-03-26T00:00:00Z&to=2026-03-26T23:59:59Z
```

Query parameters:

| Parameter | Type | Description |
|---|---|---|
| `limit` | number | Max events to return (default: 100) |
| `agentId` | string | Exact match on agentId |
| `actionType` | string | Substring match on actionType |
| `executionOutcome` | string | Exact match on executionOutcome |
| `from` | ISO 8601 | Events at or after this time |
| `to` | ISO 8601 | Events at or before this time |

Response:

```json
{
  "events": [...],
  "total": 42
}
```

### GET /api/audit/tail?limit=N

Returns the last N events (most-recent-last order):

```
GET /api/audit/tail?limit=10
```

---

## AuditPanel (Control UI)

The **Audit Log** tab in the Control UI provides:

- Paginated table (50 events per page)
- Filter bar: action type, agent ID, outcome, date range
- Colour coding: success = green, blocked/error = red, timeout = amber
- Privacy badges on rows where rerouting occurred
- Auto-refresh toggle (5-second interval)
- Row click to expand full event JSON

---

## Content Hashing

Raw content (messages, file contents, URLs) is never stored in audit events. Instead, `AuditLogger.hashContent(content)` computes a SHA-256 hex digest:

```typescript
const hash = AuditLogger.hashContent('sensitive content here');
// "a591a6d40bf420404a011733cfb7b190..."
```

This allows correlation of events involving the same content without storing the content itself.

---

## In-Memory Ring Buffer

`AuditLogger` maintains a ring buffer of the last 10,000 events. Events in the buffer can be queried without disk I/O. Events are also appended to the NDJSON file for persistence.

On startup, the logger reads the existing NDJSON file and populates the ring buffer. If the file contains more than 10,000 events, only the most recent 10,000 are loaded into memory.

---

## Log Rotation

Log rotation is not currently implemented. The NDJSON file grows indefinitely. For long-running deployments, rotate manually:

```bash
# Archive and reset
mv ~/.local/share/krythor/logs/audit.ndjson \
   ~/.local/share/krythor/logs/audit-$(date +%Y%m%d).ndjson
```

The gateway will create a new `audit.ndjson` on the next event.
