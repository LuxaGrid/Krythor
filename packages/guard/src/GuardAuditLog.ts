import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { GuardContext, GuardVerdict } from './types.js';

// ─── GuardAuditLog ────────────────────────────────────────────────────────────
//
// Persists every guard decision to a NDJSON (newline-delimited JSON) log file.
// The file is appended on every check — one JSON object per line.
//
// Format (each line):
//   {
//     "ts": 1700000000000,       // Unix ms timestamp
//     "operation": "memory:write",
//     "source": "agent",
//     "sourceId": "helper-agent",
//     "allowed": true,
//     "action": "allow",
//     "ruleId": "rule-123",      // omitted if default policy applied
//     "reason": "Default allow",
//     "warnings": []
//   }
//
// File: <dataDir>/logs/guard-audit.ndjson
// Rotation: not automatic — use logrotate or the built-in backup command.
//

export interface AuditEntry {
  ts: number;
  operation: string;
  source: string;
  sourceId?: string;
  scope?: string;
  allowed: boolean;
  action: string;
  ruleId?: string;
  ruleName?: string;
  reason: string;
  warnings: string[];
}

export class GuardAuditLog {
  private readonly logPath: string;
  private ready = false;

  constructor(dataDir: string) {
    const logsDir = join(dataDir, 'logs');
    this.logPath = join(logsDir, 'guard-audit.ndjson');
    try {
      mkdirSync(logsDir, { recursive: true });
      this.ready = true;
    } catch {
      // Non-fatal — log to stderr but don't crash the guard engine
      process.stderr.write('[guard] Could not create logs directory — audit log disabled\n');
    }
  }

  record(ctx: GuardContext, verdict: GuardVerdict): void {
    if (!this.ready) return;

    const entry: AuditEntry = {
      ts: Date.now(),
      operation: ctx.operation,
      source: ctx.source,
      ...(ctx.sourceId ? { sourceId: ctx.sourceId } : {}),
      ...(ctx.scope ? { scope: ctx.scope } : {}),
      allowed: verdict.allowed,
      action: verdict.action,
      ...(verdict.ruleId ? { ruleId: verdict.ruleId } : {}),
      ...(verdict.ruleName ? { ruleName: verdict.ruleName } : {}),
      reason: verdict.reason,
      warnings: verdict.warnings,
    };

    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch {
      // Best-effort — if the disk is full or path is broken, skip silently
    }
  }

  /** Path to the audit log file (useful for display in doctor/repair) */
  get path(): string {
    return this.logPath;
  }
}
