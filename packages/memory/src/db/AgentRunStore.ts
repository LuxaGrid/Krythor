import type Database from 'better-sqlite3';

// ─── AgentRunStore ────────────────────────────────────────────────────────────
//
// Persists agent runs to SQLite. Mirrors the in-memory run history in
// AgentOrchestrator so runs survive process restarts.
//
// Rows are kept for 30 days; older rows are pruned on startup.
//

const RETENTION_DAYS = 30;
const MAX_RUNS_STORED = 2000;

export interface PersistedRun {
  id: string;
  agentId: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  input: string;
  output?: string;
  modelUsed?: string;
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
  messages: unknown[];
  memoryIdsUsed: string[];
  memoryIdsWritten: string[];
  selectionReason?: string;
  fallbackOccurred?: boolean;
  retryCount?: number;
  promptTokens?: number;
  completionTokens?: number;
  parentRunId?: string;
}

interface RunRow {
  id: string;
  agent_id: string;
  status: string;
  input: string;
  output: string | null;
  model_used: string | null;
  error_message: string | null;
  started_at: number;
  completed_at: number | null;
  messages_json: string;
  memory_ids_used: string;
  memory_ids_written: string;
  selection_reason: string | null;
  fallback_occurred: number;
  retry_count: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  parent_run_id: string | null;
}

export class AgentRunStore {
  private readonly upsert: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByAgent: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.upsert = db.prepare(`
      INSERT INTO agent_runs
        (id, agent_id, status, input, output, model_used, error_message,
         started_at, completed_at, messages_json, memory_ids_used, memory_ids_written,
         selection_reason, fallback_occurred, retry_count,
         prompt_tokens, completion_tokens, parent_run_id)
      VALUES
        (@id, @agentId, @status, @input, @output, @modelUsed, @errorMessage,
         @startedAt, @completedAt, @messagesJson, @memoryIdsUsed, @memoryIdsWritten,
         @selectionReason, @fallbackOccurred, @retryCount,
         @promptTokens, @completionTokens, @parentRunId)
      ON CONFLICT(id) DO UPDATE SET
        status             = excluded.status,
        output             = excluded.output,
        model_used         = excluded.model_used,
        error_message      = excluded.error_message,
        completed_at       = excluded.completed_at,
        messages_json      = excluded.messages_json,
        memory_ids_used    = excluded.memory_ids_used,
        memory_ids_written = excluded.memory_ids_written,
        selection_reason   = excluded.selection_reason,
        fallback_occurred  = excluded.fallback_occurred,
        retry_count        = excluded.retry_count,
        prompt_tokens      = excluded.prompt_tokens,
        completion_tokens  = excluded.completion_tokens,
        parent_run_id      = excluded.parent_run_id
    `);

    this.selectById = db.prepare(
      'SELECT * FROM agent_runs WHERE id = ?',
    );

    this.selectByAgent = db.prepare(
      'SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT 500',
    );

    this.selectAll = db.prepare(
      'SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 500',
    );

    this.prune();
  }

  save(run: PersistedRun): void {
    this.upsert.run({
      id:              run.id,
      agentId:         run.agentId,
      status:          run.status,
      input:           run.input,
      output:          run.output ?? null,
      modelUsed:       run.modelUsed ?? null,
      errorMessage:    run.errorMessage ?? null,
      startedAt:       run.startedAt,
      completedAt:     run.completedAt ?? null,
      messagesJson:    JSON.stringify(run.messages),
      memoryIdsUsed:   JSON.stringify(run.memoryIdsUsed),
      memoryIdsWritten: JSON.stringify(run.memoryIdsWritten),
      selectionReason:  run.selectionReason ?? null,
      fallbackOccurred: run.fallbackOccurred ? 1 : 0,
      retryCount:       run.retryCount ?? 0,
      promptTokens:     run.promptTokens ?? null,
      completionTokens: run.completionTokens ?? null,
      parentRunId:      run.parentRunId ?? null,
    });
  }

  getById(id: string): PersistedRun | null {
    const row = this.selectById.get(id) as RunRow | undefined;
    return row ? this.toRun(row) : null;
  }

  list(agentId?: string): PersistedRun[] {
    const rows = agentId
      ? (this.selectByAgent.all(agentId) as RunRow[])
      : (this.selectAll.all() as RunRow[]);
    return rows.map(r => this.toRun(r));
  }

  private toRun(row: RunRow): PersistedRun {
    return {
      id:              row.id,
      agentId:         row.agent_id,
      status:          row.status as PersistedRun['status'],
      input:           row.input,
      output:          row.output ?? undefined,
      modelUsed:       row.model_used ?? undefined,
      errorMessage:    row.error_message ?? undefined,
      startedAt:       row.started_at,
      completedAt:     row.completed_at ?? undefined,
      messages:        this.parseJson(row.messages_json, []),
      memoryIdsUsed:   this.parseJson(row.memory_ids_used, []),
      memoryIdsWritten: this.parseJson(row.memory_ids_written, []),
      selectionReason:  row.selection_reason ?? undefined,
      fallbackOccurred: row.fallback_occurred === 1 ? true : undefined,
      retryCount:       row.retry_count > 0 ? row.retry_count : undefined,
      promptTokens:     row.prompt_tokens ?? undefined,
      completionTokens: row.completion_tokens ?? undefined,
      parentRunId:      row.parent_run_id ?? undefined,
    };
  }

  private parseJson<T>(raw: string, fallback: T): T {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }

  /**
   * Mark all persisted 'running' runs as 'failed'.
   * Called once at startup to clear orphans left by a previous crashed process.
   * Returns the number of rows updated.
   */
  resolveOrphanedRuns(errorMessage = 'Process restarted — run interrupted.'): number {
    const result = this.db.prepare(`
      UPDATE agent_runs
      SET status = 'failed', completed_at = ?, error_message = ?
      WHERE status = 'running'
    `).run(Date.now(), errorMessage);
    return result.changes;
  }

  /**
   * Delete completed sub-agent runs (those with a parent_run_id) that completed
   * more than `maxAgeMs` milliseconds ago. Returns the number of rows deleted.
   * Used by the orchestrator janitor to keep the run history lean.
   */
  pruneSubAgentRuns(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.prepare(`
      DELETE FROM agent_runs
      WHERE parent_run_id IS NOT NULL
        AND status IN ('completed', 'failed', 'stopped')
        AND completed_at < ?
    `).run(cutoff);
    return result.changes;
  }

  private prune(): void {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM agent_runs WHERE started_at < ?').run(cutoff);

    // Also enforce absolute max rows (oldest first)
    this.db.prepare(`
      DELETE FROM agent_runs WHERE id IN (
        SELECT id FROM agent_runs ORDER BY started_at DESC LIMIT -1 OFFSET ?
      )
    `).run(MAX_RUNS_STORED);
  }
}
