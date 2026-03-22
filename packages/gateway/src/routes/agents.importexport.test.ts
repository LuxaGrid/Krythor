/**
 * Tests for ITEM 1: Agent import/export
 * - GET /api/agents/:id/export
 * - POST /api/agents/import
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer, GATEWAY_PORT } from '../server.js';
import { loadOrCreateToken } from '../auth.js';
import { join } from 'path';
import { homedir } from 'os';

let app: Awaited<ReturnType<typeof buildServer>>;
let authToken: string;
const HOST = `127.0.0.1:${GATEWAY_PORT}`;

function getDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Krythor');
  }
  return join(homedir(), '.local', 'share', 'krythor');
}

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  const cfg = loadOrCreateToken(join(getDataDir(), 'config'));
  authToken = cfg.token ?? '';
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/agents/:id/export', () => {
  it('returns 404 for a non-existent agent', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/agents/does-not-exist-xyz/export',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    expect(res.statusCode).toBe(404);
  });

  it('exports an existing agent as JSON and includes name/systemPrompt', async () => {
    // Create an agent first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'Export Test Agent',
        systemPrompt: 'You are an export test agent.',
        description: 'Agent used for export testing',
        memoryScope: 'session',
      }),
    });
    expect(createRes.statusCode).toBe(201);
    const created = JSON.parse(createRes.body) as { id: string; name: string };

    const res = await app.inject({
      method: 'GET',
      url: `/api/agents/${created.id}/export`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.name).toBe('Export Test Agent');
    expect(body.systemPrompt).toBe('You are an export test agent.');
    expect(body.description).toBe('Agent used for export testing');
    expect(body.krythorAgentExport).toBe('1');
    // id, createdAt, updatedAt must be stripped
    expect(body.id).toBeUndefined();
    expect(body.createdAt).toBeUndefined();
    expect(body.updatedAt).toBeUndefined();
  });

  it('sets Content-Disposition header for download', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'CD Test Agent', systemPrompt: 'Content-Disposition test.' }),
    });
    const created = JSON.parse(createRes.body) as { id: string };

    const res = await app.inject({
      method: 'GET',
      url: `/api/agents/${created.id}/export`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/\.json/);
  });
});

describe('POST /api/agents/import', () => {
  it('creates a new agent from exported config', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/import',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        krythorAgentExport: '1',
        name: 'Imported Agent',
        systemPrompt: 'You are an imported agent.',
        description: 'Imported from export',
        memoryScope: 'session',
        maxTurns: 5,
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string; name: string; systemPrompt: string };
    expect(body.name).toBe('Imported Agent');
    expect(body.systemPrompt).toBe('You are an imported agent.');
    // Should have a fresh id assigned
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
  });

  it('returns 400 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/import',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ systemPrompt: 'No name provided.' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when systemPrompt is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/import',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'No Prompt Agent' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 401 without auth token', async () => {
    if (!authToken) return;
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents/import',
      headers: { host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Anon Agent', systemPrompt: 'Hello.' }),
    });
    expect(res.statusCode).toBe(401);
  });

  it('round-trip: export then import preserves fields', async () => {
    // Create original
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/agents',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({
        name: 'Round Trip Agent',
        systemPrompt: 'You are a round-trip test agent.',
        description: 'Round trip test',
        memoryScope: 'agent',
        maxTurns: 7,
      }),
    });
    const original = JSON.parse(createRes.body) as { id: string; name: string };

    // Export
    const exportRes = await app.inject({
      method: 'GET',
      url: `/api/agents/${original.id}/export`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    const exported = JSON.parse(exportRes.body) as Record<string, unknown>;

    // Import
    const importRes = await app.inject({
      method: 'POST',
      url: '/api/agents/import',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify(exported),
    });
    expect(importRes.statusCode).toBe(201);
    const imported = JSON.parse(importRes.body) as Record<string, unknown>;

    expect(imported['name']).toBe('Round Trip Agent');
    expect(imported['systemPrompt']).toBe('You are a round-trip test agent.');
    expect(imported['description']).toBe('Round trip test');
    expect(imported['memoryScope']).toBe('agent');
    expect(imported['maxTurns']).toBe(7);
    // New agent must have a different ID
    expect(imported['id']).not.toBe(original.id);
  });
});
