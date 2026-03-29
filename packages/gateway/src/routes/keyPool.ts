/**
 * API Key Pool routes — per-provider key rotation management.
 *
 * GET    /api/providers/:id/keys         — list keys (masked) and stats
 * POST   /api/providers/:id/keys         — add a key to the pool
 * DELETE /api/providers/:id/keys/:key    — remove a key from the pool
 * POST   /api/providers/:id/keys/clear   — clear all keys for provider
 * GET    /api/providers/keys/stats       — stats across all providers
 */

import type { FastifyInstance } from 'fastify';
import type { ApiKeyPool } from '../ApiKeyPool.js';

/** Mask a key, showing only the last 4 chars. */
function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${'*'.repeat(Math.min(key.length - 4, 20))}${key.slice(-4)}`;
}

export function registerKeyPoolRoutes(
  app: FastifyInstance,
  pool: ApiKeyPool,
): void {

  // GET /api/providers/:id/keys — list masked keys and stats
  app.get<{ Params: { id: string } }>('/api/providers/:id/keys', async (req, reply) => {
    const { id } = req.params;
    const keys = pool.getKeys(id).map(k => ({ masked: maskKey(k) }));
    const stats = pool.stats(id);
    return reply.send({ providerId: id, keys, stats });
  });

  // POST /api/providers/:id/keys — add a key to the pool
  app.post<{ Params: { id: string } }>('/api/providers/:id/keys', {
    schema: {
      body: {
        type: 'object',
        required: ['key'],
        properties: {
          key: { type: 'string', minLength: 8, maxLength: 512 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { key } = req.body as { key: string };
    pool.addKey(req.params.id, key);
    const stats = pool.stats(req.params.id);
    return reply.code(201).send({ ok: true, stats });
  });

  // DELETE /api/providers/:id/keys/:key — remove a specific key
  // Key is passed as base64url encoded to avoid path conflicts
  app.delete<{ Params: { id: string; keyb64: string } }>(
    '/api/providers/:id/keys/:keyb64',
    async (req, reply) => {
      let key: string;
      try {
        key = Buffer.from(req.params.keyb64, 'base64url').toString('utf8');
      } catch {
        return reply.code(400).send({ error: 'Invalid key encoding (expected base64url)' });
      }
      pool.removeKey(req.params.id, key);
      return reply.send({ ok: true });
    },
  );

  // POST /api/providers/:id/keys/clear — remove all keys for provider
  app.post<{ Params: { id: string } }>('/api/providers/:id/keys/clear', async (req, reply) => {
    pool.removeProvider(req.params.id);
    return reply.send({ ok: true });
  });

  // GET /api/providers/keys/stats — stats across all providers
  app.get('/api/providers/keys/stats', async (_req, reply) => {
    return reply.send(pool.allStats());
  });
}
