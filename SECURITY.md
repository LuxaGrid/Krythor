# Krythor — Security Report

**Version:** 0.1.0
**Date:** 2026-03-16
**Scope:** Full codebase audit — all 8 packages

---

## Threat Model

Krythor is designed as a **local-only tool**. The gateway binds to `127.0.0.1:47200` exclusively — it is not reachable from other machines unless the user manually exposes it (e.g., via reverse proxy, firewall rule, or `HOST=0.0.0.0` override). The primary threat actors are:

1. **Other processes on the same machine** (malware, compromised browser extensions, other local software)
2. **The user themselves** (misconfiguration, e.g., exposing the port to a network)
3. **Malicious content in AI responses** (prompt injection, XSS in rendered output)

---

## Findings

### CRITICAL

---

#### SEC-01 — API keys returned in plain text from GET /api/models/providers

**File:** `packages/gateway/src/routes/models.ts:17–19`
**Status:** ✅ Fixed — keys masked to `****xxxx`

The `GET /api/models/providers` endpoint returns the full provider config including `apiKey` in plain text. Any process on the local machine (or any network client if the port is ever exposed) can retrieve all configured API keys — OpenAI, Anthropic, custom — with a single unauthenticated GET request.

```typescript
// Before fix: returns apiKey in full
app.get('/api/models/providers', async (_req, reply) => {
  return reply.send(models.listProviders());
});
```

**Fix applied:** Mask `apiKey` in list and single-provider responses. Replace with `"sk-...****"` (showing only type prefix + last 4 chars) so the UI can indicate a key is set without exposing it.

---

#### SEC-02 — SSRF via user-supplied provider endpoint URLs

**File:** `packages/gateway/src/routes/models.ts:22–51`, `packages/models/src/providers/`
**Status:** ✅ Fixed — `validateEndpointUrl()` rejects non-http/https and known metadata hostnames

The `endpoint` field in `POST /api/models/providers` accepts any URL with no validation. When a provider's models are refreshed or pinged, Krythor makes an HTTP request to the user-supplied URL. This is a Server-Side Request Forgery vector:

- `http://169.254.169.254/latest/meta-data/` — AWS/GCP/Azure metadata service
- `http://127.0.0.1:22` — local port scanner
- `http://192.168.1.1/admin` — internal network router

The fix validates that the endpoint URL is a well-formed `http://` or `https://` URL and rejects requests to private/link-local IP ranges when the user is connecting from a network-exposed context.

---

#### SEC-03 — ReDoS via arbitrary regex in guard rule contentPattern

**File:** `packages/guard/src/PolicyEngine.ts:94–103`
**Status:** ✅ Fixed — pattern capped at 500 chars; content truncated to 50 KB before test

Guard rules accept an arbitrary `contentPattern` string that is compiled to a `RegExp` and run against every command's content. A catastrophic backtracking pattern (e.g., `(a+)+b`) submitted via `POST /api/guard/rules` will freeze the Node.js event loop for seconds or minutes when matched against certain inputs.

```typescript
const re = new RegExp(c.contentPattern, 'i'); // no timeout, no validation
if (!re.test(ctx.content)) return false;
```

**Fix applied:** Validate `contentPattern` length (max 200 chars) and test it against a known-safe timeout mechanism before accepting it.

---

### HIGH

---

#### SEC-04 — Guard policy can be modified by any authenticated local process

**File:** `packages/gateway/src/routes/guard.ts:113–129`
**Status:** Accepted — by design. The user owns their guard configuration.

Any unauthenticated caller can:
1. `PATCH /api/guard/policy/default` with `{"action":"allow"}` — default-allow everything
2. `DELETE /api/guard/rules/:id` — delete all restrictive rules
3. `POST /api/guard/rules` — inject new permissive rules

This is a **local-only tool** with no multi-user model. The guard is primarily a user-controlled safety layer, not a security enforcement boundary against adversarial callers. The risk is acknowledged: if malware on the same machine can call the API, the guard provides no additional protection.

**Mitigation:** The `127.0.0.1` binding limits exposure. Full auth is Phase 2 (see roadmap).

---

#### SEC-05 — No rate limiting on any endpoint

**File:** `packages/gateway/src/server.ts`
**Status:** ✅ Fixed — `@fastify/rate-limit` applied globally, 300 req/min

No rate limiting is applied. Any local process can spam `/api/command` to exhaust CPU and memory, or make thousands of concurrent SQLite queries. Adding `@fastify/rate-limit` is Phase 2.

---

### MEDIUM

---

#### SEC-06 — No authentication on WebSocket /ws/stream

**File:** `packages/gateway/src/ws/stream.ts`
**Status:** ✅ Fixed — WS requires `?token=<token>`; unauthenticated connections closed with code 4001

The WebSocket endpoint accepts connections from any client on `127.0.0.1`. Commands can be executed and events broadcast with no auth token. Same threat model as SEC-04 — local process on same machine is the actor, same Phase 2 auth work will address this.

---

#### SEC-07 — Unvalidated limit/offset parameters (unbounded queries)

**File:** `packages/gateway/src/routes/memory.ts:7–21`
**Status:** ✅ Fixed — `limit` clamped to [1, 500], `offset` ≥ 0

`limit` and `offset` are parsed with `parseInt()` without bounds checking. `limit=2147483647` would cause SQLite to attempt to return billions of rows.

**Fix applied:** Clamp `limit` to `[1, 500]` and `offset` to `>= 0`.

---

#### SEC-08 — Guard rule condition object has no schema

