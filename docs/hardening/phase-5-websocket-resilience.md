# Phase 5 — WebSocket Resilience + UI Degraded Mode

**Status:** Complete
**Scope:** `@krythor/control` — `GatewayContext.tsx`, `App.tsx`, `components/DegradedBanner.tsx`
**Blockers fixed:** Fixed 3 s reconnect interval (no backoff); no distinction between transient drop and sustained failure; UI silently showed "offline" with no user guidance.

---

## Problem

Before this phase:

| Gap | Risk |
|-----|------|
| Fixed 3 s reconnect — no backoff | If the gateway crashes, all open browser tabs hammer it with reconnect attempts simultaneously (thundering herd) |
| Binary `connected: boolean` | No way to distinguish "just dropped, reconnecting" from "gateway has been down for 10 minutes" |
| Silent "offline" dot in status bar | Users assumed the UI was broken; no call to action, no indication of whether to wait or check the process |
| No max-retry degraded state | Reconnect loop ran forever at 3 s with no escalation |

---

## Solution

### 1. Exponential Backoff Reconnection

`GatewayContext.tsx` reconnect logic:

```typescript
const RECONNECT_BASE_MS   = 2_000;   // first retry after 2 s
const RECONNECT_MAX_MS    = 30_000;  // cap at 30 s
const RECONNECT_MAX_TRIES = 10;      // → 'degraded' after 10 failures

// On close:
attemptsRef.current++;
const backoffMs = Math.min(RECONNECT_BASE_MS * 2 ** (attemptsRef.current - 1), RECONNECT_MAX_MS);
reconnectTimer.current = setTimeout(() => connect(), backoffMs);
```

Retry schedule: 2 s → 4 s → 8 s → 16 s → 30 s (capped) → 30 s … until success.

On successful reconnect: `attemptsRef.current` resets to 0.

### 2. ConnectionState

New exported type and context field:

```typescript
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'degraded' | 'disconnected';
```

| State | When |
|-------|------|
| `connecting` | First connection attempt (no prior attempts) |
| `connected` | WebSocket `onopen` fired |
| `reconnecting` | 1–9 failed attempts; retrying with backoff |
| `degraded` | ≥ 10 failed attempts; gateway likely down |
| `disconnected` | No token — WS never attempted |

`reconnectAttempts: number` also exposed in context.

### 3. DegradedBanner Component

`packages/control/src/components/DegradedBanner.tsx`:

- **Hidden** when `connected`, `connecting`, or `disconnected` (no token scenario)
- **Suppressed** on first transient drop (`reconnectAttempts <= 1`) — avoids flash on brief network hiccup
- **Yellow banner** (`reconnecting`, attempts > 1): "Reconnecting to gateway (attempt N) — live events paused."
- **Red banner** (`degraded`): "Gateway unreachable — N attempts failed. Commands and live events are unavailable."

Both banners use `role="alert"` / `role="status"` with `aria-live` for accessibility.

### 4. App.tsx — Banner Placement

`DegradedBanner` renders between `StatusBar` and the tab bar:

```tsx
<StatusBar ... />
<DegradedBanner />
{/* Tab bar */}
```

This gives it maximum visibility without blocking the tab content.

---

## Integration Points

| File | Change |
|------|--------|
| `GatewayContext.tsx` | Added `connectionState`, `reconnectAttempts`, `attemptsRef`; replaced fixed 3 s with exponential backoff; tracks `RECONNECT_MAX_TRIES` → `'degraded'` |
| `components/DegradedBanner.tsx` | Created — yellow/red banner keyed on `connectionState` |
| `App.tsx` | Imports and renders `DegradedBanner` between StatusBar and tab bar |

---

## Reconnect Timeline Example

```
t=0     WS open → connected
t=5min  Gateway crashes → onclose fires
t=5:00  Attempt 1 — backoff 2s
t=5:02  Attempt 2 — backoff 4s
t=5:06  Attempt 3 — backoff 8s  [yellow banner appears]
t=5:14  Attempt 4 — backoff 16s
t=5:30  Attempt 5 — backoff 30s
...
t=~10min Attempt 10 → state = 'degraded' [red banner]
         Still retrying every 30s silently
t=12min Gateway restarts → WS open → connected
         Banner hidden, attempts reset to 0
```

---

## Tests

No new automated tests for this phase — `GatewayContext` and `DegradedBanner` are browser-side React components that require a DOM environment. The build (`pnpm --filter @krythor/control build`) passes TypeScript strict mode and the Vite bundler validates all imports.

All 178 backend tests continue to pass.

---

## Next

**Phase 6 — Structured logging + request ID propagation**
Replace ad-hoc `console.*` calls throughout the gateway with a uniform structured logger, propagate Fastify's `req.id` into all log lines for a given request, and add log-level configuration to `AppConfig`.
