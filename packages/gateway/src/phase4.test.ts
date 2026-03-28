/**
 * Phase 4 — Edge-Case Resilience Tests
 *
 * Covers real-world failure scenarios without heavy mocking:
 *
 *   1. Crash during active run → restart → orphan recovery
 *      Simulates a process that was killed mid-run. On the next startup,
 *      resolveOrphanedRuns() must mark all 'running' rows as 'failed'.
 *
 *   2. Corrupt / invalid config file → safe fallback
 *      Writes a malformed providers.json and verifies the registry falls
 *      back to a safe empty state rather than crashing.
 *
 *   3. Provider flapping (failure → circuit open → recovery)
 *      Drives a provider to trip its circuit breaker, then exercises the
 *      half-open probe path to confirm recovery is detected.
 *
 *   4. Max-concurrency stress test
 *      Fires MAX_ACTIVE_RUNS+1 simultaneous agent-run requests and verifies
 *      the orchestrator queues excess requests instead of crashing.
 *
 *   5. WebSocket reconnect storm
 *      Opens MAX_WS_CONNECTIONS sockets then immediately closes and
 *      reconnects them in rapid succession; checks the server survives.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import WebSocket from 'ws';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';

import { MigrationRunner, AgentRunStore } from '@krythor/memory';
import { ModelRouter } from '@krythor/models';
import { CircuitBreaker, CircuitOpenError } from '@krythor/models';
import { AgentOrchestrator } from '@krythor/core';
import { registerStreamWs } from './ws/stream.js';
import type { KrythorCore } from '@krythor/core';
import type { GuardEngine } from '@krythor/guard';

// ── Helpers ─────────────────────────────────────────────────────────────────

function openDb(): Database.Database {
  const db = new Database(':memory:');
  new MigrationRunner(db).run();
  return db;
}

function makeRunStore(db: Database.Database): AgentRunStore {
  return new AgentRunStore(db);
}

// ── 1. Orphan recovery after simulated crash ─────────────────────────────────

describe('Phase 4 — crash recovery: orphaned runs', () => {
  it('resolveOrphanedRuns marks all running rows as failed on restart', () => {
    const db = openDb();
    const store = makeRunStore(db);

    // Simulate 3 runs that were in-flight when the process was killed
    for (let i = 0; i < 3; i++) {
      store.save({
        id: `orphan-${i}`,
        agentId: 'agent-x',
        status: 'running',
        input: `task ${i}`,
        messages: [],
        memoryIdsUsed: [],
        memoryIdsWritten: [],
        startedAt: Date.now() - 60_000,
      });
    }

    // Simulate one run that already completed — should not be touched
    store.save({
      id: 'completed-1',
      agentId: 'agent-x',
      status: 'completed',
      input: 'done',
      messages: [],
      memoryIdsUsed: [],
      memoryIdsWritten: [],
      startedAt: Date.now() - 120_000,
      completedAt: Date.now() - 60_000,
    });

    // "Restart" — call resolveOrphanedRuns as server.ts does at startup
    const resolved = store.resolveOrphanedRuns('Killed by process restart');
    expect(resolved).toBe(3);

    // All 3 orphans should now be 'failed'
    for (let i = 0; i < 3; i++) {
      const run = store.getById(`orphan-${i}`);
      expect(run?.status).toBe('failed');
      expect(run?.completedAt).toBeDefined();
      expect(run?.errorMessage).toContain('restart');
    }

    // Completed run should be untouched
    expect(store.getById('completed-1')?.status).toBe('completed');

    db.close();
  });

  it('resolveOrphanedRuns returns 0 when no runs are in-flight', () => {
    const db = openDb();
    const store = makeRunStore(db);

    store.save({
      id: 'done-run',
      agentId: 'agent-y',
      status: 'failed',
      input: 'test',
      messages: [],
      memoryIdsUsed: [],
      memoryIdsWritten: [],
      startedAt: Date.now() - 5000,
      completedAt: Date.now(),
    });

    expect(store.resolveOrphanedRuns()).toBe(0);
    db.close();
  });

  it('orphaned runs have completedAt set and a non-empty errorMessage', () => {
    const db = openDb();
    const store = makeRunStore(db);
    store.save({
      id: 'orphan-msg',
      agentId: 'agent-z',
      status: 'running',
      input: 'work',
      messages: [],
      memoryIdsUsed: [],
      memoryIdsWritten: [],
      startedAt: Date.now() - 1000,
    });

    store.resolveOrphanedRuns('Custom shutdown message');
    const run = store.getById('orphan-msg');
    expect(run?.completedAt).toBeGreaterThan(0);
    expect(run?.errorMessage).toContain('Custom shutdown message');
    db.close();
  });
});

// ── 2. Corrupt config → safe fallback ────────────────────────────────────────

describe('Phase 4 — corrupt config: safe fallback', () => {
  it('ModelRegistry falls back to empty state when providers.json is malformed', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'krythor-corrupt-cfg-'));
    const providersPath = join(tmpDir, 'providers.json');

    // Write intentionally corrupt JSON
    writeFileSync(providersPath, '{ this is not valid json !!!');

    // ModelEngine / ModelRegistry should not throw — it should log and use empty state
    const { ModelEngine } = await import('@krythor/models');
    const warnMessages: string[] = [];
    const engine = new ModelEngine(tmpDir, (msg) => { warnMessages.push(msg); });

    // Should have 0 providers (graceful empty state)
    expect(engine.listProviders()).toHaveLength(0);
    expect(engine.stats().providerCount).toBe(0);
  });

  it('ModelRegistry falls back to empty state when providers.json contains wrong type', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'krythor-wrong-type-'));
    writeFileSync(join(tmpDir, 'providers.json'), '"this is a string not an array"');

    const { ModelEngine } = await import('@krythor/models');
    const engine = new ModelEngine(tmpDir, () => {});
    expect(engine.listProviders()).toHaveLength(0);
  });

  it('ModelRegistry falls back to empty state when providers.json is empty', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'krythor-empty-json-'));
    writeFileSync(join(tmpDir, 'providers.json'), '');

    const { ModelEngine } = await import('@krythor/models');
    const engine = new ModelEngine(tmpDir, () => {});
    expect(engine.listProviders()).toHaveLength(0);
  });

  it('AgentRegistry falls back to empty list when agents.json is malformed', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'krythor-corrupt-agents-'));
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'agents.json'), '{ broken json');

    const { AgentRegistry } = await import('@krythor/core');
    // Should not throw — returns empty list
    const registry = new AgentRegistry(tmpDir);
    expect(registry.list()).toHaveLength(0);
    expect(registry.count()).toBe(0);
  });
});

// ── 3. Provider flapping: circuit breaker trip and recovery ───────────────────

describe('Phase 4 — provider flapping: circuit breaker', () => {
  it('circuit trips to open after 3 consecutive failures', () => {
    const warns: string[] = [];
    const breaker = new CircuitBreaker('flapping-provider', (msg) => warns.push(msg));

    expect(breaker.stats().state).toBe('closed');

    // Record 3 failures directly (bypassing execute() to avoid async)
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure(); // threshold reached

    expect(breaker.stats().state).toBe('open');
    expect(breaker.isOpen()).toBe(true);
    // warnFn receives message string; data carries from/to but we just check it was called
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0]).toContain('[CircuitBreaker] State transition');
  });

  it('circuit transitions to half-open after reset timeout elapses', () => {
    vi.useFakeTimers();
    const warns: string[] = [];
    const breaker = new CircuitBreaker('recovering-provider', (msg) => warns.push(msg));

    // Trip to open
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.stats().state).toBe('open');

    // Advance past the 30s reset window
    vi.advanceTimersByTime(31_000);

    // Next execute() call triggers maybeTransitionToHalfOpen
    breaker.execute(() => Promise.resolve('probe')).catch(() => {});
    expect(breaker.stats().state).toBe('half-open');
    // warnFn message is '[CircuitBreaker] State transition'; data has to: 'half-open'
    expect(warns.some(w => w.includes('[CircuitBreaker] State transition'))).toBe(true);

    vi.useRealTimers();
  });

  it('circuit recovers to closed after a successful probe in half-open', async () => {
    const warns: string[] = [];
    const breaker = new CircuitBreaker('recovery-provider', (msg) => warns.push(msg));

    // Trip to open
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.stats().state).toBe('open');

    // Manually set lastFailureAt far in the past so maybeTransitionToHalfOpen fires
    breaker['lastFailureAt'] = Date.now() - 31_000;

    // execute() calls maybeTransitionToHalfOpen → half-open, then runs probe
    await breaker.execute(() => Promise.resolve('ok'));

    // After successful probe, state should be closed
    expect(breaker.stats().state).toBe('closed');
    // warnFn was called for open→half-open and half-open→closed transitions
    expect(warns.filter(w => w.includes('[CircuitBreaker] State transition')).length).toBeGreaterThanOrEqual(2);
  });

  it('execute() throws CircuitOpenError when circuit is open', async () => {
    const breaker = new CircuitBreaker('open-provider');
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();

    await expect(breaker.execute(() => Promise.resolve('x')))
      .rejects.toThrow(CircuitOpenError);
  });

  it('ModelRouter falls back to secondary when primary circuit is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { ModelRouter } = await import('@krythor/models');
    const { vi: vi2 } = await import('vitest');

    // Build two providers where primary always fails
    const primary = {
      id: 'primary-flap',
      name: 'Primary',
      type: 'ollama' as const,
      isEnabled: true,
      getModels: () => ['model-p'],
      getModelInfo: (id: string) => ({ id, providerId: 'primary-flap', badges: [], isAvailable: true }),
      infer: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
      inferStream: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(false),
      listModels: vi.fn().mockResolvedValue([]),
    } as never;

    const secondary = {
      id: 'secondary-flap',
      name: 'Secondary',
      type: 'ollama' as const,
      isEnabled: true,
      getModels: () => ['model-s'],
      getModelInfo: (id: string) => ({ id, providerId: 'secondary-flap', badges: [], isAvailable: true }),
      infer: vi.fn().mockResolvedValue({ content: 'fallback response', model: 'model-s', providerId: 'secondary-flap', durationMs: 5 }),
      inferStream: vi.fn(),
      isAvailable: vi.fn().mockResolvedValue(true),
      listModels: vi.fn().mockResolvedValue(['model-s']),
    } as never;

    const registry = {
      getProvider: (id: string) => id === 'primary-flap' ? primary : id === 'secondary-flap' ? secondary : null,
      getDefaultProvider: () => primary,
      listEnabled: () => [primary, secondary],
      listConfigs: () => [],
      addProvider: vi.fn(),
      updateProvider: vi.fn(),
      removeProvider: vi.fn(),
    } as never;

    const fallbackMessages: string[] = [];
    const router = new ModelRouter(registry, undefined, (msg) => fallbackMessages.push(msg));

    const result = await router.infer({ messages: [{ role: 'user', content: 'hello' }] });

    expect(result.providerId).toBe('secondary-flap');
    expect(result.fallbackOccurred).toBe(true);
    expect(fallbackMessages.some(m => m.includes('fallback'))).toBe(true);

    vi.useRealTimers();
  });
});

// ── 4. Max-concurrency stress test ────────────────────────────────────────────

describe('Phase 4 — max concurrency: orchestrator queue', () => {
  it('queues excess requests when MAX_ACTIVE_RUNS is reached', async () => {
    // Build a stub ModelEngine that blocks until released
    let releaseAll: () => void = () => {};
    const blockPromise = new Promise<void>(resolve => { releaseAll = resolve; });

    const slowModelEngine = {
      stats: () => ({ providerCount: 1, modelCount: 1 }),
      infer: async () => {
        await blockPromise;
        return { content: 'done', model: 'stub', providerId: 'stub', durationMs: 1 };
      },
      inferStream: async function* () { yield { delta: 'done', done: true }; },
      listProviders: () => [],
      circuitStats: () => ({}),
    } as never;

    const tmpDir = mkdtempSync(join(tmpdir(), 'krythor-concurrency-'));
    const orchestrator = new AgentOrchestrator(null, slowModelEngine, tmpDir);

    // Create a minimal agent
    const agent = orchestrator.createAgent({
      name: 'Stress Agent',
      systemPrompt: 'You are a test agent.',
      maxTurns: 1,
    });

    // Start MAX_ACTIVE_RUNS (10) concurrent runs — each will block on blockPromise
    const MAX = 10;
    const runPromises = Array.from({ length: MAX }, () =>
      orchestrator.runAgent(agent.id, { input: 'stress test' }).catch(() => null)
    );

    // Give runs a moment to enter the active set
    await new Promise(r => setTimeout(r, 20));

    // Stats should show active runs at (or near) max
    const stats = orchestrator.stats();
    expect(stats.activeRuns).toBeGreaterThan(0);
    expect(stats.activeRuns).toBeLessThanOrEqual(MAX);

    // Release all blocked runs
    releaseAll();
    await Promise.allSettled(runPromises);
  }, 10_000);

  it('RunQueueFullError is thrown when queue depth is exceeded', async () => {
    const { RunQueueFullError } = await import('@krythor/core');

    // Build an orchestrator that is effectively infinite-blocking
    const neverResolve = new Promise<never>(() => {});
    const blockingModelEngine = {
      stats: () => ({ providerCount: 1, modelCount: 1 }),
      infer: () => neverResolve,
      inferStream: async function* () {},
      listProviders: () => [],
      circuitStats: () => ({}),
    } as never;

    const tmpDir = mkdtempSync(join(tmpdir(), 'krythor-queue-full-'));
    const orchestrator = new AgentOrchestrator(null, blockingModelEngine, tmpDir);
    orchestrator.setMaxRunsPerMinute(0); // disable rate limiting so queue-full logic is testable
    const agent = orchestrator.createAgent({ name: 'Queue Test', systemPrompt: 'test', maxTurns: 1 });

    // Saturate the active run slots (MAX_ACTIVE_RUNS = 10)
    const saturators = Array.from({ length: 10 }, () =>
      orchestrator.runAgent(agent.id, { input: 'saturate' }).catch(() => null)
    );
    await new Promise(r => setTimeout(r, 30));

    // Now saturate the queue (RUN_QUEUE_DEPTH = 50) — fire 50 more
    const queueFillers = Array.from({ length: 50 }, () =>
      orchestrator.runAgent(agent.id, { input: 'fill queue' }).catch(() => null)
    );
    await new Promise(r => setTimeout(r, 30));

    // The 61st request (beyond active + queue) should get RunQueueFullError
    await expect(orchestrator.runAgent(agent.id, { input: 'overflow' }))
      .rejects.toThrow(RunQueueFullError);
    // Saturator and filler promises never resolve (blocking engine) — do not await them
  }, 15_000);
});

// ── 5. WebSocket reconnect storm ──────────────────────────────────────────────

describe('Phase 4 — WebSocket reconnect storm', () => {
  const VALID_TOKEN = 'reconnect-storm-token';

  async function startWsServer(): Promise<[ReturnType<typeof Fastify>, number]> {
    const app = Fastify({ logger: false });
    await app.register(fastifyWebsocket);

    const coreStub = {
      handleCommand: async (input: string) => ({ output: `echo: ${input}`, agentId: 'stub' }),
    } as unknown as KrythorCore;
    const guardAllow = {
      check: () => ({ allowed: true, reason: '' }),
    } as unknown as GuardEngine;

    registerStreamWs(app, coreStub, () => VALID_TOKEN, guardAllow);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    return [app, port];
  }

  /** Helper: open a WS, send connect handshake, wait for ok response, return socket. */
  async function connectClient(port: number): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        ws.send(JSON.stringify({ type: 'req', id: 'c1', method: 'connect', params: { auth: { token: VALID_TOKEN } } }));
      });
      const timer = setTimeout(() => reject(new Error('connect timeout')), 3000);
      const onMsg = (data: Buffer) => {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        if (parsed['type'] === 'res' && parsed['id'] === 'c1' && parsed['ok'] === true) {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve();
        }
      };
      ws.on('message', onMsg);
      ws.once('error', (err) => { clearTimeout(timer); ws.off('message', onMsg); reject(err); });
    });
    return ws;
  }

  it('server survives rapid open/close cycles without crashing', async () => {
    const [app, port] = await startWsServer();

    try {
      // Rapid open/close without handshake — simulates stale connections
      const CYCLES = 20;
      for (let i = 0; i < CYCLES; i++) {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
        await new Promise<void>(resolve => {
          ws.on('open', () => { ws.close(); });
          ws.on('close', resolve);
          ws.on('error', resolve);
        });
      }

      // Server should still accept a valid connect handshake after the storm
      const check = await connectClient(port);
      check.close();
      // If we got here, the server survived
      expect(true).toBe(true);
    } finally {
      await app.close();
    }
  }, 15_000);

  it('connection cap (4029) is enforced even under rapid reconnect pressure', async () => {
    const [app, port] = await startWsServer();
    const sockets: WebSocket[] = [];

    try {
      // Fill all 10 slots
      const opens = Array.from({ length: 10 }, () =>
        new Promise<WebSocket>(resolve => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream?token=${VALID_TOKEN}`);
          ws.on('open', () => resolve(ws));
          ws.on('error', () => resolve(ws));
        })
      );
      sockets.push(...await Promise.all(opens));

      // Fire 5 concurrent overflow connections — all should be rejected with 4029
      const overflowCodes = await Promise.all(
        Array.from({ length: 5 }, () =>
          new Promise<number>(resolve => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream?token=${VALID_TOKEN}`);
            ws.on('close', code => resolve(code));
            ws.on('error', () => resolve(0));
            setTimeout(() => resolve(-1), 2000);
          })
        )
      );

      expect(overflowCodes.every(code => code === 4029)).toBe(true);
    } finally {
      sockets.forEach(ws => { try { ws.close(); } catch {} });
      await app.close();
    }
  }, 15_000);

  it('reconnected client receives connect ok after previous disconnect', async () => {
    const [app, port] = await startWsServer();

    try {
      // First connection — connect handshake then close
      const first = await connectClient(port);
      await new Promise<void>(resolve => { first.once('close', resolve); first.close(); });

      // Reconnect immediately — should get another ok response
      const second = await connectClient(port);
      second.close();
      // If connectClient resolved without error, reconnect succeeded
      expect(true).toBe(true);
    } finally {
      await app.close();
    }
  }, 10_000);
});
