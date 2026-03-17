import type Database from 'better-sqlite3';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

// ─── MigrationRunner ──────────────────────────────────────────────────────────
//
// Applies numbered SQL migration files in order.
// Tracks applied migrations in the schema_migrations table.
//
// Migration files must be named NNN_description.sql (e.g. 001_initial.sql).
// Each file is applied in a single transaction. Failures halt migration and
// throw — the server will not start with a partially migrated database.
//

const MIGRATIONS_DIR = join(__dirname, 'migrations');

export class MigrationRunner {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  run(): void {
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

    for (const { version, name, path } of files) {
      if (applied.has(version)) continue;

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
        // PRAGMAs run outside the transaction
        if (pragmaLines.length > 0) {
          this.db.exec(pragmaLines.join('\n'));
        }
        // DDL + migration record in a single transaction
        const apply = this.db.transaction(() => {
          this.db.exec(ddlLines.join('\n'));
          this.db.prepare(
            'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
          ).run(version, name, Date.now());
        });
        apply();
        console.log(`[migrations] Applied migration ${version}: ${name}`);
      } catch (err) {
        throw new Error(
          `[migrations] Failed to apply migration ${version} (${name}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  getAppliedVersions(): Set<number> {
    try {
      const rows = this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
      return new Set(rows.map(r => r.version));
    } catch {
      return new Set();
    }
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
