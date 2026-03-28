import type Database from 'better-sqlite3';

// ─── DbJanitor ────────────────────────────────────────────────────────────────
//
// Enforces data retention and pruning rules across all tables in memory.db.
// Called by the heartbeat memory_hygiene check (every 6 hours) and on startup
// (deferred via setImmediate to avoid blocking the boot path).
//
// Rules:
//   memory_entries     — prune entries older than 90 days with importance < 0.2 and not pinned
//   conversations      — prune conversations (and their messages via CASCADE) older than 90 days
//   messages           — orphaned messages cleaned up by CASCADE; no direct rule needed
//   learning_records   — keep last 90 days; enforce 50 000-row ceiling
//   agent_runs         — handled by AgentRunStore.prune() (30 days / 2000 rows)
//   guard_decisions    — handled by GuardDecisionStore.prune() (90 days / 10 000 rows)
//
// All rules are designed to be safe to run multiple times (idempotent).
//

const MEMORY_ENTRY_RETENTION_DAYS    = 90;
const MEMORY_ENTRY_LOW_IMPORTANCE    = 0.2;   // entries below this threshold are prunable
const DEFAULT_CONVERSATION_RETENTION_DAYS    = 90;
const LEARNING_RECORD_RETENTION_DAYS = 90;
const LEARNING_RECORD_MAX_ROWS       = 50_000;

export interface JanitorResult {
  memoryEntriesPruned: number;
  conversationsPruned: number;
  learningRecordsPruned: number;
  heartbeatInsightsPruned: number;
  ranAt: number;
  /** Row counts per table after pruning — useful for heartbeat insights and diagnostics. */
  tableCountsAfter: Record<string, number>;
}

