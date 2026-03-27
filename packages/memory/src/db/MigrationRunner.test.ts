/**
 * Tests for MigrationRunner — PRAGMA user_version and backup behaviour.
 *
 * Uses an in-memory SQLite database for all migration logic tests.
 * Backup tests use a real temp file so copyFileSync can be exercised.
 */

import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MigrationRunner } from './MigrationRunner.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function openMemoryDb(): Database.Database {
  // In-memory DB — migrations dir won't exist, so no migrations run.
  // We test migration logic by manipulating schema_migrations directly.
  return new Database(':memory:');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MigrationRunner — user_version', () => {
  it('getUserVersion returns 0 on a fresh in-memory database before run()', () => {
    const db = openMemoryDb();
    const runner = new MigrationRunner(db);
    expect(runner.getUserVersion()).toBe(0);
    db.close();
  });

  it('run() returns correct total count from real migration files', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'migration-test-'));
    const dbPath = join(tmpDir, 'test.db');
    const db = new Database(dbPath);
    const runner = new MigrationRunner(db);
    const result = runner.run(dbPath);
    // We have 8 migration files (001–008)
    expect(result.total).toBe(8);
    expect(result.applied).toBe(8);
    expect(result.userVersion).toBe(8);
    expect(runner.getUserVersion()).toBe(8);
    db.close();
  });

  it('getAppliedVersions returns all versions after a fresh run', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'migration-applied-'));
    const dbPath = join(tmpDir, 'test.db');
    const db = new Database(dbPath);
    const runner = new MigrationRunner(db);
    runner.run(dbPath);
    expect(runner.getAppliedVersions().size).toBe(8);
    db.close();
  });

  it('run() is idempotent — second call applies 0 new migrations', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'migration-idem-'));
    const dbPath = join(tmpDir, 'test.db');
    const db = new Database(dbPath);
    const runner = new MigrationRunner(db);
    runner.run(dbPath);
    const second = runner.run(dbPath);
    expect(second.applied).toBe(0);
    expect(second.userVersion).toBe(8);
    db.close();
  });

  it('user_version matches applied migration count after run', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'migration-ver-'));
    const dbPath = join(tmpDir, 'test.db');
    const db = new Database(dbPath);
    const runner = new MigrationRunner(db);
    const result = runner.run(dbPath);
    expect(runner.getUserVersion()).toBe(result.userVersion);
    expect(result.userVersion).toBe(result.total); // all 8 applied → version 8
    db.close();
  });
});

describe('MigrationRunner — pre-migration backup', () => {
  it('creates a .bak file when there are pending migrations', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'migration-bak-'));
    const dbPath = join(tmpDir, 'test.db');

    // Open the DB first so better-sqlite3 creates a valid SQLite file,
    // then run migrations. The backup is created from the real SQLite file.
    const db = new Database(dbPath);
    const runner = new MigrationRunner(db);
    const result = runner.run(dbPath);

    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath!)).toBe(true);
    expect(result.backupPath!.endsWith('.bak')).toBe(true);
    db.close();
  });

  it('does not create a backup when there are no pending migrations', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'migration-nobak-'));
    const dbPath = join(tmpDir, 'test.db');
    const db = new Database(dbPath);
    const runner = new MigrationRunner(db);

    // First run applies all migrations
    runner.run(dbPath);

    // Count .bak files before second run
    const baksBefore = readdirSync(tmpDir).filter(f => f.endsWith('.bak')).length;

    // Second run — nothing pending, no backup should be created
    const result = runner.run(dbPath);
    expect(result.backupPath).toBeUndefined();

    const baksAfter = readdirSync(tmpDir).filter(f => f.endsWith('.bak')).length;
    expect(baksAfter).toBe(baksBefore); // no new .bak created
    db.close();
  });

  it('backup filename includes a timestamp component', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'migration-ts-'));
    const dbPath = join(tmpDir, 'test.db');
    const db = new Database(dbPath);
    const runner = new MigrationRunner(db);
    const result = runner.run(dbPath);
    // Backup name: test.db.2026-03-18T18-21-22.bak (ISO-like)
    expect(result.backupPath).toMatch(/\.db\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.bak$/);
    db.close();
  });

  it('throws (hard stop) when the backup write fails', () => {
    // Strategy: spy on Date.prototype.toISOString to get a deterministic backup
    // filename, then pre-create a directory at that exact path so copyFileSync
    // throws EISDIR — exercising the hard-stop branch.
    const tmpDir = mkdtempSync(join(tmpdir(), 'migration-bak-fail-'));
    const dbPath = join(tmpDir, 'test.db');

    const fixedIso = '2026-03-18T00:00:00.000Z';
    const ts = fixedIso.replace(/[:.]/g, '-').slice(0, 19); // '2026-03-18T00-00-00'
    const expectedBak = `${dbPath}.${ts}.bak`;

    // Create a directory at the expected .bak path so copyFileSync throws EISDIR
    mkdirSync(expectedBak);

    const dateSpy = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue(fixedIso);
    const db = new Database(dbPath);
    const runner = new MigrationRunner(db);
    expect(() => runner.run(dbPath)).toThrow(/Aborting/);
    dateSpy.mockRestore();
    db.close();
  });
});
