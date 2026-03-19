/**
 * Phase 8 — Tests for ModelEngine.checkAvailability() v0.2 change.
 *
 * checkAvailability now returns { ok, lastUnavailableReason? } instead of boolean.
 * Tests verify:
 *   1. Returns { ok: true } when provider is available
 *   2. Returns { ok: false, lastUnavailableReason } when unavailable
 *   3. Returns { ok: false, lastUnavailableReason: 'Provider not found' } for unknown id
 *   4. Does not include lastUnavailableReason when ok is true (no stale reason)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModelEngine } from './ModelEngine.js';

// Minimal registry + provider stub — avoids file I/O
function makeEngineWithProvider(opts: {
  providerId: string;
  available: boolean;
  lastUnavailableReason?: string;
}): ModelEngine {
  const engine = new ModelEngine('/tmp/krythor-test-cfg');

  // Inject a fake provider via the registry's internal map
  const fakeProvider = {
    id: opts.providerId,
    name: 'Test Provider',
    type: 'openai-compat',
    isEnabled: true,
    getModels: () => ['test-model'],
    getModelInfo: () => ({ id: 'test-model', providerId: opts.providerId, badges: [], isAvailable: true }),
    infer: vi.fn(),
    inferStream: vi.fn(),
    isAvailable: vi.fn(async () => opts.available),
    listModels: vi.fn(async () => ['test-model']),
    lastUnavailableReason: opts.available ? undefined : (opts.lastUnavailableReason ?? 'Connection refused'),
  };

  // @ts-expect-error accessing private registry internals for test
  (engine.registry as unknown as { providers: Map<string, unknown> }).providers =
    new Map([[opts.providerId, fakeProvider]]);

  return engine;
}

describe('ModelEngine.checkAvailability() v0.2', () => {
  it('returns { ok: true } for a reachable provider', async () => {
    const engine = makeEngineWithProvider({ providerId: 'p1', available: true });
    const result = await engine.checkAvailability('p1');
    expect(result.ok).toBe(true);
    expect(result.lastUnavailableReason).toBeUndefined();
  });

  it('returns { ok: false, lastUnavailableReason } for an unreachable provider', async () => {
    const engine = makeEngineWithProvider({
      providerId: 'p2',
      available: false,
      lastUnavailableReason: 'ECONNREFUSED at http://localhost:8080',
    });
    const result = await engine.checkAvailability('p2');
    expect(result.ok).toBe(false);
    expect(result.lastUnavailableReason).toBe('ECONNREFUSED at http://localhost:8080');
  });

  it('returns { ok: false, lastUnavailableReason: "Provider not found" } for unknown id', async () => {
    const engine = new ModelEngine('/tmp/krythor-test-cfg-empty');
    const result = await engine.checkAvailability('does-not-exist');
    expect(result.ok).toBe(false);
    expect(result.lastUnavailableReason).toBe('Provider not found');
  });

  it('does not include lastUnavailableReason when provider is available', async () => {
    const engine = makeEngineWithProvider({ providerId: 'p3', available: true });
    const result = await engine.checkAvailability('p3');
    expect('lastUnavailableReason' in result && result.lastUnavailableReason !== undefined).toBe(false);
  });

  it('returns a reason even when provider has no explicit message', async () => {
    const engine = makeEngineWithProvider({ providerId: 'p4', available: false });
    const result = await engine.checkAvailability('p4');
    expect(result.ok).toBe(false);
    // Falls back to default set by the test stub
    expect(result.lastUnavailableReason).toBeTruthy();
  });
});