export type LogFn = (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void;

export interface DbJanitorConfig {
  /**
   * Days after which conversations are pruned (measured by updated_at).
   * Default: 90. Set to 0 to disable age-based pruning.
   */
  conversationRetentionDays?: number;
  /**
   * Maximum number of conversations to retain. Oldest (by updated_at) are pruned first.
   * Default: 0 (disabled — no count cap).
   */
  maxConversations?: number;
  /**
   * Maximum total message payload size in bytes across all conversations.
   * When exceeded, oldest conversations (by updated_at) are pruned until under budget.
   * Approximate — uses the LENGTH of message content. Default: 0 (disabled).
   */
  maxDiskBytes?: number;
  /**
   * Archive a conversation after its message count reaches this threshold.
   * Archived conversations are excluded from the default sessions_list view.
   * Default: 0 (disabled).
   */
  rotateAfterMessages?: number;
}

export class DbJanitor {
  constructor(
    private readonly db: Database.Database,
    private readonly logFn?: LogFn,
    private config: DbJanitorConfig = {},
  ) {}

  /** Update retention config at runtime (e.g. after PATCH /api/config). */
  setConfig(config: DbJanitorConfig): void {
    this.config = config;
  }

  private log(level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>): void {
    if (this.logFn) {
      this.logFn(level, message, data);
    } else {
      // Fallback to console when no logger injected (e.g. standalone use)
      if (level === 'error') console.error(message, data ?? '');
      else console.log(message, data ?? '');
    }
  }

  /**
   * Run all retention rules.
   * Returns counts of pruned rows per table.
   * Never throws — errors are caught and logged so the heartbeat is never blocked.
   */
  run(): JanitorResult {
    const result: JanitorResult = {
      memoryEntriesPruned:     0,
      conversationsPruned:     0,
      learningRecordsPruned:   0,
      heartbeatInsightsPruned: 0,
      ranAt: Date.now(),
      tableCountsAfter: {},
    };

    try {
      result.memoryEntriesPruned = this.pruneMemoryEntries();
    } catch (err) {
      this.log('error', '[janitor] memory_entries prune failed', { error: err instanceof Error ? err.message : String(err) });
    }

    try {
      result.conversationsPruned = this.pruneConversations();
    } catch (err) {
      this.log('error', '[janitor] conversations prune failed', { error: err instanceof Error ? err.message : String(err) });
    }

    try {
      result.conversationsPruned += this.pruneByDiskBudget();
    } catch (err) {
      this.log('error', '[janitor] disk-budget prune failed', { error: err instanceof Error ? err.message : String(err) });
    }

    try {
      this.archiveOverMessageLimit();
    } catch (err) {
      this.log('error', '[janitor] rotate-after-messages archive failed', { error: err instanceof Error ? err.message : String(err) });
    }

    try {
      result.learningRecordsPruned = this.pruneLearningRecords();
    } catch (err) {
      this.log('error', '[janitor] learning_records prune failed', { error: err instanceof Error ? err.message : String(err) });
    }

    try {
      result.heartbeatInsightsPruned = this.pruneHeartbeatInsights();
    } catch (err) {
      this.log('error', '[janitor] heartbeat_insights prune failed', { error: err instanceof Error ? err.message : String(err) });
    }

    // Capture post-prune row counts for diagnostics
    result.tableCountsAfter = this.tableCounts();

    const total = result.memoryEntriesPruned + result.conversationsPruned + result.learningRecordsPruned + result.heartbeatInsightsPruned;
    if (total > 0) {
      this.log('info', '[janitor] Pruning complete', {
        total,
        memoryEntriesPruned:     result.memoryEntriesPruned,
        conversationsPruned:     result.conversationsPruned,
        learningRecordsPruned:   result.learningRecordsPruned,
        heartbeatInsightsPruned: result.heartbeatInsightsPruned,
        tableCountsAfter:        result.tableCountsAfter,
      });
    }

    return result;
  }

  // ── Per-table rules ────────────────────────────────────────────────────────

  /**
   * Prune memory entries that are:
   *   - older than MEMORY_ENTRY_RETENTION_DAYS
   *   - importance < MEMORY_ENTRY_LOW_IMPORTANCE
   *   - not pinned
   *
   * Pinned entries are never pruned by retention rules — only by explicit user action.
   */
  private pruneMemoryEntries(): number {
    const cutoff = Date.now() - MEMORY_ENTRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(`
      DELETE FROM memory_entries
      WHERE pinned = 0
        AND importance < @threshold
        AND last_used < @cutoff
    `).run({ threshold: MEMORY_ENTRY_LOW_IMPORTANCE, cutoff });
    return result.changes;
  }

  /**
   * Prune conversations (and their messages via CASCADE):
   *   1. Age-based: conversations older than retentionDays (measured by updated_at).
   *      Skipped when retentionDays = 0.
   *   2. Count cap: when maxConversations > 0, prune oldest conversations
   *      that exceed the cap (oldest by updated_at, pinned ones last).
   */
  private pruneConversations(): number {
    let pruned = 0;

    const retentionDays = this.config.conversationRetentionDays ?? DEFAULT_CONVERSATION_RETENTION_DAYS;
    if (retentionDays > 0) {
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      const result = this.db.prepare(`
        DELETE FROM conversations WHERE updated_at < @cutoff
      `).run({ cutoff });
      pruned += result.changes;
    }

    const maxConversations = this.config.maxConversations ?? 0;
    if (maxConversations > 0) {
      // Keep pinned conversations safe: prune non-pinned oldest first, then pinned
      const byCap = this.db.prepare(`
        DELETE FROM conversations WHERE id IN (
          SELECT id FROM conversations
          ORDER BY pinned ASC, updated_at ASC
          LIMIT -1 OFFSET @max
        )
      `).run({ max: maxConversations });
      pruned += byCap.changes;
    }

    return pruned;
  }

  /**
   * Prune oldest conversations until total message payload is within maxDiskBytes.
   * Uses approximate byte measurement (sum of LENGTH(content) across messages).
   */
  private pruneByDiskBudget(): number {
    const maxDiskBytes = this.config.maxDiskBytes ?? 0;
    if (maxDiskBytes <= 0) return 0;

    let pruned = 0;
    for (let attempt = 0; attempt < 1000; attempt++) {
      // Calculate approximate total message payload
      const sizeRow = this.db.prepare(`
        SELECT COALESCE(SUM(LENGTH(content)), 0) as total FROM messages
      `).get({}) as { total: number };

      if (sizeRow.total <= maxDiskBytes) break;

      // Prune the oldest non-pinned conversation
      const oldest = this.db.prepare(`
        SELECT id FROM conversations ORDER BY pinned ASC, updated_at ASC LIMIT 1
      `).get({}) as { id: string } | undefined;

      if (!oldest) break;

      this.db.prepare(`DELETE FROM conversations WHERE id = @id`).run({ id: oldest.id });
      pruned++;
    }
    return pruned;
  }

  /**
   * Archive conversations whose message count exceeds rotateAfterMessages.
   * Archiving marks them as archived=1 (excluded from default list views).
   */
  private archiveOverMessageLimit(): void {
    const limit = this.config.rotateAfterMessages ?? 0;
    if (limit <= 0) return;

    this.db.prepare(`
      UPDATE conversations SET archived = 1
      WHERE archived = 0 AND id IN (
        SELECT conversation_id FROM messages
        GROUP BY conversation_id
        HAVING COUNT(*) >= @limit
      )
    `).run({ limit });
  }

  /**
   * Prune learning records older than LEARNING_RECORD_RETENTION_DAYS,
   * then enforce the absolute row ceiling (oldest first).
   */
  private pruneLearningRecords(): number {
    const cutoff = Date.now() - LEARNING_RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    const byAge = this.db.prepare(`
      DELETE FROM learning_records WHERE recorded_at < @cutoff
    `).run({ cutoff });

    const byCap = this.db.prepare(`
      DELETE FROM learning_records WHERE id IN (
        SELECT id FROM learning_records ORDER BY recorded_at DESC LIMIT -1 OFFSET @max
      )
    `).run({ max: LEARNING_RECORD_MAX_ROWS });

    return byAge.changes + byCap.changes;
  }

  private pruneHeartbeatInsights(): number {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h retention
    const byAge = this.db.prepare(
      `DELETE FROM heartbeat_insights WHERE recorded_at < @cutoff`
    ).run({ cutoff });
    const byCap = this.db.prepare(`
      DELETE FROM heartbeat_insights WHERE id IN (
        SELECT id FROM heartbeat_insights ORDER BY recorded_at DESC LIMIT -1 OFFSET 500
      )
    `).run({});
    return byAge.changes + byCap.changes;
  }

  // ── Diagnostic / dry-run ────────────────────────────────────────────────────

  /**
   * Estimate how many conversations would be pruned without mutating the database.
   * Returns counts for age-based and count-cap pruning separately.
   */
  dryRunConversations(): { wouldPruneByAge: number; wouldPruneByCount: number; currentCount: number } {
    let wouldPruneByAge = 0;
    let wouldPruneByCount = 0;

    try {
      const retentionDays = this.config.conversationRetentionDays ?? DEFAULT_CONVERSATION_RETENTION_DAYS;
      if (retentionDays > 0) {
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const row = this.db.prepare(`SELECT COUNT(*) as c FROM conversations WHERE updated_at < @cutoff`).get({ cutoff }) as { c: number };
        wouldPruneByAge = row.c;
      }

      const maxConversations = this.config.maxConversations ?? 0;
      if (maxConversations > 0) {
        const countRow = this.db.prepare(`SELECT COUNT(*) as c FROM conversations`).get({}) as { c: number };
        const current = countRow.c;
        if (current > maxConversations) {
          wouldPruneByCount = current - maxConversations;
        }
      }
    } catch { /* ignore */ }

    const countRow = this.db.prepare(`SELECT COUNT(*) as c FROM conversations`).get({}) as { c: number };
    return { wouldPruneByAge, wouldPruneByCount, currentCount: countRow.c };
  }

  /** Returns row counts for all major tables — useful for heartbeat insights. */
  tableCounts(): Record<string, number> {
    const tables = [
      'memory_entries',
      'conversations',
      'messages',
      'agent_runs',
      'guard_decisions',
      'learning_records',
      'heartbeat_insights',
    ];

    const counts: Record<string, number> = {};
    for (const table of tables) {
      try {
        const row = this.db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
        counts[table] = row.c;
      } catch {
        counts[table] = -1; // table may not exist yet (schema not migrated)
      }
    }
    return counts;
  }
}
