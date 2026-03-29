import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StreamCoalescer } from './StreamCoalescer.js';

describe('StreamCoalescer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('buffers small pushes and flushes on idle', () => {
    const events: string[] = [];
    const coalescer = new StreamCoalescer(e => events.push(e.content), { idleMs: 50 });
    coalescer.push('hello');
    coalescer.push(' world');
    expect(events).toHaveLength(0); // not flushed yet
    vi.advanceTimersByTime(50);
    expect(events).toEqual(['hello world']);
    coalescer.destroy();
  });

  it('flushes immediately when maxChars is exceeded', () => {
    const events: string[] = [];
    const coalescer = new StreamCoalescer(e => events.push(e.content), { maxChars: 5 });
    coalescer.push('12345'); // exactly 5 — flush
    expect(events).toEqual(['12345']);
    coalescer.destroy();
  });

  it('does not flush on push under maxChars', () => {
    const events: string[] = [];
    const coalescer = new StreamCoalescer(e => events.push(e.content), { maxChars: 10 });
    coalescer.push('abc');
    expect(events).toHaveLength(0);
    coalescer.flush();
    expect(events).toEqual(['abc']);
  });

  it('resets idle timer on each push', () => {
    const events: string[] = [];
    const coalescer = new StreamCoalescer(e => events.push(e.content), { idleMs: 50 });
    coalescer.push('a');
    vi.advanceTimersByTime(40);
    coalescer.push('b'); // resets timer
    vi.advanceTimersByTime(40); // total 80ms but timer reset at 40ms
    expect(events).toHaveLength(0);
    vi.advanceTimersByTime(10); // now 50ms from reset → flush
    expect(events).toEqual(['ab']);
    coalescer.destroy();
  });

  it('flush() emits accumulated content immediately', () => {
    const events: string[] = [];
    const coalescer = new StreamCoalescer(e => events.push(e.content), { idleMs: 100 });
    coalescer.push('test');
    expect(events).toHaveLength(0);
    coalescer.flush();
    expect(events).toEqual(['test']);
  });

  it('flush() on empty buffer emits nothing', () => {
    const events: string[] = [];
    const coalescer = new StreamCoalescer(e => events.push(e.content), {});
    coalescer.flush();
    expect(events).toHaveLength(0);
  });

  it('destroy() flushes remaining content', () => {
    const events: string[] = [];
    const coalescer = new StreamCoalescer(e => events.push(e.content), { idleMs: 100 });
    coalescer.push('final');
    coalescer.destroy();
    expect(events).toEqual(['final']);
  });

  it('includes meta fields in emitted events', () => {
    const emitted: Array<Record<string, unknown>> = [];
    const coalescer = new StreamCoalescer(e => emitted.push(e), {
      idleMs: 50,
      meta: { runId: 'test-run' },
    });
    coalescer.push('x');
    vi.advanceTimersByTime(50);
    expect(emitted[0]).toMatchObject({ type: 'delta', content: 'x', runId: 'test-run' });
    coalescer.destroy();
  });

  it('bufferedLength tracks pending chars', () => {
    const coalescer = new StreamCoalescer(() => {}, { maxChars: 100 });
    expect(coalescer.bufferedLength).toBe(0);
    coalescer.push('abc');
    expect(coalescer.bufferedLength).toBe(3);
    coalescer.flush();
    expect(coalescer.bufferedLength).toBe(0);
  });

  it('empty push is a no-op', () => {
    const events: string[] = [];
    const coalescer = new StreamCoalescer(e => events.push(e.content), { idleMs: 10 });
    coalescer.push('');
    vi.advanceTimersByTime(20);
    expect(events).toHaveLength(0);
    coalescer.destroy();
  });
});
