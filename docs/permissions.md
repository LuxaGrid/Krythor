# Agent Access Profiles & File Permissions

This document explains how Krythor controls what files and system resources each agent can access.

---

## Overview

Every agent in Krythor is assigned an **access profile** that determines which file operations it may perform and what level of shell access it has. Access profiles are enforced at the tool layer — before any file operation executes, the gateway checks the active agent's profile against the requested path and operation.

The three profiles are: `safe`, `standard`, and `full_access`.

---

## Access Profile Reference

| Profile | File Access | Shell Access | Default |
|---------|-------------|--------------|---------|
| `safe` | Workspace directory only | No | Yes |
| `standard` | Workspace + non-system paths | With confirmation hooks | |
| `full_access` | Unrestricted local filesystem | Yes (unrestricted) | |

### safe

- Agents may only read and write files within the configured workspace directory (typically `<dataDir>/workspace/`).
- All paths are resolved and checked to ensure they remain inside the workspace root. Any attempt to traverse outside (e.g., `../../etc/passwd`) is rejected.
- Shell execution tools are not available to `safe` agents regardless of the tool permission settings on the agent.
- This is the default profile for all newly created agents.

### standard

- Agents may access the workspace directory and any non-system path on the local filesystem.
- System directories are blocked by a hard-coded blocklist (see Path Enforcement below).
- Shell execution is available but routed through confirmation hooks — the gateway emits a `tool:exec:confirm` event before execution; integrations can veto the call.
- Suitable for agents that need broader file access without full unrestricted power.

### full_access

- No path restrictions. The agent may read, write, move, copy, or delete any file the OS user running Krythor has permission to access.
- Shell access is unrestricted.
- Use with caution. The UI displays a red badge with a warning indicator on any agent using this profile.
- All operations are still recorded in the audit log.

---

## Available File Operation Tools

Agents with an appropriate access profile can invoke these 9 tools:

| Tool | Description |
|------|-------------|
| `read_file` | Read the contents of a file |
| `write_file` | Write (overwrite) a file with new content |
| `edit_file` | Apply a targeted string replacement in a file |
| `move_file` | Move or rename a file |
| `copy_file` | Copy a file to a new path |
| `delete_file` | Permanently delete a file |
| `make_directory` | Create a directory (including nested parents) |
| `list_directory` | List the contents of a directory |
| `stat_path` | Return metadata about a file or directory (size, mtime, type) |

All tools are exposed via the REST API under `/api/tools/files/`.

---

## Path Enforcement

### Workspace detection

The workspace root is resolved from the gateway configuration at startup. When an agent's profile is `safe`, every requested path is run through `path.resolve()` and then tested with `startsWith(workspaceRoot)`. If the resolved path escapes the workspace, the operation is rejected with a `403 PATH_OUTSIDE_WORKSPACE` error before any filesystem access occurs.

### System directory blocklist

For `standard` profile agents, a blocklist of system directories prevents accidental or malicious modification of critical OS locations. The blocklist includes (but is not limited to):

- `/etc`, `/bin`, `/sbin`, `/usr/bin`, `/usr/sbin`, `/lib`, `/lib64`
- `/boot`, `/dev`, `/proc`, `/sys`
- `C:\Windows`, `C:\Windows\System32`, `C:\Program Files`, `C:\Program Files (x86)`
- macOS: `/System`, `/Library`, `/private/etc`

Any path that starts with a blocklisted directory is rejected with a `403 PATH_BLOCKED` error regardless of whether the OS would have allowed the access.

`full_access` agents bypass both the workspace check and the blocklist.

---

## Audit Log

Every file operation — successful or rejected — is appended to the audit log.

### Log location

```
~/.krythor/file-audit.log
```

On Windows this resolves to `%USERPROFILE%\.krythor\file-audit.log`.

### Log format

Each entry is a single JSON line (newline-delimited JSON):

```json
{
  "timestamp": "2026-03-26T14:23:01.456Z",
  "agentId": "agent-abc123",
  "agentName": "Research Agent",
  "profile": "standard",
  "tool": "read_file",
  "path": "/home/user/projects/notes.md",
  "outcome": "allowed",
  "requestId": "req-xyz789"
}
```

| Field | Description |
|-------|-------------|
| `timestamp` | ISO 8601 UTC timestamp |
| `agentId` | ID of the agent that made the call |
| `agentName` | Display name of the agent |
| `profile` | The access profile active at time of the operation |
| `tool` | Which file tool was invoked |
| `path` | The fully resolved absolute path that was accessed |
| `outcome` | `allowed`, `denied_workspace`, `denied_blocklist`, or `error` |
| `requestId` | Correlates to the gateway request log for the same operation |

### Viewing audit logs via the API

```bash
GET /api/tools/files/audit
Authorization: Bearer <token>
```

Query parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `limit` | 100 | Maximum entries to return |
| `page` | 1 | Page number |
| `agentId` | — | Filter to a specific agent |
| `outcome` | — | Filter by outcome (`allowed`, `denied_workspace`, etc.) |
| `since` | — | ISO 8601 timestamp — return entries after this time |

---

## Changing an Agent's Access Profile

### Via the UI

1. Go to the **Agents** panel.
2. Each agent card displays its current access profile as a colored badge.
3. Click the badge to open the profile selector.
4. Choose `safe`, `standard`, or `full_access` and confirm.

The `full_access` badge is displayed in red with a warning indicator to make it visually distinct.

### Via the API

```bash
# Read the current profile
GET /api/agents/:id/access-profile
Authorization: Bearer <token>

# Update the profile
PUT /api/agents/:id/access-profile
Authorization: Bearer <token>
Content-Type: application/json

{ "profile": "standard" }
```

Valid values for `profile`: `safe`, `standard`, `full_access`.

---

## Security Recommendations

1. **Leave new agents on `safe`** — the default. Only elevate to `standard` or `full_access` when a specific task genuinely requires it, and lower it back afterward.

2. **Audit `full_access` usage regularly** — query the audit log filtered by `profile=full_access` to review what operations are actually being performed under full access.

3. **Use `standard` instead of `full_access` for most automation** — the system directory blocklist in `standard` mode prevents the most dangerous accidental writes, while still giving broad access.

4. **Review the audit log after unfamiliar agent runs** — if an agent you did not configure ran file operations, the audit log will show exactly what paths were touched and what the outcome was.

5. **Run Krythor under a non-root OS user** — even with `full_access`, the agent can only do what the OS user running Krythor can do. Running as a limited user provides an OS-level safety boundary.

6. **Do not store secrets inside the workspace directory** — agents with `safe` profile can read all files in the workspace. Keep credentials in the system credential store, not as plain files in the workspace.
