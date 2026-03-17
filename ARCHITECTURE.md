# Krythor Architecture Blueprint

**Version:** 1.0
**Date:** 2026-03-09
**Status:** Phase 1 — Architecture Definition

---

## 1. SYSTEM OVERVIEW

Krythor is a local-first AI command platform. It runs entirely on the user's machine. External connections are optional and user-controlled.

The system is divided into eight isolated modules that communicate through well-defined interfaces.

```
┌─────────────────────────────────────────────────────────────┐
│                     Krythor Control (UI)                    │
│              Command dashboard, memory manager              │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / WebSocket
┌────────────────────────▼────────────────────────────────────┐
│                    Krythor Gateway                          │
│         Local service layer — routes all requests           │
└───┬──────────┬──────────┬──────────┬──────────┬────────────┘
    │          │          │          │          │
    ▼          ▼          ▼          ▼          ▼
  Core      Memory     Models      Guard      Skills
```

---

## 2. MODULE BOUNDARIES

### Krythor Core
**Role:** Orchestration runtime
**Owns:** Agent lifecycle, task scheduling, tool dispatch, context management
**Does NOT own:** Storage, UI, model inference, security policy

Responsibilities:
- Spin up and shut down agents
- Route tasks to the correct agent or skill
- Inject memory context into agent prompts
- Collect and persist agent outputs
- Coordinate multi-agent workflows

### Krythor Gateway
**Role:** Local service layer
**Owns:** HTTP API, WebSocket server, request validation, session tokens
**Does NOT own:** Business logic, storage, model calls

Responsibilities:
- Expose a local REST + WebSocket API on `localhost`
- Authenticate requests from the Control UI
- Forward requests to Core, Memory, Models, Guard, Skills
- Stream responses back to the UI

### Krythor Control
**Role:** User interface
**Owns:** All UI rendering
**Does NOT own:** Data, logic, or storage

Responsibilities:
- Command input and agent chat
- Memory manager (view, edit, delete, pin, search)
- Model configuration panel
- Agent management panel
- Guard policy settings
- System status dashboard

### Krythor Memory
**Role:** Persistent local memory
**Owns:** `memory.db` (SQLite), optional vector index
**Does NOT own:** What to remember (decided by Core)

Responsibilities:
- Store and retrieve memory records
- Rank results by recency, importance, and semantic similarity
- Provide exact lookup by ID or tag
- Expose CRUD API consumed by Core and Control

### Krythor Models
**Role:** Model provider registry and routing
**Owns:** Provider configurations, model metadata, routing rules
**Does NOT own:** Memory, agents, UI

Responsibilities:
- Maintain provider registry (Ollama, OpenAI, Anthropic, local GGUF)
- Route model calls through priority hierarchy
- Handle fallback chains
- Report model availability and latency
- Badge each model: local / remote / default / agent-assigned / override-active

### Krythor Guard
**Role:** Security policy enforcement
**Owns:** Risk classification rules, permission prompts
**Does NOT own:** Execution logic

Responsibilities:
- Classify every action as SAFE / MODERATE / HIGH
- Block HIGH actions until explicit user approval is granted
- Request user confirmation for MODERATE actions
- Log all decisions
- Enforce active safety mode: Guarded / Balanced / Power User

### Krythor Skills
**Role:** Tool and skill execution framework
**Owns:** Skill registry, sandboxed execution
**Does NOT own:** Memory, model inference

Responsibilities:
- Maintain registry of installed skills
- Execute skills in isolated subprocesses
- Pass Guard approval before executing MODERATE or HIGH skills
- Return structured output to Core

### Krythor Setup
**Role:** Installer and onboarding wizard
**Owns:** Install scripts, onboarding state machine
**Does NOT own:** Runtime logic

Responsibilities:
- Detect OS
- Verify Node.js version
- Install pnpm if missing
- Install dependencies
- Build the application
- Create Krythor data directories
- Launch onboarding wizard (safety mode, first model, first agent)
- Start Krythor Control and Gateway

---

## 3. DATA FLOW

### User sends a command

```
User types command in Control
  → HTTP POST /api/command to Gateway
    → Gateway validates session token
      → Guard classifies action risk
        → if SAFE: proceed
        → if MODERATE: prompt user, await approval
        → if HIGH: require explicit approval
      → Core receives approved command
        → Core queries Memory for relevant context
        → Core selects model via Models routing hierarchy
        → Core invokes model with prompt + memory context
        → Core dispatches tools/skills if needed
          → Skills executes tool (after Guard approval)
          → Result returned to Core
        → Core stores result in Memory if warranted
        → Response streamed back through Gateway to Control
```

### Memory write

```
Core decides to persist a memory
  → Core calls Memory.write(record)
    → Memory stores to memory.db (SQLite)
    → If vector index enabled: Memory updates index
    → Returns record ID
```

### Model call

```
Core requests model inference
  → Core calls Models.route(agentConfig, taskContext)
    → Models checks: agent model override → global default → fallback chain
    → Models calls selected provider (Ollama / OpenAI / Anthropic / local)
    → Returns streamed or batched response
```

