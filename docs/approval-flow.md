# Approval Flow

When a guard policy rule has `action: require-approval`, the requesting operation is paused and a pending approval record is created. An operator must respond within the timeout window (default 30 seconds) or the action is automatically denied.

---

## Lifecycle

```
Agent calls tool
      |
      v
GuardEngine.check() → verdict: require-approval
      |
      v
ApprovalManager.requestApproval(approval, timeoutMs)
      |
      +──────────────────────────────────────+
      |                                      |
      v                                      v
Operator responds via UI or API         Timeout (30s)
POST /api/approvals/:id/respond              |
{ response: "allow_once" }                  v
      |                              Auto-deny → action blocked
      v
Response resolves the pending Promise
      |
      v
   allow_once → proceeds once
   allow_for_session → proceeds; stored for session
   deny → BlockedActionError thrown
```

---

## ApprovalManager API

### requestApproval()

```typescript
const response = await approvalManager.requestApproval(
  {
    agentId: 'agent-123',
    toolName: 'web_fetch',
    actionType: 'network:fetch',
    target: 'https://example.com/sensitive-data',
    reason: 'Agent wants to fetch external URL',
    riskSummary: 'Outbound network request to unknown domain',
    context: { url: 'https://example.com/sensitive-data' },
  },
  30_000  // timeout in ms
);
// response: 'allow_once' | 'allow_for_session' | 'deny'
```

### Session approvals

When `allow_for_session` is granted, subsequent `requestApproval` calls with the same `agentId + actionType` combination resolve immediately without user interaction for the lifetime of the gateway process.

Clear all session approvals:

```bash
curl -X DELETE http://127.0.0.1:47200/api/approvals/session \
  -H "Authorization: Bearer $KRYTHOR_TOKEN"
```

---

## REST API

### GET /api/approvals

Returns all pending approvals (auto-expires those past their deadline).

```json
{
  "approvals": [
    {
      "id": "3f2a1b-...",
      "requestedAt": "2026-03-26T14:00:00.000Z",
      "expiresAt": "2026-03-26T14:00:30.000Z",
      "agentId": "agent-123",
      "toolName": "web_fetch",
      "actionType": "network:fetch",
      "target": "https://example.com",
      "reason": "Agent wants to fetch external URL",
      "riskSummary": "Outbound network request",
      "context": {}
    }
  ],
  "count": 1
}
```

### POST /api/approvals/:id/respond

```json
{ "response": "allow_once" }
```

Valid responses: `allow_once`, `allow_for_session`, `deny`.

Returns `{ ok: true }` on success, `404` if the approval ID is not found.

### DELETE /api/approvals/session

Clears all session-level approval overrides. Returns `{ cleared: true }`.

---

## Control UI

The `ApprovalModal` component polls `GET /api/approvals` every 2 seconds. When a pending approval is found:

- A modal is displayed with action type, target, agent name, risk summary, and a countdown timer.
- Risk colour coding: `critical`/`high` → red, `medium` → amber, `low` → green.
- Three buttons: **Deny** (red), **Allow Once** (neutral), **Allow for Session** (green).
- The modal auto-dismisses if the server-side approval expires.

The modal is rendered globally above all tab content in `App.tsx` so it appears regardless of which panel is active.

---

## Timeout Behaviour

The default timeout is 30 seconds. If no response is received within the window, `requestApproval` resolves with `'deny'` and the action is blocked. This prevents hung agent tasks when an operator is unavailable.

To adjust the timeout, pass `timeoutMs` to `requestApproval`:

```typescript
// 5-minute approval window for sensitive long-running tasks
await approvalManager.requestApproval(approval, 5 * 60 * 1000);
```

---

## Audit Integration

Every approval request and response is recorded in the audit log:

```json
{
  "actionType": "guard:approval-required",
  "agentId": "agent-123",
  "toolName": "web_fetch",
  "policyDecision": "require-approval",
  "approvalResult": "allow_once",
  "executionOutcome": "success"
}
```

View recent approval events:

```bash
krythor audit tail --outcome blocked
krythor audit tail --limit 50 | grep approval
```
