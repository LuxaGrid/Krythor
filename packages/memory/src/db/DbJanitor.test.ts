/**
 * Tests for DbJanitor — retention and pruning rules.
 *
 * Uses in-memory SQLite databases with the full applied schema so all tables
 * exist. Inserts test data with manipulated timestamps to trigger pruning.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { MigrationRunner } from './MigrationRunner.js';
import { DbJanitor } from './DbJanitor.js';

function openDb(): Database.Database {
  const db = new Database(':memory:');
  const runner = new MigrationRunner(db);
  runner.run(); // apply all 3 migrations
  return db;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const OLD = NOW - 100 * DAY_MS; // 100 days ago — exceeds all 90-day rules
const RECENT = NOW - 10 * DAY_MS; // 10 days ago — within all retention windows

// ── Helpers ───────────────────────────────────────────────────────────────────

function insertMemoryEntry(db: Database.Database, opts: { importance: number; pinned: number; last_used: number }): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO memory_entries (id, title, content, scope, source, importance, pinned, created_at, last_used, access_count)
    VALUES (?, 'Test', 'content', 'agent', 'test', ?, ?, ?, ?, 0)
  `).run(id, opts.importance, opts.pinned, opts.last_used, opts.last_used);
  return id;
}

function insertConversation(db: Database.Database, updated_at: number): string {
  const id = randomUUID();
  db.prepare(`INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, 'Test', ?, ?)`)
    .run(id, updated_at, updated_at);
  return id;
}

function insertLearningRecord(db: Database.Database, recorded_at: number): string {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO learning_records (id, recorded_at, task_type, model_id, provider_id, outcome)
    VALUES (?, ?, 'code', 'gpt-4', 'openai', 'success')
  `).run(id, recorded_at);
  return id;
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;
}

// ── memory_entries ─────────────────────────────────────────────────────────────

describe('DbJanitor — memory_entries', () => {
  it('prunes old low-importance unpinned entries', () => {
    const db = openDb();
    const janitor = new DbJanitor(db);

    // Should be pruned: old, low importance, not pinned
    insertMemoryEntry(db, { importance: 0.1, pinned: 0, last_used: OLD });

    // Should survive: old but pinned
    insertMemoryEntry(db, { importance: 0.1, pinned: 1, last_used: OLD });

    // Should survive: old but importance >= 0.2
    insertMemoryEntry(db, { importance: 0.5, pinned: 0, last_used: OLD });

    // Should survive: low importance but recent
    insertMemoryEntry(db, { importance: 0.1, pinned: 0, last_used: RECENT });

    expect(count(db, 'memory_entries')).toBe(4);
    const result = janitor.run();
    expect(result.memoryEntriesPruned).toBe(1);
    expect(count(db, 'memory_entries')).toBe(3);
    db.close();
  });

  it('never prunes pinned entries regardless of age or importance', () => {
    const db = openDb();
    const janitor = new DbJanitor(db);
    insertMemoryEntry(db, { importance: 0.0, pinned: 1, last_used: OLD });
    const result = janitor.run();
    expect(result.memoryEntriesPruned).toBe(0);
    expect(count(db, 'memory_entries')).toBe(1);
    db.close();
  });
});

// ── conversations ─────────────────────────────────────────────────────────────

describe('DbJanitor — conversations', () => {
  it('prunes conversations older than 90 days', () => {
    const db = openDb();
    const janitor = new DbJanitor(db);

    insertConversation(db, OLD);    // should be pruned
    insertConversation(db, RECENT); // should survive

    const result = janitor.run();
    expect(result.conversationsPruned).toBe(1);
    expect(count(db, 'conversations')).toBe(1);
    db.close();
  });

  it('cascades to messages when conversation is pruned', () => {
    const db = openDb();
    const janitor = new DbJanitor(db);

    const convId = insertConversation(db, OLD);
    // Insert a message for this conversation
    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, created_at)
      VALUES (?, ?, 'user', 'hello', ?)
    `).run(randomUUID(), convId, OLD);

    expect(count(db, 'messages')).toBe(1);
    janitor.run();
    expect(count(db, 'messages')).toBe(0); // CASCADE delete
    db.close();
  });
});

// ── learning_records ──────────────────────────────────────────────────────────

describe('DbJanitor — learning_records', () => {
  it('prunes learning records older than 90 days', () => {
    const db = openDb();
    const janitor = new DbJanitor(db);

    insertLearningRecord(db, OLD);    // should be pruned
    insertLearningRecord(db, RECENT); // should survive

    const result = janitor.run();
    expect(result.learningRecordsPruned).toBe(1);
    expect(count(db, 'learning_records')).toBe(1);
    db.close();
  });

  it('returns zero pruned when all records are recent', () => {
    const db = openDb();
    const janitor = new DbJanitor(db);
    insertLearningRecord(db, RECENT);
    insertLearningRecord(db, RECENT);
    const result = janitor.run();
    expect(result.learningRecordsPruned).toBe(0);
    db.close();
  });
});

// ── tableCounts ───────────────────────────────────────────────────────────────

describe('DbJanitor — tableCounts', () => {
  it('returns counts for all major tables', () => {
    const db = openDb();
    const janitor = new DbJanitor(db);
    insertMemoryEntry(db, { importance: 0.5, pinned: 0, last_used: RECENT });
    insertConversation(db, RECENT);

    const counts = janitor.tableCounts();
    expect(counts['memory_entries']).toBe(1);
    expect(counts['conversations']).toBe(1);
    expect(typeof counts['agent_runs']).toBe('number');
    expect(typeof counts['guard_decisions']).toBe('number');
    expect(typeof counts['learning_records']).toBe('number');
    db.close();
  });
});

// ── run() result shape ────────────────────────────────────────────────────────

describe('DbJanitor — run() result', () => {
  it('returns a result with ranAt timestamp', () => {
    const db = openDb();
    const janitor = new DbJanitor(db);
    const before = Date.now();
    const result = janitor.run();
    const after = Date.now();
    expect(result.ranAt).toBeGreaterThanOrEqual(before);
    expect(result.ranAt).toBeLessThanOrEqual(after);
    db.close();
  });

  it('returns zero for all counts when database is empty', () => {
    const db = openDb();
    const janitor = new DbJanitor(db);
    const result = janitor.run();
    expect(result.memoryEntriesPruned).toBe(0);
    expect(result.conversationsPruned).toBe(0);
    expect(result.learningRecordsPruned).toBe(0);
    db.close();
  });

  it('populates tableCountsAfter with counts for all major tables', () => {
    const db = openDb();
    const janitor = new DbJanitor(db);
    insertMemoryEntry(db, { importance: 0.5, pinned: 0, last_used: RECENT });
    insertConversation(db, RECENT);
    insertLearningRecord(db, RECENT);

    const result = janitor.run();

    expect(typeof result.tableCountsAfter['memory_entries']).toBe('number');
    expect(typeof result.tableCountsAfter['conversations']).toBe('number');
    expect(typeof result.tableCountsAfter['learning_records']).toBe('number');
    expect(typeof result.tableCountsAfter['agent_runs']).toBe('number');
    expect(typeof result.tableCountsAfter['guard_decisions']).toBe('number');
    expect(result.tableCountsAfter['memory_entries']).toBeGreaterThanOrEqual(1);
    expect(result.tableCountsAfter['conversations']).toBeGreaterThanOrEqual(1);
    expect(result.tableCountsAfter['learning_records']).toBeGreaterThanOrEqual(1);
    db.close();
  });

  it('routes errors through injected logFn', () => {
    const db = openDb();
    const logged: Array<{ level: string; message: string }> = [];
    const logFn = (level: 'info' | 'warn' | 'error', message: string) => {
      logged.push({ level, message });
    };
    // Close DB before running to force errors in all prune calls
    db.close();
    const janitor = new DbJanitor(db, logFn);
    const result = janitor.run();
    // All three prune calls should fail and be logged as errors
    expect(logged.filter(l => l.level === 'error').length).toBeGreaterThanOrEqual(1);
    // Result should still be returned (errors are non-fatal)
    expect(typeof result.ranAt).toBe('number');
  });
});
