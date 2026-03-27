import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { atomicWriteJSON } from '@krythor/core';

// ─── CronStore ────────────────────────────────────────────────────────────────
//
// Persists user-defined cron jobs for the Krythor scheduler.
// Each job specifies when to run (schedule) and what to do (an agent message).
//
// Three schedule kinds:
//   at:    one-shot ISO 8601 timestamp (auto-disabled after success)
//   every: fixed interval in milliseconds
//   cron:  5-field cron expression ("0 7 * * *") with optional IANA timezone
//
// Jobs are stored as JSON under <dataDir>/config/cron-jobs.json.
//

/** Schedule: one-shot timestamp */
export interface ScheduleAt {
  kind: 'at';
  /** ISO 8601 UTC timestamp */
  at: string;
}

/** Schedule: fixed interval */
export interface ScheduleEvery {
  kind: 'every';
  /** Interval in milliseconds */
  everyMs: number;
}

/** Schedule: cron expression */
export interface ScheduleCron {
  kind: 'cron';
  /** 5-field cron expression (minute hour dom month dow) */
  expr: string;
  /** IANA timezone (e.g. "America/New_York"). Defaults to UTC. */
  tz?: string;
}

export type CronSchedule = ScheduleAt | ScheduleEvery | ScheduleCron;

