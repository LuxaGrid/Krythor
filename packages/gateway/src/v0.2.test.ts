/**
 * Phase 8 — v0.2 integration tests
 *
 * Tests for the v0.2 usability improvements:
 *   1. /health includes embeddingDegraded in memory section
 *   2. /health firstRun flag behavior
 *   3. /api/heartbeat/status returns embeddingStatus
 *   4. /api/models/providers/:id/ping returns lastUnavailableReason on failure
 *   5. AgentRun UI type fields (selectionReason, fallbackOccurred, memoryUsed, memoryIdsUsed)
 *   6. Memory stats includes embeddingDegraded
 *   7. /ready endpoint returns 200 when healthy
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildServer, GATEWAY_PORT } from './server.js';
import { loadOrCreateToken } from './auth.js';
import { join } from 'path';
import { homedir } from 'os';

let app: Awaited<ReturnType<typeof buildServer>>;
let authToken: string;
const HOST = `127.0.0.1:${GATEWAY_PORT}`;

function getDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor');
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Krythor');
  return join(homedir(), '.local', 'share', 'krythor');
}

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  const cfg = loadOrCreateToken(join(getDataDir(), 'config'));
  authToken = cfg.token ?? '';
});

// ── 1. /health — embeddingDegraded in memory section ──────────────────────────

describe('v0.2 — /health embedding degradation field', () => {
  it('includes embeddingDegraded boolean in memory section', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const memory = body['memory'] as Record<string, unknown>;
    expect(memory).toBeDefined();
    expect(typeof memory['embeddingDegraded']).toBe('boolean');
  });

  it('includes semantic boolean in memory section', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const memory = body['memory'] as Record<string, unknown>;
    expect(typeof memory['semantic']).toBe('boolean');
  });

  it('embeddingProvider is always present in memory section', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const memory = body['memory'] as Record<string, unknown>;
    expect(typeof memory['embeddingProvider']).toBe('string');
    expect((memory['embeddingProvider'] as string).length).toBeGreaterThan(0);
  });
});

// ── 2. /health — firstRun flag ────────────────────────────────────────────────

describe('v0.2 — /health firstRun field', () => {
  it('includes firstRun boolean in health response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(typeof body['firstRun']).toBe('boolean');
  });

  it('firstRun is true when providerCount and agentCount are both 0', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const models = body['models'] as Record<string, unknown>;
    const agents = body['agents'] as Record<string, unknown>;
    const expectedFirstRun = (models['providerCount'] as number) === 0 && (agents['agentCount'] as number) === 0;
    expect(body['firstRun']).toBe(expectedFirstRun);
  });
});

// ── 3. /api/heartbeat/status — embeddingStatus ────────────────────────────────

describe('v0.2 — /api/heartbeat/status embedding status', () => {
  it('returns embeddingStatus with degraded and providerName', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/heartbeat/status',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    const emb = body['embeddingStatus'] as Record<string, unknown>;
    expect(emb).toBeDefined();
    expect(typeof emb['degraded']).toBe('boolean');
    expect(typeof emb['providerName']).toBe('string');
    expect(typeof emb['semantic']).toBe('boolean');
  });

  it('returns persistedWarnings array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/heartbeat/status',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(Array.isArray(body['persistedWarnings'])).toBe(true);
  });
});

// ── 4. /api/models/providers/:id/ping — lastUnavailableReason ─────────────────

describe('v0.2 — ping route returns lastUnavailableReason on failure', () => {
  it('returns ok field in ping response', async () => {
    // Use a non-existent provider id — should return ok: false
    const res = await app.inject({
      method: 'POST',
      url: '/api/models/providers/nonexistent-provider-id/ping',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(typeof body['ok']).toBe('boolean');
    expect(typeof body['latencyMs']).toBe('number');
  });

  it('ping for unknown provider returns ok:false with lastUnavailableReason', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/models/providers/fake-no-exist/ping',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body['ok']).toBe(false);
    expect(typeof body['lastUnavailableReason']).toBe('string');
  });
});

// ── 5. /api/agents/runs — AgentRun shape ──────────────────────────────────────

describe('v0.2 — /api/agents/runs response shape', () => {
  it('GET /api/agents/runs returns an array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/runs',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    expect(res.statusCode).toBe(200);
    const runs = JSON.parse(res.body) as unknown[];
    expect(Array.isArray(runs)).toBe(true);
  });
});

// ── 6. /api/memory/stats — embeddingDegraded ──────────────────────────────────

describe('v0.2 — /api/memory/stats embeddingDegraded field', () => {
  it('returns embeddingDegraded boolean in memory stats', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/stats',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(typeof body['embeddingDegraded']).toBe('boolean');
  });
});

// ── 7. /ready endpoint ────────────────────────────────────────────────────────

describe('v0.2 — /ready readiness endpoint', () => {
  it('returns 200 or 503 with a ready boolean', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    expect([200, 503]).toContain(res.statusCode);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(typeof body['ready']).toBe('boolean');
  });

  it('/ready returns 200 when server is freshly started (DB and guard ok)', async () => {
    const res = await app.inject({ method: 'GET', url: '/ready' });
    // Fresh server with in-memory state should be ready
    expect(res.statusCode).toBe(200);
  });
});