**File:** `packages/gateway/src/routes/guard.ts:46–75`
**Status:** ✅ Fixed — explicit schema with known fields only, `additionalProperties: false`

The `condition` field in POST `/api/guard/rules` accepts any JSON object. While `PolicyEngine` only reads expected fields, arbitrary nested objects are persisted to `policy.json`. Adding an explicit JSON schema for the condition structure prevents garbage data from being stored.

---

### LOW

---

#### SEC-09 — Sensitive context logged to disk on guard denials

**File:** `packages/gateway/src/server.ts:112–116`, `packages/gateway/src/logger.ts`
**Status:** Accepted / documented

Guard denial events log the full `context` object to rotating JSON log files. If user input or AI output contains sensitive data (passwords, API keys typed into the chat), it will appear in `%LOCALAPPDATA%\Krythor\logs\`. Log files are only readable by the local user on standard OS permission configurations.

---

#### SEC-10 — No encryption of API keys at rest

**File:** `packages/models/src/ModelRegistry.ts`
**Status:** ✅ Fixed — AES-256-GCM encryption with machine-derived key

API keys are encrypted at rest using AES-256-GCM. The key is derived from `hostname + platform + "krythor-v1"` via SHA-256, making it specific to the machine. Encrypted values are prefixed with `e1:` and stored as `<iv>:<tag>:<ciphertext>` hex. Plaintext keys are automatically migrated on first load.

---

#### SEC-11 — No authentication token for any HTTP or WS route

**File:** `packages/gateway/src/server.ts`
**Status:** ✅ Fixed — 32-byte random token generated on first run; required on all `/api/*` and `/ws/*` routes; UI auto-loads from `/health`

Any process on `127.0.0.1` can call any API endpoint. This is intentional for v0.1.0 (the tool is single-user, local-only). A shared-secret token approach (set in `app-config.json`, sent as `Authorization: Bearer <token>`, checked by a Fastify preHandler hook) is the planned Phase 2 solution.

---

#### SEC-12 — Server bind address hardcoded but not enforced against env overrides

**File:** `packages/gateway/src/server.ts:21–22`
**Status:** Acceptable — no env override path exists

`GATEWAY_HOST = '127.0.0.1'` is a constant. There is no code path that reads `HOST` or `LISTEN_HOST` from environment variables to override it. Risk is low. Document explicitly that this value must not be changed to `0.0.0.0` without adding auth (SEC-11).

---

---

## User Guidance

> **Do not expose port 47200 to any network without a reverse proxy that enforces its own authentication.**

Krythor now ships with a shared-secret token (generated on first run, stored in `app-config.json`). The browser UI loads it automatically — you never need to interact with it. However, the token provides **local process isolation** only. If you expose port 47200 via a reverse proxy, firewall forwarding, or Tailscale funnel, any caller who can reach that port will be able to brute-force or intercept the token. Add proper auth (e.g. HTTP Basic Auth or OAuth) at the proxy layer before doing so.

The gateway prints a warning on startup if it detects it is not binding to loopback only.

---

#### SEC-13 — WebSocket auth token exposed in URL

**File:** `packages/gateway/src/ws/stream.ts`
**Status:** Accepted — by design for local-only use

WebSocket clients pass the auth token as `?token=<token>` in the query string. This means the token appears in server access logs and browser history. For a local-only tool binding to `127.0.0.1`, this is acceptable — the threat model does not include a shared machine where other users could read your browser history. If Krythor is ever exposed via a reverse proxy, the proxy should strip the token from logs.

---

## Fixed / Implemented summary

| ID | Finding | Status |
|----|---------|--------|
| SEC-01 | API keys in GET /api/models/providers | ✅ Masked to `****xxxx` |
| SEC-02 | SSRF via provider endpoint | ✅ `validateEndpointUrl()` validates http/https, blocks metadata hosts |
| SEC-03 | ReDoS via guard contentPattern | ✅ Pattern capped at 500 chars; content tested up to 50 KB |
| SEC-05 | No rate limiting | ✅ `@fastify/rate-limit` — 300 req/min global |
| SEC-06 | No WebSocket auth | ✅ WS requires `?token=<token>`; rejected with close code 4001 |
| SEC-07 | Unbounded limit/offset queries | ✅ `limit` clamped [1, 500], `offset` ≥ 0 |
| SEC-08 | Unstructured guard condition object | ✅ Explicit JSON schema, `additionalProperties: false` |
| SEC-10 | API keys plain text at rest | ✅ AES-256-GCM with machine-derived key; auto-migrates plaintext |
| SEC-11 | No HTTP auth token | ✅ 32-byte token on first run; all `/api/*` and `/ws/*` require `Authorization: Bearer` |
| SEC-12 (CSP) | No Content-Security-Policy headers | ✅ CSP, X-Frame-Options, X-Content-Type-Options on all responses |

## Accepted / Deferred

| ID | Finding | Rationale |
|----|---------|-----------|
| SEC-04 | Guard policy modifiable by authenticated local process | By design — user owns their guard config |
| SEC-09 | Sensitive context may appear in disk logs | OS file permissions sufficient; logs in user's private AppData |
| SEC-12 | Bind address is a constant | No env override path exists |
| SEC-13 | WS token in URL query string | Acceptable for local-only tool; document if ever proxy-exposed |

---

## Remaining Security Roadmap

1. **Guard rule change audit log** — record who/when changed a guard rule (currently only AI decisions are logged)
2. **Token rotation UI** — let the user regenerate the gateway token from the Settings panel
3. **Platform keychain integration** — DPAPI/Keychain/libsecret as an upgrade path over machine-derived AES key
