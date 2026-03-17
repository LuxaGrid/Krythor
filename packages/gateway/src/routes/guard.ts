import type { FastifyInstance } from 'fastify';
import type { GuardEngine, GuardContext, PolicyRule } from '@krythor/guard';
import type { GuardDecisionStore } from '@krythor/memory';

export function registerGuardRoutes(app: FastifyInstance, guard: GuardEngine, guardDecisionStore?: GuardDecisionStore): void {

  // GET /api/guard/policy — full policy config
  app.get('/api/guard/policy', async (_req, reply) => {
    return reply.send(guard.getPolicy());
  });

  // GET /api/guard/stats
  app.get('/api/guard/stats', async (_req, reply) => {
    return reply.send(guard.stats());
  });

  // GET /api/guard/rules
  app.get('/api/guard/rules', async (_req, reply) => {
    return reply.send(guard.getRules());
  });

  // POST /api/guard/check — evaluate a context without executing anything
  app.post('/api/guard/check', {
    schema: {
      body: {
        type: 'object',
        required: ['operation', 'source'],
        properties: {
          operation: { type: 'string' },
          source:    { type: 'string' },
          sourceId:  { type: 'string' },
          scope:     { type: 'string' },
          content:   { type: 'string' },
          metadata:  { type: 'object' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const verdict = guard.check(req.body as GuardContext);
    return reply.send(verdict);
  });

  // POST /api/guard/rules — add a custom rule
  app.post('/api/guard/rules', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'description', 'priority', 'condition', 'action', 'reason'],
        properties: {
          name:        { type: 'string', minLength: 1 },
          description: { type: 'string' },
          enabled:     { type: 'boolean' },
          priority:    { type: 'number', minimum: 0 },
          condition: {
            type: 'object',
            properties: {
              operations:     { type: 'array', items: { type: 'string' } },
              sources:        { type: 'array', items: { type: 'string' } },
              scopes:         { type: 'array', items: { type: 'string' } },
              minRisk:        { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
              contentPattern: { type: 'string', maxLength: 500 },
            },
            additionalProperties: false,
          },
          action:      { type: 'string', enum: ['allow', 'deny', 'warn'] },
          reason:      { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as Omit<PolicyRule, 'id'>;
    if (body.condition?.contentPattern) {
      try { new RegExp(body.condition.contentPattern, 'i'); }
      catch { return reply.code(400).send({ error: 'contentPattern is not a valid regular expression' }); }
    }
    const rule = guard.addRule(body);
    return reply.code(201).send(rule);
  });

  // PATCH /api/guard/rules/:id
  app.patch<{ Params: { id: string } }>('/api/guard/rules/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string', minLength: 1 },
          description: { type: 'string' },
          enabled:     { type: 'boolean' },
          priority:    { type: 'number', minimum: 0 },
          condition: {
            type: 'object',
            properties: {
              operations:     { type: 'array', items: { type: 'string' } },
              sources:        { type: 'array', items: { type: 'string' } },
              scopes:         { type: 'array', items: { type: 'string' } },
              minRisk:        { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
              contentPattern: { type: 'string', maxLength: 500 },
            },
            additionalProperties: false,
          },
          action:      { type: 'string', enum: ['allow', 'deny', 'warn'] },
          reason:      { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const patch = req.body as Partial<Omit<PolicyRule, 'id'>>;
    if (patch.condition?.contentPattern) {
      try { new RegExp(patch.condition.contentPattern, 'i'); }
      catch { return reply.code(400).send({ error: 'contentPattern is not a valid regular expression' }); }
    }
    try {
      const rule = guard.updateRule(req.params.id, patch);
      return reply.send(rule);
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : 'Not found' });
    }
  });

  // DELETE /api/guard/rules/:id
  app.delete<{ Params: { id: string } }>('/api/guard/rules/:id', async (req, reply) => {
    try {
      guard.deleteRule(req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  });

  // PATCH /api/guard/policy/default — set default action
  app.patch('/api/guard/policy/default', {
    schema: {
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['allow', 'deny'] },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { action } = req.body as { action: 'allow' | 'deny' };
    guard.setDefaultAction(action);
    return reply.send({ defaultAction: action });
  });

  // POST /api/guard/reload — reload policy from disk
  app.post('/api/guard/reload', async (_req, reply) => {
    guard.reload();
    return reply.send({ reloaded: true, stats: guard.stats() });
  });

  // GET /api/guard/decisions — audit log of all guard decisions
  app.get('/api/guard/decisions', async (req, reply) => {
    if (!guardDecisionStore) return reply.code(503).send({ error: 'Guard decision store not available' });
    const q = req.query as Record<string, string>;
    const limit = Math.min(Math.max(1, parseInt(q.limit, 10) || 100), 500);
    const offset = Math.max(0, parseInt(q.offset, 10) || 0);
    const decisions = guardDecisionStore.list(limit, offset);
    return reply.send(decisions);
  });
}
