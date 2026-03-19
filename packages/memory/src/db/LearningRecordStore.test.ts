import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { LearningRecordStore } from './LearningRecordStore.js';
import type { NewLearningRecord } from './LearningRecordStore.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  // Create the table that the migration would create
  db.exec(`
    CREATE TABLE IF NOT EXISTS learning_records (
      id              TEXT PRIMARY KEY,
      recorded_at     INTEGER NOT NULL,
      task_type       TEXT NOT NULL,
      task_text_hash  TEXT,
      skill_id        TEXT,
      agent_id        TEXT,
      model_id        TEXT NOT NULL,
      provider_id     TEXT NOT NULL,
      recommended_model_id TEXT,
      user_accepted_recommendation INTEGER NOT NULL DEFAULT 1,
      outcome         TEXT NOT NULL,
      latency_ms      INTEGER,
      estimated_cost  REAL,
      retries         INTEGER NOT NULL DEFAULT 0,
      turn_count      INTEGER,
      was_pinned_preference INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

function makeRecord(overrides: Partial<NewLearningRecord> = {}): NewLearningRecord {
  return {
    taskType:                   'summarize',
    modelId:                    'llama3.1:8b',
    providerId:                 'ollama',
    userAcceptedRecommendation: true,
    outcome:                    'success',
    retries:                    0,
    wasPinnedPreference:        false,
    ...overrides,
  };
}

describe('LearningRecordStore', () => {
  let db: Database.Database;
  let store: LearningRecordStore;

  beforeEach(() => {
    db = makeDb();
    store = new LearningRecordStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it('writes and retrieves a record', () => {
    const id = store.record(makeRecord());
    expect(id).toBeTruthy();
    const records = store.list();
    expect(records).toHaveLength(1);
    expect(records[0]!.taskType).toBe('summarize');
    expect(records[0]!.outcome).toBe('success');
  });

  it('deduplicates records with same task_type + hash within window', () => {
    const hash = LearningRecordStore.hashText('same input');
    const rec = makeRecord({ taskTextHash: hash });
    const id1 = store.record(rec);
    const id2 = store.record(rec); // should be deduplicated
    expect(id1).toBeTruthy();
    expect(id2).toBeNull();
    expect(store.list()).toHaveLength(1);
  });

  it('allows same hash with different task types', () => {
    const hash = LearningRecordStore.hashText('input');
    store.record(makeRecord({ taskType: 'summarize', taskTextHash: hash }));
    const id2 = store.record(makeRecord({ taskType: 'code', taskTextHash: hash }));
    expect(id2).toBeTruthy();
    expect(store.list()).toHaveLength(2);
  });

  it('stats() returns correct totals', () => {
    store.record(makeRecord({ taskType: 'code' }));
    store.record(makeRecord({ taskType: 'code', taskTextHash: 'different-hash' }));
    store.record(makeRecord({ taskType: 'summarize', taskTextHash: 'another' }));
    const stats = store.stats();
    expect(stats.totalRecords).toBe(3);
    expect(stats.byTaskType['code']).toBe(2);
    expect(stats.byTaskType['summarize']).toBe(1);
  });

  it('stats() acceptance rate reflects user_accepted_recommendation', () => {
    store.record(makeRecord({ recommendedModelId: 'a', userAcceptedRecommendation: true,  taskTextHash: 'h1' }));
    store.record(makeRecord({ recommendedModelId: 'a', userAcceptedRecommendation: false, taskTextHash: 'h2' }));
    const stats = store.stats();
    expect(stats.acceptanceRate).toBeCloseTo(0.5);
  });

  it('hashText returns 8-char hex string', () => {
    const hash = LearningRecordStore.hashText('hello world');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('list() respects limit', () => {
    for (let i = 0; i < 5; i++) {
      store.record(makeRecord({ taskTextHash: `hash-${i}` }));
    }
    const results = store.list({ limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('list() filters by taskType', () => {
    store.record(makeRecord({ taskType: 'code',      taskTextHash: 'h1' }));
    store.record(makeRecord({ taskType: 'summarize', taskTextHash: 'h2' }));
    const results = store.list({ taskType: 'code' });
    expect(results).toHaveLength(1);
    expect(results[0]!.taskType).toBe('code');
  });
});
