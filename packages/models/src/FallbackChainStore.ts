import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';

/** Raw SQLite row for the fallback_chains table. */
interface FallbackChainRow {
  id: string;
  name: string;
  description: string | null;
  task_type: string | null;
  agent_id: string | null;
  skill_id: string | null;
  providers: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface FallbackChain {
  id: string;
  name: string;
  description?: string;
  taskType?: string;
  agentId?: string;
  skillId?: string;
  providers: string[];  // ordered provider IDs
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateFallbackChainInput {
  name: string;
  description?: string;
  taskType?: string;
  agentId?: string;
  skillId?: string;
  providers: string[];
  createdBy?: string;
}

export class FallbackChainStore {
  constructor(private readonly db: Database.Database) {}

  create(input: CreateFallbackChainInput): FallbackChain {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO fallback_chains (id, name, description, task_type, agent_id, skill_id, providers, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.name,
      input.description ?? null,
      input.taskType ?? null,
      input.agentId ?? null,
      input.skillId ?? null,
      JSON.stringify(input.providers),
      input.createdBy ?? null,
      now,
      now,
    );
    return this.getById(id)!;
  }

  getById(id: string): FallbackChain | null {
    const row = this.db.prepare(`SELECT * FROM fallback_chains WHERE id = ?`).get(id) as FallbackChainRow | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  list(filter?: { taskType?: string; agentId?: string; skillId?: string }): FallbackChain[] {
    let sql = `SELECT * FROM fallback_chains WHERE 1=1`;
    const params: unknown[] = [];
    if (filter?.taskType) {
      sql += ` AND task_type = ?`;
      params.push(filter.taskType);
    }
    if (filter?.agentId) {
      sql += ` AND agent_id = ?`;
      params.push(filter.agentId);
    }
    if (filter?.skillId) {
      sql += ` AND skill_id = ?`;
      params.push(filter.skillId);
    }
    sql += ` ORDER BY updated_at DESC`;
    return (this.db.prepare(sql).all(...params) as FallbackChainRow[]).map(this.rowToRecord);
  }

  /**
   * Find the best chain for a given scope.
   * Priority: skillId match > agentId match > taskType match.
   */
  findByScope(scope: { taskType?: string; agentId?: string; skillId?: string }): FallbackChain | null {
    if (scope.skillId) {
      const row = this.db.prepare(`SELECT * FROM fallback_chains WHERE skill_id = ? LIMIT 1`).get(scope.skillId) as FallbackChainRow | undefined;
      if (row) return this.rowToRecord(row);
    }
    if (scope.agentId) {
      const row = this.db.prepare(`SELECT * FROM fallback_chains WHERE agent_id = ? LIMIT 1`).get(scope.agentId) as FallbackChainRow | undefined;
      if (row) return this.rowToRecord(row);
    }
    if (scope.taskType) {
      const row = this.db.prepare(`SELECT * FROM fallback_chains WHERE task_type = ? LIMIT 1`).get(scope.taskType) as FallbackChainRow | undefined;
      if (row) return this.rowToRecord(row);
    }
    return null;
  }

  update(id: string, patch: Partial<Pick<FallbackChain, 'name' | 'description' | 'providers' | 'taskType' | 'agentId' | 'skillId'>>): FallbackChain {
    const existing = this.getById(id);
    if (!existing) throw new Error(`FallbackChain "${id}" not found`);
    const updated = { ...existing, ...patch, updatedAt: Date.now() };
    this.db.prepare(`
      UPDATE fallback_chains
      SET name = ?, description = ?, task_type = ?, agent_id = ?, skill_id = ?, providers = ?, updated_at = ?
      WHERE id = ?
    `).run(
      updated.name,
      updated.description ?? null,
      updated.taskType ?? null,
      updated.agentId ?? null,
      updated.skillId ?? null,
      JSON.stringify(updated.providers),
      updated.updatedAt,
      id,
    );
    return this.getById(id)!;
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM fallback_chains WHERE id = ?`).run(id);
  }

  private rowToRecord(row: FallbackChainRow): FallbackChain {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      taskType: row.task_type ?? undefined,
      agentId: row.agent_id ?? undefined,
      skillId: row.skill_id ?? undefined,
      providers: JSON.parse(row.providers),
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
