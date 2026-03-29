/**
 * API Key management routes.
 *
 * All routes require the master gateway token (admin only).
 *
 *   GET    /api/auth/keys         — list keys (safe view, no hashes)
 *   POST   /api/auth/keys         — create key (returns plaintext once)
 *   DELETE /api/auth/keys/:id     — revoke key
 *   PATCH  /api/auth/keys/:id     — update name / permissions / expiry
 */

import type { FastifyInstance } from 'fastify';
import type { ApiKeyStore } from '../ApiKeyStore.js';
import { ALL_PERMISSIONS, type ApiKeyPermission } from '../ApiKeyStore.js';

export function registerApiKeyRoutes(app: FastifyInstance, store: ApiKeyStore): void {

  // GET /api/auth/keys — list all keys
  app.get('/api/auth/keys', async (_req, reply) => {
    return reply.send({ keys: store.list() });
  });

  // POST /api/auth/keys — create a new key
  app.post('/api/auth/keys', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'permissions'],
        properties: {
          name:        { type: 'string', minLength: 1, maxLength: 100 },
          permissions: { type: 'array', items: { type: 'string' }, minItems: 1 },
          expiresAt:   { type: 'number' },
          rateLimit:   { type: 'number', minimum: 1 },
          dailyLimit:  { type: 'number', minimum: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { name, permissions, expiresAt, rateLimit, dailyLimit } = req.body as {
      name: string;
      permissions: ApiKeyPermission[];
      expiresAt?: number;
      rateLimit?: number;
      dailyLimit?: number;
    };

    // Validate permission values
    const invalid = permissions.filter(p => !ALL_PERMISSIONS.includes(p));
    if (invalid.length > 0) {
      return reply.code(400).send({ error: `Unknown permissions: ${invalid.join(', ')}` });
    }

    const { key, entry } = store.create(name, permissions, expiresAt, rateLimit, dailyLimit);
    const { keyHash: _kh, ...safe } = entry;
    return reply.code(201).send({ key, entry: safe });
  });

  // DELETE /api/auth/keys/:id — revoke a key
  app.delete('/api/auth/keys/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    store.revoke(id);
    return reply.code(204).send();
  });

  // PATCH /api/auth/keys/:id — update name / permissions / expiry
  app.patch('/api/auth/keys/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string', minLength: 1, maxLength: 100 },
          permissions: { type: 'array', items: { type: 'string' } },
          expiresAt:   { type: ['number', 'null'] },
          rateLimit:   { type: ['number', 'null'], minimum: 1 },
          dailyLimit:  { type: ['number', 'null'], minimum: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const updates = req.body as {
      name?: string;
      permissions?: ApiKeyPermission[];
      expiresAt?: number | null;
      rateLimit?: number | null;
      dailyLimit?: number | null;
    };

    if (updates.permissions) {
      const invalid = updates.permissions.filter(p => !ALL_PERMISSIONS.includes(p));
      if (invalid.length > 0) {
        return reply.code(400).send({ error: `Unknown permissions: ${invalid.join(', ')}` });
      }
    }

    const updated = store.update(id, updates);
    if (!updated) return reply.code(404).send({ error: 'API key not found' });
    const { keyHash: _kh, ...safe } = updated;
    return reply.send(safe);
  });
}
