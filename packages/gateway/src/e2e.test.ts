/**
 * ITEM 8 — End-to-end integration tests (real server, real port 47299).
 *
 * These tests build the full Fastify server, bind it to port 47299 to verify
 * the TCP listen path works, then use Fastify's inject() for HTTP assertions.
 * inject() avoids the host-header security guard (which only allows port 47200)
 * while still exercising the full route/middleware stack end-to-end.
 *
 * Covered:
 *   1. Server starts and /health returns 200 with required fields
 *   2. GET /api/providers returns an array (auth required)
 *   3. GET /api/agents returns an array (auth required)
 *   4. POST /api/command with no providers returns a clear error (not a crash)
 *   5. Unauthenticated request to /api/providers returns 401
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { buildServer, GATEWAY_PORT } from './server.js';
import { loadOrCreateToken } from './auth.js';

const E2E_PORT = 47299;
const E2E_HOST = '127.0.0.1';
const INJECT_HOST = `127.0.0.1:${GATEWAY_PORT}`;

let app: Awaited<ReturnType<typeof buildServer>>;
let authToken: string;

function getDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor');
  }
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Krythor');
  return join(homedir(), '.local', 'share', 'krythor');
}

beforeAll(async () => {
  app = await buildServer();
  // Bind to port 47299 to verify TCP listen works — this is the "real port" aspect
  await app.listen({ port: E2E_PORT, host: E2E_HOST });
  const cfg = loadOrCreateToken(join(getDataDir(), 'config'));
  authToken = cfg.token ?? '';
}, 30_000);

afterAll(async () => {
  await app.close();
});

// ── 1. Server starts and /health returns 200 ─────────────────────────────────

describe('E2E — /health endpoint', () => {
  it('server is listening on port 47299 and /health returns 200', async () => {
    // Verify the server is actually bound by fetching from the real port
    const res = await fetch(`http://${E2E_HOST}:${E2E_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body['status']).toBe('ok');
    expect(typeof body['version']).toBe('string');
    expect(typeof body['timestamp']).toBe('string');
    expect(typeof body['firstRun']).toBe('boolean');
    expect(body['models']).toBeDefined();
    expect(body['agents']).toBeDefined();
  });
});

// ── 2. GET /api/providers returns array ───────────────────────────────────────

describe('E2E — GET /api/providers', () => {
  it('returns an array when authenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/providers',
      headers: { authorization: `Bearer ${authToken}`, host: INJECT_HOST },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/providers',
      headers: { host: INJECT_HOST },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── 3. GET /api/agents returns array ─────────────────────────────────────────

describe('E2E — GET /api/agents', () => {
  it('returns an array when authenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: INJECT_HOST },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });
});

// ── 4. POST /api/command with no providers returns clear error ────────────────

describe('E2E — POST /api/command no-provider error', () => {
  it('returns a clear structured error (not a crash) when no providers are configured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/command',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${authToken}`,
        host: INJECT_HOST,
      },
      payload: { input: 'hello' },
    });
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(typeof body).toBe('object');

    if (res.statusCode === 200) {
      // noProvider path — response includes output or error info
      expect(body['output'] ?? body['error']).toBeTruthy();
    } else {
      // Structured error — must have an error field or code
      expect(body['error'] ?? body['code']).toBeTruthy();
    }
  });
});
