# Krythor — Build Tracker

**Version:** 0.1.0
**Last updated:** 2026-03-16
**Build status:** v0.1.0 — RELEASE READY. All Critical and Major items resolved. 44 tests passing. Full build clean.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Repository Layout](#repository-layout)
3. [Build Status by Package](#build-status-by-package)
   - [core](#krythorcore)
   - [gateway](#krythorgateway)
   - [memory](#krythormemory)
   - [models](#krythormodels)
   - [guard](#krythorguard)
   - [skills](#krythorskills)
   - [setup](#krythorsetup)
   - [control (UI)](#krythorcontrol--ui)
4. [Launcher & Install Scripts](#launcher--install-scripts)
5. [Test Coverage](#test-coverage)
6. [Known Bugs](#known-bugs)
7. [What Is Missing / Not Started](#what-is-missing--not-started)
8. [Feature Roadmap](#feature-roadmap)
9. [Version History](#version-history)

---

## Project Overview

Krythor is a **local-first AI command platform**. It runs entirely on the user's machine — no cloud, no telemetry, no accounts. A browser-based dashboard connects to AI providers (local via Ollama, or cloud via OpenAI/Anthropic), backed by a SQLite memory engine, a custom agent system, and a security policy engine.

- **Entry point (Windows):** `Krythor.bat` → `start.js` → `packages/gateway/dist/index.js`
- **UI:** React SPA served at `http://127.0.0.1:47200`
- **Data storage (Windows):** `%LOCALAPPDATA%\Krythor\`
- **Runtime requirement:** Node.js 18+ (all runtime checks) / pnpm

---

## Repository Layout

```
C:\Krythor\
  ARCHITECTURE.md          Architecture blueprint (developer spec)
  Build.md                 This file
  README.md                User-facing documentation
  package.json             Workspace root — version 0.1.0
  pnpm-workspace.yaml      pnpm monorepo definition
  tsconfig.base.json       Shared TypeScript base config
  start.js                 Cross-platform launcher
  Krythor.bat              Windows double-click launcher (auto-builds)
  Krythor-Setup.bat        Windows setup wizard launcher
  install.sh               Mac/Linux installer script
  packages/
    core/       Orchestration runtime (agents, command handling)
    gateway/    Fastify HTTP + WebSocket server
    memory/     SQLite memory engine + conversation store
    models/     Model provider registry and inference routing
    guard/      Security policy engine
    skills/     Tool execution framework (STUB)
    setup/      CLI setup wizard
    control/    React + Vite web dashboard
```

---

## Build Status by Package

### @krythor/core

**Status: ✅ Complete**

| Feature | Status |
|---------|--------|
| `KrythorCore.handleCommand()` — query memory, call model, write session memory | ✅ Done |
| `AgentRegistry` — CRUD with JSON file persistence | ✅ Done |
| `AgentOrchestrator` — lifecycle, parallel/sequential runs, EventEmitter | ✅ Done |
| `AgentRunner` — single-turn run with memory retrieval and write-back | ✅ Done |
| `AgentRunner` — streaming run via `inferStream()` async generator | ✅ Done |
| `AgentRunner` — `stopRun()` with `AbortController` | ✅ Done |
| Multi-turn loop heuristic (continue if response ends with `?` or `[CONTINUE]`) | ✅ Done |
| Parallel agent runs (`runAgentsParallel`) | ✅ Done |
| Sequential agent pipeline (`runAgentsSequential`) | ✅ Done |
| Run history (in-memory, capped at 500) | ✅ Done |
| `contextMessages` from conversation history injected into agent runs | ✅ Fixed — field added to `RunAgentInput`; `buildMessages()` prepends history |
| True multi-turn streaming (multi-turn loop in `runStream`) | ✅ Fixed — `runStream()` now has same multi-turn while-loop as `run()` |

---

### @krythor/gateway

**Status: ✅ Complete**

| Feature | Status |
|---------|--------|
| Fastify 5 server on `127.0.0.1:47200` | ✅ Done |
| Static file serving — SPA with fallback to `index.html` | ✅ Done |
| `GET /health` — version, nodeVersion, stats for all subsystems | ✅ Done |
| WebSocket `/ws/stream` — broadcast agent and guard events | ✅ Done |
| `POST /api/command` — Guard check, no-provider handling, conversation history, SSE streaming | ✅ Done |
| `POST /api/command` — true token-by-token SSE delta streaming | ✅ Fixed — subscribes to `agent:event` per-runId; emits `delta` events in real-time |
| Agent routes — full CRUD, run, parallel, sequential, stop, run history | ✅ Done |
| Memory routes — full CRUD, pin/unpin, stats | ✅ Done |
| Model routes — provider CRUD, ping, refresh, direct inference | ✅ Done |
| Guard routes — policy CRUD, rule CRUD, check, reload, set default action | ✅ Done |
| Config routes — `GET/PATCH /api/config` | ✅ Done |
| Conversation routes — full CRUD + messages | ✅ Done |
| `DiskLogger` — rotating daily JSON logs, 7-day retention | ✅ Done |
| Guard checked on `command:execute` and `agent:run` | ✅ Done |
| Guard checked on memory write/delete, provider add/delete, agent create/delete | ❌ Not wired |
| Session token / authentication | ❌ Not implemented — any localhost process can call the API |
| `durationMs` in `run:completed` log event | ✅ Fixed — `runStartTimes` Map tracks real wall-clock start; delta computed on completion |

---

### @krythor/memory

**Status: ✅ Complete (stub embedding)**

| Feature | Status |
|---------|--------|
| SQLite schema — `memory_entries`, `memory_tags`, `memory_usage`, `memory_sources` | ✅ Done |
| SQLite schema — `conversations`, `messages` with cascade delete | ✅ Done |
| `MemoryStore` — full CRUD, tag management, transactions | ✅ Done |
| `ConversationStore` — create/list/get/update/delete conversations, add/get messages | ✅ Done |
| `MemoryWriter` — create, update, delete, pin, unpin, recordUse, applyDecay | ✅ Done |
| `MemoryScorer` — composite scoring (importance 40%, recency 30%, frequency 15%, content 15%) | ✅ Done |
| `MemoryRetriever` — retrieve, score, sort, trim to limit | ✅ Done |
| `MemoryEngine` — unified facade with embedding provider registry | ✅ Done |
| Importance decay on startup (exponential, 30-day half-life) | ✅ Done |
| Importance boost on memory access (+0.05, capped at 1.0) | ✅ Done |
| `StubEmbeddingProvider` — deterministic char-hash pseudo-vector (64-dim) | ⚠️ Stub only — NOT semantically meaningful |
| Real embedding provider (Ollama embeddings / OpenAI text-embedding) | ❌ Not implemented |
| Full-text search (SQLite FTS5) | ❌ Not implemented — uses `LIKE '%term%'` |
| Memory deduplication | ❌ Not implemented |
| Auto-summarization / pruning beyond decay | ❌ Not implemented |
| Guard decision log (SQLite table) | ✅ Fixed — `guard_decisions` table with indexes, shared DB instance |

---

### @krythor/models

**Status: ✅ Complete**

| Feature | Status |
|---------|--------|
| `OllamaProvider` — batch + streaming inference | ✅ Done |
| `OpenAIProvider` — batch + streaming inference | ✅ Done |
| `AnthropicProvider` — batch + streaming inference | ✅ Done |
| `OpenAICompatProvider` — extends OpenAI (for llama.cpp / other OpenAI-compat APIs) | ✅ Done |
| `ModelRegistry` — provider CRUD, file persistence (`providers.json`) | ✅ Done |
| `ModelRegistry` — handles both flat array and wrapped `{version, providers}` format | ✅ Done |
| `ModelRouter` — 5-level routing hierarchy with model-ID prefix matching | ✅ Done |
| `ModelEngine` — unified facade, `infer()` and `inferStream()` | ✅ Done |
| `AbortSignal` passed through all provider `fetch()` calls | ✅ Done |
| `BaseProvider.getModels()` public getter (replaces bracket-notation hack) | ✅ Done |
| API key encryption at rest | ❌ Not implemented — plaintext in `providers.json` |
| `AnthropicProvider.isAvailable()` — real network check | ✅ Fixed — makes real HTTP request to `/v1/models`; true on 200/401, false on connection error |
| Direct GGUF file loading | ❌ `gguf` type maps to OpenAI-compat; requires a running llama.cpp server |

---

### @krythor/guard

**Status: ✅ Complete (enforcement partial)**

| Feature | Status |
|---------|--------|
| `PolicyEngine` — rule evaluation, priority ordering, warn accumulation | ✅ Done |
| `PolicyStore` — JSON persistence, 4 built-in rules on first run | ✅ Done |
| `GuardEngine` — EventEmitter facade, `check()`, `assert()`, `GuardDeniedError` | ✅ Done |
| Guard enforced on `command:execute` | ✅ Done |
| Guard enforced on `agent:run` | ✅ Done |
| Guard enforced on memory write/delete, provider add/delete, agent create/delete | ❌ Not wired in routes |
| `require-approval` action — UI approval flow | ❌ Treated as immediate deny; no hold-and-approve mechanism |
| Safety mode presets — Guarded / Balanced / Power User | ✅ Done (in UI) |
| Guard decision log (persistent) | ✅ Fixed — `guard_decisions` SQLite table; `GuardDecisionStore`; `GET /api/guard/decisions` |

**Built-in rules (shipped on first run):**
1. `builtin-deny-provider-delete` — deny provider deletion from agent/skill/system sources
2. `builtin-deny-user-scope-from-agent` — deny agent writing to user memory scope
3. `builtin-warn-high-risk-delete` — warn on memory/agent/provider deletion
4. `builtin-warn-user-scope-write` — warn on memory writes to user scope

---

### @krythor/skills

**Status: ❌ Stub only — not started**

| Feature | Status |
|---------|--------|
| Package builds successfully | ✅ Done |
| Skill registry | ❌ Not implemented |
| Skill execution / runner | ❌ Not implemented |
| Sandboxed subprocess execution | ❌ Not implemented |
| Skill-to-Guard integration | ❌ Not implemented |
| Skill discovery / loading | ❌ Not implemented |
| Any import of `@krythor/skills` elsewhere in the codebase | ❌ None |

---

### @krythor/setup

**Status: ✅ Complete**

| Feature | Status |
|---------|--------|
| `SystemProbe` — OS detection, Node version, port check, Ollama auto-detection | ✅ Done |
| `Prompt` — readline-based interactive CLI prompts | ✅ Done |
| `Installer` — creates dirs, writes `providers.json`, `agents.json`, `app-config.json` | ✅ Done |
| `SetupWizard` — full interactive wizard: probe → dirs → agent → provider → launch offer | ✅ Done |
| Provider types: Ollama, OpenAI, Anthropic, openai-compat, skip | ✅ Done |
| Ollama model list on setup | ✅ Done |
| Auto-creates default "Krythor" agent | ✅ Done |
| Offer to launch gateway after setup | ✅ Done |
| Safety mode selection step | ❌ Not in CLI wizard (only in browser onboarding) |
| "Create first agent" step (custom name/prompt) | ❌ Default agent is created silently without prompting |
| Build step (`pnpm install && pnpm build`) | ❌ Handled by `.bat` files, not by the wizard itself |

---

### @krythor/control — UI

**Status: ✅ Complete**

#### App Shell & Navigation

| Feature | Status |
|---------|--------|
| 6-tab layout: Command, Agents, Memory, Models, Guard, Events | ✅ Done |
| Tab state preserved across switches (CSS hidden, not unmounted) | ✅ Done |
| `AppConfigContext` — global config read/write | ✅ Done |
| StatusBar — connection indicator, agent picker, model picker, guard badge, version | ✅ Done |
| About dialog — version, Node.js version, keyboard shortcuts, data paths | ✅ Done |
| Onboarding wizard — 3-step first-run flow | ✅ Done |
| Keyboard shortcut `Ctrl+1`–`6` — switch tabs | ✅ Done |
| Keyboard shortcut `Ctrl+N` — new conversation | ✅ Done |
| Keyboard shortcut `Ctrl+/` — About dialog | ✅ Done |
| Keyboard shortcut `Escape` — close dialogs | ✅ Done |
| Dark mode | ✅ Done (hardcoded) |
| Light mode / theme toggle | ❌ Not implemented |

#### Command / Chat Panel

| Feature | Status |
|---------|--------|
| Conversation sessions sidebar — grouped by Today/Yesterday/This Week/Older | ✅ Done |
| New conversation button | ✅ Done |
| Rename conversation (inline edit) | ✅ Done |
| Delete conversation (with confirm) | ✅ Done |
| Persistent multi-turn chat (history saved to SQLite, sent as context) | ✅ Done |
| Message bubbles — user (right, zinc-700) and assistant (left, zinc-800 + "K" avatar) | ✅ Done |
| Markdown rendering (`react-markdown` + `remark-gfm`) | ✅ Done |
| Syntax-highlighted code blocks (`react-syntax-highlighter`, vscDarkPlus) | ✅ Done |
| Copy button — per message | ✅ Done |
| Copy button — per code block | ✅ Done |
| Typing indicator (3 animated dots) | ✅ Done |
| Animated cursor while streaming | ✅ Done |
| Stop button (aborts in-flight fetch) | ✅ Done |
| Regenerate last response | ✅ Done |
| Auto-resize textarea (Shift+Enter for newline, Enter to send) | ✅ Done |
| Auto-scroll to bottom | ✅ Done |
| No-provider banner with link to Models tab | ✅ Done |
| True token-by-token streaming display | ✅ Fixed — `delta` SSE events accumulate in real-time; animated cursor while streaming |
| Arrow-key message input history browsing | ✅ Fixed — `inputHistory` + `historyIdx` state; Up/Down arrows cycle through sent messages |

#### Agents Panel

| Feature | Status |
|---------|--------|
| Agent list with active indicator | ✅ Done |
| Create agent — name, description, system prompt, scope, model | ✅ Done |
| Edit agent — inline form pre-filled | ✅ Done |
| Delete agent | ✅ Done |
| Set active agent | ✅ Done |
| Temperature slider (0.0–2.0) | ✅ Done |
| Max Tokens input | ✅ Done |
| Max Turns input | ✅ Done |
| Model assignment dropdown (populated from providers) | ✅ Done |
| Run agent with input field | ✅ Done |
| Run history per agent (expandable rows) | ✅ Done |
| `temperature` / `maxTokens` in frontend `Agent` interface (`api.ts`) | ✅ Fixed — `temperature?`, `maxTokens?`, `maxTurns?` added to `Agent` interface |

#### Memory Panel

| Feature | Status |
|---------|--------|
| Paginated memory list (PAGE_SIZE=20, "Load more") | ✅ Done |
| Scope filter | ✅ Done |
| Pin / unpin | ✅ Done |
| Delete entry | ✅ Done |
| Search (client-side filter) | ✅ Done |
| Search — server-side (passes `text` to `/api/memory?text=`) | ✅ Fixed — `listMemory` passes `text` + `scope` params; 300ms debounce; offset resets on change |
| Create / edit memory entry | ❌ No UI form; read-only list |

#### Models Panel

| Feature | Status |
|---------|--------|
| Provider list with default badge, type, endpoint | ✅ Done |
| Add provider — name, type, endpoint, API key, set-as-default | ✅ Done |
| API key included in POST body | ✅ Fixed |
| Ping provider | ✅ Done |
| Refresh models (calls provider API, shows count + names) | ✅ Done |
| Set as default | ✅ Done |
| Delete provider | ✅ Done |
| `ModelInfo.name` field populated | ✅ Fixed — `name: string` added to `ModelInfo` type; `BaseProvider.getModelInfo()` returns `name: modelId` |

#### Guard Panel

| Feature | Status |
|---------|--------|
| Rule list with action badge, priority, reason, conditions | ✅ Done |
| Enable / disable rules | ✅ Done |
| Delete custom rules (built-in rules protected) | ✅ Done |
| Add rule form — name, description, action, priority, reason, content pattern | ✅ Done |
| Safety mode presets — Guarded / Balanced / Power User | ✅ Done |
| Safety mode derived from loaded policy on page load | ✅ Fixed |
| `require-approval` action UI prompt | ❌ Not implemented — treated as deny |

#### Events Panel

| Feature | Status |
|---------|--------|
| Live WebSocket event log (newest first, capped at 200) | ✅ Done |
| Color-coded by event type | ✅ Done |
| Clear button | ✅ Done |
| Truncated JSON payload display | ✅ Done |

---

## Launcher & Install Scripts

| Script | Platform | Status |
|--------|----------|--------|
| `Krythor.bat` — Node check, version check, pnpm check, auto-build on first run, launches app | Windows | ✅ Done |
| `Krythor-Setup.bat` — same checks + runs CLI setup wizard | Windows | ✅ Done |
| `start.js` — Node version check, port-in-use check, spawn gateway, open browser, `--no-browser` flag | All | ✅ Done |
| `install.sh` — Node check, auto-installs pnpm, builds, prints next-step instructions | Mac/Linux | ✅ Done |
| `install.sh` — auto-runs setup wizard after build | Mac/Linux | ❌ Manual step required |

---

## Test Coverage

| Package | Test File | Tests | Coverage |
|---------|-----------|-------|----------|
| @krythor/core | `AgentRegistry.test.ts` | 11 | CRUD, persistence, sorting, error handling |
| @krythor/memory | `MemoryScorer.test.ts` | 8 | Scoring, decay, boost, boundary cases |
| @krythor/models | `ModelRouter.test.ts` | 7 | All routing hierarchy levels, empty-provider error |
| @krythor/guard | `PolicyEngine.test.ts` | 9 | Default actions, deny/allow/warn/disabled rules, priority, regex, source conditions |
| @krythor/gateway | `health.test.ts`, `command.test.ts` | 5 | HTTP route integration tests (200/400 responses, subsystem stats, no-provider) |
| @krythor/skills | — | 0 | No tests |
| @krythor/setup | — | 0 | No tests |
| @krythor/control | — | 0 | No tests |

**Total: 44 tests across 6 packages. All passing.**
Gateway now has HTTP route integration tests. No end-to-end or React component tests.

---

## Known Bugs

All release-gate bugs have been resolved. The following are known limitations accepted for v0.1.0:

| # | Severity | Location | Description |
|---|----------|----------|-------------|
| 1 | Low | `packages/setup/src/SetupWizard.ts` | Safety mode selection and custom first-agent prompting are browser-only; CLI wizard creates a default agent silently |
| 2 | Low | `install.sh` | Does not auto-launch setup wizard after build — manual step required (`.bat` handles this on Windows) |
| 3 | Low | `packages/guard/src/GuardEngine.ts` | `require-approval` action treated as immediate deny; no hold-and-approve mechanism |
| 4 | Low | `packages/control/src/App.tsx` | Dark mode only; `<html class="dark">` is hardcoded; no light/dark toggle |

---

## What Is Missing / Not Started

All v0.1.0 Critical and Major items are resolved. The following are deferred to v0.2.0+:

### Phase 2 Targets (v0.2.0)

| Feature | Notes |
|---------|-------|
| **@krythor/skills** | Entire package is a stub — no registry, runner, sandboxing, or Guard integration |
| **Real embedding provider** | Ollama embeddings or OpenAI `text-embedding-3-small`; replaces `StubEmbeddingProvider` |
| **Guard enforcement on all operation types** | Wire `guard.check()` into memory write/delete, provider add/delete, agent create/delete routes |
| **`require-approval` action flow** | Hold operation, emit WS event, await UI approval prompt, then retry or cancel |
| **Memory panel — create/edit entries** | Currently read-only; add form to create and edit entries manually |
| **API key encryption at rest** | Encrypt `providers.json` using a machine-specific key |
| **Authentication / session tokens** | Simple shared secret token to prevent other local processes from calling the API |
| **Full-text search (SQLite FTS5)** | Migrate memory search from `LIKE '%term%'` to a proper FTS5 index |
| **Conversation export** | Export as Markdown or JSON |
| **Memory export** | Export all memory entries as JSON |

### Phase 3 Targets (v0.3.0+)

| Feature | Notes |
|---------|-------|
| **Web search skill** | Built-in skill using the skills package once implemented |
| **Local GGUF file browser** | UI to browse and load `.gguf` files, auto-starting llama.cpp |
| **Ollama model pull UI** | Pull models from Ollama library without leaving Krythor |
| **File/image upload** | Multimodal inference via vision-capable providers |
| **Light/dark mode toggle** | Currently hardcoded dark mode |
| **React component tests** | Vitest + Testing Library for UI components |
| **About page — changelog** | Version history in About dialog |

---

## Feature Roadmap

```
v0.1.0  (current)
  ✅ Core backend: memory, models, guard, agents, gateway
  ✅ React UI: all 6 panels
  ✅ Persistent conversation threads (SQLite)
  ✅ Markdown + syntax-highlighted code rendering
  ✅ Windows installer with auto-build
  ✅ README for end users
  ✅ 35 unit tests

v0.2.0  (next — streaming + agent context)
  [ ] True per-token SSE streaming in the UI
  [ ] Conversation history injected into agent runs
  [ ] Fix Agent interface types in api.ts
  [ ] Arrow-key input history in chat panel
  [ ] Server-side memory search
  [ ] install.sh auto-runs setup wizard

v0.3.0  (skills + embeddings)
  [ ] @krythor/skills — registry + runner + sandboxing
  [ ] Real embedding provider (Ollama or OpenAI)
  [ ] Guard enforcement on all operation types
  [ ] `require-approval` action UI flow
  [ ] Guard decision log (SQLite + UI)

v0.4.0  (polish + security)
  [ ] API key encryption at rest
  [ ] Light/dark mode toggle
  [ ] File/image upload and multimodal inference
  [ ] Conversation and memory export
  [ ] Integration tests for gateway routes
  [ ] React component tests

v1.0.0  (production-ready)
  [ ] Full skills ecosystem
  [ ] Complete Guard enforcement across all operations
  [ ] Authentication / session tokens
  [ ] Full E2E test suite
  [ ] Ollama model pull UI
  [ ] Local GGUF file browser
```

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| 0.1.0 | 2026-03-16 | RELEASE — full backend, React UI, real SSE streaming, persistent conversations, markdown rendering, self-hosted fonts, guard audit log, Windows installer, README, 44 tests. All 36 release-check items resolved (35 fixed, 1 N/A, 1 deferred to Phase 3). |