export interface CronJob {
  /** Stable unique ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Optional description */
  description?: string;
  /** Job schedule */
  schedule: CronSchedule;
  /** Agent ID to run (uses default agent if omitted) */
  agentId?: string;
  /** Message to send to the agent */
  message: string;
  /** Whether the job is active */
  enabled: boolean;
  /** Delete after first successful run (for 'at' jobs) */
  deleteAfterRun?: boolean;
  /** ISO timestamp of last successful run */
  lastRunAt?: string;
  /** ISO timestamp of last failure */
  lastFailedAt?: string;
  /** Last run error message */
  lastError?: string;
  /** Total successful run count */
  runCount: number;
  /** Unix ms of next scheduled fire (maintained by scheduler) */
  nextRunAt?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCronJobInput {
  name: string;
  description?: string;
  schedule: CronSchedule;
  agentId?: string;
  message: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
}

export interface UpdateCronJobInput {
  name?: string;
  description?: string;
  schedule?: CronSchedule;
  agentId?: string;
  message?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
}

// ─── Cron expression parser (minimal, no deps) ────────────────────────────────

/**
 * Returns the next fire time after `from` for a cron expression.
 * Supports 5-field expressions: min hour dom month dow.
 * All times are treated as UTC (timezone support is informational only
 * in this implementation — use a library like 'croner' for full TZ support).
 */
export function nextCronFire(expr: string, from: Date): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minPart, hourPart, domPart, monPart, dowPart] = parts as [string, string, string, string, string];

  const domIsWild = domPart === '*';
  const dowIsWild = dowPart === '*';

  function parse(s: string, min: number, max: number): number[] {
    if (s === '*') {
      const r: number[] = [];
      for (let i = min; i <= max; i++) r.push(i);
      return r;
    }
    if (s.includes('/')) {
      const [range, step] = s.split('/') as [string, string];
      const stepN = parseInt(step, 10);
      const start = range === '*' ? min : parseInt(range, 10);
      const r: number[] = [];
      for (let i = start; i <= max; i += stepN) r.push(i);
      return r;
    }
    if (s.includes(',')) {
      return s.split(',').map(n => parseInt(n, 10));
    }
    if (s.includes('-')) {
      const [lo, hi] = s.split('-').map(n => parseInt(n, 10)) as [number, number];
      const r: number[] = [];
      for (let i = lo; i <= hi; i++) r.push(i);
      return r;
    }
    return [parseInt(s, 10)];
  }

  const mins  = parse(minPart,  0, 59);
  const hours = parse(hourPart, 0, 23);
  const doms  = parse(domPart,  1, 31);
  const mons  = parse(monPart,  1, 12);
  const dows  = parse(dowPart,  0,  6);

  // Advance by one minute to ensure we don't return `from` itself
  const d = new Date(from.getTime() + 60_000);
  d.setUTCSeconds(0, 0);

  // Search up to 4 years ahead
  const limit = new Date(from.getTime() + 4 * 365 * 24 * 60 * 60 * 1000);

  while (d < limit) {
    const m  = d.getUTCMonth() + 1; // 1-12
    const dd = d.getUTCDate();
    const dw = d.getUTCDay();  // 0=Sun
    const h  = d.getUTCHours();
    const mi = d.getUTCMinutes();

    if (!mons.includes(m)) {
      d.setUTCMonth(d.getUTCMonth() + 1, 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    // Standard cron day matching:
    // - If both dom and dow are wildcards: any day matches
    // - If only dom is restricted: must match dom
    // - If only dow is restricted: must match dow
    // - If both are restricted: either matching suffices (OR semantics)
    const domMatch = doms.includes(dd);
    const dowMatch = dows.includes(dw);
    const dayMatch = domIsWild && dowIsWild ? true
                   : domIsWild              ? dowMatch
                   : dowIsWild              ? domMatch
                   : domMatch || dowMatch;   // both specified → OR
    if (!dayMatch) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!hours.includes(h)) {
      d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!mins.includes(mi)) {
      d.setUTCMinutes(d.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(d);
  }

  return null;
}

/** Compute the next fire time for a job relative to `now`. */
export function computeNextRun(schedule: CronSchedule, now: Date, lastRunAt?: Date): Date | null {
  if (schedule.kind === 'at') {
    const t = new Date(schedule.at);
    return t > now ? t : null; // past → no next run
  }
  if (schedule.kind === 'every') {
    const base = lastRunAt ?? now;
    return new Date(base.getTime() + schedule.everyMs);
  }
  if (schedule.kind === 'cron') {
    return nextCronFire(schedule.expr, now);
  }
  return null;
}

// ─── CronStore ────────────────────────────────────────────────────────────────

export class CronStore {
  private readonly configPath: string;
  private jobs: Map<string, CronJob> = new Map();

  constructor(configDir: string) {
    this.configPath = join(configDir, 'cron-jobs.json');
    this.load();
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  create(input: CreateCronJobInput): CronJob {
    const now = new Date();
    const job: CronJob = {
      id:            randomUUID(),
      name:          input.name,
      description:   input.description,
      schedule:      input.schedule,
      agentId:       input.agentId,
      message:       input.message,
      enabled:       input.enabled !== false,
      deleteAfterRun: input.deleteAfterRun,
      runCount:      0,
      nextRunAt:     computeNextRun(input.schedule, now)?.getTime(),
      createdAt:     now.toISOString(),
      updatedAt:     now.toISOString(),
    };
    this.jobs.set(job.id, job);
    this.save();
    return job;
  }

  update(id: string, input: UpdateCronJobInput): CronJob {
    const existing = this.jobs.get(id);
    if (!existing) throw new Error(`Cron job "${id}" not found`);
    const now = new Date();
    const updated: CronJob = {
      ...existing,
      ...(input.name !== undefined      && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.agentId !== undefined   && { agentId: input.agentId || undefined }),
      ...(input.message !== undefined   && { message: input.message }),
      ...(input.enabled !== undefined   && { enabled: input.enabled }),
      ...(input.deleteAfterRun !== undefined && { deleteAfterRun: input.deleteAfterRun }),
      updatedAt: now.toISOString(),
    };
    if (input.schedule !== undefined) {
      updated.schedule = input.schedule;
      updated.nextRunAt = computeNextRun(input.schedule, now, updated.lastRunAt ? new Date(updated.lastRunAt) : undefined)?.getTime();
    }
    this.jobs.set(id, updated);
    this.save();
    return updated;
  }

  delete(id: string): void {
    if (!this.jobs.has(id)) throw new Error(`Cron job "${id}" not found`);
    this.jobs.delete(id);
    this.save();
  }

  getById(id: string): CronJob | null {
    return this.jobs.get(id) ?? null;
  }

  list(): CronJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
  }

  /** Returns enabled jobs whose nextRunAt is at or before `now`. */
  getDueJobs(now: Date): CronJob[] {
    const ts = now.getTime();
    return Array.from(this.jobs.values()).filter(
      j => j.enabled && j.nextRunAt !== undefined && j.nextRunAt <= ts,
    );
  }

  /** Called after a successful run. Updates runCount, lastRunAt, nextRunAt. */
  recordSuccess(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const now = new Date();

    // Auto-delete one-shot jobs after success
    if (job.schedule.kind === 'at' && job.deleteAfterRun !== false) {
      this.jobs.delete(id);
      this.save();
      return;
    }

    // Disable 'at' jobs that should not be deleted (keeps them visible)
    if (job.schedule.kind === 'at') {
      this.jobs.set(id, { ...job, enabled: false, runCount: job.runCount + 1, lastRunAt: now.toISOString(), nextRunAt: undefined });
      this.save();
      return;
    }

    const nextRun = computeNextRun(job.schedule, now, now);
    this.jobs.set(id, {
      ...job,
      runCount: job.runCount + 1,
      lastRunAt: now.toISOString(),
      lastError: undefined,
      nextRunAt: nextRun?.getTime(),
    });
    this.save();
  }

  /** Called after a failed run. Logs the error and advances nextRunAt. */
  recordFailure(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const now = new Date();
    const nextRun = computeNextRun(job.schedule, now, now);
    this.jobs.set(id, {
      ...job,
      lastFailedAt: now.toISOString(),
      lastError: error.slice(0, 500),
      nextRunAt: nextRun?.getTime(),
    });
    this.save();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.configPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf-8')) as unknown;
      if (Array.isArray(raw)) {
        for (const j of raw as CronJob[]) {
          this.jobs.set(j.id, j);
        }
      }
    } catch (err) {
      console.error(`[CronStore] Failed to load ${this.configPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private save(): void {
    atomicWriteJSON(this.configPath, Array.from(this.jobs.values()));
  }
}
