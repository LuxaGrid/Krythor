import type { FastifyInstance } from 'fastify';
import type { SkillRegistry, SkillRunner, CreateSkillInput, UpdateSkillInput } from '@krythor/skills';
import type { GuardEngine } from '@krythor/guard';
import { sendError } from '../errors.js';
import { logger } from '../logger.js';

export function registerSkillRoutes(app: FastifyInstance, skills: SkillRegistry, guard: GuardEngine, runner: SkillRunner): void {

  // GET /api/skills — list skills, optionally filtered by tags
  app.get('/api/skills', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const tags = q.tags ? q.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined;
    return reply.send(skills.list(tags));
  });

  // GET /api/skills/:id
  app.get<{ Params: { id: string } }>('/api/skills/:id', async (req, reply) => {
    const skill = skills.getById(req.params.id);
    if (!skill) return sendError(reply, 404, 'SKILL_NOT_FOUND', 'Skill not found');
    return reply.send(skill);
  });

  // POST /api/skills — create a skill
  app.post('/api/skills', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'systemPrompt'],
        properties: {
          name:         { type: 'string', minLength: 1, maxLength: 200 },
          description:  { type: 'string', maxLength: 1000 },
          systemPrompt: { type: 'string', minLength: 1, maxLength: 100000 },
          tags:         { type: 'array', items: { type: 'string', minLength: 1, maxLength: 50 }, maxItems: 20 },
          permissions:  { type: 'array', items: { type: 'string', enum: ['memory:read','memory:write','skill:invoke','internet:read'] }, maxItems: 10 },
          modelId:      { type: 'string' },
          providerId:   { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const verdict = guard.check({ operation: 'skill:create', source: 'user' });
    if (!verdict.allowed) {
      return sendError(reply, 403, 'GUARD_DENIED', verdict.reason, 'Check your guard policy rules');
    }
    const skill = skills.create(req.body as CreateSkillInput);
    return reply.code(201).send(skill);
  });

  // PATCH /api/skills/:id — update a skill
  app.patch<{ Params: { id: string } }>('/api/skills/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name:         { type: 'string', minLength: 1, maxLength: 200 },
          description:  { type: 'string', maxLength: 1000 },
          systemPrompt: { type: 'string', minLength: 1, maxLength: 100000 },
          tags:         { type: 'array', items: { type: 'string', minLength: 1, maxLength: 50 }, maxItems: 20 },
          permissions:  { type: 'array', items: { type: 'string', enum: ['memory:read','memory:write','skill:invoke','internet:read'] }, maxItems: 10 },
          modelId:      { type: 'string' },
          providerId:   { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    try {
      const skill = skills.update(req.params.id, req.body as UpdateSkillInput);
      return reply.send(skill);
    } catch (err) {
      return sendError(reply, 404, 'SKILL_NOT_FOUND', err instanceof Error ? err.message : 'Not found');
    }
  });

  // POST /api/skills/:id/run — execute a skill against the configured model
  app.post<{ Params: { id: string } }>('/api/skills/:id/run', {
    config: {
      rateLimit: { max: 60, timeWindow: 60_000 },
    },
    schema: {
      body: {
        type: 'object',
        required: ['input'],
        properties: {
          input: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const skill = skills.getById(req.params.id);
    if (!skill) return sendError(reply, 404, 'SKILL_NOT_FOUND', 'Skill not found');

    const verdict = guard.check({ operation: 'skill:execute', source: 'user', sourceId: req.params.id });
    if (!verdict.allowed) {
      return sendError(reply, 403, 'GUARD_DENIED', verdict.reason, 'Check your guard policy rules');
    }

    try {
      const { input } = req.body as { input: string };
      const abortSignal = req.raw.destroyed ? AbortSignal.abort() : undefined;
      const result = await runner.run({ skillId: req.params.id, input, abortSignal });
      skills.recordRun(req.params.id);
      logger.skillRunCompleted(result.skillId, result.skillName, result.durationMs, result.modelId);
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Skill run failed';
      logger.skillRunFailed(req.params.id, skill.name, message);
      return sendError(reply, 502, 'SKILL_RUN_FAILED', message, 'Check that a model provider is configured');
    }
  });

  // DELETE /api/skills/:id
  app.delete<{ Params: { id: string } }>('/api/skills/:id', async (req, reply) => {
    const verdict = guard.check({ operation: 'skill:delete', source: 'user' });
    if (!verdict.allowed) {
      return sendError(reply, 403, 'GUARD_DENIED', verdict.reason, 'Check your guard policy rules');
    }
    try {
      skills.delete(req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return sendError(reply, 404, 'SKILL_NOT_FOUND', err instanceof Error ? err.message : 'Not found');
    }
  });
}
