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
         started_at, completed_at, messages_json, memory_ids_used, memory_ids_written)
      VALUES
        (@id, @agentId, @status, @input, @output, @modelUsed, @errorMessage,
         @startedAt, @completedAt, @messagesJson, @memoryIdsUsed, @memoryIdsWritten)
      ON CONFLICT(id) DO UPDATE SET
        status             = excluded.status,
        output             = excluded.output,
        model_used         = excluded.model_used,
        error_message      = excluded.error_message,
        completed_at       = excluded.completed_at,
        messages_json      = excluded.messages_json,
        memory_ids_used    = excluded.memory_ids_used,
        memory_ids_written = excluded.memory_ids_written
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
    };
  }

  private parseJson<T>(raw: string, fallback: T): T {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
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
