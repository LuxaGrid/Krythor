# Policy File Format

Krythor policy files control what operations agents and skills are allowed to perform. Files are loaded by `PolicyLoader` at gateway startup and evaluated by `GuardEngine` at runtime.

---

## File Location

Policy files are discovered in this order (first match wins):

```
<configDir>/policy.json
<configDir>/policy.yaml
<configDir>/policy.yml
<configDir>/guardrails/policy.yaml
<configDir>/guardrails/policy.yml
```

Run `krythor config init-guardrails` to create a default policy at `<configDir>/guardrails/policy.yaml`.

---

## Top-Level Fields

```yaml
version: 1                  # Required. Schema version (currently 1).
defaultAction: warn         # Required. Fallback when no rule matches.
                            # Values: allow | deny | warn | require-approval
rules: []                   # Array of rule objects (see below).
```

### defaultAction values

| Value | Behaviour |
|---|---|
| `allow` | Action proceeds without intervention |
| `deny` | Action is blocked; `BlockedActionError` is thrown |
| `warn` | Action proceeds but is logged as a warning |
| `require-approval` | Action blocks until operator responds (or 30s timeout → deny) |

---

## Rule Object

```yaml
rules:
  - id: my-rule-id           # Recommended. UUID or slug. Auto-assigned if missing.
    description: "..."       # Optional. Human-readable description.
    operation: file:write    # Required. See supported operations below.
    action: warn             # Required. Same values as defaultAction.
    minRisk: medium          # Optional. Only apply rule if risk >= this level.
                             # Values: low | medium | high | critical
    sources:                 # Optional. Restrict to specific sources.
      - agent
      - skill
    targets:                 # Optional. Substring match on target path/URL.
      - /etc
      - /windows
    enabled: true            # Optional. Defaults to true. Set false to disable.
    priority: 10             # Optional. Lower number = evaluated first.
```

---

## Supported Operations

```
file:read        file:write       file:delete
memory:read      memory:write     memory:delete     memory:export
command:execute  command:list
network:fetch    network:search
webhook:call
agent:spawn      agent:kill
model:infer
config:read      config:write
```

---

## Sources

| Source | Description |
|---|---|
| `agent` | An agent (AgentRunner) |
| `skill` | A skill execution |
| `user` | Direct user action |
| `system` | Gateway-internal operation |
| `api` | External API call |

---

## Risk Levels

| Level | Examples |
|---|---|
| `low` | Read operations, searches |
| `medium` | Writes, webhook calls |
| `high` | Deletes, command execution, agent spawning |
| `critical` | Config writes, mass operations |

---

## Examples

### Strict production policy (YAML)

```yaml
version: 1
defaultAction: deny

rules:
  # Allow agents to read files
  - id: allow-file-read
    operation: file:read
    action: allow
    sources: [agent, skill]

  # Warn on file writes
  - id: warn-file-write
    operation: file:write
    action: warn

  # Require approval for deletes
  - id: approve-file-delete
    operation: file:delete
    action: require-approval

  # Block config writes from agents
  - id: deny-config-write-agent
    operation: config:write
    action: deny
    sources: [agent, skill]

  # Allow web searches
  - id: allow-search
    operation: network:search
    action: allow

  # Require approval for web fetch (allows human review of outbound requests)
  - id: approve-fetch
    operation: network:fetch
    action: require-approval

  # Deny command execution entirely
  - id: deny-exec
    operation: command:execute
    action: deny
```

### Permissive development policy (JSON)

```json
{
  "version": 1,
  "defaultAction": "allow",
  "rules": [
    {
      "id": "warn-deletes",
      "operation": "file:delete",
      "action": "warn"
    },
    {
      "id": "warn-webhooks",
      "operation": "webhook:call",
      "action": "warn"
    }
  ]
}
```

---

## Validation

Run `krythor policy check` to validate your policy file:

```
$ krythor policy check
  PASS  defaultAction: warn
  PASS  version: 1
  PASS  rules: 8 rule(s) found

  Policy check passed.
```

Run `krythor policy doctor` for extended diagnostics including directory checks, audit log status, and strict-mode recommendations.

---

## Multiple Files

Only the first discovered policy file is loaded. If you want to maintain separate policies for different environments, use the `KRYTHOR_DATA_DIR` environment variable:

```bash
KRYTHOR_DATA_DIR=/etc/krythor-prod krythor policy check
```

---

## Merging Policies (programmatic)

```typescript
import { loadPolicyFromYaml, mergePolicyConfigs } from '@krythor/guard';

const base     = loadPolicyFromYaml('/etc/krythor/policy.yaml');
const override = loadPolicyFromYaml('/home/user/.krythor/policy-override.yaml');
const merged   = mergePolicyConfigs(base, override);
```

`mergePolicyConfigs` appends override rules after base rules and uses the override's `defaultAction` if set.