---

## 4. MEMORY SYSTEM DESIGN

### Storage

Primary store: SQLite database at `%LOCALAPPDATA%\Krythor\memory\memory.db`
Optional: Vector index at `%LOCALAPPDATA%\Krythor\memory\memory_index\`

### Memory Record Schema

```
id          TEXT PRIMARY KEY   -- UUID v4
title       TEXT NOT NULL
content     TEXT NOT NULL
source      TEXT               -- 'agent', 'user', 'skill', 'system'
scope       TEXT               -- 'user', 'agent', 'workspace', 'skill', 'session'
tags        TEXT               -- JSON array, e.g. ["task", "code", "project-x"]
timestamp   INTEGER            -- Unix epoch ms, created_at
last_used   INTEGER            -- Unix epoch ms, updated on each retrieval
importance  REAL               -- 0.0 to 1.0, user or system assigned
agent_id    TEXT               -- null if scope is not agent
project_id  TEXT               -- null if scope is not workspace
```

### Retrieval Strategy (priority order)

1. Exact lookup by ID or tag match
2. Semantic similarity search via vector index (if enabled)
3. Importance score descending
4. Recency (last_used) descending

### Memory Scopes

| Scope     | Description                              | Cleared On        |
|-----------|------------------------------------------|-------------------|
| session   | Temporary, in-memory only                | Session end       |
| user      | Persistent across all contexts           | Never (user only) |
| agent     | Tied to a specific agent                 | Agent deletion    |
| workspace | Tied to a project directory              | Project deletion  |
| skill     | Optional, per skill                      | Skill deletion    |

---

## 5. MODEL ROUTING DESIGN

### Routing Hierarchy

```
1. Skill/tool override      (highest priority)
   ↓ if not set
2. Agent-specific model
   ↓ if not set
3. Global default model
   ↓ if unavailable
4. Fallback model chain     (lowest priority)
```

### Provider Registry Schema

```
id            TEXT PRIMARY KEY
name          TEXT
type          TEXT    -- 'ollama' | 'openai' | 'anthropic' | 'openai-compat' | 'gguf'
endpoint      TEXT    -- base URL or file path
api_key       TEXT    -- encrypted at rest, null for local
is_default    BOOLEAN
is_enabled    BOOLEAN
models        TEXT    -- JSON array of available model IDs
```

### Model Badges

Each model displayed in the UI is tagged with one or more badges:

| Badge          | Meaning                                  |
|----------------|------------------------------------------|
| local          | Running on user's machine                |
| remote         | Requires external API call               |
| default        | Global default model                     |
| agent-assigned | Set as the model for a specific agent    |
| override-active| Skill or task is overriding the model    |

---

## 6. SECURITY SYSTEM DESIGN

### Risk Levels

| Level    | Action Required          | Examples                                   |
|----------|-------------------------|--------------------------------------------|
| SAFE     | None                    | Reading files, querying memory, inference  |
| MODERATE | User confirmation popup | Writing files, executing skills, system tools |
| HIGH     | Explicit typed approval | Shell execution, network access, importing untrusted skills, modifying system files |

### Safety Modes

| Mode        | Behavior                                              |
|-------------|-------------------------------------------------------|
| Guarded     | MODERATE actions require confirmation; HIGH blocked   |
| Balanced    | MODERATE auto-approved; HIGH requires confirmation    |
| Power User  | All actions proceed; HIGH only logs warning           |

### Guard Decision Log Schema

```
id          TEXT PRIMARY KEY
timestamp   INTEGER
action      TEXT
risk_level  TEXT    -- 'SAFE' | 'MODERATE' | 'HIGH'
decision    TEXT    -- 'approved' | 'denied' | 'auto-approved'
agent_id    TEXT
user_id     TEXT
```

---

## 7. LOCAL STORAGE LAYOUT

### Windows

```
C:\Krythor\                          Application installation
  core\
  gateway\
  control\
  memory\
  models\
  guard\
  skills\
  setup\

%LOCALAPPDATA%\Krythor\              User data (never deleted by updates)
  config\
    krythor.json                     Global config
    providers.json                   Model provider registry
    agents.json                      Agent definitions
    guard.json                       Security policy settings
  data\
  memory\
    memory.db                        SQLite memory database
    memory_index\                    Optional vector index
  models\                            Locally stored GGUF model files
  logs\
    krythor.log
    guard.log
  projects\                          Per-project workspace data
```

### macOS

```
/Applications/Krythor/              Application installation
~/Library/Application Support/Krythor/   User data
```

### Linux

```
/opt/krythor/                       Application installation
~/.local/share/krythor/             User data
```

---

## 8. ONBOARDING FLOW

```
Start Krythor Setup
  │
  ├─ Detect OS
  ├─ Verify Node.js >= 18
  │   └─ If missing: show install instructions, exit
  ├─ Install pnpm if missing
  ├─ Install dependencies (pnpm install)
  ├─ Build application (pnpm build)
  ├─ Create data directories
  ├─ Launch onboarding wizard
  │
  Onboarding Wizard (Krythor Control — setup mode)
  │
  Step 1: Welcome screen
  │   Show Krythor branding, version, brief description
  │
  Step 2: Choose safety mode
  │   Guarded / Balanced / Power User
  │   Explain each option clearly
  │
  Step 3: Configure first model provider
  │   Choose: Ollama (local) / OpenAI / Anthropic / Custom endpoint
  │   Enter API key if required
  │   Test connection
  │
  Step 4: Create first agent (optional)
  │   Name, description, model assignment
  │
  Step 5: Complete
  │   Show summary
  │   Launch Krythor Control main dashboard
