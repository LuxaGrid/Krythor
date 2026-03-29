import type { FastifyInstance } from 'fastify';
import type { StandingOrderStore } from '../StandingOrderStore.js';
import type { AgentOrchestrator } from '@krythor/core';

export function registerStandingOrderRoutes(
  app: FastifyInstance,
  store: StandingOrderStore,
  orchestrator?: AgentOrchestrator,
): void {

  // GET /api/standing-orders — list all standing orders
  app.get('/api/standing-orders', async (_req, reply) => {
    return reply.send(store.list());
  });

  // POST /api/standing-orders — create a new standing order
  app.post('/api/standing-orders', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'scope'],
        properties: {
          name:           { type: 'string', minLength: 1, maxLength: 120 },
          description:    { type: 'string', maxLength: 500 },
          agentId:        { type: 'string' },
          scope:          { type: 'string', minLength: 1 },
          triggers:       { type: 'string' },
          approvalGates:  { type: 'string' },
          escalation:     { type: 'string' },
          executionSteps: { type: 'string' },
          cronJobId:      { type: 'string' },
          enabled:        { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      name: string; description?: string; agentId?: string; scope: string;
      triggers?: string; approvalGates?: string; escalation?: string;
      executionSteps?: string; cronJobId?: string; enabled?: boolean;
    };
    const order = store.create(body);
    return reply.code(201).send(order);
  });

  // GET /api/standing-orders/:id — get a single standing order
  app.get('/api/standing-orders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = store.getById(id);
    if (!order) return reply.code(404).send({ error: 'Standing order not found' });
    return reply.send(order);
  });

  // PATCH /api/standing-orders/:id — update a standing order
  app.patch('/api/standing-orders/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name:           { type: 'string', minLength: 1, maxLength: 120 },
          description:    { type: 'string' },
          agentId:        { type: 'string' },
          scope:          { type: 'string', minLength: 1 },
          triggers:       { type: 'string' },
          approvalGates:  { type: 'string' },
          escalation:     { type: 'string' },
          executionSteps: { type: 'string' },
          cronJobId:      { type: 'string' },
          enabled:        { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    try {
      const updated = store.update(id, body);
      return reply.send(updated);
    } catch {
      return reply.code(404).send({ error: 'Standing order not found' });
    }
  });

  // DELETE /api/standing-orders/:id — delete a standing order
  app.delete('/api/standing-orders/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      store.delete(id);
      return reply.code(204).send();
    } catch {
      return reply.code(404).send({ error: 'Standing order not found' });
    }
  });

  // POST /api/standing-orders/:id/run — trigger a standing order immediately
  app.post('/api/standing-orders/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = store.getById(id);
    if (!order) return reply.code(404).send({ error: 'Standing order not found' });
    if (!order.enabled) return reply.code(409).send({ error: 'Standing order is disabled' });

    const prompt = store.buildPrompt(id);
    if (!prompt) return reply.code(409).send({ error: 'Could not build prompt for standing order' });

    if (!orchestrator) {
      return reply.code(503).send({ error: 'Orchestrator not available' });
    }

    const agentId = order.agentId;
    const agents = orchestrator.listAgents();
    const targetAgent = agentId
      ? orchestrator.getAgent(agentId)
      : agents[0] ?? null;

    if (!targetAgent) {
      return reply.code(409).send({ error: 'No agent available to run standing order' });
    }

    // Fire-and-forget — return accepted immediately
    orchestrator.runAgent(targetAgent.id, { input: prompt }).then(() => {
      store.recordSuccess(id);
    }).catch((err: unknown) => {
      store.recordFailure(id, err instanceof Error ? err.message : String(err));
    });

    return reply.code(202).send({ status: 'accepted', orderId: id, agentId: targetAgent.id });
  });

  // GET /api/standing-orders/:id/prompt — preview the prompt for a standing order
  app.get('/api/standing-orders/:id/prompt', async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = store.getById(id);
    if (!order) return reply.code(404).send({ error: 'Standing order not found' });
    const prompt = store.buildPrompt(id);
    return reply.send({ prompt });
  });
}
