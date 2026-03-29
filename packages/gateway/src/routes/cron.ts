import type { FastifyInstance } from 'fastify';
import type { CronStore, CreateCronJobInput, UpdateCronJobInput, CronSchedule } from '../CronStore.js';
import type { CronScheduler } from '../CronScheduler.js';
import { sendError } from '../errors.js';

// ─── Cron routes ──────────────────────────────────────────────────────────────
//
// GET    /api/cron              — list all cron jobs
// GET    /api/cron/:id          — get a single job
// POST   /api/cron              — create a job
// PATCH  /api/cron/:id          — update a job
// DELETE /api/cron/:id          — delete a job
// POST   /api/cron/:id/run      — manually trigger a job immediately
//

const SCHEDULE_SCHEMA = {
  type: 'object',
  required: ['kind'],
  oneOf: [
    {
      properties: {
        kind: { type: 'string', enum: ['at'] },
        at:   { type: 'string', minLength: 1 },
      },
      required: ['kind', 'at'],
    },
    {
      properties: {
        kind:    { type: 'string', enum: ['every'] },
        everyMs: { type: 'integer', minimum: 60_000 }, // min 1 minute
      },
      required: ['kind', 'everyMs'],
    },
    {
      properties: {
        kind: { type: 'string', enum: ['cron'] },
        expr: { type: 'string', minLength: 9 },
        tz:   { type: 'string' },
      },
      required: ['kind', 'expr'],
    },
  ],
};

export function registerCronRoutes(
  app: FastifyInstance,
  store: CronStore,
  scheduler: CronScheduler,
): void {

  // GET /api/cron — list all jobs
  app.get('/api/cron', async (_req, reply) => {
    return reply.send(store.list());
  });

  // GET /api/cron/:id — get a single job
  app.get<{ Params: { id: string } }>('/api/cron/:id', async (req, reply) => {
    const job = store.getById(req.params.id);
    if (!job) return sendError(reply, 404, 'CRON_JOB_NOT_FOUND', 'Cron job not found');
    return reply.send(job);
  });

  // POST /api/cron — create a job
  app.post('/api/cron', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'schedule', 'message'],
        properties: {
          name:          { type: 'string', minLength: 1, maxLength: 200 },
          description:   { type: 'string', maxLength: 1000 },
          schedule:      SCHEDULE_SCHEMA,
          agentId:       { type: 'string', minLength: 1, maxLength: 200 },
          message:       { type: 'string', minLength: 1, maxLength: 100_000 },
          webhookUrl:    { type: 'string', maxLength: 2048 },
          webhookSecret: { type: 'string', maxLength: 256 },
          enabled:       { type: 'boolean' },
          deleteAfterRun: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as CreateCronJobInput;

    // Validate 'at' schedule timestamp
    if (body.schedule.kind === 'at') {
      const t = new Date((body.schedule as { kind: 'at'; at: string }).at);
      if (isNaN(t.getTime())) {
        return sendError(reply, 400, 'INVALID_SCHEDULE', 'schedule.at must be a valid ISO 8601 timestamp');
      }
      if (t <= new Date()) {
        return sendError(reply, 400, 'SCHEDULE_IN_PAST', 'schedule.at must be in the future');
      }
    }

    // Validate cron expression (basic: 5 fields)
    if (body.schedule.kind === 'cron') {
      const expr = (body.schedule as { kind: 'cron'; expr: string }).expr;
      if (expr.trim().split(/\s+/).length !== 5) {
        return sendError(reply, 400, 'INVALID_CRON_EXPR', 'schedule.expr must be a 5-field cron expression (min hour dom month dow)');
      }
    }

    const job = store.create(body);
    return reply.code(201).send(job);
  });

  // PATCH /api/cron/:id — update a job
  app.patch<{ Params: { id: string } }>('/api/cron/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name:          { type: 'string', minLength: 1, maxLength: 200 },
          description:   { type: 'string', maxLength: 1000 },
          schedule:      SCHEDULE_SCHEMA,
          agentId:       { type: 'string', maxLength: 200 },
          message:       { type: 'string', minLength: 1, maxLength: 100_000 },
          webhookUrl:    { type: 'string', maxLength: 2048 },
          webhookSecret: { type: 'string', maxLength: 256 },
          enabled:       { type: 'boolean' },
          deleteAfterRun: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const body = req.body as UpdateCronJobInput;

    if (body.schedule) {
      const sched = body.schedule as CronSchedule;
      if (sched.kind === 'at') {
        const t = new Date((sched as { kind: 'at'; at: string }).at);
        if (isNaN(t.getTime())) return sendError(reply, 400, 'INVALID_SCHEDULE', 'schedule.at must be a valid ISO 8601 timestamp');
        if (t <= new Date()) return sendError(reply, 400, 'SCHEDULE_IN_PAST', 'schedule.at must be in the future');
      }
      if (sched.kind === 'cron') {
        const expr = (sched as { kind: 'cron'; expr: string }).expr;
        if (expr.trim().split(/\s+/).length !== 5) {
          return sendError(reply, 400, 'INVALID_CRON_EXPR', 'schedule.expr must be a 5-field cron expression');
        }
      }
    }

    try {
      const updated = store.update(req.params.id, body);
      return reply.send(updated);
    } catch (err) {
      return sendError(reply, 404, 'CRON_JOB_NOT_FOUND', err instanceof Error ? err.message : 'Not found');
    }
  });

  // DELETE /api/cron/:id — remove a job
  app.delete<{ Params: { id: string } }>('/api/cron/:id', async (req, reply) => {
    try {
      store.delete(req.params.id);
      return reply.code(204).send();
    } catch (err) {
      return sendError(reply, 404, 'CRON_JOB_NOT_FOUND', err instanceof Error ? err.message : 'Not found');
    }
  });

  // POST /api/cron/:id/run — manually trigger a job immediately
  app.post<{ Params: { id: string } }>('/api/cron/:id/run', async (req, reply) => {
    const job = store.getById(req.params.id);
    if (!job) return sendError(reply, 404, 'CRON_JOB_NOT_FOUND', 'Cron job not found');

    // Fire and forget — manual runs are async
    void scheduler.runJob(req.params.id);
    return reply.send({ ok: true, jobId: req.params.id, message: 'Job queued for immediate execution' });
  });
}
