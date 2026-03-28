/**
 * Job queue routes.
 *
 *   GET /api/jobs         — list jobs (optional ?status= ?agentId= ?limit= ?offset=)
 *   GET /api/jobs/:id     — get a single job
 *   DELETE /api/jobs/:id  — cancel a job
 */

import type { FastifyInstance } from 'fastify';
import type { JobQueue } from '@krythor/memory';

export function registerJobRoutes(app: FastifyInstance, jobQueue: JobQueue): void {

  // GET /api/jobs
  app.get('/api/jobs', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const jobs = jobQueue.list({
      status:  q['status'],
      agentId: q['agentId'],
      limit:   q['limit']  ? parseInt(q['limit'], 10)  : 50,
      offset:  q['offset'] ? parseInt(q['offset'], 10) : 0,
    });
    return reply.send({ jobs, pending: jobQueue.pending() });
  });

  // GET /api/jobs/:id
  app.get('/api/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = jobQueue.get(id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    return reply.send(job);
  });

  // DELETE /api/jobs/:id — cancel
  app.delete('/api/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    jobQueue.cancel(id);
    return reply.code(204).send();
  });
}
