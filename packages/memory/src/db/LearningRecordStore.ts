import type { Database } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

// ─── LearningRecordStore ───────────────────────────────────────────────────────
//
// Append-only structured event store for model-selection learning signals.
//
// Design rules (from MASTER Prompt Phase 4):
//   - Bounded: retention + row cap
//   - No raw input text stored — only a short hash prefix for dedup
//   - Dedup: records with the same task_type + task_text_hash within 5s are dropped
//   - Structured enough for future analytics
//   - Never writes to prompt files or identity files
//

const RETENTION_DAYS   = 90;
const MAX_RECORDS      = 50_000;
const DEDUP_WINDOW_MS  = 5_000;

export interface LearningRecord {
  id:                         string;
  recordedAt:                 number;   // epoch ms
  taskType:                   string;
  taskTextHash?:              string;
  skillId?:                   string;
  agentId?:                   string;
  modelId:                    string;
  providerId:                 string;
  recommendedModelId?:        string;
  userAcceptedRecommendation: boolean;
  outcome:                    'success' | 'failure' | 'stopped';
  latencyMs?:                 number;
  estimatedCost?:             number;
  retries:                    number;
  turnCount?:                 number;
  wasPinnedPreference:        boolean;
}

export type NewLearningRecord = Omit<LearningRecord, 'id' | 'recordedAt'>;

export interface LearningStats {
  totalRecords:         number;
  byTaskType:           Record<string, number>;
  acceptanceRate:       number;  // fraction where user accepted recommendation
  avgLatencyMs:         number;
  oldestRecordAt:       number | null;
}

export class LearningRecordStore {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
    this.prune();
  }

  /** Append a new learning record. Returns the generated id, or null if deduped. */
  record(input: NewLearningRecord): string | null {
    const now = Date.now();

    // Dedup: skip if we've already seen this task_type + hash combo recently
    if (input.taskTextHash) {
      const recent = this.db.prepare(
        `SELECT 1 FROM learning_records
         WHERE task_type = ? AND task_text_hash = ? AND recorded_at > ?
         LIMIT 1`,
      ).get(input.taskType, input.taskTextHash, now - DEDUP_WINDOW_MS);
      if (recent) return null;
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO learning_records (
        id, recorded_at, task_type, task_text_hash,
        skill_id, agent_id,
        model_id, provider_id, recommended_model_id, user_accepted_recommendation,
        outcome, latency_ms, estimated_cost, retries, turn_count, was_pinned_preference
      ) VALUES (
        ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
    `).run(
      id,
      now,
      input.taskType,
      input.taskTextHash ?? null,
      input.skillId ?? null,
      input.agentId ?? null,
      input.modelId,
      input.providerId,
      input.recommendedModelId ?? null,
      input.userAcceptedRecommendation ? 1 : 0,
      input.outcome,
      input.latencyMs ?? null,
      input.estimatedCost ?? null,
      input.retries,
      input.turnCount ?? null,
      input.wasPinnedPreference ? 1 : 0,
    );
    return id;
  }

  /** List recent records, newest first. Max 1000 returned. */
  list(opts: { taskType?: string; modelId?: string; limit?: number } = {}): LearningRecord[] {
    const limit = Math.min(opts.limit ?? 100, 1000);
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.taskType) { conditions.push('task_type = ?'); params.push(opts.taskType); }
    if (opts.modelId)  { conditions.push('model_id = ?');  params.push(opts.modelId); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db.prepare(
      `SELECT * FROM learning_records ${where} ORDER BY recorded_at DESC LIMIT ?`,
    ).all(...params, limit) as Record<string, unknown>[];

    return rows.map(this.fromRow);
  }

  /** Summarized acceptance stats per task type and model. */
  stats(): LearningStats {
    const total = (this.db.prepare('SELECT COUNT(*) AS c FROM learning_records').get() as { c: number }).c;
    const byType = this.db.prepare(
      'SELECT task_type, COUNT(*) AS c FROM learning_records GROUP BY task_type',
    ).all() as { task_type: string; c: number }[];
    const acceptance = this.db.prepare(
      'SELECT AVG(user_accepted_recommendation) AS r FROM learning_records WHERE recommended_model_id IS NOT NULL',
    ).get() as { r: number | null };
    const avgLatency = this.db.prepare(
      'SELECT AVG(latency_ms) AS a FROM learning_records WHERE latency_ms IS NOT NULL',
    ).get() as { a: number | null };
    const oldest = this.db.prepare(
      'SELECT MIN(recorded_at) AS t FROM learning_records',
    ).get() as { t: number | null };

    return {
      totalRecords:   total,
      byTaskType:     Object.fromEntries(byType.map(r => [r.task_type, r.c])),
      acceptanceRate: acceptance.r ?? 1,
      avgLatencyMs:   avgLatency.a ?? 0,
      oldestRecordAt: oldest.t ?? null,
    };
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  /**
   * Hash a short prefix of input text for use as taskTextHash.
   * Returns the first 8 hex chars of SHA-1(text) — enough for dedup,
   * not enough to reconstruct the original.
   */
  static hashText(text: string): string {
    return createHash('sha1').update(text).digest('hex').slice(0, 8);
  }

  // ── Retention ────────────────────────────────────────────────────────────

  prune(): void {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const byAge = this.db.prepare('DELETE FROM learning_records WHERE recorded_at < ?').run(cutoff);

    // Cap to MAX_RECORDS (delete oldest above the cap)
    const byCap = this.db.prepare(`
      DELETE FROM learning_records
      WHERE id IN (
        SELECT id FROM learning_records
        ORDER BY recorded_at DESC
        LIMIT -1 OFFSET ?
      )
    `).run(MAX_RECORDS);

    const total = byAge.changes + byCap.changes;
    if (total > 0) {
      console.info(`[LearningRecordStore] Pruned ${total} records (age: ${byAge.changes}, cap: ${byCap.changes}).`);
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private fromRow(row: Record<string, unknown>): LearningRecord {
    return {
      id:                         row['id'] as string,
      recordedAt:                 row['recorded_at'] as number,
      taskType:                   row['task_type'] as string,
      taskTextHash:               (row['task_text_hash'] as string) ?? undefined,
      skillId:                    (row['skill_id'] as string) ?? undefined,
      agentId:                    (row['agent_id'] as string) ?? undefined,
      modelId:                    row['model_id'] as string,
      providerId:                 row['provider_id'] as string,
      recommendedModelId:         (row['recommended_model_id'] as string) ?? undefined,
      userAcceptedRecommendation: row['user_accepted_recommendation'] === 1,
      outcome:                    row['outcome'] as 'success' | 'failure' | 'stopped',
      latencyMs:                  (row['latency_ms'] as number) ?? undefined,
      estimatedCost:              (row['estimated_cost'] as number) ?? undefined,
      retries:                    row['retries'] as number,
      turnCount:                  (row['turn_count'] as number) ?? undefined,
      wasPinnedPreference:        row['was_pinned_preference'] === 1,
    };
  }
}
