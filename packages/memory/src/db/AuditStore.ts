import type Database from 'better-sqlite3';

// ─── AuditStore ───────────────────────────────────────────────────────────────
//
// Persists access-profile audit entries to SQLite (table: audit_log).
// Created by migration 011_audit_log.sql.
//
// This store is the durable backing for AccessProfileStore's in-memory ring
// buffer. Both coexist: in-memory ring for fast tail(), SQLite for persistence
// across restarts and richer filtering.
//

export interface AuditEntry {
  id: string;
  agentId: string;
  operation: string;
  target: string;
  profile: string;
  allowed: boolean;
  reason?: string;
  timestamp: number;
}

interface AuditRow {
  id: string;
  agent_id: string;
  operation: string;
  target: string;
  profile: string;
  allowed: number;
  reason: string | null;
  timestamp: number;
}

export class AuditStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Insert a single audit entry. */
  insert(entry: AuditEntry): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO audit_log (id, agent_id, operation, target, profile, allowed, reason, timestamp)
      VALUES (@id, @agentId, @operation, @target, @profile, @allowed, @reason, @timestamp)
    `).run({
      id:        entry.id,
      agentId:   entry.agentId,
      operation: entry.operation,
      target:    entry.target,
      profile:   entry.profile,
      allowed:   entry.allowed ? 1 : 0,
      reason:    entry.reason ?? null,
      timestamp: entry.timestamp,
    });
  }

  /**
   * Query audit entries with optional filters.
   * Results are ordered by timestamp DESC (newest first).
   */
  query(opts: {
    agentId?:   string;
    operation?: string;
    limit?:     number;
    offset?:    number;
    since?:     number;
  } = {}): AuditEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.agentId) {
      conditions.push('agent_id = ?');
      params.push(opts.agentId);
    }
    if (opts.operation) {
      conditions.push('operation = ?');
      params.push(opts.operation);
    }
    if (opts.since !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(opts.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit  = Math.min(Math.max(1, opts.limit  ?? 100), 1000);
    const offset = Math.max(0, opts.offset ?? 0);

    const rows = this.db.prepare(
      `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as AuditRow[];

    return rows.map(this._rowToEntry);
  }

  /** Return the last N entries ordered by timestamp DESC. */
  tail(n: number): AuditEntry[] {
    const limit = Math.min(Math.max(1, n), 1000);
    const rows = this.db.prepare(
      'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?'
    ).all(limit) as AuditRow[];
    return rows.map(this._rowToEntry);
  }

  /** Delete all rows (primarily for testing). */
  clear(): void {
    this.db.prepare('DELETE FROM audit_log').run();
  }

  private _rowToEntry(row: AuditRow): AuditEntry {
    return {
      id:        row.id,
      agentId:   row.agent_id,
      operation: row.operation,
      target:    row.target,
      profile:   row.profile,
      allowed:   row.allowed === 1,
      ...(row.reason !== null ? { reason: row.reason } : {}),
      timestamp: row.timestamp,
    };
  }
}
