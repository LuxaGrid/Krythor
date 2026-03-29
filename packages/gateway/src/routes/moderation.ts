/**
 * Moderation routes — manage content moderation patterns and scan content.
 *
 * GET    /api/moderation/patterns           — list all patterns (builtin + custom)
 * GET    /api/moderation/patterns/custom    — list custom patterns only
 * POST   /api/moderation/patterns           — add or replace a custom pattern
 * PATCH  /api/moderation/patterns/:id       — update fields on an existing pattern
 * DELETE /api/moderation/patterns/:id       — delete a custom pattern
 * POST   /api/moderation/scan               — scan content against all patterns
 */

import type { FastifyInstance } from 'fastify';
import { ModerationEngine } from '@krythor/guard';
import type { ModerationDirection, ModerationPattern } from '@krythor/guard';

const PATTERN_SCHEMA = {
  type: 'object',
  required: ['id', 'name', 'category', 'pattern', 'action', 'enabled'],
  properties: {
    id:         { type: 'string', minLength: 1, maxLength: 128 },
    name:       { type: 'string', minLength: 1, maxLength: 200 },
    category:   { type: 'string', enum: ['pii', 'credential', 'prompt-injection', 'custom'] },
    pattern:    { type: 'string', minLength: 1, maxLength: 2000 },
    action:     { type: 'string', enum: ['block', 'warn'] },
    directions: { type: 'array', items: { type: 'string', enum: ['inbound', 'outbound'] } },
    enabled:    { type: 'boolean' },
  },
  additionalProperties: false,
};

export function registerModerationRoutes(
  app: FastifyInstance,
  moderation: ModerationEngine,
): void {
  // GET /api/moderation/patterns — list all patterns
  app.get('/api/moderation/patterns', async (_req, reply) => {
    return reply.send(moderation.listPatterns());
  });

  // GET /api/moderation/patterns/custom — list custom patterns only
  app.get('/api/moderation/patterns/custom', async (_req, reply) => {
    return reply.send(moderation.listCustomPatterns());
  });

  // POST /api/moderation/patterns — add or replace a custom pattern
  app.post<{ Body: ModerationPattern }>(
    '/api/moderation/patterns',
    { schema: { body: PATTERN_SCHEMA } },
    async (req, reply) => {
      // Validate the regex before accepting
      try {
        new RegExp(req.body.pattern, 'i');
      } catch {
        return reply.code(400).send({ error: 'Invalid regex in "pattern" field' });
      }
      const saved = moderation.upsertPattern(req.body);
      return reply.code(201).send(saved);
    },
  );

  // PATCH /api/moderation/patterns/:id — update fields on an existing custom pattern
  app.patch<{ Params: { id: string }; Body: Partial<Omit<ModerationPattern, 'id'>> }>(
    '/api/moderation/patterns/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name:       { type: 'string', minLength: 1, maxLength: 200 },
            category:   { type: 'string', enum: ['pii', 'credential', 'prompt-injection', 'custom'] },
            pattern:    { type: 'string', minLength: 1, maxLength: 2000 },
            action:     { type: 'string', enum: ['block', 'warn'] },
            directions: { type: 'array', items: { type: 'string', enum: ['inbound', 'outbound'] } },
            enabled:    { type: 'boolean' },
          },
          additionalProperties: false,
          minProperties: 1,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params;
      // Find the existing pattern (could be a custom or a builtin override)
      const all = moderation.listPatterns();
      const existing = all.find(p => p.id === id);
      if (!existing) return reply.code(404).send({ error: 'Pattern not found' });

      const patch = req.body;
      if (patch.pattern !== undefined) {
        try {
          new RegExp(patch.pattern, 'i');
        } catch {
          return reply.code(400).send({ error: 'Invalid regex in "pattern" field' });
        }
      }

      const updated: ModerationPattern = { ...existing, ...patch, id };
      const saved = moderation.upsertPattern(updated);
      return reply.send(saved);
    },
  );

  // DELETE /api/moderation/patterns/:id — delete a custom pattern
  app.delete<{ Params: { id: string } }>(
    '/api/moderation/patterns/:id',
    async (req, reply) => {
      const { id } = req.params;
      // Prevent deleting builtin-only patterns (they were never added to custom list)
      if (moderation.isBuiltinOnly(id)) {
        return reply.code(400).send({ error: 'Cannot delete a builtin pattern; set enabled=false to disable it' });
      }
      const removed = moderation.deletePattern(id);
      if (!removed) return reply.code(404).send({ error: 'Custom pattern not found' });
      return reply.code(204).send();
    },
  );

  // POST /api/moderation/scan — scan content
  app.post<{ Body: { content: string; direction?: ModerationDirection } }>(
    '/api/moderation/scan',
    {
      schema: {
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content:   { type: 'string', minLength: 1, maxLength: 100000 },
            direction: { type: 'string', enum: ['inbound', 'outbound'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { content, direction } = req.body;
      const result = moderation.scan(content, { direction });
      return reply.send(result);
    },
  );
}
