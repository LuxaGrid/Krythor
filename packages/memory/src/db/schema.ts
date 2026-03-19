import type Database from 'better-sqlite3';
import { MigrationRunner } from './MigrationRunner.js';
import type { MigrationResult } from './MigrationRunner.js';

// ─── applySchema ──────────────────────────────────────────────────────────────
//
// Applies all pending database migrations in order, then runs a startup
// integrity check on the database file.
//
// Called once at startup by MemoryEngine.
// Safe to call on an existing database — only unapplied migrations run.
//
// Returns a StartupCheckResult summarising schema state and integrity.
//

export interface StartupCheckResult {
  /** Migration summary from MigrationRunner */
  migration: MigrationResult;
  /** PRAGMA integrity_check result — 'ok' means no corruption detected */
  integrityStatus: 'ok' | 'warning';
  /** Raw integrity check messages (empty when ok) */
  integrityMessages: string[];
  /** PRAGMA user_version after migrations */
  userVersion: number;
}

/**
 * Apply schema migrations and perform a startup integrity check.
 *
 * @param db        - Open better-sqlite3 Database instance
 * @param dbFilePath - Path to the .db file on disk (used for backup before migration)
 */
export function applySchema(db: Database.Database, dbFilePath?: string): StartupCheckResult {
  const runner = new MigrationRunner(db);
  const migration = runner.run(dbFilePath);

  // ── Integrity check ──────────────────────────────────────────────────────
  // PRAGMA integrity_check returns 'ok' when the database is healthy.
  // Any other value indicates corruption or structural problems.
  // We log and surface this but do not halt startup — a corrupted DB is
  // better than no DB (users can still read existing data in many cases).
  const integrityRows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  const messages = integrityRows
    .map(r => r.integrity_check)
    .filter(m => m !== 'ok');

  const integrityStatus: 'ok' | 'warning' = messages.length === 0 ? 'ok' : 'warning';

  if (integrityStatus === 'warning') {
    console.error(
      `[db] Integrity check FAILED — ${messages.length} issue(s) detected:\n` +
      messages.map(m => `  ${m}`).join('\n')
    );
  } else {
    console.log(`[db] Integrity check passed. Schema version: ${migration.userVersion}`);
  }

  return {
    migration,
    integrityStatus,
    integrityMessages: messages,
    userVersion: migration.userVersion,
  };
}

export type { MigrationResult };
