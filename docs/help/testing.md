# Krythor Testing Guide

## Test Tiers

Krythor has three test tiers:

| Tier | Command | When to run | External calls |
|---|---|---|---|
| Unit / integration | `pnpm test` | Every commit | No |
| E2E (real port) | `pnpm test` | Every commit | No — uses in-process Fastify |
| Live (real providers) | See below | Before releases | Yes — costs real quota |

---

## Running the Standard Test Suite

```bash
pnpm test
```

Runs all 235+ tests across every package. Tests are fast (< 30s total). No network calls, no API keys required.

---

## Running Live Provider Tests

Live tests verify that real AI providers respond correctly. They are **skipped by default** and only activate when the corresponding environment variable is set.

### Available env vars

| Variable | Provider | What is tested |
|---|---|---|
| `KRYTHOR_TEST_ANTHROPIC_KEY` | Anthropic | `claude-haiku-20240307` — minimal inference |
| `KRYTHOR_TEST_OPENAI_KEY` | OpenAI | `gpt-3.5-turbo` — minimal inference |
| `KRYTHOR_TEST_OLLAMA_URL` | Ollama (local) | Lists models, runs inference on first installed model |

### How to run

Set one or more env vars, then run `pnpm test`:

```bash
# Anthropic only
KRYTHOR_TEST_ANTHROPIC_KEY=sk-ant-... pnpm test

# OpenAI only
KRYTHOR_TEST_OPENAI_KEY=sk-... pnpm test

# Ollama (running locally)
KRYTHOR_TEST_OLLAMA_URL=http://127.0.0.1:11434 pnpm test

# All three at once
KRYTHOR_TEST_ANTHROPIC_KEY=sk-ant-... \
KRYTHOR_TEST_OPENAI_KEY=sk-... \
KRYTHOR_TEST_OLLAMA_URL=http://127.0.0.1:11434 \
pnpm test
```

### Which test file

Live tests live in:

```
packages/gateway/src/routes/providers.live.test.ts
```

Each test uses `it.skipIf(!ENV_VAR)(...)` so unset variables cleanly skip without a failure.

### Notes

- Live tests consume real API quota. Use low-cost models (haiku, gpt-3.5-turbo).
- Ollama tests require at least one model to be installed (`ollama pull llama3.2`).
- Timeout per test is 30–60 seconds. Slow network or cold model startup may cause flakiness.
- Live tests are NOT run in CI unless secrets are explicitly configured in GitHub Actions.

---

## Adding New Tests

### Unit test (no gateway)

Create a `.test.ts` file in the relevant package's `src/` directory. Vitest discovers all `*.test.ts` files automatically.

### Gateway route test

Create a `*.test.ts` file in `packages/gateway/src/routes/`. Use the `buildServer()` helper and `app.inject()` for fast in-process testing.

Example:

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { buildServer, GATEWAY_PORT } from '../server.js'
import { loadOrCreateToken } from '../auth.js'
import { join } from 'path'
import { homedir } from 'os'

let app: Awaited<ReturnType<typeof buildServer>>
let authToken: string
const HOST = `127.0.0.1:${GATEWAY_PORT}`

beforeAll(async () => {
  app = await buildServer()
  await app.ready()
  const cfg = loadOrCreateToken(join(getDataDir(), 'config'))
  authToken = cfg.token ?? ''
})

describe('GET /api/my-route', () => {
  it('returns 200', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/my-route',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    })
    expect(res.statusCode).toBe(200)
  })
})
```

### E2E test (real TCP port)

See `packages/gateway/src/e2e.test.ts` for an example that binds on real port 47299 and uses `fetch()`.

---

## CI Configuration

Tests run automatically on every push and pull request via GitHub Actions (`.github/workflows/release.yml`).

Live tests only run in CI if the relevant secrets are set in the repository settings:
- `KRYTHOR_TEST_ANTHROPIC_KEY`
- `KRYTHOR_TEST_OPENAI_KEY`
- `KRYTHOR_TEST_OLLAMA_URL`

These are not set by default — live tests are a manual/release-gate concern.
