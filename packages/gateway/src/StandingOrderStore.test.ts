import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { StandingOrderStore } from './StandingOrderStore.js';

let tmpDir: string;
let store: StandingOrderStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'krythor-so-'));
  store = new StandingOrderStore(tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('StandingOrderStore.create', () => {
  it('creates a standing order with defaults', () => {
    const o = store.create({ name: 'Daily Report', scope: 'Compile and send report' });
    expect(o.id).toBeTruthy();
    expect(o.name).toBe('Daily Report');
    expect(o.scope).toBe('Compile and send report');
    expect(o.enabled).toBe(true);
    expect(o.runCount).toBe(0);
  });

  it('persists to disk', () => {
    store.create({ name: 'Test', scope: 'Do stuff' });
    const raw = JSON.parse(readFileSync(join(tmpDir, 'standing-orders.json'), 'utf-8')) as unknown[];
    expect(raw).toHaveLength(1);
  });

  it('reloads persisted data on construction', () => {
    store.create({ name: 'Persistent', scope: 'Remember me' });
    const store2 = new StandingOrderStore(tmpDir);
    expect(store2.list()).toHaveLength(1);
    expect(store2.list()[0].name).toBe('Persistent');
  });
});

describe('StandingOrderStore.update', () => {
  it('updates fields', () => {
    const o = store.create({ name: 'Old', scope: 'Old scope' });
    const updated = store.update(o.id, { name: 'New', enabled: false });
    expect(updated.name).toBe('New');
    expect(updated.enabled).toBe(false);
    expect(updated.scope).toBe('Old scope'); // unchanged
  });

  it('throws on missing id', () => {
    expect(() => store.update('nope', { name: 'x' })).toThrow('not found');
  });
});

describe('StandingOrderStore.delete', () => {
  it('removes the order', () => {
    const o = store.create({ name: 'Temp', scope: 'x' });
    store.delete(o.id);
    expect(store.getById(o.id)).toBeNull();
  });

  it('throws on missing id', () => {
    expect(() => store.delete('nope')).toThrow('not found');
  });
});

describe('StandingOrderStore.getByCronJobId', () => {
  it('returns orders linked to a cron job', () => {
    store.create({ name: 'A', scope: 'x', cronJobId: 'cron-1' });
    store.create({ name: 'B', scope: 'y', cronJobId: 'cron-2' });
    store.create({ name: 'C', scope: 'z', cronJobId: 'cron-1' });
    const linked = store.getByCronJobId('cron-1');
    expect(linked).toHaveLength(2);
    expect(linked.map(o => o.name).sort()).toEqual(['A', 'C']);
  });
});

describe('StandingOrderStore.recordSuccess / recordFailure', () => {
  it('records a successful run', () => {
    const o = store.create({ name: 'Run', scope: 'x' });
    store.recordSuccess(o.id);
    const updated = store.getById(o.id)!;
    expect(updated.runCount).toBe(1);
    expect(updated.lastRunStatus).toBe('success');
    expect(updated.lastRunAt).toBeTruthy();
  });

  it('records a failed run', () => {
    const o = store.create({ name: 'Run', scope: 'x' });
    store.recordFailure(o.id, 'Connection refused');
    const updated = store.getById(o.id)!;
    expect(updated.lastRunStatus).toBe('failed');
    expect(updated.lastError).toBe('Connection refused');
  });
});

describe('StandingOrderStore.buildPrompt', () => {
  it('includes scope and name in the prompt', () => {
    const o = store.create({
      name: 'Weekly Report',
      scope: 'Compile weekly metrics',
      approvalGates: 'None required',
      executionSteps: '1. Pull data\n2. Write report',
    });
    const prompt = store.buildPrompt(o.id)!;
    expect(prompt).toContain('Weekly Report');
    expect(prompt).toContain('Compile weekly metrics');
    expect(prompt).toContain('None required');
    expect(prompt).toContain('1. Pull data');
  });

  it('returns null for disabled orders', () => {
    const o = store.create({ name: 'Disabled', scope: 'x', enabled: false });
    expect(store.buildPrompt(o.id)).toBeNull();
  });

  it('returns null for missing id', () => {
    expect(store.buildPrompt('nonexistent')).toBeNull();
  });
});
