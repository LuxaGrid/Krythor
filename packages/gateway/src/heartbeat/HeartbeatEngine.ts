import { readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import type { MemoryEngine } from '@krythor/memory';
import type { ModelEngine, ModelRecommender } from '@krythor/models';
import type { AgentOrchestrator } from '@krythor/core';
import type { DiskLogger } from '../logger.js';

// ─── HeartbeatEngine ──────────────────────────────────────────────────────────
//
// Krythor's bounded internal maintenance loop.
//
// Design constraints (from HEARTBEAT.md):
//   - Never performs dangerous or destructive actions silently
//   - Each run is time-bounded (HEARTBEAT_TIMEOUT_MS)
//   - All runs are logged with duration and outcomes
//   - Disableable via config
//   - Each check type has its own interval and can be disabled independently
//   - No more than one heartbeat run in flight at a time (concurrency lock)
//   - Does not run while system is starting up (MIN_STARTUP_DELAY_MS)
//
// Adding a new check:
//   1. Add an entry to DEFAULT_CHECKS
//   2. Implement a private method `check_<id>(ctx: CheckContext): Promise<HeartbeatInsight[]>`
//   3. Add dispatch case in runChecks()
//

const HEARTBEAT_TIMEOUT_MS  = 60_000;      // hard ceiling per full run
const MIN_STARTUP_DELAY_MS  = 30_000;     // don't run during first 30s of boot
const CONCURRENCY_GUARD_MS  = 5_000;      // min gap between consecutive runs
const POLL_INTERVAL_BASE_MS = 50_000;     // jitter base: 50s
const POLL_INTERVAL_JITTER_MS = 20_000;   // + up to 20s → 50–70s window
const STALE_RUN_THRESHOLD_MS = 10 * 60 * 1000; // runs stuck > 10 min

export interface CheckConfig {
  enabled:    boolean;
  intervalMs: number;
}

export interface HeartbeatConfig {
  enabled:    boolean;
  timeoutMs:  number;
  checks:     Record<string, CheckConfig>;
}

export interface HeartbeatInsight {
  type:            'heartbeat_insight';
  checkId:         string;
  severity:        'info' | 'warning';
  message:         string;
  actionable:      boolean;
  suggestedAction?: string;
  timestamp:       string;
}

/** A single provider health check result stored in the rolling history. */
export interface ProviderHealthEntry {
  timestamp: string;   // ISO string
  ok: boolean;
  latencyMs: number;
}

export interface HeartbeatRunRecord {
  startedAt:    number;
  completedAt?: number;
  durationMs?:  number;
  checksRan:    string[];
  insights:     HeartbeatInsight[];
  timedOut:     boolean;
  error?:       string;
}

// Internal alias kept for compat within this file
type RunRecord = HeartbeatRunRecord;

interface CheckContext {
  memory:       MemoryEngine | null;
  models:       ModelEngine | null;
  orchestrator: AgentOrchestrator | null;
  recommender?: ModelRecommender | null;
}

const DEFAULT_CHECKS: Record<string, CheckConfig> = {
  task_review:        { enabled: true, intervalMs: 30 * 60 * 1000 },      // 30 min
  stale_state:        { enabled: true, intervalMs: 60 * 60 * 1000 },      // 1 h
  failed_skills:      { enabled: true, intervalMs: 60 * 60 * 1000 },      // 1 h
  memory_hygiene:     { enabled: true, intervalMs: 6 * 60 * 60 * 1000 },  // 6 h
  learning_summary:   { enabled: true, intervalMs: 24 * 60 * 60 * 1000 }, // 24 h
  model_signal:       { enabled: true, intervalMs: 24 * 60 * 60 * 1000 }, // 24 h
  config_integrity:   { enabled: true, intervalMs: 6 * 60 * 60 * 1000 },  // 6 h
};

const PROVIDER_HISTORY_CAP = 100; // max entries per provider

export class HeartbeatEngine {
  private config:       HeartbeatConfig;
  private lastRanAt:   Map<string, number> = new Map(); // checkId → epoch ms
  private inFlight:    boolean = false;
  private timer?:      ReturnType<typeof setInterval>;
  private runHistory:  RunRecord[] = [];          // capped at 50
  private startedAt:   number = Date.now();
  /** Per-provider rolling health history — capped at PROVIDER_HISTORY_CAP entries each. */
  private providerHealthHistory: Map<string, ProviderHealthEntry[]> = new Map();

  constructor(
    private readonly memory:       MemoryEngine | null,
    private readonly models:       ModelEngine | null,
    private readonly orchestrator: AgentOrchestrator | null,
    config?: Partial<HeartbeatConfig>,
    private readonly recommender?: ModelRecommender | null,
    private readonly diskLogger?: DiskLogger | null,
  ) {
    this.config = this.mergeConfig(config);
  }

  /** Start the polling loop. Safe to call multiple times (idempotent). */
  start(): void {
    if (!this.config.enabled) {
      this.log('info', 'Disabled by config — not starting.');
      return;
    }
    if (this.timer) return; // already running

    // Schedule first tick with jitter, then reschedule after each tick.
    const scheduleNext = (): void => {
      const intervalMs = POLL_INTERVAL_BASE_MS + Math.random() * POLL_INTERVAL_JITTER_MS;
      this.timer = setTimeout(() => {
        void this.tick().finally(() => {
          if (this.timer !== undefined) scheduleNext();
        });
      }, intervalMs) as unknown as ReturnType<typeof setInterval>;
    };
    scheduleNext();
    this.log('info', `Started (polling every ${POLL_INTERVAL_BASE_MS / 1000}–${(POLL_INTERVAL_BASE_MS + POLL_INTERVAL_JITTER_MS) / 1000}s with jitter).`);
  }

  /** Stop the heartbeat loop cleanly. In-flight runs complete or time out. */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer as unknown as ReturnType<typeof setTimeout>);
      this.timer = undefined;
      this.log('info', 'Stopped.');
    }
  }

  /** Expose recent run history (for diagnostics / API). */
  history(limit = 10): HeartbeatRunRecord[] {
    return this.runHistory.slice(-limit);
  }

  /** Returns the most recent completed run, or null if none yet. */
  getLastRun(): HeartbeatRunRecord | null {
    const runs = this.runHistory;
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].completedAt !== undefined) return runs[i];
    }
    return null;
  }

  /**
   * Returns all warning-severity insights from the last run.
   * Used by the UI to surface non-invasive warnings in the status bar.
   */
  getActiveWarnings(): HeartbeatInsight[] {
    const last = this.getLastRun();
    if (!last) return [];
    return last.insights.filter(i => i.severity === 'warning');
  }

  /** Current config (read-only snapshot). */
  getConfig(): HeartbeatConfig { return { ...this.config, checks: { ...this.config.checks } }; }

  /**
   * Returns per-provider rolling health history.
   * Each key is a provider id; each value is the last N entries (newest last).
   */
  getProviderHealthHistory(): Record<string, ProviderHealthEntry[]> {
    const result: Record<string, ProviderHealthEntry[]> = {};
    for (const [id, entries] of this.providerHealthHistory.entries()) {
      result[id] = [...entries];
    }
    return result;
  }

  /** Record a single provider health check result into the rolling history. */
  recordProviderHealth(providerId: string, ok: boolean, latencyMs: number): void {
    let entries = this.providerHealthHistory.get(providerId);
    if (!entries) {
      entries = [];
      this.providerHealthHistory.set(providerId, entries);
    }
    entries.push({ timestamp: new Date().toISOString(), ok, latencyMs });
    if (entries.length > PROVIDER_HISTORY_CAP) entries.shift();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    // Skip during startup window
    if (Date.now() - this.startedAt < MIN_STARTUP_DELAY_MS) return;
    // Concurrency guard — only one heartbeat run at a time
    if (this.inFlight) {
      this.log('debug', 'Skipping tick — previous run still in flight.');
      return;
    }

    this.inFlight = true;
    const record: RunRecord = {
      startedAt: Date.now(),
      checksRan: [],
      insights:  [],
      timedOut:  false,
    };

    try {
      await this.runWithTimeout(record);
    } catch (err) {
      record.error = err instanceof Error ? err.message : String(err);
      this.log('error', `Unexpected error during run: ${record.error}`);
    } finally {
      record.completedAt = Date.now();
      record.durationMs  = record.completedAt - record.startedAt;
      this.inFlight = false;
      this.storeRecord(record);
      const duration = record.completedAt - record.startedAt;
      this.log('info',
        `Run complete — ${record.checksRan.length} checks, ` +
        `${record.insights.length} insights, ${duration}ms` +
        (record.timedOut ? ' [TIMED OUT]' : ''),
      );
    }
  }

  private async runWithTimeout(record: RunRecord): Promise<void> {
    const timeout = this.config.timeoutMs ?? HEARTBEAT_TIMEOUT_MS;

    const runPromise = this.runChecks(record);
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('HeartbeatEngine timeout')), timeout),
    );

    try {
      await Promise.race([runPromise, timeoutPromise]);
    } catch (err) {
      if (err instanceof Error && err.message === 'HeartbeatEngine timeout') {
        record.timedOut = true;
        this.log('warn', `Run exceeded ${timeout}ms — cancelled.`);
      } else {
        throw err;
      }
    }
  }

  private async runChecks(record: RunRecord): Promise<void> {
    const now = Date.now();
    const ctx: CheckContext = {
      memory:       this.memory,
      models:       this.models,
      orchestrator: this.orchestrator,
      recommender:  this.recommender,
    };

    for (const [checkId, cfg] of Object.entries(this.config.checks)) {
      if (!cfg.enabled) continue;
      const lastRan = this.lastRanAt.get(checkId) ?? 0;
      if (now - lastRan < cfg.intervalMs) continue;

      const checkStart = Date.now();
      try {
        const insights = await this.runCheck(checkId, ctx);
        const checkDurationMs = Date.now() - checkStart;
        record.checksRan.push(checkId);
        record.insights.push(...insights);
        this.lastRanAt.set(checkId, now);
        if (insights.length > 0) {
          for (const insight of insights) {
            this.log(insight.severity === 'warning' ? 'warn' : 'info',
              `[${checkId}] ${insight.severity.toUpperCase()}: ${insight.message}`);
          }
          // Persist warning insights to DB for cross-restart visibility
          if (this.memory) {
            for (const insight of insights) {
              if (insight.severity === 'warning') {
                try {
                  this.memory.heartbeatInsightStore.record({
                    checkId:         insight.checkId,
                    severity:        insight.severity,
                    message:         insight.message,
                    actionable:      insight.actionable,
                    suggestedAction: insight.suggestedAction,
                  });
                } catch { /* never block heartbeat for persistence errors */ }
              }
            }
          }
        } else {
          this.log('info', `[${checkId}] OK — no issues found (${checkDurationMs}ms)`);
        }
      } catch (err) {
        this.log('warn', `[${checkId}] Check failed (${Date.now() - checkStart}ms): ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async runCheck(id: string, ctx: CheckContext): Promise<HeartbeatInsight[]> {
    switch (id) {
      case 'task_review':      return this.check_task_review(ctx);
      case 'stale_state':      return this.check_stale_state(ctx);
      case 'failed_skills':    return this.check_failed_skills(ctx);
      case 'memory_hygiene':   return this.check_memory_hygiene(ctx);
      case 'learning_summary':  return this.check_learning_summary(ctx);
      case 'model_signal':      return this.check_model_signal(ctx);
      case 'config_integrity':  return this.check_config_integrity(ctx);
      default:
        this.log('warn', `Unknown check id: ${id}`);
        return [];
    }
  }

  // ── Checks ─────────────────────────────────────────────────────────────

  private async check_task_review(ctx: CheckContext): Promise<HeartbeatInsight[]> {
    if (!ctx.orchestrator) return [];
    const insights: HeartbeatInsight[] = [];
    const runs = ctx.orchestrator.listRuns();
    const stuckRuns = runs.filter(r =>
      r.status === 'running' &&
      Date.now() - r.startedAt > 10 * 60 * 1000, // running > 10 min
    );
    if (stuckRuns.length > 0) {
      insights.push(this.insight('task_review', 'warning',
        `${stuckRuns.length} agent run(s) have been in 'running' state for over 10 minutes.`,
        true, 'review_stuck_runs'));
    }
    return insights;
  }

  private async check_stale_state(ctx: CheckContext): Promise<HeartbeatInsight[]> {
    if (!ctx.memory) return [];
    const insights: HeartbeatInsight[] = [];
    try {
      const cutoff = Date.now() - STALE_RUN_THRESHOLD_MS;
      // Query agent_runs directly — in-memory list in AgentOrchestrator only covers this session;
      // the DB covers runs that outlasted a previous process.
      const staleRows = ctx.memory.agentRunStore
        .list()
        .filter(r => r.status === 'running' && r.startedAt < cutoff);

      if (staleRows.length > 0) {
        // Auto-correct to 'failed' so the next process start doesn't replay them
        for (const run of staleRows) {
          ctx.memory.agentRunStore.save({
            ...run,
            status:       'failed',
            completedAt:  Date.now(),
            errorMessage: 'Marked failed by heartbeat stale_state check (exceeded 10 min without completing).',
          });
        }
        insights.push(this.insight('stale_state', 'warning',
          `${staleRows.length} agent run(s) were stuck in 'running' state for over 10 minutes and have been marked failed.`,
          false));
        this.log('warn', `[stale_state] Auto-corrected ${staleRows.length} stale run(s) to 'failed'.`);
      }
    } catch { /* non-fatal */ }
    return insights;
  }

  private async check_failed_skills(ctx: CheckContext): Promise<HeartbeatInsight[]> {
    if (!ctx.orchestrator) return [];
    const insights: HeartbeatInsight[] = [];
    const runs = ctx.orchestrator.listRuns();
    const recentWindow = Date.now() - 60 * 60 * 1000; // last 1h
    const recentFailed = runs.filter(r =>
      r.status === 'failed' && (r.completedAt ?? 0) > recentWindow,
    );
    if (recentFailed.length >= 3) {
      insights.push(this.insight('failed_skills', 'warning',
        `${recentFailed.length} agent runs failed in the last hour. Check model availability and input limits.`,
        true, 'review_failed_runs'));
    }
    return insights;
  }

  private async check_memory_hygiene(ctx: CheckContext): Promise<HeartbeatInsight[]> {
    if (!ctx.memory) return [];
    const insights: HeartbeatInsight[] = [];
    try {
      // Run retention janitor — prunes stale memory_entries, conversations, learning_records
      const janitorResult = ctx.memory.runJanitor();
      const totalPruned = janitorResult.memoryEntriesPruned +
                          janitorResult.conversationsPruned +
                          janitorResult.learningRecordsPruned;
      if (totalPruned > 0) {
        this.log('info',
          `[memory_hygiene] Janitor pruned ${totalPruned} rows ` +
          `(entries=${janitorResult.memoryEntriesPruned}, ` +
          `conversations=${janitorResult.conversationsPruned}, ` +
          `learning=${janitorResult.learningRecordsPruned}).`);
      }

      const stats = ctx.memory.stats();
      const total = (stats as { entryCount?: number }).entryCount ?? 0;
      if (total > 5000) {
        insights.push(this.insight('memory_hygiene', 'info',
          `Memory store has ${total} entries. Consider running memory consolidation or adjusting retention settings.`,
          true, 'consolidate_memory'));
      }

      // DB file-size check via SQLite PRAGMA (no fs.statSync needed — works on any platform)
      try {
        const pageCount = (ctx.memory.db.pragma('page_count', { simple: true }) as number) ?? 0;
        const pageSize  = (ctx.memory.db.pragma('page_size',  { simple: true }) as number) ?? 4096;
        const dbSizeMb  = Math.round((pageCount * pageSize) / (1024 * 1024));
        this.log('debug', `[memory_hygiene] DB size: ${dbSizeMb} MB (${pageCount} pages × ${pageSize} bytes).`);
        if (dbSizeMb > 500) {
          insights.push(this.insight('memory_hygiene', 'warning',
            `Database file is ${dbSizeMb} MB. Consider running VACUUM or tightening retention policies.`,
            true, 'vacuum_db'));
        } else if (dbSizeMb > 100) {
          insights.push(this.insight('memory_hygiene', 'info',
            `Database file is ${dbSizeMb} MB.`,
            false));
        }
      } catch { /* PRAGMA unavailable — skip size check */ }

      // Backup file accumulation check.
      // Policy: keep the 5 newest backups always (safety net), then prune by age (30 days).
      // Never deletes the single newest file.
      try {
        const BAK_RETENTION_DAYS = 30;
        const BAK_KEEP_NEWEST    = 5;
        const BAK_RETENTION_MS   = BAK_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const now = Date.now();

        const bakDir = ctx.memory.dbDir;
        const allBak = readdirSync(bakDir)
          .filter(f => f.endsWith('.bak'))
          .map(f => ({ name: f, path: join(bakDir, f), mtime: 0 }));

        for (const b of allBak) {
          try { b.mtime = statSync(b.path).mtimeMs; } catch { b.mtime = 0; }
        }

        // Sort newest first
        allBak.sort((a, b) => b.mtime - a.mtime);

        let deleted = 0;
        for (let i = 0; i < allBak.length; i++) {
          const b = allBak[i];
          // Always preserve the BAK_KEEP_NEWEST most recent files
          if (i < BAK_KEEP_NEWEST) continue;
          // Prune older files beyond the keep window that are also past the age threshold
          if (now - b.mtime > BAK_RETENTION_MS) {
            try { unlinkSync(b.path); deleted++; } catch { /* skip locked */ }
          }
        }

        if (deleted > 0) {
          this.log('info',
            `[memory_hygiene] Pruned ${deleted} .bak backup file(s) ` +
            `(policy: keep newest ${BAK_KEEP_NEWEST}, prune older than ${BAK_RETENTION_DAYS} days).`);
        }

        const remaining = allBak.length - deleted;
        if (remaining > 10) {
          insights.push(this.insight('memory_hygiene', 'warning',
            `${remaining} .bak backup files remain after cleanup. ` +
            `This may indicate frequent migrations. Run \`pnpm doctor\` for details.`,
            false));
        } else if (remaining > 0) {
          this.log('debug',
            `[memory_hygiene] ${remaining} .bak file(s) retained (newest ${Math.min(remaining, BAK_KEEP_NEWEST)} protected).`);
        }
      } catch { /* directory unreadable — skip */ }
    } catch { /* stats unavailable — skip */ }
    return insights;
  }

  private async check_learning_summary(ctx: CheckContext): Promise<HeartbeatInsight[]> {
    if (!ctx.memory) return [];
    const insights: HeartbeatInsight[] = [];
    try {
      ctx.memory.learningStore.prune();
      const stats = ctx.memory.learningStore.stats();
      if (stats.totalRecords > 10_000) {
        insights.push(this.insight('learning_summary', 'info',
          `Learning store has ${stats.totalRecords} records. Retention rules applied.`,
          false));
      }
      if (stats.acceptanceRate < 0.3 && stats.totalRecords > 50) {
        insights.push(this.insight('learning_summary', 'warning',
          `Model recommendation acceptance rate is ${Math.round(stats.acceptanceRate * 100)}% — users frequently override suggestions. Consider reviewing recommendation profiles.`,
          true, 'review_recommendation_profiles'));
      }
    } catch { /* non-fatal */ }
    return insights;
  }

  private async check_model_signal(ctx: CheckContext): Promise<HeartbeatInsight[]> {
    if (!ctx.memory || !ctx.recommender) return [];
    const insights: HeartbeatInsight[] = [];
    try {
      const stats = ctx.memory.learningStore.stats();
      // If we have pinned preferences and a low acceptance rate, surface an insight
      const prefs = ctx.recommender.listPreferences();
      if (prefs.length > 0 && stats.acceptanceRate < 0.5 && stats.totalRecords > 20) {
        insights.push(this.insight('model_signal', 'info',
          `You have ${prefs.length} pinned model preference(s). Recommendation engine updated with latest usage patterns.`,
          false));
      }
    } catch { /* non-fatal */ }

    // Opportunistic embedding probe — if provider is degraded, try a lightweight
    // ping to see if it has recovered. No embed() call — just a reachability check.
    try {
      if (ctx.memory) {
        const provider = ctx.memory.getActiveEmbeddingProvider();
        if (provider.probe && !provider.isAvailable()) {
          const recovered = await provider.probe();
          if (recovered) {
            this.log('info', `[model_signal] Embedding provider recovered — semantic search is active again. provider=${provider.name}`);
          }
        } else if (provider.probe) {
          // Already available — still probe to keep status fresh
          await provider.probe();
        }
      }
    } catch { /* probe is best-effort */ }

    return insights;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private insight(
    checkId: string,
    severity: 'info' | 'warning',
    message: string,
    actionable: boolean,
    suggestedAction?: string,
  ): HeartbeatInsight {
    return {
      type: 'heartbeat_insight',
      checkId,
      severity,
      message,
      actionable,
      suggestedAction,
      timestamp: new Date().toISOString(),
    };
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const tagged = `[HeartbeatEngine] ${message}`;
    if (this.diskLogger) {
      this.diskLogger[level](tagged);
    } else {
      // Fallback when no logger injected (e.g. in tests)
      const prefix = `[HeartbeatEngine] ${new Date().toISOString()}`;
      switch (level) {
        case 'debug': console.debug(`${prefix} DEBUG ${message}`); break;
        case 'info':  console.info(`${prefix} INFO  ${message}`); break;
        case 'warn':  console.warn(`${prefix} WARN  ${message}`); break;
        case 'error': console.error(`${prefix} ERROR ${message}`); break;
      }
    }
  }

  private storeRecord(record: RunRecord): void {
    this.runHistory.push(record);
    if (this.runHistory.length > 50) this.runHistory.shift();
  }

  /**
   * Check for config file anomalies using the already-loaded in-memory state.
   *
   * Detects:
   * - No providers configured (onboarding skipped or providers.json emptied)
   * - Providers with empty model lists (possible sign of a corrupted write)
   * - No agents configured (agents.json emptied or missing)
   *
   * This check does not re-read disk files — it validates the in-memory state that
   * was loaded (and validated) at startup. A mismatch between disk and memory
   * (e.g. an external editor corrupted the file after startup) is caught on the
   * next gateway restart.
   */
  private async check_config_integrity(ctx: CheckContext): Promise<HeartbeatInsight[]> {
    const insights: HeartbeatInsight[] = [];
    try {
      if (ctx.models) {
        const providers = ctx.models.listProviders();
        if (providers.length === 0) {
          insights.push(this.insight('config_integrity', 'warning',
            'No AI providers are configured. Add a provider via the Models tab to enable inference.',
            true, 'add_provider'));
        } else {
          const emptyModels = providers.filter(p => p.isEnabled && (!p.models || p.models.length === 0));
          if (emptyModels.length > 0) {
            insights.push(this.insight('config_integrity', 'warning',
              `${emptyModels.length} enabled provider(s) have no models configured: ${emptyModels.map(p => p.name).join(', ')}. Use "Refresh Models" or add models manually.`,
              true, 'refresh_models'));
          }

          // Record provider health history entries for each enabled provider.
          // Uses circuit breaker state as a lightweight proxy for reachability —
          // avoids making real HTTP calls during heartbeat (which would consume quota).
          const circuits = ctx.models.circuitStats();
          for (const p of providers.filter(p2 => p2.isEnabled)) {
            const circuit = (circuits as Record<string, unknown>)[p.id];
            const isOpen  = circuit && (circuit as Record<string, unknown>)['state'] === 'open';
            // Record as ok if circuit is closed/half-open; fail if circuit is open.
            // latencyMs is approximated from last inference latency if tracked, else 0.
            this.recordProviderHealth(p.id, !isOpen, 0);
          }
        }
      }

      if (ctx.orchestrator) {
        const agents = ctx.orchestrator.listAgents();
        if (agents.length === 0) {
          insights.push(this.insight('config_integrity', 'info',
            'No agents are configured. A default agent will be created automatically on next setup.',
            false));
        }
      }
    } catch { /* non-fatal */ }
    return insights;
  }

  private mergeConfig(partial?: Partial<HeartbeatConfig>): HeartbeatConfig {
    const base: HeartbeatConfig = {
      enabled:   true,
      timeoutMs: HEARTBEAT_TIMEOUT_MS,
      checks:    { ...DEFAULT_CHECKS },
    };
    if (!partial) return base;

    if (partial.enabled !== undefined)   base.enabled   = partial.enabled;
    if (partial.timeoutMs !== undefined) base.timeoutMs = partial.timeoutMs;

    if (partial.checks) {
      for (const [id, overrides] of Object.entries(partial.checks)) {
        if (base.checks[id]) {
          base.checks[id] = { ...base.checks[id]!, ...overrides };
        } else {
          base.checks[id] = overrides;
        }
      }
    }

    return base;
  }
}
