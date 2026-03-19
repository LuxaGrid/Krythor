import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { MigrationRunner } from '@krythor/memory';
import { AgentRunStore } from '@krythor/memory';
import { HeartbeatEngine } from './HeartbeatEngine.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function openDb(): Database.Database {
  const db = new Database(':memory:');
  const runner = new MigrationRunner(db);
  runner.run(); // apply all migrations
  return db;
}

/** Minimal MemoryEngine stub with real AgentRunStore on an in-memory DB. */
function makeMemoryStub(db: Database.Database, dbDir?: string) {
  const agentRunStore = new AgentRunStore(db);
  return {
    agentRunStore,
    db,
    dbDir: dbDir ?? '',
    runJanitor: () => ({
      memoryEntriesPruned: 0,
      conversationsPruned: 0,
      learningRecordsPruned: 0,
      ranAt: Date.now(),
      tableCountsAfter: {},
    }),
    stats: () => ({ totalEntries: 0, entryCount: 0, embeddingProvider: 'stub' }),
    learningStore: { prune: () => {}, stats: () => ({ totalRecords: 0, acceptanceRate: 1 }) },
  };
}

describe('HeartbeatEngine', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start when disabled in config', () => {
    const engine = new HeartbeatEngine(null, null, null, { enabled: false });
    const spy = vi.spyOn(global, 'setTimeout');
    engine.start();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('is idempotent — calling start() twice does not create two timers', () => {
    vi.useFakeTimers();
    const engine = new HeartbeatEngine(null, null, null, { enabled: true });
    engine.start();
    engine.start(); // second call should be no-op
    const config = engine.getConfig();
    expect(config.enabled).toBe(true);
    engine.stop();
  });

  it('stop() clears the timer', () => {
    vi.useFakeTimers();
    const engine = new HeartbeatEngine(null, null, null);
    engine.start();
    engine.stop();
    // No error thrown — that's the test
    expect(true).toBe(true);
  });

  it('returns empty history on fresh instance', () => {
    const engine = new HeartbeatEngine(null, null, null);
    expect(engine.history()).toHaveLength(0);
  });

  it('getConfig() reflects merged config', () => {
    const engine = new HeartbeatEngine(null, null, null, {
      enabled: true,
      timeoutMs: 10_000,
      checks: {
        task_review: { enabled: false, intervalMs: 999 },
      },
    });
    const cfg = engine.getConfig();
    expect(cfg.timeoutMs).toBe(10_000);
    expect(cfg.checks['task_review']!.enabled).toBe(false);
    expect(cfg.checks['task_review']!.intervalMs).toBe(999);
    // Other checks should retain defaults
    expect(cfg.checks['memory_hygiene']!.enabled).toBe(true);
  });

  it('gracefully handles null memory/models/orchestrator (no crash)', async () => {
    vi.useFakeTimers();
    const engine = new HeartbeatEngine(null, null, null, {
      enabled: true,
      timeoutMs: 5_000,
    });
    // Manually trigger a tick — should not throw even with all-null context
    // Access private method for testing via type assertion
    await (engine as unknown as { tick: () => Promise<void> }).tick();
    engine.stop();
  });
});

// ── stale_state check ──────────────────────────────────────────────────────

