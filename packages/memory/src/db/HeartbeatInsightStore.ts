import type Database from 'better-sqlite3';

// ─── HeartbeatInsightStore ────────────────────────────────────────────────────
//
// Persists warning-severity heartbeat insights across gateway restarts.
// Only warnings are stored — informational/OK checks are not persisted (no noise).
//
// Retention: 24-hour rolling window + 500-row ceiling (enforced by prune()).
// Reads are fast (indexed by recorded_at DESC).
//

const RETENTION_MS  = 24 * 60 * 60 * 1000; // 24 hours
const MAX_ROWS      = 500;

export interface PersistedInsight {
  id:               string;
  recordedAt:       number;
  checkId:          string;
  severity:         'info' | 'warning';
  message:          string;
  actionable:       boolean;
  suggestedAction?: string;
}

export class HeartbeatInsightStore {
  constructor(private readonly db: Database.Database) {}

  /** Persist a warning insight. Ignores info-severity entries. */
  record(insight: Omit<PersistedInsight, 'id' | 'recordedAt'>): void {
    if (insight.severity !== 'warning') return; // only persist warnings
    const id = `hb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.db.prepare(`
      INSERT INTO heartbeat_insights (id, recorded_at, check_id, severity, message, actionable, suggested_action)
      VALUES (@id, @recordedAt, @checkId, @severity, @message, @actionable, @suggestedAction)
    `).run({
      id,
      recordedAt:      Date.now(),
      checkId:         insight.checkId,
      severity:        insight.severity,
      message:         insight.message,
      actionable:      insight.actionable ? 1 : 0,
      suggestedAction: insight.suggestedAction ?? null,
    });
  }

  /** Returns recent warning insights within the retention window. */
  recent(limitHours = 24): PersistedInsight[] {
    const cutoff = Date.now() - limitHours * 60 * 60 * 1000;
    const rows = this.db.prepare(`
      SELECT id, recorded_at, check_id, severity, message, actionable, suggested_action
      FROM heartbeat_insights
      WHERE recorded_at >= @cutoff AND severity = 'warning'
      ORDER BY recorded_at DESC
      LIMIT 100
    `).all({ cutoff }) as Array<{
      id: string; recorded_at: number; check_id: string; severity: string;
      message: string; actionable: number; suggested_action: string | null;
    }>;

    return rows.map(r => ({
      id:              r.id,
      recordedAt:      r.recorded_at,
      checkId:         r.check_id,
      severity:        r.severity as 'info' | 'warning',
      message:         r.message,
      actionable:      r.actionable === 1,
      suggestedAction: r.suggested_action ?? undefined,
    }));
  }

  /** Prune old rows. Called by DbJanitor during memory_hygiene. */
  prune(): number {
    const cutoff = Date.now() - RETENTION_MS;
    const byAge = this.db.prepare(
      `DELETE FROM heartbeat_insights WHERE recorded_at < @cutoff`
    ).run({ cutoff });

    const byCap = this.db.prepare(`
      DELETE FROM heartbeat_insights WHERE id IN (
        SELECT id FROM heartbeat_insights ORDER BY recorded_at DESC LIMIT -1 OFFSET @max
      )
    `).run({ max: MAX_ROWS });

    return byAge.changes + byCap.changes;
  }

  /** Count of stored warning insights. */
  count(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as c FROM heartbeat_insights WHERE severity = 'warning'`
    ).get() as { c: number };
    return row.c;
  }
}
