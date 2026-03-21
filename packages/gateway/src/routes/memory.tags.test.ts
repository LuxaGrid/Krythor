/**
 * Tests for GET /api/memory/tags
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

describe('GET /api/memory/tags', () => {
  it('returns 200 with tags array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/tags',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { tags: unknown };
    expect(Array.isArray(body.tags)).toBe(true);
  });

  it('returns 401 without auth token', async () => {
    if (!authToken) return; // auth disabled — skip
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/tags',
      headers: { host: HOST },
    });
    expect(res.statusCode).toBe(401);
  });

  it('tags array is sorted alphabetically', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory/tags',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    const body = JSON.parse(res.body) as { tags: string[] };
    const tags = body.tags;
    // Every element must be a string
    for (const t of tags) expect(typeof t).toBe('string');
    // Sorted alphabetically
    const sorted = [...tags].sort();
    expect(tags).toEqual(sorted);
  });
});
