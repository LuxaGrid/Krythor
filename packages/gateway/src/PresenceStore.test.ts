import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PresenceStore } from './PresenceStore.js';

describe('PresenceStore', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('upserts and retrieves an entry', () => {
    const store = new PresenceStore();
    store.upsert('client-1', { host: 'desktop', mode: 'control', version: '0.5.0' });
    const entry = store.get('client-1');
    expect(entry).toBeDefined();
    expect(entry?.host).toBe('desktop');
    expect(entry?.mode).toBe('control');
    expect(entry?.version).toBe('0.5.0');
  });

  it('merges fields on subsequent upserts', () => {
    const store = new PresenceStore();
    store.upsert('c1', { host: 'laptop', mode: 'node' });
    store.upsert('c1', { version: '1.0.0' });
    const entry = store.get('c1');
    expect(entry?.host).toBe('laptop');
    expect(entry?.version).toBe('1.0.0');
    expect(entry?.mode).toBe('node');
  });

  it('returns undefined for unknown instanceId', () => {
    const store = new PresenceStore();
    expect(store.get('nonexistent')).toBeUndefined();
  });

  it('prunes stale entries after TTL', () => {
    const store = new PresenceStore({ ttlMs: 1000 });
    store.upsert('c1', { mode: 'control' });
    vi.advanceTimersByTime(1001);
    expect(store.get('c1')).toBeUndefined();
  });

  it('fresh entries survive TTL prune', () => {
    const store = new PresenceStore({ ttlMs: 5000 });
    store.upsert('c1', { mode: 'control' });
    vi.advanceTimersByTime(3000);
    expect(store.get('c1')).toBeDefined();
  });

  it('list() returns only non-stale entries', () => {
    const store = new PresenceStore({ ttlMs: 1000 });
    store.upsert('c1', { mode: 'control' });
    store.upsert('c2', { mode: 'node' });
    vi.advanceTimersByTime(500);
    store.upsert('c3', { mode: 'gateway' });
    vi.advanceTimersByTime(600); // c1, c2 now stale; c3 still fresh
    const entries = store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.instanceId).toBe('c3');
  });

  it('remove() deletes an entry', () => {
    const store = new PresenceStore();
    store.upsert('c1', { mode: 'control' });
    store.remove('c1');
    expect(store.get('c1')).toBeUndefined();
  });

  it('evicts oldest when maxEntries exceeded', () => {
    const store = new PresenceStore({ maxEntries: 2, ttlMs: 60_000 });
    store.upsert('c1', { mode: 'control' });
    vi.advanceTimersByTime(10);
    store.upsert('c2', { mode: 'control' });
    vi.advanceTimersByTime(10);
    store.upsert('c3', { mode: 'control' }); // should evict c1
    expect(store.size).toBe(2);
    expect(store.get('c1')).toBeUndefined();
    expect(store.get('c2')).toBeDefined();
    expect(store.get('c3')).toBeDefined();
  });

  it('prune() removes stale entries and returns count', () => {
    const store = new PresenceStore({ ttlMs: 500 });
    store.upsert('c1', { mode: 'control' });
    store.upsert('c2', { mode: 'control' });
    vi.advanceTimersByTime(600);
    const removed = store.prune();
    expect(removed).toBe(2);
    expect(store.size).toBe(0);
  });

  it('size reflects current entry count', () => {
    const store = new PresenceStore();
    expect(store.size).toBe(0);
    store.upsert('c1', { mode: 'gateway' });
    expect(store.size).toBe(1);
    store.remove('c1');
    expect(store.size).toBe(0);
  });
});