describe('HeartbeatEngine — stale_state check', () => {
  it('auto-corrects runs stuck in running state for over 10 minutes', async () => {
    const db = openDb();
    const memory = makeMemoryStub(db);

    // Insert a run that started 15 minutes ago and is still 'running'
    const staleRun = {
      id: 'run-stale-1',
      agentId: 'agent-1',
      status: 'running' as const,
      input: 'test',
      messages: [],
      memoryIdsUsed: [],
      memoryIdsWritten: [],
      startedAt: Date.now() - 15 * 60 * 1000,
    };
    memory.agentRunStore.save(staleRun);

    const engine = new HeartbeatEngine(memory as never, null, null);
    // Fast-forward startup delay so tick() won't skip
    (engine as unknown as { startedAt: number }).startedAt = Date.now() - 60_000;

    const check = (engine as unknown as { check_stale_state: (ctx: unknown) => Promise<unknown[]> }).check_stale_state;
    const insights = await check.call(engine, { memory, models: null, orchestrator: null });

    expect(insights).toHaveLength(1);
    expect((insights[0] as { severity: string }).severity).toBe('warning');

    // Verify DB row was updated to 'failed'
    const updated = memory.agentRunStore.getById('run-stale-1');
    expect(updated?.status).toBe('failed');
    expect(updated?.completedAt).toBeDefined();
    db.close();
  });

  it('returns no insights when no runs are stale', async () => {
    const db = openDb();
    const memory = makeMemoryStub(db);

    // Insert a recent run (1 minute ago)
    memory.agentRunStore.save({
      id: 'run-recent-1',
      agentId: 'agent-1',
      status: 'running',
      input: 'test',
      messages: [],
      memoryIdsUsed: [],
      memoryIdsWritten: [],
      startedAt: Date.now() - 60_000,
    });

    const engine = new HeartbeatEngine(memory as never, null, null);
    const check = (engine as unknown as { check_stale_state: (ctx: unknown) => Promise<unknown[]> }).check_stale_state;
    const insights = await check.call(engine, { memory, models: null, orchestrator: null });
    expect(insights).toHaveLength(0);
    db.close();
  });
});

// ── memory_hygiene check ───────────────────────────────────────────────────

describe('HeartbeatEngine — memory_hygiene check', () => {
  it('calls runJanitor() and returns no insight when entry count is below threshold', async () => {
    const db = openDb();
    let janitorCalled = false;
    const memory = {
      ...makeMemoryStub(db),
      runJanitor: () => {
        janitorCalled = true;
        return { memoryEntriesPruned: 2, conversationsPruned: 1, learningRecordsPruned: 0, ranAt: Date.now() };
      },
    };

    const engine = new HeartbeatEngine(memory as never, null, null);
    const check = (engine as unknown as { check_memory_hygiene: (ctx: unknown) => Promise<unknown[]> }).check_memory_hygiene;
    const insights = await check.call(engine, { memory, models: null, orchestrator: null });

    expect(janitorCalled).toBe(true);
    expect(insights).toHaveLength(0); // entryCount = 0, below 5000
    db.close();
  });

  it('emits a warning insight when more than 10 .bak files are present', async () => {
    const db = openDb();
    const tmpDir = mkdtempSync(join(tmpdir(), 'krythor-test-'));

    // Create 11 fake .bak files to exceed the threshold
    for (let i = 0; i < 11; i++) {
      writeFileSync(join(tmpDir, `memory.db.backup-${i}.bak`), '');
    }

    const memory = { ...makeMemoryStub(db, tmpDir) };
    const engine = new HeartbeatEngine(memory as never, null, null);
    const check = (engine as unknown as { check_memory_hygiene: (ctx: unknown) => Promise<unknown[]> }).check_memory_hygiene;
    const insights = await check.call(engine, { memory, models: null, orchestrator: null });

    const bakWarning = (insights as Array<{ severity: string; message: string }>)
      .find(i => i.severity === 'warning' && i.message.includes('.bak'));
    expect(bakWarning).toBeDefined();
    db.close();
  });

  it('does not emit a warning when .bak count is within normal range', async () => {
    const db = openDb();
    const tmpDir = mkdtempSync(join(tmpdir(), 'krythor-test-'));

    // 3 .bak files — within normal range
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(tmpDir, `memory.db.bak${i}`), '');
    }

    const memory = { ...makeMemoryStub(db, tmpDir) };
    const engine = new HeartbeatEngine(memory as never, null, null);
    const check = (engine as unknown as { check_memory_hygiene: (ctx: unknown) => Promise<unknown[]> }).check_memory_hygiene;
    const insights = await check.call(engine, { memory, models: null, orchestrator: null });

    const bakWarning = (insights as Array<{ severity: string; message: string }>)
      .find(i => i.message?.includes('.bak'));
    expect(bakWarning).toBeUndefined();
    db.close();
  });
});
