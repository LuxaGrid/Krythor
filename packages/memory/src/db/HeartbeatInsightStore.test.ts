/**
 * Tests for HeartbeatInsightStore — persistence and retention.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { HeartbeatInsightStore } from './HeartbeatInsightStore.js';

function openDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE heartbeat_insights (
      id           TEXT PRIMARY KEY,
      recorded_at  INTEGER NOT NULL,
      check_id     TEXT NOT NULL,
      severity     TEXT NOT NULL,
      message      TEXT NOT NULL,
      actionable   INTEGER NOT NULL DEFAULT 0,
      suggested_action TEXT
    );
    CREATE INDEX idx_hb_insights_recorded_at ON heartbeat_insights(recorded_at DESC);
    CREATE INDEX idx_hb_insights_severity    ON heartbeat_insights(severity, recorded_at DESC);
  `);
  return db;
}

describe('HeartbeatInsightStore', () => {
  let db: Database.Database;
  let store: HeartbeatInsightStore;

  beforeEach(() => {
    db = openDb();
    store = new HeartbeatInsightStore(db);
  });

  it('persists warning-severity insights', () => {
    store.record({ checkId: 'memory_hygiene', severity: 'warning', message: 'DB too large', actionable: true });
    const rows = store.recent(24);
    expect(rows).toHaveLength(1);
    expect(rows[0].checkId).toBe('memory_hygiene');
    expect(rows[0].message).toBe('DB too large');
    expect(rows[0].actionable).toBe(true);
  });

  it('does NOT persist info-severity insights', () => {
    store.record({ checkId: 'task_review', severity: 'info', message: 'All good', actionable: false });
    expect(store.recent(24)).toHaveLength(0);
  });

  it('prune() removes rows older than 24 hours', () => {
    // Insert a row with old timestamp directly
    db.prepare(`
      INSERT INTO heartbeat_insights (id, recorded_at, check_id, severity, message, actionable)
      VALUES ('old-1', @ts, 'memory_hygiene', 'warning', 'old warning', 0)
    `).run({ ts: Date.now() - 25 * 60 * 60 * 1000 }); // 25 hours ago

    store.record({ checkId: 'memory_hygiene', severity: 'warning', message: 'fresh warning', actionable: false });

    const pruned = store.prune();
    expect(pruned).toBeGreaterThanOrEqual(1);
    const remaining = store.recent(24);
    expect(remaining.every(r => r.message !== 'old warning')).toBe(true);
  });

  it('prune() enforces 500-row ceiling', () => {
    // Insert 510 rows
    const insert = db.prepare(`
      INSERT INTO heartbeat_insights (id, recorded_at, check_id, severity, message, actionable)
      VALUES (@id, @ts, 'check', 'warning', 'msg', 0)
    `);
    for (let i = 0; i < 510; i++) {
      insert.run({ id: `row-${i}`, ts: Date.now() - i * 1000 });
    }
    store.prune();
    expect(store.count()).toBeLessThanOrEqual(500);
  });

  it('count() returns number of warning rows', () => {
    expect(store.count()).toBe(0);
    store.record({ checkId: 'test', severity: 'warning', message: 'w1', actionable: false });
    store.record({ checkId: 'test', severity: 'warning', message: 'w2', actionable: false });
    expect(store.count()).toBe(2);
  });

  it('warnings survive simulated restart (DB is source of truth)', () => {
    store.record({ checkId: 'config_integrity', severity: 'warning', message: 'Config invalid', actionable: true, suggestedAction: 'fix_config' });

    // Simulate restart: create a new store instance over the same DB
    const store2 = new HeartbeatInsightStore(db);
    const warnings = store2.recent(24);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].suggestedAction).toBe('fix_config');
  });
});
