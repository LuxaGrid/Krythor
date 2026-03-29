/**
 * Moderation routes — manage content moderation patterns and scan content.
 *
 * GET  /api/moderation/patterns           — list all patterns
 * POST /api/moderation/scan               — scan content against all patterns
 */

import type { FastifyInstance } from 'fastify';
import { ModerationEngine } from '@krythor/guard';
import type { ModerationDirection } from '@krythor/guard';

export function registerModerationRoutes(
  app: FastifyInstance,
  moderation: ModerationEngine,
): void {
  // GET /api/moderation/patterns — list all patterns
  app.get('/api/moderation/patterns', async (_req, reply) => {
    return reply.send(moderation.listPatterns());
  });

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
