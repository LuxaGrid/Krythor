/**
 * Custom tool routes — ITEM 6: User-defined webhook tools.
 *
 * POST /api/tools            — register a custom tool (previously only GET was here;
 *                              the new custom-tool POST is on this path)
 * GET  /api/tools/custom     — list user-defined tools
 * DELETE /api/tools/:name    — remove a custom tool by name
 *
 * All routes require auth (handled by the global preHandler in server.ts).
 */

import type { FastifyInstance } from 'fastify';
import type { GuardEngine } from '@krythor/guard';
import { CustomToolStore } from '@krythor/core';
import type { CustomToolDefinition, HttpMethod } from '@krythor/core';

const VALID_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function registerCustomToolRoutes(
  app: FastifyInstance,
  customToolStore: CustomToolStore,
  _guard?: GuardEngine,
): void {

  // GET /api/tools/custom — list all user-defined tools
  app.get('/api/tools/custom', async (_req, reply) => {
    return reply.send(customToolStore.list());
  });

  // POST /api/tools/custom — register a new custom tool
  app.post('/api/tools/custom', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'description', 'type', 'url', 'method'],
        properties: {
          name:         { type: 'string', minLength: 1, maxLength: 100 },
          description:  { type: 'string', minLength: 1, maxLength: 500 },
          type:         { type: 'string', enum: ['webhook'] },
          url:          { type: 'string', minLength: 7, maxLength: 2048 },
          method:       { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
          headers:      {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          bodyTemplate: { type: 'string', maxLength: 4096 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      name: string;
      description: string;
      type: 'webhook';
      url: string;
      method: string;
      headers?: Record<string, string>;
      bodyTemplate?: string;
    };

    if (!VALID_METHODS.includes(body.method as HttpMethod)) {
      return reply.code(400).send({ error: 'Invalid method', hint: `Must be one of: ${VALID_METHODS.join(', ')}` });
    }

    const tool: CustomToolDefinition = {
      name:         body.name,
      description:  body.description,
      type:         'webhook',
      url:          body.url,
      method:       body.method as HttpMethod,
      headers:      body.headers,
      bodyTemplate: body.bodyTemplate,
    };

    const saved = customToolStore.add(tool);
    return reply.code(201).send(saved);
  });

  // DELETE /api/tools/custom/:name — remove a custom tool
  app.delete<{ Params: { name: string } }>('/api/tools/custom/:name', async (req, reply) => {
    const removed = customToolStore.remove(req.params.name);
    if (!removed) {
      return reply.code(404).send({ error: `Custom tool "${req.params.name}" not found` });
    }
    return reply.code(204).send();
  });
}
