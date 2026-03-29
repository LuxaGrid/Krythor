import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SenderRateLimiter } from './SenderRateLimiter.js';

describe('SenderRateLimiter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('allows messages within quota', () => {
    const limiter = new SenderRateLimiter({ maxMessages: 3, windowMs: 60_000 });
    expect(limiter.allowed('tg', 'user1')).toBe(true);
    expect(limiter.allowed('tg', 'user1')).toBe(true);
    expect(limiter.allowed('tg', 'user1')).toBe(true);
    limiter.destroy();
  });

  it('blocks messages exceeding quota', () => {
    const limiter = new SenderRateLimiter({ maxMessages: 3, windowMs: 60_000 });
    limiter.allowed('tg', 'user1');
    limiter.allowed('tg', 'user1');
    limiter.allowed('tg', 'user1');
    expect(limiter.allowed('tg', 'user1')).toBe(false);
    limiter.destroy();
  });

  it('allows again after window expires', () => {
    const limiter = new SenderRateLimiter({ maxMessages: 3, windowMs: 1000 });
    limiter.allowed('tg', 'user1');
    limiter.allowed('tg', 'user1');
    limiter.allowed('tg', 'user1');
    vi.advanceTimersByTime(1001);
    expect(limiter.allowed('tg', 'user1')).toBe(true);
    limiter.destroy();
  });

  it('different senders have independent quotas', () => {
    const limiter = new SenderRateLimiter({ maxMessages: 2, windowMs: 60_000 });
    limiter.allowed('tg', 'user1');
    limiter.allowed('tg', 'user1');
    // user1 is at limit, user2 should still be allowed
    expect(limiter.allowed('tg', 'user2')).toBe(true);
    // user1 is blocked
    expect(limiter.allowed('tg', 'user1')).toBe(false);
    limiter.destroy();
  });

  it('different channels are independent', () => {
    const limiter = new SenderRateLimiter({ maxMessages: 2, windowMs: 60_000 });
    limiter.allowed('telegram', 'user1');
    limiter.allowed('telegram', 'user1');
    // Reached limit on telegram, but discord is separate
    expect(limiter.allowed('discord', 'user1')).toBe(true);
    expect(limiter.allowed('telegram', 'user1')).toBe(false);
    limiter.destroy();
  });

  it('count() returns current window count without recording', () => {
    const limiter = new SenderRateLimiter({ maxMessages: 5, windowMs: 60_000 });
    expect(limiter.count('tg', 'user1')).toBe(0);
    limiter.allowed('tg', 'user1');
    limiter.allowed('tg', 'user1');
    expect(limiter.count('tg', 'user1')).toBe(2);
    // count() itself doesn't add to the count
    expect(limiter.count('tg', 'user1')).toBe(2);
    limiter.destroy();
  });

  it('sweep removes stale entries', () => {
    const limiter = new SenderRateLimiter({ maxMessages: 5, windowMs: 100 });
    limiter.allowed('tg', 'user1');
    vi.advanceTimersByTime(300); // sweep fires (2x windowMs = 200ms)
    // After sweep, the entry should be cleaned up internally
    expect(limiter.count('tg', 'user1')).toBe(0);
    limiter.destroy();
  });

  it('destroy() stops sweep timer without error', () => {
    const limiter = new SenderRateLimiter({ maxMessages: 5, windowMs: 1000 });
    expect(() => { limiter.destroy(); limiter.destroy(); }).not.toThrow();
  });
});
