/**
 * Tests for GET /api/plugins (ITEM C)
 */

import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerPluginRoutes } from './plugins.js';
import type { PluginLoader } from '@krythor/core';

function makeApp(loadedPlugins: Array<{ name: string; description: string; file: string; run: (input: string) => Promise<string> }>) {
  const app = Fastify({ logger: false });

  const fakeLoader = {
    list: () => loadedPlugins,
    get: (name: string) => loadedPlugins.find(p => p.name === name) ?? null,
    load: () => loadedPlugins,
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

  it('returns loaded plugins with name, description, file', async () => {
    const app = makeApp([
      { name: 'greet', description: 'A greeting plugin', file: 'greet.js', run: async (i) => i },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/plugins' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ name: 'greet', description: 'A greeting plugin', file: 'greet.js' });
    // run function should NOT be serialized
    expect(body[0].run).toBeUndefined();
  });

  it('returns all loaded plugins', async () => {
    const app = makeApp([
      { name: 'a', description: 'Plugin A', file: 'a.js', run: async () => '' },
      { name: 'b', description: 'Plugin B', file: 'b.js', run: async () => '' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/plugins' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveLength(2);
  });
});
