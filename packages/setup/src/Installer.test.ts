/**
 * Tests for Installer — rollback helpers (findLatestBackup, restoreBackup).
 *
 * Uses real temp directories so file operations run against an actual FS.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Installer } from './Installer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'installer-test-'));
}

// ── findLatestBackup ──────────────────────────────────────────────────────────

describe('Installer.findLatestBackup', () => {
  it('returns undefined when no .bak files exist', () => {
    const dir = makeTmpDir();
    const installer = new Installer(dir);
    const dbPath = join(dir, 'memory.db');
    writeFileSync(dbPath, 'data');
    expect(installer.findLatestBackup(dbPath)).toBeUndefined();
  });

  it('returns the single backup when only one exists', () => {
    const dir = makeTmpDir();
    const installer = new Installer(dir);
    const dbPath = join(dir, 'memory.db');
    const bakPath = join(dir, 'memory.db.2026-03-18T12-00-00.bak');
    writeFileSync(dbPath, 'live');
    writeFileSync(bakPath, 'backup');
    expect(installer.findLatestBackup(dbPath)).toBe(bakPath);
  });

  it('returns the newest backup when multiple exist', () => {
    const dir = makeTmpDir();
    const installer = new Installer(dir);
    const dbPath = join(dir, 'memory.db');
    const older = join(dir, 'memory.db.2026-03-17T10-00-00.bak');
    const newer = join(dir, 'memory.db.2026-03-18T18-30-00.bak');
    writeFileSync(dbPath, 'live');
    writeFileSync(older, 'old-backup');
    writeFileSync(newer, 'new-backup');
    expect(installer.findLatestBackup(dbPath)).toBe(newer);
  });

  it('ignores unrelated .bak files in the same directory', () => {
    const dir = makeTmpDir();
    const installer = new Installer(dir);
    const dbPath = join(dir, 'memory.db');
    // A .bak file for a different DB should not be returned
    const unrelated = join(dir, 'other.db.2026-03-18T10-00-00.bak');
    writeFileSync(dbPath, 'live');
    writeFileSync(unrelated, 'unrelated');
    expect(installer.findLatestBackup(dbPath)).toBeUndefined();
  });
});

// ── restoreBackup ─────────────────────────────────────────────────────────────

describe('Installer.restoreBackup', () => {
  it('copies backup over the live DB file', () => {
    const dir = makeTmpDir();
    const installer = new Installer(dir);
    const dbPath = join(dir, 'memory.db');
    const bakPath = join(dir, 'memory.db.2026-03-18T12-00-00.bak');
    writeFileSync(dbPath, 'corrupted-or-new');
    writeFileSync(bakPath, 'good-backup-content');

    installer.restoreBackup(bakPath, dbPath);

    expect(readFileSync(dbPath, 'utf8')).toBe('good-backup-content');
  });

  it('throws when backup file does not exist', () => {
    const dir = makeTmpDir();
    const installer = new Installer(dir);
    const dbPath = join(dir, 'memory.db');
    const missingBak = join(dir, 'memory.db.missing.bak');
    writeFileSync(dbPath, 'live');

    expect(() => installer.restoreBackup(missingBak, dbPath)).toThrow(/not found/);
  });

  it('leaves backup file intact after restore (non-destructive)', () => {
    const dir = makeTmpDir();
    const installer = new Installer(dir);
    const dbPath = join(dir, 'memory.db');
    const bakPath = join(dir, 'memory.db.2026-03-18T12-00-00.bak');
    writeFileSync(dbPath, 'live');
    writeFileSync(bakPath, 'backup-data');

    installer.restoreBackup(bakPath, dbPath);

    // Backup still exists (copy, not move)
    expect(existsSync(bakPath)).toBe(true);
    expect(readFileSync(bakPath, 'utf8')).toBe('backup-data');
  });
});
