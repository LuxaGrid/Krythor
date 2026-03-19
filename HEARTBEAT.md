# HEARTBEAT.md — Krythor Maintenance Schedule
version: 1
updated: 2026-03-18

---

## Purpose

The heartbeat is Krythor's internal maintenance loop. It is not autonomous behavior. It is scheduled hygiene: reviewing state, surfacing patterns, and preparing better future behavior — without taking actions the user has not authorized.

The heartbeat runs periodically in the background. It is observable, bounded, and disableable.

---

## Schedule

| Check | Interval | Description |
|-------|----------|-------------|
| task_review | 30 minutes | Surface any pending or interrupted agent runs |
| stale_state | 1 hour | Identify temporary context that has not been touched in over 2 hours |
| failed_skills | 1 hour | Review recent skill execution failures for pattern recognition |
| memory_hygiene | 6 hours | Suggest memory consolidation if fragmentation is detected |
| learning_summary | 24 hours | Consolidate learning records older than 7 days into summaries |
| model_signal | 24 hours | Update recommendation weights based on recent override patterns |

---

## Behavior Rules

**The heartbeat does not perform dangerous actions.**
It may flag, suggest, or log. It may clean low-value temporary state that is explicitly configured as ephemeral. It must not delete durable memory, overwrite user-authored content, or call external APIs without explicit authorization.

**The heartbeat does not spam.**
If a check finds nothing actionable, it completes silently. It surfaces only meaningful, non-redundant signals. Each insight type is rate-limited to prevent repetition.

**The heartbeat is bounded in time.**
Each heartbeat run has a hard timeout (default: 60 seconds). If it exceeds that, the run is cancelled and logged. A partial heartbeat is better than a runaway one.

**The heartbeat is observable.**
All runs are logged with a timestamp, duration, which checks ran, and what (if anything) was surfaced or acted on.

**The heartbeat is disableable.**
Setting `heartbeat.enabled: false` in config stops all heartbeat activity immediately. Individual check types can also be disabled independently.

---

## What the Heartbeat Will Never Do

- Silently overwrite user-authored memory
- Modify SOUL.md or HEARTBEAT.md without explicit admin approval
- Call external network endpoints (other than checking model provider availability, if enabled)
- Delete conversation history or agent run records outside of configured retention windows
- Take destructive actions without surfacing them first
- Run while Krythor is handling an active user request (deferred until quiet)

---

## Surfaced Insights Format

When the heartbeat has something worth surfacing, it emits a structured insight:

```json
{
  "type": "heartbeat_insight",
  "checkId": "memory_hygiene",
  "severity": "info",
  "message": "23 session-scope entries are older than 48h and below importance threshold. Consider pruning.",
  "actionable": true,
  "suggestedAction": "prune_stale_session_memory",
  "timestamp": "2026-03-18T12:00:00Z"
}
```

Severity levels: `info`, `warning`. No `error` severity — errors are logged separately.

---

## Configuration Reference

All heartbeat config lives under `krythor.heartbeat` in the app config file:

```json
{
  "heartbeat": {
    "enabled": true,
    "timeoutMs": 60000,
    "checks": {
      "task_review": { "enabled": true, "intervalMs": 1800000 },
      "stale_state": { "enabled": true, "intervalMs": 3600000 },
      "failed_skills": { "enabled": true, "intervalMs": 3600000 },
      "memory_hygiene": { "enabled": true, "intervalMs": 21600000 },
      "learning_summary": { "enabled": true, "intervalMs": 86400000 },
      "model_signal": { "enabled": true, "intervalMs": 86400000 }
    }
  }
}
```

---

*This file defines Krythor's scheduled maintenance behavior. It is loaded at boot alongside SOUL.md. Failures to load this file degrade to safe built-in defaults — the heartbeat will not run if configuration cannot be parsed.*
