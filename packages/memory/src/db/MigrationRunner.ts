import type Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync, copyFileSync } from 'fs';
import { join } from 'path';

// ─── MigrationRunner ──────────────────────────────────────────────────────────
//
// Applies numbered SQL migration files in order.
// Tracks applied migrations in the schema_migrations table.
// Sets PRAGMA user_version to the highest applied migration number after each run.
// Creates a timestamped backup of the DB file before applying any new migrations.
//
// Migration files must be named NNN_description.sql (e.g. 001_initial.sql).
// Each file is applied in a single transaction. Failures halt migration and
// throw — the server will not start with a partially migrated database.
//

const MIGRATIONS_DIR = join(__dirname, 'migrations');

export interface MigrationResult {
  /** Number of new migrations applied this run */
  applied: number;
  /** Total migrations that exist (applied + pending) */
  total: number;
  /** Highest applied migration version (= PRAGMA user_version) */
  userVersion: number;
  /** Path to pre-migration backup, if one was created */
  backupPath?: string;
}

export class MigrationRunner {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Run all pending migrations.
   * Returns a result summary; never returns partial state — throws on failure.
   */
  run(dbFilePath?: string): MigrationResult {
    // Bootstrap: create the tracking table before any migrations run.
    // This is intentionally outside the migrations system itself.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const applied = this.getAppliedVersions();
    const files = this.getMigrationFiles();
    const pending = files.filter(f => !applied.has(f.version));

    let backupPath: string | undefined;

    // Create a timestamped backup before touching anything, if there are pending migrations
    // and we know the DB file path. This ensures the previous state is always recoverable.
    if (pending.length > 0 && dbFilePath && existsSync(dbFilePath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      backupPath = `${dbFilePath}.${ts}.bak`;
      try {
        copyFileSync(dbFilePath, backupPath);
        console.log(`[migrations] Backup created: ${backupPath}`);
      } catch (err) {
        // Backup failure is a hard stop — never migrate without a safety net.
        // If the backup cannot be written (disk full, permissions, etc.) it is safer
        // to abort than to risk an unrecoverable schema change with no rollback path.
        throw new Error(
          `[migrations] Aborting: could not create pre-migration backup at ${backupPath}: ` +
          `${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    let newlyApplied = 0;

    for (const { version, name, path } of pending) {
      const sql = readFileSync(path, 'utf-8');

      // PRAGMA statements cannot run inside a transaction (SQLite restriction).
      // Split them out and run first, then wrap DDL in a transaction.
      const pragmaLines: string[] = [];
      const ddlLines: string[] = [];
      for (const line of sql.split('\n')) {
        const trimmed = line.trimStart();
        if (/^PRAGMA\s/i.test(trimmed)) {
          pragmaLines.push(line);
        } else {
          ddlLines.push(line);
        }
      }

      try {
        if (pragmaLines.length > 0) {
          this.db.exec(pragmaLines.join('\n'));
        }
        const apply = this.db.transaction(() => {
          this.db.exec(ddlLines.join('\n'));
          this.db.prepare(
            'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
          ).run(version, name, Date.now());
        });
        apply();
        newlyApplied++;
        console.log(`[migrations] Applied migration ${version}: ${name}`);
      } catch (err) {
        throw new Error(
          `[migrations] Failed to apply migration ${version} (${name}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Set PRAGMA user_version to the highest applied migration version.
    // This provides a fast O(1) schema version check without querying schema_migrations.
    const allApplied = this.getAppliedVersions();
    const userVersion = allApplied.size > 0 ? Math.max(...allApplied) : 0;
    this.db.pragma(`user_version = ${userVersion}`);

    return {
      applied: newlyApplied,
      total: files.length,
      userVersion,
      backupPath,
    };
  }

  getAppliedVersions(): Set<number> {
    try {
      const rows = this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
      return new Set(rows.map(r => r.version));
    } catch {
      return new Set();
    }
  }

  /** Read the current PRAGMA user_version without running migrations. */
  getUserVersion(): number {
    const row = this.db.pragma('user_version', { simple: true }) as number;
    return row ?? 0;
  }

  private getMigrationFiles(): { version: number; name: string; path: string }[] {
    if (!existsSync(MIGRATIONS_DIR)) return [];

    return readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .map(f => {
        const match = /^(\d+)_(.+)\.sql$/.exec(f);
        if (!match) return null;
        return {
          version: parseInt(match[1]!, 10),
          name: match[2]!,
          path: join(MIGRATIONS_DIR, f),
        };
      })
      .filter((f): f is { version: number; name: string; path: string } => f !== null)
      .sort((a, b) => a.version - b.version);
  }
}
