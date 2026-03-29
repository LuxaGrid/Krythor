import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InboundDeduplicator } from './InboundDeduplicator.js';

describe('InboundDeduplicator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('returns false for a new key', () => {
    const d = new InboundDeduplicator(1000, 60_000);
    expect(d.seen('chan:123:abc')).toBe(false);
    d.destroy();
  });

  it('returns true for a duplicate within TTL', () => {
    const d = new InboundDeduplicator(1000, 60_000);
    d.seen('key1');
    expect(d.seen('key1')).toBe(true);
    d.destroy();
  });

  it('returns false after TTL expires', () => {
    const d = new InboundDeduplicator(1000, 60_000);
    d.seen('expiring');
    vi.advanceTimersByTime(1001);
    expect(d.seen('expiring')).toBe(false);
    d.destroy();
  });

  it('different keys are independent', () => {
    const d = new InboundDeduplicator(1000, 60_000);
    d.seen('a');
    expect(d.seen('b')).toBe(false);
    expect(d.seen('a')).toBe(true);
    d.destroy();
  });

  it('evict() allows the key to be re-processed', () => {
    const d = new InboundDeduplicator(1000, 60_000);
    d.seen('evictable');
    d.evict('evictable');
    expect(d.seen('evictable')).toBe(false);
    d.destroy();
  });

  it('size tracks number of active keys', () => {
    const d = new InboundDeduplicator(1000, 60_000);
    expect(d.size).toBe(0);
    d.seen('a');
    d.seen('b');
    expect(d.size).toBe(2);
    d.seen('a'); // duplicate — size unchanged
    expect(d.size).toBe(2);
    d.destroy();
  });

  it('sweep removes expired entries', () => {
    const d = new InboundDeduplicator(500, 100); // sweep every 100 ms
    d.seen('old');
    expect(d.size).toBe(1);
    vi.advanceTimersByTime(600); // TTL + sweep fires
    expect(d.size).toBe(0);
    d.destroy();
  });

  it('destroy() stops the sweep timer', () => {
    const d = new InboundDeduplicator(500, 100);
    d.seen('x');
    d.destroy();
    vi.advanceTimersByTime(600);
    // No error — timer was cleaned up
    expect(d.size).toBe(1); // sweep no longer runs
  });
});