```

---

## 9. GATEWAY API DESIGN (Phase 2)

All endpoints served on `http://localhost:PORT` (default: 47200).

```
POST   /api/command          Submit a command to Core
GET    /api/agents           List agents
POST   /api/agents           Create agent
PATCH  /api/agents/:id       Update agent
DELETE /api/agents/:id       Delete agent

GET    /api/memory           List memory records (with filters)
GET    /api/memory/:id       Get memory record
POST   /api/memory           Create memory record
PATCH  /api/memory/:id       Update memory record
DELETE /api/memory/:id       Delete memory record

GET    /api/models           List providers and models
POST   /api/models/providers Add provider
DELETE /api/models/providers/:id Remove provider

GET    /api/guard/log        View Guard decision log
PATCH  /api/guard/settings   Update safety mode

WS     /ws/stream            Stream agent responses to Control
```

---

## 10. PHASED IMPLEMENTATION ROADMAP

### Phase 1 — Architecture Blueprint ✅
Define all module boundaries, schemas, flows, and storage layout.
Deliverable: This document (`ARCHITECTURE.md`)

---

### Phase 2 — Base Module Structure and Runtime
- Initialize monorepo with pnpm workspaces
- Create package stubs for all 8 modules
- Implement Krythor Gateway (local HTTP + WebSocket server)
- Implement Krythor Core (minimal orchestration loop)
- Wire Gateway → Core
- Verify: `pnpm build` passes; Gateway starts; Core receives a test command

---

### Phase 3 — Krythor Memory
- Implement SQLite schema with `better-sqlite3`
- Implement CRUD operations
- Implement retrieval strategy (exact, recency, importance)
- Expose Memory API endpoints via Gateway
- Verify: memory records can be written and retrieved via API

---

### Phase 4 — Krythor Models
- Implement provider registry (config file backed)
- Implement routing hierarchy (skill override → agent → global → fallback)
- Add Ollama adapter
- Add OpenAI adapter
- Add Anthropic adapter
- Add OpenAI-compatible adapter
- Expose Models API via Gateway
- Verify: model call routed to Ollama returns a response

---

### Phase 5 — Agent Orchestration
- Implement agent definition schema
- Implement agent lifecycle (create, start, stop, delete)
- Connect agents to Memory (context injection)
- Connect agents to Models (model routing)
- Support sequential and parallel agent execution
- Verify: agent completes a multi-step task using memory and a model

---

### Phase 6 — Krythor Guard
- Implement risk classification rules
- Implement Guard decision log
- Implement safety mode enforcement
- Wire Guard into Gateway request pipeline
- Verify: HIGH risk action is blocked until approval; log entry recorded

---

### Phase 7 — Krythor Control UI
- Scaffold UI with Vite + React + TypeScript
- Apply Krythor visual theme (gold, electric blue, deep navy)
- Implement command input and agent chat panel
- Implement Memory Manager (view, edit, delete, pin, search)
- Implement Model configuration panel
- Implement Guard policy settings
- Implement system status dashboard
- Verify: full round-trip from UI command to agent response visible in UI

---

### Phase 8 — Krythor Setup (Installer and Onboarding)
- Write OS-aware installer scripts (Windows .ps1, macOS/Linux .sh)
- Implement onboarding wizard as first-launch flow in Control
- Implement safety mode selection, first provider setup, first agent creation
- Verify: fresh install on Windows, macOS, and Linux reaches main dashboard

---

## 11. KEY DESIGN CONSTRAINTS

- No telemetry by default
- No hidden analytics
- No background remote execution
- No forced cloud storage
- No cloning of third-party repositories during install
- All module interfaces must be versioned to allow independent updates
- SQLite is the only required database dependency (no Postgres, no Redis)
- The vector index (for semantic memory search) is optional and off by default

---

## 12. TECHNOLOGY STACK RECOMMENDATIONS

| Layer        | Technology                              |
|--------------|-----------------------------------------|
| Runtime      | Node.js >= 18                           |
| Package mgr  | pnpm workspaces                         |
| Language     | TypeScript (strict mode)                |
| Gateway      | Fastify (lightweight, fast)             |
| Database     | SQLite via `better-sqlite3`             |
| Vector index | `usearch` or `hnswlib-node` (optional)  |
| UI framework | Vite + React + TypeScript               |
| UI styling   | Tailwind CSS with custom Krythor theme  |
| Build tool   | tsup (for Node modules), Vite (for UI) |
| Testing      | Vitest                                  |

---

*End of Krythor Architecture Blueprint v1.0*
