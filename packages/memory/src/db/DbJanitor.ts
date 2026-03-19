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
const CONVERSATION_RETENTION_DAYS    = 90;
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

export class DbJanitor {
  constructor(
    private readonly db: Database.Database,
    private readonly logFn?: LogFn,
  ) {}

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
   * Prune conversations (and their messages via CASCADE) older than
   * CONVERSATION_RETENTION_DAYS, measured by updated_at.
   */
  private pruneConversations(): number {
    const cutoff = Date.now() - CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const result = this.db.prepare(`
      DELETE FROM conversations
      WHERE updated_at < @cutoff
    `).run({ cutoff });
    return result.changes;
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

  // ── Diagnostic queries ─────────────────────────────────────────────────────

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
