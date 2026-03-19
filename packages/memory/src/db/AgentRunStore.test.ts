/**
 * Tests for AgentRunStore — persistence and orphan recovery.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { MigrationRunner } from './MigrationRunner.js';
import { AgentRunStore } from './AgentRunStore.js';
import type { PersistedRun } from './AgentRunStore.js';

function openDb(): Database.Database {
  const db = new Database(':memory:');
  new MigrationRunner(db).run();
  return db;
}

function makeRun(overrides: Partial<PersistedRun> = {}): PersistedRun {
  return {
    id:               randomUUID(),
    agentId:          'agent-1',
    status:           'running',
    input:            'test input',
    startedAt:        Date.now(),
    messages:         [],
    memoryIdsUsed:    [],
    memoryIdsWritten: [],
    ...overrides,
  };
}

describe('AgentRunStore — resolveOrphanedRuns', () => {
  it('marks all running rows as failed and returns count', () => {
    const db = openDb();
    const store = new AgentRunStore(db);

    store.save(makeRun({ id: 'run-1', status: 'running' }));
    store.save(makeRun({ id: 'run-2', status: 'running' }));
    store.save(makeRun({ id: 'run-3', status: 'completed', completedAt: Date.now() }));

    const resolved = store.resolveOrphanedRuns();

    expect(resolved).toBe(2);
    expect(store.getById('run-1')?.status).toBe('failed');
    expect(store.getById('run-2')?.status).toBe('failed');
    expect(store.getById('run-3')?.status).toBe('completed'); // untouched
    db.close();
  });

  it('sets completed_at and a default error message on resolved rows', () => {
    const db = openDb();
    const store = new AgentRunStore(db);

    const before = Date.now();
    store.save(makeRun({ id: 'run-1', status: 'running' }));
    store.resolveOrphanedRuns();
    const after = Date.now();

    const run = store.getById('run-1')!;
    expect(run.completedAt).toBeGreaterThanOrEqual(before);
    expect(run.completedAt).toBeLessThanOrEqual(after);
    expect(run.errorMessage).toMatch(/restart/i);
    db.close();
  });

  it('accepts a custom error message', () => {
    const db = openDb();
    const store = new AgentRunStore(db);

    store.save(makeRun({ id: 'run-1', status: 'running' }));
    store.resolveOrphanedRuns('Custom shutdown message.');

    expect(store.getById('run-1')?.errorMessage).toBe('Custom shutdown message.');
    db.close();
  });

  it('returns 0 when there are no running rows', () => {
    const db = openDb();
    const store = new AgentRunStore(db);

    store.save(makeRun({ id: 'run-1', status: 'completed', completedAt: Date.now() }));
    store.save(makeRun({ id: 'run-2', status: 'failed', completedAt: Date.now() }));

    expect(store.resolveOrphanedRuns()).toBe(0);
    db.close();
  });

  it('is idempotent — second call returns 0', () => {
    const db = openDb();
    const store = new AgentRunStore(db);

    store.save(makeRun({ id: 'run-1', status: 'running' }));
    store.resolveOrphanedRuns();
    expect(store.resolveOrphanedRuns()).toBe(0); // no running rows remain
    db.close();
  });
});
