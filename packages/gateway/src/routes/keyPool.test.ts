import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { ApiKeyPool } from '../ApiKeyPool.js';
import { registerKeyPoolRoutes } from './keyPool.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function b64url(s: string) {
  return Buffer.from(s).toString('base64url');
}

let app: ReturnType<typeof Fastify>;
let pool: ApiKeyPool;
let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'krythor-keypoolroute-'));
  pool = new ApiKeyPool(tmpDir);
  app = Fastify();
  registerKeyPoolRoutes(app, pool);
  await app.ready();
});

afterEach(async () => {
  await app.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/providers/:id/keys', () => {
  it('returns empty keys for unknown provider', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/openai/keys' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.keys).toHaveLength(0);
    expect(body.stats).toBeNull();
  });

  it('returns masked keys', async () => {
    pool.addKey('openai', 'sk-abcdefghij1234');
    const res = await app.inject({ method: 'GET', url: '/api/providers/openai/keys' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0].masked).toMatch(/\*+1234$/);
    expect(body.keys[0].masked).not.toContain('abcdefghij');
  });
});

describe('POST /api/providers/:id/keys', () => {
  it('adds a key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/openai/keys',
      payload: { key: 'sk-abcdefghijklmnop' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ok).toBe(true);
    expect(pool.getKeys('openai')).toHaveLength(1);
  });

  it('rejects missing key field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/openai/keys',
      payload: { other: 'field' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects key shorter than 8 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/providers/openai/keys',
      payload: { key: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /api/providers/:id/keys/:keyb64', () => {
  it('removes a key', async () => {
    pool.addKey('anthropic', 'sk-ant-12345678');
    const encoded = b64url('sk-ant-12345678');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/providers/anthropic/keys/${encoded}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(pool.getKeys('anthropic')).toHaveLength(0);
  });

  it('returns ok even if key does not exist', async () => {
    const encoded = b64url('sk-nonexistent-key');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/providers/openai/keys/${encoded}`,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/providers/:id/keys/clear', () => {
  it('clears all keys for provider', async () => {
    pool.setKeys('openai', ['sk-a1234567', 'sk-b1234567']);
    const res = await app.inject({ method: 'POST', url: '/api/providers/openai/keys/clear' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(pool.getKeys('openai')).toHaveLength(0);
  });
});

describe('GET /api/providers/keys/stats', () => {
  it('returns empty array when no providers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/providers/keys/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns stats for all providers', async () => {
    pool.addKey('openai', 'sk-a123456789');
    pool.addKey('anthropic', 'sk-b123456789');
    const res = await app.inject({ method: 'GET', url: '/api/providers/keys/stats' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body.map((s: { providerId: string }) => s.providerId).sort()).toEqual(['anthropic', 'openai']);
  });
});
