import type { FastifyInstance } from 'fastify';
import type { AgentOrchestrator, CreateAgentInput, UpdateAgentInput, RunAgentInput } from '@krythor/core';
import { RunQueueFullError } from '@krythor/core';
import type { GuardEngine } from '@krythor/guard';

interface ParallelJob { agentId: string; input: RunAgentInput }
interface ParallelBody { jobs: ParallelJob[] }
interface SequentialBody { agentIds: string[]; input: string }

export function registerAgentRoutes(app: FastifyInstance, orchestrator: AgentOrchestrator, guard?: GuardEngine): void {

  // GET /api/agents
  // Returns agents with a systemPromptPreview (first 100 chars) for list views.
  // The full systemPrompt is still included for detail views (/api/agents/:id).
  app.get('/api/agents', async (_req, reply) => {
    const agents = orchestrator.listAgents();
    const enriched = agents.map(a => ({
      ...a,
      systemPromptPreview: a.systemPrompt.slice(0, 100) + (a.systemPrompt.length > 100 ? '…' : ''),
    }));
    return reply.send(enriched);
  });

  // GET /api/agents/stats
  app.get('/api/agents/stats', async (_req, reply) => {
    return reply.send(orchestrator.stats());
  });

  // GET /api/agents/:id
  app.get<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    const agent = orchestrator.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    return reply.send(agent);
  });

  // POST /api/agents
  app.post('/api/agents', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'systemPrompt'],
        properties: {
          name:         { type: 'string', minLength: 1, maxLength: 200 },
          description:  { type: 'string', maxLength: 1000 },
          systemPrompt: { type: 'string', minLength: 1, maxLength: 100000 },
          modelId:      { type: 'string' },
          providerId:   { type: 'string' },
          memoryScope:  { type: 'string', enum: ['session', 'agent', 'workspace'] },
          maxTurns:     { type: 'number', minimum: 1, maximum: 100 },
          temperature:  { type: 'number', minimum: 0, maximum: 2 },
          maxTokens:    { type: 'number', minimum: 1 },
          tags:         { type: 'array', items: { type: 'string', minLength: 1, maxLength: 50 }, maxItems: 20 },
          allowedTools: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 50 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const agent = orchestrator.createAgent(req.body as CreateAgentInput);
    return reply.code(201).send(agent);
  });

  // PATCH /api/agents/:id
  app.patch<{ Params: { id: string } }>('/api/agents/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name:         { type: 'string', minLength: 1, maxLength: 200 },
          description:  { type: 'string', maxLength: 1000 },
          systemPrompt: { type: 'string', minLength: 1, maxLength: 100000 },
          modelId:      { type: 'string' },
          providerId:   { type: 'string' },
          memoryScope:  { type: 'string', enum: ['session', 'agent', 'workspace'] },
          maxTurns:     { type: 'number', minimum: 1, maximum: 100 },
          temperature:  { type: 'number', minimum: 0, maximum: 2 },
          maxTokens:    { type: 'number', minimum: 1 },
          tags:         { type: 'array', items: { type: 'string', minLength: 1, maxLength: 50 }, maxItems: 20 },
          allowedTools: { oneOf: [
            { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 50 },
            { type: 'null' },
          ] },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    try {
      const agent = orchestrator.updateAgent(req.params.id, req.body as UpdateAgentInput);
      return reply.send(agent);
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : 'Not found' });
    }
  });

  // DELETE /api/agents/:id
  app.delete<{ Params: { id: string } }>('/api/agents/:id', async (req, reply) => {
    try {
      orchestrator.deleteAgent(req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : 'Not found' });
    }
  });

  // GET /api/agents/:id/run — run an agent with ?message= query param (ITEM 5)
  // Separate from the command route; intended for simple scripting/curl usage.
  app.get<{ Params: { id: string }; Querystring: { message?: string } }>('/api/agents/:id/run', {
    config: { rateLimit: { max: 30, timeWindow: 60_000 } },
  }, async (req, reply) => {
    const agent = orchestrator.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    const message = req.query.message;
    if (!message || message.trim().length === 0) {
      return reply.code(400).send({ error: 'message query parameter is required' });
    }

    if (guard) {
      const verdict = guard.check({
        operation: 'agent:run',
        source: 'user',
        sourceId: req.params.id,
        content: message,
      });
      if (!verdict.allowed) {
        return reply.code(403).send({ error: 'Guard denied agent run', reason: verdict.reason, guardVerdict: verdict });
      }
    }

    try {
      const run = await orchestrator.runAgent(req.params.id, { input: message });
      return reply.send({ output: run.output ?? '', modelUsed: run.modelUsed, status: run.status, runId: run.id });
    } catch (err) {
      if (err instanceof RunQueueFullError) {
        reply.header('Retry-After', '30');
        return reply.code(429).send({ error: err.message });
      }
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Run failed' });
    }
  });

  // POST /api/agents/:id/run — run a single agent
  app.post<{ Params: { id: string } }>('/api/agents/:id/run', {
    config: {
      rateLimit: { max: 60, timeWindow: 60_000 },
    },
    schema: {
      body: {
        type: 'object',
        required: ['input'],
        properties: {
          input:           { type: 'string', minLength: 1, maxLength: 10000 },
          taskId:          { type: 'string' },
          contextOverride: { type: 'string', maxLength: 10000 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const agent = orchestrator.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });

    // Guard check before running agent
    if (guard) {
      const body = req.body as { input: string };
      const verdict = guard.check({
        operation: 'agent:run',
        source: 'user',
        sourceId: req.params.id,
        content: body.input,
      });
      if (!verdict.allowed) {
        return reply.code(403).send({
          error: 'Guard denied agent run',
          reason: verdict.reason,
          guardVerdict: verdict,
        });
      }
    }

    try {
      const run = await orchestrator.runAgent(req.params.id, req.body as RunAgentInput);
      return reply.send(run);
    } catch (err) {
      if (err instanceof RunQueueFullError) {
        reply.header('Retry-After', '30');
        return reply.code(429).send({ error: err.message });
      }
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Run failed' });
    }
  });

  // POST /api/agents/run/parallel — run multiple agents concurrently
  app.post('/api/agents/run/parallel', {
    config: {
      rateLimit: { max: 20, timeWindow: 60_000 },
    },
    schema: {
      body: {
        type: 'object',
        required: ['jobs'],
        properties: {
          jobs: {
            type: 'array',
            items: {
              type: 'object',
              required: ['agentId', 'input'],
              properties: {
                agentId: { type: 'string' },
                input:   { type: 'object', required: ['input'], properties: { input: { type: 'string' } } },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    try {
      const { jobs } = req.body as ParallelBody;
      const runs = await orchestrator.runAgentsParallel(jobs);
      return reply.send(runs);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Parallel run failed' });
    }
  });

  // POST /api/agents/run/sequential — run agents in a pipeline
  app.post('/api/agents/run/sequential', {
    config: {
      rateLimit: { max: 20, timeWindow: 60_000 },
    },
    schema: {
      body: {
        type: 'object',
        required: ['agentIds', 'input'],
        properties: {
          agentIds: { type: 'array', items: { type: 'string' } },
          input:    { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    try {
      const { agentIds, input } = req.body as SequentialBody;
      const runs = await orchestrator.runAgentsSequential(agentIds, input);
      return reply.send(runs);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Sequential run failed' });
    }
  });

  // POST /api/agents/runs/:runId/stop
  app.post<{ Params: { runId: string } }>('/api/agents/runs/:runId/stop', async (req, reply) => {
    const stopped = orchestrator.stopRun(req.params.runId);
    return reply.send({ stopped });
  });

  // GET /api/agents/runs — list recent runs
  app.get('/api/agents/runs', async (req, reply) => {
    const { agentId } = req.query as { agentId?: string };
    return reply.send(orchestrator.listRuns(agentId));
  });

  // GET /api/agents/runs/:runId
  app.get<{ Params: { runId: string } }>('/api/agents/runs/:runId', async (req, reply) => {
    const run = orchestrator.getRun(req.params.runId);
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    return reply.send(run);
  });
}
