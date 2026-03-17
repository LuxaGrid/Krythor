import type Database from 'better-sqlite3';
import { MigrationRunner } from './MigrationRunner.js';

// ─── applySchema ──────────────────────────────────────────────────────────────
//
// Applies all pending database migrations in order.
// Called once at startup by MemoryEngine.
// Safe to call on an existing database — only unapplied migrations run.
//

export function applySchema(db: Database.Database): void {
  const runner = new MigrationRunner(db);
  runner.run();
}
