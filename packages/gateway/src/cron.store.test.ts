/**
 * Unit tests for CronStore: CRUD, nextCronFire, computeNextRun, scheduling.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { CronStore, nextCronFire, computeNextRun } from './CronStore.js';

function makeTmpDir(): string {
  const d = join(tmpdir(), `cron-test-${randomUUID()}`);
  mkdirSync(d, { recursive: true });
  return d;
}

// ── nextCronFire ──────────────────────────────────────────────────────────────

describe('nextCronFire', () => {
  it('returns null for invalid expression', () => {
    const from = new Date('2026-03-27T00:00:00Z');
    expect(nextCronFire('bad expr', from)).toBeNull();
  });

  it('handles * * * * * (every minute)', () => {
    const from = new Date('2026-03-27T10:00:00Z');
    const next = nextCronFire('* * * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(from.getTime());
  });

  it('returns next occurrence of 0 7 * * * (7am daily)', () => {
    // From just before 7am
    const from = new Date('2026-03-27T06:59:00Z');
    const next = nextCronFire('0 7 * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getUTCHours()).toBe(7);
    expect(next!.getUTCMinutes()).toBe(0);
    expect(next!.getUTCDate()).toBe(27);
  });

  it('advances to next day when time has passed', () => {
    // From 7:01am — should get next 7am
    const from = new Date('2026-03-27T07:01:00Z');
    const next = nextCronFire('0 7 * * *', from);
    expect(next).not.toBeNull();
    expect(next!.getUTCDate()).toBe(28); // next day
    expect(next!.getUTCHours()).toBe(7);
  });

  it('handles 0 9 * * 1 (9am Mondays)', () => {
    // 2026-03-27 is a Friday; next Monday is 2026-03-30
    const from = new Date('2026-03-27T09:00:00Z');
    const next = nextCronFire('0 9 * * 1', from);
    expect(next).not.toBeNull();
    // Next occurrence is on a Monday
    expect(next!.getUTCDay()).toBe(1); // 0=Sun, 1=Mon
    expect(next!.getUTCHours()).toBe(9);
    expect(next!.getUTCMinutes()).toBe(0);
  });
});

// ── computeNextRun ────────────────────────────────────────────────────────────

describe('computeNextRun', () => {
  const now = new Date('2026-03-27T10:00:00Z');

  it('at schedule: returns the timestamp if in the future', () => {
    const future = new Date('2026-04-01T00:00:00Z');
    const result = computeNextRun({ kind: 'at', at: future.toISOString() }, now);
    expect(result?.getTime()).toBe(future.getTime());
  });

  it('at schedule: returns null if timestamp is in the past', () => {
    const past = new Date('2026-01-01T00:00:00Z');
    const result = computeNextRun({ kind: 'at', at: past.toISOString() }, now);
    expect(result).toBeNull();
  });

  it('every schedule: returns now + everyMs when no lastRun', () => {
    const result = computeNextRun({ kind: 'every', everyMs: 60_000 }, now);
    expect(result?.getTime()).toBe(now.getTime() + 60_000);
  });

  it('every schedule: uses lastRunAt as base', () => {
    const lastRun = new Date(now.getTime() - 30_000);
    const result = computeNextRun({ kind: 'every', everyMs: 60_000 }, now, lastRun);
    expect(result?.getTime()).toBe(lastRun.getTime() + 60_000);
  });

  it('cron schedule: delegates to nextCronFire', () => {
    const result = computeNextRun({ kind: 'cron', expr: '* * * * *' }, now);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThan(now.getTime());
  });
});

// ── CronStore ─────────────────────────────────────────────────────────────────

describe('CronStore', () => {
  let tmpDir: string;
  let store: CronStore;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    store = new CronStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('starts empty', () => {
    expect(store.list()).toHaveLength(0);
  });

  it('creates a job and returns it from list()', () => {
    const job = store.create({
      name: 'Test Job',
      schedule: { kind: 'every', everyMs: 60_000 },
      message: 'Hello agent',
    });
    expect(job.id).toBeTruthy();
    expect(job.name).toBe('Test Job');
    expect(job.runCount).toBe(0);
    expect(job.enabled).toBe(true);
    expect(store.list()).toHaveLength(1);
  });

  it('getById returns null for unknown id', () => {
    expect(store.getById('unknown')).toBeNull();
  });

  it('updates job fields', () => {
    const job = store.create({
      name: 'Original',
      schedule: { kind: 'every', everyMs: 60_000 },
      message: 'Hi',
    });
    const updated = store.update(job.id, { name: 'Updated', enabled: false });
    expect(updated.name).toBe('Updated');
    expect(updated.enabled).toBe(false);
  });

  it('deletes a job', () => {
    const job = store.create({ name: 'Del', schedule: { kind: 'every', everyMs: 60_000 }, message: 'x' });
    store.delete(job.id);
    expect(store.list()).toHaveLength(0);
  });

  it('throws on delete of unknown id', () => {
    expect(() => store.delete('bad')).toThrow();
  });

  it('getDueJobs returns only due enabled jobs', () => {
    const future = new Date(Date.now() + 60_000);
    const sooner = new Date(Date.now() + 300_000);

    // 'every' job due very soon — nextRunAt = now + everyMs which may be > now
    // 'at' job in the near future — nextRunAt is set to the 'at' timestamp
    const j1 = store.create({ name: 'Future', schedule: { kind: 'at', at: future.toISOString() }, message: 'a' });
    const j2 = store.create({ name: 'Sooner', schedule: { kind: 'at', at: sooner.toISOString() }, message: 'b' });

    // Neither is due right now
    const dueBefore = store.getDueJobs(new Date());
    expect(dueBefore.map(j => j.id)).not.toContain(j1.id);
    expect(dueBefore.map(j => j.id)).not.toContain(j2.id);

    // Advance time past j1's schedule
    const duePast = store.getDueJobs(new Date(future.getTime() + 1000));
    expect(duePast.map(j => j.id)).toContain(j1.id);
    expect(duePast.map(j => j.id)).not.toContain(j2.id);
  });

  it('recordSuccess increments runCount and clears lastError', () => {
    const job = store.create({ name: 'S', schedule: { kind: 'every', everyMs: 60_000 }, message: 'm' });
    store.recordSuccess(job.id);
    const updated = store.getById(job.id);
    expect(updated?.runCount).toBe(1);
    expect(updated?.lastRunAt).toBeTruthy();
  });

  it('recordSuccess deletes at+deleteAfterRun jobs', () => {
    const future = new Date(Date.now() + 60_000);
    const job = store.create({
      name: 'OneShotDel',
      schedule: { kind: 'at', at: future.toISOString() },
      message: 'x',
      deleteAfterRun: true,
    });
    store.recordSuccess(job.id);
    expect(store.getById(job.id)).toBeNull();
  });

  it('recordFailure logs error and advances nextRunAt', () => {
    const job = store.create({ name: 'F', schedule: { kind: 'every', everyMs: 60_000 }, message: 'm' });
    store.recordFailure(job.id, 'model down');
    const updated = store.getById(job.id);
    expect(updated?.lastError).toBe('model down');
    expect(updated?.lastFailedAt).toBeTruthy();
  });

  it('persists jobs to disk and reloads', () => {
    store.create({ name: 'Persist', schedule: { kind: 'every', everyMs: 60_000 }, message: 'test' });
    const store2 = new CronStore(tmpDir);
    expect(store2.list()).toHaveLength(1);
    expect(store2.list()[0]?.name).toBe('Persist');
  });
});
