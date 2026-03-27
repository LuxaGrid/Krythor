/**
 * Tests for GET /api/plugins and POST /api/plugins/reload
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerPluginRoutes } from './plugins.js';
import type { PluginLoader, PluginLoadRecord } from '@krythor/core';

function makeApp(records: PluginLoadRecord[]) {
  const app = Fastify({ logger: false });

  const fakeLoader = {
    listRecords: () => records,
    load: () => [],
  } as unknown as PluginLoader;

  registerPluginRoutes(app, fakeLoader);
  return app;
}

describe('GET /api/plugins', () => {
  it('returns empty array when no plugins loaded', async () => {
    const app = makeApp([]);
    const res = await app.inject({ method: 'GET', url: '/api/plugins' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('returns loaded plugin records with status', async () => {
    const app = makeApp([
      { file: 'greet.js', status: 'loaded', name: 'greet', description: 'A greeting plugin' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/plugins' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ file: 'greet.js', status: 'loaded', name: 'greet', description: 'A greeting plugin' });
  });

  it('includes error and skipped records', async () => {
    const app = makeApp([
      { file: 'ok.js', status: 'loaded', name: 'ok', description: 'Fine' },
      { file: 'bad.js', status: 'error', reason: 'Failed to load: SyntaxError' },
      { file: 'dup.js', status: 'skipped', name: 'ok', reason: 'Tool name "ok" is already registered' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/plugins' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(3);
    expect(body[1]).toMatchObject({ file: 'bad.js', status: 'error' });
    expect(body[2]).toMatchObject({ file: 'dup.js', status: 'skipped' });
  });
});

describe('POST /api/plugins/reload', () => {
  it('returns 200 with updated records after reload', async () => {
    const app = makeApp([{ file: 'greet.js', status: 'loaded', name: 'greet', description: 'Hi' }]);
    const res = await app.inject({ method: 'POST', url: '/api/plugins/reload' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // After reload, fakeLoader.load() returns [] so listRecords() still returns original records
    expect(Array.isArray(body)).toBe(true);
  });
});
