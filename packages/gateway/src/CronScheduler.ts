import { createHmac } from 'crypto';
import type { AgentOrchestrator } from '@krythor/core';
import { RunQueueFullError } from '@krythor/core';
import type { CronStore } from './CronStore.js';
import { logger } from './logger.js';

// ─── CronScheduler ────────────────────────────────────────────────────────────
//
// Polls the CronStore every TICK_MS and fires due jobs.
//
// Design:
//   - At most one tick in flight at a time (concurrent run guard)
//   - Each job run is isolated: a failure does not block other jobs
//   - Uses orchestrator.runAgent() — same code path as the REST API
//   - Disabled in test environments (KRYTHOR_TEST=1)
//

const TICK_MS           = 30_000;   // check every 30 s
const STARTUP_DELAY_MS  = 15_000;   // don't fire immediately on boot

export class CronScheduler {
  private readonly store: CronStore;
  private readonly orchestrator: AgentOrchestrator;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(store: CronStore, orchestrator: AgentOrchestrator) {
    this.store = store;
    this.orchestrator = orchestrator;
  }

  /** Start the scheduler. Safe to call multiple times (no-op if already running). */
  start(): void {
    if (this.timer) return;

    // Delay the first tick so the gateway finishes booting
    const delayed = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
    }, STARTUP_DELAY_MS);

    // Store the timeout ref so stop() can cancel it if called before first tick
    (this as unknown as { _startupTimer: ReturnType<typeof setTimeout> })._startupTimer = delayed;
  }

  /** Stop the scheduler. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const t = (this as unknown as { _startupTimer?: ReturnType<typeof setTimeout> })._startupTimer;
    if (t) clearTimeout(t);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = this.store.getDueJobs(new Date());
      if (due.length === 0) return;

      logger.info(`[CronScheduler] ${due.length} job(s) due`, { jobNames: due.map(j => j.name) });

      await Promise.allSettled(due.map(job => this.runJob(job.id)));
    } catch (err) {
      logger.error('[CronScheduler] tick error', { error: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  /** Exposed for manual/forced runs (e.g. from the REST API). */
  async runJob(jobId: string): Promise<void> {
    const job = this.store.getById(jobId);
    if (!job) {
      logger.warn('[CronScheduler] Job not found', { jobId });
      return;
    }

    // Resolve agent
    let agentId = job.agentId;
    if (!agentId) {
      const agents = this.orchestrator.listAgents();
      if (agents.length === 0) {
        this.store.recordFailure(jobId, 'No agents configured');
        return;
      }
      agentId = agents[0]!.id;
    } else {
      const agent = this.orchestrator.getAgent(agentId);
      if (!agent) {
        logger.warn('[CronScheduler] Configured agent not found, using default', { jobId, agentId });
        const agents = this.orchestrator.listAgents();
        if (agents.length === 0) {
          this.store.recordFailure(jobId, `Agent "${agentId}" not found and no fallback available`);
          return;
        }
        agentId = agents[0]!.id;
      }
    }

    // ── Webhook delivery mode ──────────────────────────────────────────────────
    if (job.webhookUrl) {
      logger.info('[CronScheduler] Delivering job via webhook', { jobId, jobName: job.name, url: job.webhookUrl });
      try {
        await this.deliverWebhook(job.webhookUrl, job.webhookSecret, {
          jobId,
          jobName: job.name,
          message: job.message,
          firedAt: new Date().toISOString(),
        });
        this.store.recordSuccess(jobId);
        logger.info('[CronScheduler] Webhook delivery succeeded', { jobId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('[CronScheduler] Webhook delivery failed', { jobId, error: msg });
        this.store.recordFailure(jobId, msg);
      }
      return;
    }

    // ── Agent run mode ─────────────────────────────────────────────────────────
    logger.info('[CronScheduler] Running job', { jobId, jobName: job.name, agentId });

    try {
      await this.orchestrator.runAgent(agentId, { input: job.message });
      this.store.recordSuccess(jobId);
      logger.info('[CronScheduler] Job completed', { jobId, jobName: job.name });
    } catch (err) {
      const msg = err instanceof RunQueueFullError
        ? 'Run queue full — will retry next tick'
        : err instanceof Error ? err.message : String(err);
      logger.warn('[CronScheduler] Job failed', { jobId, jobName: job.name, error: msg });
      this.store.recordFailure(jobId, msg);
    }
  }

  private async deliverWebhook(
    url: string,
    secret: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent':   'Krythor-CronScheduler/1.0',
    };

    if (secret) {
      const sig = createHmac('sha256', secret).update(body).digest('hex');
      headers['X-Krythor-Signature'] = `sha256=${sig}`;
    }

    const res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) {
      throw new Error(`Webhook returned HTTP ${res.status}`);
    }
  }
}
