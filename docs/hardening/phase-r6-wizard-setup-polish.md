# Release Hardening Phase 6 — Wizard/Setup Polish

**Status:** Complete
**Scope:** `@krythor/setup` — `SetupWizard.ts`, `SetupWizard.test.ts`
**Blockers fixed:** Kimi and MiniMax providers were absent from onboarding; Anthropic label did not match the spec (`'Best Overall'` → `'Best Overall / Recommended'`); wizard defaulted to Ollama at index 2 but Ollama moved to index 4 after new providers were added.

---

## What Changed

### 1. New Provider Options: Kimi and MiniMax

Added to `PROVIDER_RECOMMENDATIONS` and the selectable wizard option list:

| Provider | Label | Reason | rank |
|----------|-------|--------|------|
| `kimi` | Best for Large Context | Very long context windows — ideal for long documents and code review | 3 |
| `minimax` | Best Value | Strong performance at lower cost | 4 |

Both are presented as `recommended_for_onboarding: true`.

New provider option list (was 5 choices, now 7):
```
anthropic  openai  kimi  minimax  ollama  openai-compat  skip
```

### 2. Kimi/MiniMax Preset Configuration

Both providers are wired with preset API endpoints and sensible default models:

| Provider | Endpoint | Default model |
|----------|----------|---------------|
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-128k` |
| MiniMax | `https://api.minimax.chat/v1` | `abab6.5s-chat` |

Both use `type: 'openai-compat'` internally (the only OpenAI-compatible provider type in the models package). The wizard maps them at the `addProvider` call:

```typescript
const providerType = (type === 'kimi' || type === 'minimax') ? 'openai-compat' : type;
```

This keeps wizard UX clean (named choices) while ensuring the persisted config is valid for `ModelRegistry`.

### 3. Anthropic Label Update

Updated to match Phase R6 spec:
- Before: `'Best Overall'`
- After: `'Best Overall / Recommended'`

### 4. Ollama Default Index Updated

Ollama moved from index 2 to index 4 in the provider options list. The `defaultProviderIdx` was updated accordingly:
```typescript
const defaultProviderIdx = sys.ollamaDetected ? 4 : 0;
```

---

## What Was Not Changed

- **Existing provider options** — all four original options (`anthropic`, `openai`, `ollama`, `openai-compat`) remain, in the same relative order.
- **No forced selection** — `skip` option remains available.
- **Safe defaults** — anthropic is the default when Ollama is not detected; Ollama is the default when detected (free and local).
- **Channel setup** — no channel/communication setup step exists in the wizard; the Phase R6 requirement for channel recommendations ("if present") was not applicable.

---

## Test Counts

| Suite | Before | After | Delta |
|-------|--------|-------|-------|
| setup | 17 | 19 | +2 |

Updated/added tests in `SetupWizard.test.ts`:
- Updated `'includes all four provider types'` → `'includes all six provider types'` (+kimi, +minimax assertions)
- Updated `'recommendation labels match the spec'` (includes kimi, minimax, and updated anthropic label)
- Updated smart-default index tests to reflect new option order
- `kimi and minimax are recommended_for_onboarding`
- `kimi has higher priority rank than minimax`

**Total: 213 tests, 0 failures.**

---

## Files Changed

| File | Change |
|------|--------|
| `packages/setup/src/SetupWizard.ts` | Add kimi/minimax to `PROVIDER_RECOMMENDATIONS`; add as selectable options; add `configureProvider` branches with preset URLs; map to `openai-compat` type; update default index |
| `packages/setup/src/SetupWizard.test.ts` | Update/add tests for new providers; fix label assertions |
