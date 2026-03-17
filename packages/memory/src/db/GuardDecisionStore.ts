import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// ─── GuardDecisionStore ───────────────────────────────────────────────────────
//
// Persists every guard verdict to the guard_decisions table so that a full
// security audit trail is available for review via GET /api/guard/decisions.
//
// Uses local minimal types to avoid a circular dependency on @krythor/guard.
//

// Minimal subset of GuardContext needed for recording
export interface GuardContextInput {
  operation: string;
  source?: string;
  scope?: string;
  [key: string]: unknown;
}

// Minimal subset of GuardVerdict needed for recording
export interface GuardVerdictInput {
  allowed: boolean;
  action: string;
  ruleId?: string;
  ruleName?: string;
  reason: string;
  warnings?: string[];
}

export interface GuardDecision {
  id: string;
  timestamp: number;
  operation: string;
  source?: string;
  scope?: string;
  allowed: boolean;
  action: string;
  ruleId?: string;
  ruleName?: string;
  reason: string;
  warnings: string[];
}

export class GuardDecisionStore {
  constructor(private db: Database.Database) {}

  record(ctx: GuardContextInput, verdict: GuardVerdictInput): void {
    const stmt = this.db.prepare(`
      INSERT INTO guard_decisions (id, timestamp, operation, source, scope, allowed, action, rule_id, rule_name, reason, warnings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      randomUUID(),
      Date.now(),
      ctx.operation,
      ctx.source ?? null,
      ctx.scope ?? null,
      verdict.allowed ? 1 : 0,
      verdict.action,
      verdict.ruleId ?? null,
      verdict.ruleName ?? null,
      verdict.reason,
      JSON.stringify(verdict.warnings ?? []),
    );
  }

  list(limit = 100, offset = 0): GuardDecision[] {
    const rows = this.db.prepare(
      `SELECT * FROM guard_decisions ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(limit, offset) as Array<Record<string, unknown>>;
    return rows.map(r => ({
      id: r['id'] as string,
      timestamp: r['timestamp'] as number,
      operation: r['operation'] as string,
      source: r['source'] as string | undefined,
      scope: r['scope'] as string | undefined,
      allowed: (r['allowed'] as number) === 1,
      action: r['action'] as string,
      ruleId: r['rule_id'] as string | undefined,
      ruleName: r['rule_name'] as string | undefined,
      reason: r['reason'] as string,
      warnings: JSON.parse((r['warnings'] as string) ?? '[]') as string[],
    }));
  }

  clear(): void {
    this.db.prepare(`DELETE FROM guard_decisions`).run();
  }
}
