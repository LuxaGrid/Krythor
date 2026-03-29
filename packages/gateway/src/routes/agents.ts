import type { FastifyInstance } from 'fastify';
import type { AgentOrchestrator, CreateAgentInput, UpdateAgentInput, RunAgentInput, AgentEvent } from '@krythor/core';
import { RunQueueFullError, RunRateLimitError } from '@krythor/core';
import type { AgentMessageBus } from '@krythor/core';
import type { GuardEngine } from '@krythor/guard';
import { validateString, MAX_NAME_LEN, MAX_DESCRIPTION_LEN, MAX_SYSTEM_PROMPT_LEN } from '../validate.js';
import type { AccessProfileStore } from '../AccessProfileStore.js';
import type { ApprovalManager } from '../ApprovalManager.js';
import { guardCheck } from '../guardCheck.js';
import type { MetricsCollector } from '../MetricsCollector.js';
import type { TokenBudgetStore } from '../TokenBudgetStore.js';

interface ParallelJob { agentId: string; input: RunAgentInput }
interface ParallelBody { jobs: ParallelJob[] }
interface SequentialBody { agentIds: string[]; input: string }

export function registerAgentRoutes(
  app: FastifyInstance,
  orchestrator: AgentOrchestrator,
  guard?: GuardEngine,
  accessProfileStore?: AccessProfileStore,
  approvalManager?: ApprovalManager,
  messageBus?: AgentMessageBus,
  metricsCollector?: MetricsCollector,
  tokenBudgetStore?: TokenBudgetStore,
): void {

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
          tags:                { type: 'array', items: { type: 'string', minLength: 1, maxLength: 50 }, maxItems: 20 },
          allowedTools:        { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 50 },
          deniedTools:         { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 50 },
          allowedAgentTargets: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 50 },
          idleTimeoutMs:       { type: 'number', minimum: 5000 },
          workspaceDir:        { type: 'string', maxLength: 500 },
          skipBootstrap:       { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as CreateAgentInput;
    // Length validation (Fastify minLength/maxLength catches schema violations but
    // we add explicit checks here so error messages are user-friendly)
    const nameCheck = validateString(body.name, 'name', MAX_NAME_LEN, true);
    if (nameCheck.error) return reply.code(400).send({ error: nameCheck.error });
    const descCheck = validateString(body.description, 'description', MAX_DESCRIPTION_LEN, false);
    if (descCheck.error) return reply.code(400).send({ error: descCheck.error });
    const spCheck = validateString(body.systemPrompt, 'systemPrompt', MAX_SYSTEM_PROMPT_LEN, true);
    if (spCheck.error) return reply.code(400).send({ error: spCheck.error });
    const agent = orchestrator.createAgent({
      ...body,
      name:         nameCheck.value || body.name,
      description:  descCheck.value  || body.description,
      systemPrompt: spCheck.value    || body.systemPrompt,
    });
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
          deniedTools: { oneOf: [
            { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 50 },
            { type: 'null' },
          ] },
          allowedAgentTargets: { oneOf: [
            { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 50 },
            { type: 'null' },
          ] },
          idleTimeoutMs: { oneOf: [{ type: 'number', minimum: 5000 }, { type: 'null' }] },
          workspaceDir:  { oneOf: [{ type: 'string', maxLength: 500 }, { type: 'null' }] },
          skipBootstrap: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as UpdateAgentInput;
    if (body.name !== undefined) {
      const nameCheck = validateString(body.name, 'name', MAX_NAME_LEN, false);
      if (nameCheck.error) return reply.code(400).send({ error: nameCheck.error });
    }
    if (body.description !== undefined) {
      const descCheck = validateString(body.description, 'description', MAX_DESCRIPTION_LEN, false);
      if (descCheck.error) return reply.code(400).send({ error: descCheck.error });
    }
    if (body.systemPrompt !== undefined) {
      const spCheck = validateString(body.systemPrompt, 'systemPrompt', MAX_SYSTEM_PROMPT_LEN, false);
      if (spCheck.error) return reply.code(400).send({ error: spCheck.error });
    }
    try {
      const agent = orchestrator.updateAgent(req.params.id, body);
      return reply.send(agent);
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : 'Not found' });
    }
  });

  // GET /api/agents/:id/export — returns agent config as JSON (auth required)
  // Excludes internal fields (id, createdAt, updatedAt); receiver assigns a new ID on import.
  app.get<{ Params: { id: string } }>('/api/agents/:id/export', async (req, reply) => {
    const agent = orchestrator.getAgent(req.params.id);
    if (!agent) return reply.code(404).send({ error: 'Agent not found' });
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...config } = agent;
    return reply
      .header('Content-Disposition', `attachment; filename="agent-${agent.name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.json"`)
      .send({ krythorAgentExport: '1', ...config });
  });

  // POST /api/agents/import — accepts exported agent config, assigns new ID (auth required)
  app.post('/api/agents/import', {
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
    schema: {
      body: {
        type: 'object',
        required: ['name', 'systemPrompt'],
        properties: {
          krythorAgentExport: { type: 'string' },
          name:         { type: 'string', minLength: 1, maxLength: 200 },
          description:  { type: 'string', maxLength: 1000 },
          systemPrompt: { type: 'string', minLength: 1, maxLength: 100000 },
          modelId:      { type: 'string' },
          providerId:   { type: 'string' },
          memoryScope:  { type: 'string', enum: ['session', 'agent', 'workspace'] },
          maxTurns:     { type: 'number', minimum: 1, maximum: 100 },
          temperature:  { type: 'number', minimum: 0, maximum: 2 },
          maxTokens:    { type: 'number', minimum: 1 },
          tags:                { type: 'array', items: { type: 'string', minLength: 1, maxLength: 50 }, maxItems: 20 },
          allowedTools:        { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 50 },
          deniedTools:         { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 50 },
          allowedAgentTargets: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 100 }, maxItems: 50 },
          workspaceDir:        { type: 'string', maxLength: 500 },
          skipBootstrap:       { type: 'boolean' },
          systemPromptPreview: { type: 'string' }, // ignored; produced by list endpoint
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as CreateAgentInput & { krythorAgentExport?: string; systemPromptPreview?: string };
    const nameCheck = validateString(body.name, 'name', MAX_NAME_LEN, true);
    if (nameCheck.error) return reply.code(400).send({ error: nameCheck.error });
    const descCheck = validateString(body.description, 'description', MAX_DESCRIPTION_LEN, false);
    if (descCheck.error) return reply.code(400).send({ error: descCheck.error });
    const spCheck = validateString(body.systemPrompt, 'systemPrompt', MAX_SYSTEM_PROMPT_LEN, true);
    if (spCheck.error) return reply.code(400).send({ error: spCheck.error });
    const agent = orchestrator.createAgent({
      name:                nameCheck.value || body.name,
      description:         descCheck.value  || body.description,
      systemPrompt:        spCheck.value    || body.systemPrompt,
      memoryScope:         body.memoryScope,
      maxTurns:            body.maxTurns,
      temperature:         body.temperature,
      maxTokens:           body.maxTokens,
      modelId:             body.modelId,
      providerId:          body.providerId,
      tags:                body.tags,
      allowedTools:        body.allowedTools,
      deniedTools:         body.deniedTools,
      allowedAgentTargets: body.allowedAgentTargets,
      workspaceDir:        body.workspaceDir,
      skipBootstrap:       body.skipBootstrap,
    });
    return reply.code(201).send(agent);
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
      const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'agent:run', source: 'user', sourceId: req.params.id, target: message });
      if (!allowed) return;
    }

    try {
      const run = await orchestrator.runAgent(req.params.id, { input: message });
      return reply.send({ output: run.output ?? '', modelUsed: run.modelUsed, status: run.status, runId: run.id });
    } catch (err) {
      if (err instanceof RunRateLimitError) {
        reply.header('Retry-After', '60');
        return reply.code(429).send({ error: err.message });
      }
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
      const allowed = await guardCheck({ guard, approvalManager, reply, operation: 'agent:run', source: 'user', sourceId: req.params.id, target: body.input });
      if (!allowed) return;
    }

    // Token budget check
    if (tokenBudgetStore) {
      const budgetResult = tokenBudgetStore.check(agent.id);
      if (!budgetResult.allowed) {
        return reply.code(429).send({ error: budgetResult.reason ?? 'Token budget exceeded', budgetResult });
      }
    }

    const runStart = Date.now();
    try {
      const run = await orchestrator.runAgent(req.params.id, req.body as RunAgentInput);
      const tokensUsed = (run as unknown as Record<string, unknown>)['tokensUsed'] as number | undefined ?? 0;
      metricsCollector?.recordAgentRun(agent.id, agent.name, Date.now() - runStart, true, tokensUsed);
      if (tokensUsed > 0) tokenBudgetStore?.record(agent.id, tokensUsed);
      return reply.send(run);
    } catch (err) {
      metricsCollector?.recordAgentRun(agent.id, agent.name, Date.now() - runStart, false);
      if (err instanceof RunRateLimitError) {
        reply.header('Retry-After', '60');
        return reply.code(429).send({ error: err.message });
      }
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

  // GET /api/agents/runs/:runId/stream — SSE stream for a specific run
  // Emits agent:event messages until the run completes or fails.
  app.get<{ Params: { runId: string } }>('/api/agents/runs/:runId/stream', async (req, reply) => {
    const { runId } = req.params;

    // Check if run exists (may already be completed)
    const existingRun = orchestrator.getRun(runId);
    if (!existingRun) return reply.code(404).send({ error: 'Run not found' });

    // If run is already complete, return a single done event
    if (existingRun.status === 'completed' || existingRun.status === 'failed' || existingRun.status === 'stopped') {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      reply.raw.write(`data: ${JSON.stringify({ type: existingRun.status, runId, payload: existingRun })}\n\n`);
      reply.raw.end();
      return reply;
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const onEvent = (event: AgentEvent): void => {
      if (event.runId !== runId) return;
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'run:completed' || event.type === 'run:failed' || event.type === 'run:stopped') {
        orchestrator.off('agent:event', onEvent);
        reply.raw.end();
      }
    };

    orchestrator.on('agent:event', onEvent);

    req.socket.on('close', () => {
      orchestrator.off('agent:event', onEvent);
    });

    return reply;
  });

  // ── Access profile routes (require accessProfileStore) ─────────────────────

  if (accessProfileStore) {
    // GET /api/agents/:id/access-profile
    app.get<{ Params: { id: string } }>('/api/agents/:id/access-profile', async (req, reply) => {
      const agentId = req.params.id;
      const agent = orchestrator.getAgent(agentId);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      const profile = accessProfileStore.getProfile(agentId);
      return reply.send({ agentId, profile });
    });

    // PUT /api/agents/:id/access-profile
    app.put<{ Params: { id: string } }>('/api/agents/:id/access-profile', {
      schema: {
        body: {
          type: 'object',
          required: ['profile'],
          properties: {
            profile: { type: 'string', enum: ['safe', 'standard', 'full_access'] },
          },
          additionalProperties: false,
        },
      },
    }, async (req, reply) => {
      const agentId = req.params.id;
      const agent = orchestrator.getAgent(agentId);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      const { profile } = req.body as { profile: import('../AccessProfileStore.js').AccessProfile };
      accessProfileStore.setProfile(agentId, profile);
      return reply.send({ agentId, profile });
    });
  }

  // ── Agent message bus routes ──────────────────────────────────────────────
  // Only registered when messageBus is available.

  if (messageBus) {
    // POST /api/agents/:id/message — send a message to an agent
    app.post<{ Params: { id: string } }>('/api/agents/:id/message', {
      config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      schema: {
        body: {
          type: 'object',
          required: ['content'],
          properties: {
            content:     { type: 'string', minLength: 1, maxLength: 10000 },
            fromAgentId: { type: 'string' },
          },
          additionalProperties: false,
        },
      },
    }, async (req, reply) => {
      const toAgentId = req.params.id;
      const { content, fromAgentId = 'user' } = req.body as { content: string; fromAgentId?: string };

      const agent = orchestrator.getAgent(toAgentId);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });

      const msg = messageBus.send({ fromAgentId, toAgentId, content });
      return reply.code(201).send(msg);
    });

    // GET /api/agents/:id/messages — retrieve messages for an agent
    app.get<{
      Params: { id: string };
      Querystring: { since?: string };
    }>('/api/agents/:id/messages', async (req, reply) => {
      const agentId = req.params.id;
      const since = req.query.since ? parseInt(req.query.since, 10) : undefined;

      const agent = orchestrator.getAgent(agentId);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });

      const messages = messageBus.getMessages(agentId, since);
      return reply.send({ messages });
    });

    // POST /api/agents/delegate — delegate a task from one agent to another
    app.post('/api/agents/delegate', {
      config: { rateLimit: { max: 20, timeWindow: 60_000 } },
      schema: {
        body: {
          type: 'object',
          required: ['fromAgentId', 'toAgentId', 'input'],
          properties: {
            fromAgentId: { type: 'string' },
            toAgentId:   { type: 'string' },
            input:       { type: 'string', minLength: 1, maxLength: 10000 },
          },
          additionalProperties: false,
        },
      },
    }, async (req, reply) => {
      const { fromAgentId, toAgentId, input } = req.body as { fromAgentId: string; toAgentId: string; input: string };

      const toAgent = orchestrator.getAgent(toAgentId);
      if (!toAgent) return reply.code(404).send({ error: `Target agent "${toAgentId}" not found` });

      try {
        const output = await messageBus.delegate(fromAgentId, toAgentId, input, orchestrator);
        return reply.send({ output, fromAgentId, toAgentId });
      } catch (err) {
        if (err instanceof RunRateLimitError) {
          reply.header('Retry-After', '60');
          return reply.code(429).send({ error: err.message });
        }
        if (err instanceof RunQueueFullError) {
          reply.header('Retry-After', '30');
          return reply.code(429).send({ error: err.message });
        }
        return reply.code(500).send({ error: err instanceof Error ? err.message : 'Delegation failed' });
      }
    });
  }

  // ── Token budget routes ────────────────────────────────────────────────────

  if (tokenBudgetStore) {
    // GET /api/agents/:id/budget
    app.get<{ Params: { id: string } }>('/api/agents/:id/budget', async (req, reply) => {
      const agent = orchestrator.getAgent(req.params.id);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      const usage = tokenBudgetStore.usage(agent.id);
      return reply.send(usage);
    });

    // PUT /api/agents/:id/budget
    app.put<{ Params: { id: string } }>('/api/agents/:id/budget', {
      schema: {
        body: {
          type: 'object',
          properties: {
            dailyLimit:   { type: ['number', 'null'], minimum: 1 },
            sessionLimit: { type: ['number', 'null'], minimum: 1 },
          },
          additionalProperties: false,
        },
      },
    }, async (req, reply) => {
      const agent = orchestrator.getAgent(req.params.id);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      const { dailyLimit, sessionLimit } = req.body as { dailyLimit?: number | null; sessionLimit?: number | null };
      const budget = tokenBudgetStore.upsert(agent.id, { dailyLimit, sessionLimit });
      return reply.send(budget);
    });

    // DELETE /api/agents/:id/budget
    app.delete<{ Params: { id: string } }>('/api/agents/:id/budget', async (req, reply) => {
      const agent = orchestrator.getAgent(req.params.id);
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      tokenBudgetStore.remove(agent.id);
      return reply.send({ ok: true });
    });
  }
}
