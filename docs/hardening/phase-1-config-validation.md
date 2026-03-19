# Phase 1 — Config Validation + Atomic Writes

**Status:** Complete
**Scope:** `@krythor/core`, `@krythor/models`, `@krythor/gateway`
**Blocker fixed:** Corrupt or malformed config files could crash gateway startup or silently corrupt agent/provider state.

---

## Problem

Before this phase, all three config files were loaded with a bare `JSON.parse()` call and cast directly to the expected type. No field validation occurred. Writes used `writeFileSync`, which is not atomic — a process crash mid-write would leave a partial file on disk that would fail to parse on next startup, destroying the config.

| File | Risk |
|------|------|
| `app-config.json` | Wrong field types silently accepted, bad data persisted |
| `agents.json` | Agents missing required fields (id, name, systemPrompt) loaded into registry |
| `providers.json` | Invalid provider type or missing endpoint could crash provider instantiation |
| Any file | `writeFileSync` crash → partial write → unreadable JSON on next boot |

---

## Solution

### 1. Atomic Writes

**Files added:**
- `packages/core/src/config/atomicWrite.ts`
- `packages/models/src/config/atomicWrite.ts` (duplicate — models has no dep on core)

**Strategy:** Write → temp file (`.tmp`) → `fsync` → atomic `rename` → target.

```
app-config.json.tmp  →  (fsync)  →  rename  →  app-config.json
```

- If the process crashes before `rename`: old file is untouched, `.tmp` is cleaned up on next boot.
- If the process crashes after `rename`: new file is complete and durable.
- On failure: `.tmp` is removed (best-effort), error is re-thrown to caller.

**Note on Windows:** `renameSync` uses `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` which is atomic at the NTFS metadata level. Not a POSIX guarantee, but safe for config files on the same volume.

### 2. Schema Validation

**Files added:**
- `packages/core/src/config/validate.ts` — validation for `AgentDefinition`, `AppConfig`, `ProviderConfig`
- `packages/models/src/config/validate.ts` — provider-specific validation (no dep on core)

**Design principles:**
- `validate()` never throws — returns `{ valid, value, errors }`
- Invalid entries are **skipped**, not fatal — gateway always starts
- Defaults are applied inline (e.g. `memoryScope: 'agent'`, `maxTurns: 10`, `isEnabled: true`)
- Validation errors are **logged** at warn level so operators can see what was rejected
- Required fields that are missing/wrong type → entry is rejected entirely
- Optional fields with wrong type → default applied, warning logged

### 3. Integration Points

| File | Change |
|------|--------|
| `packages/core/src/agents/AgentRegistry.ts` | `load()` uses `parseAgentList()`, `save()` uses `atomicWriteJSON()` |
| `packages/models/src/ModelRegistry.ts` | `load()` uses `parseProviderList()`, `save()` uses `atomicWriteJSON()` |
| `packages/gateway/src/routes/config.ts` | `read()` uses `parseAppConfig()`, `write()` uses `atomicWriteJSON()` |
| `packages/core/src/index.ts` | Exports `atomicWrite`, `atomicWriteJSON`, all parse/validate functions |

### 4. Exports

The following are now part of the `@krythor/core` public API:

```typescript
// Atomic writes
export { atomicWrite, atomicWriteJSON } from './config/atomicWrite.js';

// Validation
export { parseAgentList, parseAppConfig, parseProviderList } from './config/validate.js';
export { validateAgentDefinition, validateProviderConfig } from './config/validate.js';
export type { ValidationResult, AgentDefinitionRaw, AppConfigRaw, ProviderConfigRaw } from './config/validate.js';
```

---

## Validation Rules

### AgentDefinition

| Field | Required | Default | Validation |
|-------|----------|---------|------------|
| `id` | ✅ | — | non-empty string |
| `name` | ✅ | — | non-empty string |
| `systemPrompt` | ✅ | — | string |
| `description` | — | `''` | string |
| `memoryScope` | — | `'agent'` | one of `session \| agent \| workspace` |
| `maxTurns` | — | `10` | positive number |
| `tags` | — | `[]` | array; non-string items stripped |
| `createdAt` / `updatedAt` | — | `Date.now()` | number |

### AppConfig

| Field | Required | Validation |
|-------|----------|------------|
| `selectedAgentId` | — | string or null (null = clear field) |
| `selectedModel` | — | string or null |
| `onboardingComplete` | — | boolean |

### ProviderConfig

| Field | Required | Default | Validation |
|-------|----------|---------|------------|
| `id` | ✅ | — | non-empty string |
| `name` | ✅ | — | non-empty string |
| `type` | ✅ | — | one of `ollama \| openai \| anthropic \| openai-compat \| gguf` |
| `endpoint` | ✅ | — | non-empty string |
| `isDefault` | — | `false` | boolean |
| `isEnabled` | — | `true` | boolean |
| `models` | — | `[]` | array; non-string items stripped |

---

## Tests Added

| File | Tests | Coverage |
|------|-------|----------|
| `packages/core/src/config/validate.test.ts` | 26 | All validators and list parsers |
| `packages/core/src/config/atomicWrite.test.ts` | 6 | Write, overwrite, no .tmp residue, nested dirs, JSON |

---

## Behaviour Change Summary

| Scenario | Before | After |
|----------|--------|-------|
| Corrupt JSON file | Startup crash or empty state | Safe empty state + error logged |
| Agent missing `id` | Loaded as broken agent | Skipped + warning logged |
| Provider with unknown `type` | Provider instantiation crash | Skipped + warning logged |
| Write crash mid-way | Partial file on disk | Old file untouched, .tmp cleaned |
| `memoryScope` has invalid value | Accepted, undefined behaviour | Defaulted to `'agent'`, warning logged |

---

## Next

**Phase 2 — DB integrity checks + retention rules**
Add `PRAGMA user_version`, startup integrity check, pre-migration backup, and retention pruning for agent runs, memory entries, and guard decisions.
