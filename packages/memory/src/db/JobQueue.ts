import type Database from 'better-sqlite3';
import { randomBytes } from 'crypto';

// ─── Job types ────────────────────────────────────────────────────────────────

export type JobType   = 'agent_run' | 'cron_run' | 'delegation';
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  agentId: string;
  input: string;
  output?: string;
  error?: string;
  priority: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  metadata?: Record<string, unknown>;
}

// SQLite row shape
interface JobRow {
  id: string;
  type: string;
  status: string;
  agent_id: string;
  input: string;
  output: string | null;
  error: string | null;
  priority: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  attempts: number;
  max_attempts: number;
  run_after: number;
  metadata: string | null;
}

function rowToJob(row: JobRow): Job {
  return {
    id:           row.id,
    type:         row.type as JobType,
    status:       row.status as JobStatus,
    agentId:      row.agent_id,
    input:        row.input,
    output:       row.output ?? undefined,
    error:        row.error ?? undefined,
    priority:     row.priority,
    createdAt:    row.created_at,
    startedAt:    row.started_at ?? undefined,
    completedAt:  row.completed_at ?? undefined,
    attempts:     row.attempts,
    maxAttempts:  row.max_attempts,
    runAfter:     row.run_after,
    metadata:     row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : undefined,
  };
}

// ─── JobQueue ─────────────────────────────────────────────────────────────────

export class JobQueue {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Add a job to the queue. Returns the created job. */
  enqueue(job: Omit<Job, 'id' | 'status' | 'createdAt' | 'attempts'>): Job {
    const entry: Job = {
      ...job,
      id:        randomBytes(8).toString('hex'),
      status:    'pending',
      createdAt: Date.now(),
      attempts:  0,
    };
    this.db.prepare(`
      INSERT INTO job_queue
        (id, type, status, agent_id, input, output, error, priority, created_at,
         started_at, completed_at, attempts, max_attempts, run_after, metadata)
      VALUES
        (@id, @type, @status, @agentId, @input, @output, @error, @priority, @createdAt,
         @startedAt, @completedAt, @attempts, @maxAttempts, @runAfter, @metadata)
    `).run({
      id:          entry.id,
      type:        entry.type,
      status:      entry.status,
      agentId:     entry.agentId,
      input:       entry.input,
      output:      entry.output ?? null,
      error:       entry.error ?? null,
      priority:    entry.priority,
      createdAt:   entry.createdAt,
      startedAt:   entry.startedAt ?? null,
      completedAt: entry.completedAt ?? null,
      attempts:    entry.attempts,
      maxAttempts: entry.maxAttempts,
      runAfter:    entry.runAfter,
      metadata:    entry.metadata ? JSON.stringify(entry.metadata) : null,
    });
    return entry;
  }

  /**
   * Claim up to `limit` pending jobs that are ready to run (runAfter <= now).
   * Marks them as 'running' and returns them.
   */
  claim(limit = 10): Job[] {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT * FROM job_queue
      WHERE status = 'pending' AND run_after <= @now
      ORDER BY priority DESC, created_at ASC
      LIMIT @limit
    `).all({ now, limit }) as JobRow[];

    if (rows.length === 0) return [];

    const ids = rows.map(r => `'${r.id}'`).join(',');
    this.db.prepare(`
      UPDATE job_queue
      SET status = 'running', started_at = @now, attempts = attempts + 1
      WHERE id IN (${ids})
    `).run({ now });

    return rows.map(r => ({ ...rowToJob(r), status: 'running' as JobStatus, startedAt: now, attempts: r.attempts + 1 }));
  }

  /** Mark a job as successfully completed. */
  complete(id: string, output: string): void {
    this.db.prepare(`
      UPDATE job_queue
      SET status = 'completed', output = @output, completed_at = @now
      WHERE id = @id
    `).run({ id, output, now: Date.now() });
  }

  /**
   * Mark a job as failed.
   * If attempts < maxAttempts, resets to 'pending' with exponential backoff.
   * Otherwise marks permanently as 'failed'.
   */
  fail(id: string, error: string): void {
    const row = this.db.prepare('SELECT * FROM job_queue WHERE id = @id').get({ id }) as JobRow | undefined;
    if (!row) return;

    const now = Date.now();
    if (row.attempts < row.max_attempts) {
      // Exponential backoff: 30s * 2^(attempts-1), capped at 1 hour
      const backoffMs = Math.min(30_000 * Math.pow(2, row.attempts - 1), 3_600_000);
      this.db.prepare(`
        UPDATE job_queue
        SET status = 'pending', error = @error, run_after = @runAfter
        WHERE id = @id
      `).run({ id, error, runAfter: now + backoffMs });
    } else {
      this.db.prepare(`
        UPDATE job_queue
        SET status = 'failed', error = @error, completed_at = @now
        WHERE id = @id
      `).run({ id, error, now });
    }
  }

  /** Cancel a job by id. */
  cancel(id: string): void {
    this.db.prepare(`
      UPDATE job_queue
      SET status = 'cancelled', completed_at = @now
      WHERE id = @id AND status IN ('pending', 'running')
    `).run({ id, now: Date.now() });
  }

  /** Get a single job by id. */
  get(id: string): Job | null {
    const row = this.db.prepare('SELECT * FROM job_queue WHERE id = @id').get({ id }) as JobRow | undefined;
    return row ? rowToJob(row) : null;
  }

  /** List jobs with optional filters. */
  list(opts: { status?: string; agentId?: string; limit?: number; offset?: number } = {}): Job[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (opts.status) { conditions.push('status = @status'); params['status'] = opts.status; }
    if (opts.agentId) { conditions.push('agent_id = @agentId'); params['agentId'] = opts.agentId; }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit  = opts.limit  ?? 50;
    const offset = opts.offset ?? 0;

    params['limit']  = limit;
    params['offset'] = offset;

    const rows = this.db.prepare(`
      SELECT * FROM job_queue
      ${where}
      ORDER BY created_at DESC
      LIMIT @limit OFFSET @offset
    `).all(params) as JobRow[];

    return rows.map(rowToJob);
  }

  /** Count of currently pending jobs. */
  pending(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as n FROM job_queue WHERE status = 'pending'`).get() as { n: number };
    return row.n;
  }

  /**
   * Reset jobs that were left in 'running' state (crash recovery).
   * Call on gateway startup to reclaim orphaned jobs.
   */
  resetOrphaned(): number {
    const result = this.db.prepare(`
      UPDATE job_queue
      SET status = 'pending', run_after = @now, started_at = NULL
      WHERE status = 'running'
    `).run({ now: Date.now() });
    return result.changes;
  }

  /**
   * Delete completed, failed, and cancelled jobs older than olderThanMs.
   * Returns the number of rows deleted.
   */
  cleanup(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db.prepare(`
      DELETE FROM job_queue
      WHERE status IN ('completed', 'failed', 'cancelled')
        AND completed_at IS NOT NULL
        AND completed_at < @cutoff
    `).run({ cutoff });
    return result.changes;
  }
}
