import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { AuditLogger } from './AuditLogger.js';

const TEST_DIR = join(tmpdir(), `krythor-audit-test-${randomUUID()}`);

beforeAll(() => { mkdirSync(TEST_DIR, { recursive: true }); });
afterAll(() => { if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true }); });

describe('AuditLogger', () => {
  it('initializes without error', () => {
    const logger = new AuditLogger(TEST_DIR);
    expect(logger.size).toBe(0);
    expect(logger.path).toContain('audit.ndjson');
  });

  it('logs an event and reflects in tail()', () => {
    const logger = new AuditLogger(join(TEST_DIR, 'sub1'));
    logger.log({ actionType: 'agent:run', agentId: 'agent-1', executionOutcome: 'success' });
    const events = logger.tail(10);
    expect(events).toHaveLength(1);
    expect(events[0]!.actionType).toBe('agent:run');
    expect(events[0]!.agentId).toBe('agent-1');
    expect(events[0]!.id).toBeTruthy();
    expect(events[0]!.timestamp).toBeTruthy();
  });

  it('assigns id and timestamp automatically', () => {
    const logger = new AuditLogger(join(TEST_DIR, 'sub2'));
    logger.log({ actionType: 'model:infer' });
    const [evt] = logger.tail(1);
    expect(evt!.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    expect(new Date(evt!.timestamp).getTime()).not.toBeNaN();
  });

  it('tail() returns most recent last', () => {
    const logger = new AuditLogger(join(TEST_DIR, 'sub3'));
    logger.log({ actionType: 'action:1' });
    logger.log({ actionType: 'action:2' });
    logger.log({ actionType: 'action:3' });
    const events = logger.tail(3);
    expect(events[0]!.actionType).toBe('action:1');
    expect(events[2]!.actionType).toBe('action:3');
  });

  it('tail() with limit < total returns only last N', () => {
    const logger = new AuditLogger(join(TEST_DIR, 'sub4'));
    for (let i = 0; i < 10; i++) {
      logger.log({ actionType: `action:${i}` });
    }
    expect(logger.tail(3)).toHaveLength(3);
    expect(logger.tail(3)[2]!.actionType).toBe('action:9');
  });

  it('query() filters by agentId', () => {
    const logger = new AuditLogger(join(TEST_DIR, 'sub5'));
    logger.log({ actionType: 'agent:run', agentId: 'agent-a' });
    logger.log({ actionType: 'agent:run', agentId: 'agent-b' });
    logger.log({ actionType: 'agent:run', agentId: 'agent-a' });
    const results = logger.query({ agentId: 'agent-a' });
    expect(results).toHaveLength(2);
    expect(results.every(e => e.agentId === 'agent-a')).toBe(true);
  });

  it('query() filters by actionType (substring match)', () => {
    const logger = new AuditLogger(join(TEST_DIR, 'sub6'));
    logger.log({ actionType: 'network:fetch' });
    logger.log({ actionType: 'network:search' });
    logger.log({ actionType: 'agent:run' });
    const results = logger.query({ actionType: 'network' });
    expect(results).toHaveLength(2);
  });

  it('query() with multiple filters acts as AND', () => {
    const logger = new AuditLogger(join(TEST_DIR, 'sub7'));
    logger.log({ actionType: 'agent:run', agentId: 'a1', executionOutcome: 'success' });
    logger.log({ actionType: 'agent:run', agentId: 'a1', executionOutcome: 'error' });
    logger.log({ actionType: 'agent:run', agentId: 'a2', executionOutcome: 'success' });
    const results = logger.query({ agentId: 'a1', executionOutcome: 'success' });
    expect(results).toHaveLength(1);
    expect(results[0]!.executionOutcome).toBe('success');
  });

  it('query() returns empty array when no match', () => {
    const logger = new AuditLogger(join(TEST_DIR, 'sub8'));
    logger.log({ actionType: 'model:infer' });
    expect(logger.query({ agentId: 'nonexistent' })).toHaveLength(0);
  });

  it('hashContent() returns a consistent SHA-256 hex string', () => {
    const hash = AuditLogger.hashContent('hello world');
    // SHA-256 hex is always 64 chars
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    // Must be deterministic
    expect(AuditLogger.hashContent('hello world')).toBe(hash);
    // Different input → different hash
    expect(AuditLogger.hashContent('goodbye world')).not.toBe(hash);
  });

  it('persists events to disk', () => {
    const dir = join(TEST_DIR, 'persist');
    const logger = new AuditLogger(dir);
    logger.log({ actionType: 'test:persist', agentId: 'persist-agent' });

    // New instance should reload from disk
    const logger2 = new AuditLogger(dir);
    expect(logger2.size).toBeGreaterThan(0);
    const events = logger2.query({ agentId: 'persist-agent' });
    expect(events).toHaveLength(1);
    expect(events[0]!.actionType).toBe('test:persist');
  });
});
