import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageDebouncer } from './MessageDebouncer.js';
import type { DebouncedMessage } from './MessageDebouncer.js';

describe('MessageDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes a single message after idleMs', () => {
    const results: DebouncedMessage[] = [];
    const d = new MessageDebouncer(msg => results.push(msg), { idleMs: 500 });

    d.push('conv-1', 'hello');
    expect(results).toHaveLength(0);

    vi.advanceTimersByTime(500);
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe('hello');
    expect(results[0]?.count).toBe(1);
    expect(results[0]?.conversationKey).toBe('conv-1');
  });

  it('coalesces rapid messages within idle window', () => {
    const results: DebouncedMessage[] = [];
    const d = new MessageDebouncer(msg => results.push(msg), { idleMs: 500 });

    d.push('conv-1', 'first');
    vi.advanceTimersByTime(300);
    d.push('conv-1', 'second');
    vi.advanceTimersByTime(300);
    d.push('conv-1', 'third');
    expect(results).toHaveLength(0);

    vi.advanceTimersByTime(500);
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe('first\nsecond\nthird');
    expect(results[0]?.count).toBe(3);
  });

  it('uses custom separator', () => {
    const results: DebouncedMessage[] = [];
    const d = new MessageDebouncer(msg => results.push(msg), { idleMs: 100, separator: ' | ' });

    d.push('conv-1', 'a');
    d.push('conv-1', 'b');
    vi.advanceTimersByTime(100);
    expect(results[0]?.text).toBe('a | b');
  });

  it('isolates different conversation keys', () => {
    const results: DebouncedMessage[] = [];
    const d = new MessageDebouncer(msg => results.push(msg), { idleMs: 100 });

    d.push('conv-1', 'hello');
    d.push('conv-2', 'world');
    vi.advanceTimersByTime(100);
    expect(results).toHaveLength(2);
    const keys = results.map(r => r.conversationKey).sort();
    expect(keys).toEqual(['conv-1', 'conv-2']);
  });

  it('flushes immediately for media messages', () => {
    const results: DebouncedMessage[] = [];
    const d = new MessageDebouncer(msg => results.push(msg), { idleMs: 500 });

    d.push('conv-1', 'caption', true);
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe('caption');
  });

  it('flushes buffered text before media message', () => {
    const results: DebouncedMessage[] = [];
    const d = new MessageDebouncer(msg => results.push(msg), { idleMs: 500 });

    d.push('conv-1', 'text first');
    d.push('conv-1', 'image.jpg', true);
    expect(results).toHaveLength(2);
    expect(results[0]?.text).toBe('text first');
    expect(results[1]?.text).toBe('image.jpg');
  });

  it('respects maxMs hard cap', () => {
    const results: DebouncedMessage[] = [];
    const d = new MessageDebouncer(msg => results.push(msg), { idleMs: 500, maxMs: 1_000 });

    d.push('conv-1', 'part 1');
    vi.advanceTimersByTime(400);
    d.push('conv-1', 'part 2');
    vi.advanceTimersByTime(400);
    d.push('conv-1', 'part 3');
    // maxMs=1000 elapsed from first push, idleMs keeps resetting
    vi.advanceTimersByTime(250); // total 1050ms from first push
    expect(results).toHaveLength(1);
    expect(results[0]?.count).toBe(3);
  });

  it('flush() forces immediate delivery', () => {
    const results: DebouncedMessage[] = [];
    const d = new MessageDebouncer(msg => results.push(msg), { idleMs: 1000 });

    d.push('conv-1', 'waiting');
    expect(results).toHaveLength(0);
    d.flush('conv-1');
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe('waiting');
  });

  it('flush() on empty key is a no-op', () => {
    const results: DebouncedMessage[] = [];
    const d = new MessageDebouncer(msg => results.push(msg), { idleMs: 100 });
    expect(() => d.flush('nonexistent')).not.toThrow();
    expect(results).toHaveLength(0);
  });

  it('flushAll() delivers all pending buckets', () => {
    const results: DebouncedMessage[] = [];
    const d = new MessageDebouncer(msg => results.push(msg), { idleMs: 1000 });

    d.push('a', 'msg-a');
    d.push('b', 'msg-b');
    d.push('c', 'msg-c');
    expect(results).toHaveLength(0);
    d.flushAll();
    expect(results).toHaveLength(3);
  });

  it('cancel() discards without firing', () => {
    const results: DebouncedMessage[] = [];
    const d = new MessageDebouncer(msg => results.push(msg), { idleMs: 100 });

    d.push('conv-1', 'to be cancelled');
    d.cancel('conv-1');
    vi.advanceTimersByTime(200);
    expect(results).toHaveLength(0);
  });

  it('pendingCount reflects active buckets', () => {
    const d = new MessageDebouncer(() => {}, { idleMs: 100 });
    expect(d.pendingCount).toBe(0);
    d.push('a', 'x');
    d.push('b', 'y');
    expect(d.pendingCount).toBe(2);
    vi.advanceTimersByTime(100);
    expect(d.pendingCount).toBe(0);
  });
});
