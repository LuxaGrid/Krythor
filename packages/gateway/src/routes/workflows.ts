/**
 * Workflow routes — named multi-agent pipelines.
 *
 * GET    /api/workflows              — list all workflows
 * GET    /api/workflows/:id          — get workflow by id
 * POST   /api/workflows              — create workflow
 * PUT    /api/workflows/:id          — update workflow
 * DELETE /api/workflows/:id          — delete workflow
 * POST   /api/workflows/:id/run      — execute workflow with input
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import type { WorkflowEngine } from '../WorkflowEngine.js';
import type { WorkflowDefinition } from '../WorkflowEngine.js';

const STEP_SCHEMA = {
  type: 'object',
  required: ['agentId'],
  properties: {
    agentId:        { type: 'string', minLength: 1 },
    inputMode:      { type: 'string', enum: ['initial', 'previous', 'concat', 'template'] },
    template:       { type: 'string' },
    condition:      { type: 'string' },
    stopOnFailure:  { type: 'boolean' },
  },
  additionalProperties: false,
};

export function registerWorkflowRoutes(
  app: FastifyInstance,
  workflowEngine: WorkflowEngine,
): void {

  // GET /api/workflows
  app.get('/api/workflows', async (_req, reply) => {
    return reply.send(workflowEngine.list());
  });

  // GET /api/workflows/:id
  app.get<{ Params: { id: string } }>('/api/workflows/:id', async (req, reply) => {
    const wf = workflowEngine.get(req.params.id);
    if (!wf) return reply.code(404).send({ error: 'Workflow not found' });
    return reply.send(wf);
  });

  // POST /api/workflows
  app.post('/api/workflows', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'steps'],
        properties: {
          id:          { type: 'string', minLength: 1, maxLength: 100 },
          name:        { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 1000 },
          steps:       { type: 'array', items: STEP_SCHEMA, minItems: 1, maxItems: 20 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as Partial<WorkflowDefinition>;
    const wf = workflowEngine.upsert({
      id:          body.id ?? randomUUID(),
      name:        body.name!,
      description: body.description,
      steps:       body.steps!,
    });
    return reply.code(201).send(wf);
  });

  // PUT /api/workflows/:id
  app.put<{ Params: { id: string } }>('/api/workflows/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 1000 },
          steps:       { type: 'array', items: STEP_SCHEMA, minItems: 1, maxItems: 20 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const existing = workflowEngine.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: 'Workflow not found' });
    const body = req.body as Partial<WorkflowDefinition>;
    const updated = workflowEngine.upsert({
      id:          existing.id,
      name:        body.name ?? existing.name,
      description: body.description ?? existing.description,
      steps:       body.steps ?? existing.steps,
    });
    return reply.send(updated);
  });

  // DELETE /api/workflows/:id
  app.delete<{ Params: { id: string } }>('/api/workflows/:id', async (req, reply) => {
    if (!workflowEngine.get(req.params.id)) {
      return reply.code(404).send({ error: 'Workflow not found' });
    }
    workflowEngine.remove(req.params.id);
    return reply.send({ ok: true });
  });

  // POST /api/workflows/:id/run
  app.post<{ Params: { id: string } }>('/api/workflows/:id/run', {
    config: { rateLimit: { max: 10, timeWindow: 60_000 } },
    schema: {
      body: {
        type: 'object',
        required: ['input'],
        properties: {
          input: { type: 'string', minLength: 1, maxLength: 100000 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { input } = req.body as { input: string };
    try {
      const result = await workflowEngine.run(req.params.id, input);
      return reply.send(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Workflow execution failed';
      if (msg.includes('not found')) return reply.code(404).send({ error: msg });
      return reply.code(500).send({ error: msg });
    }
  });
}
