/**
 * StreamCoalescer — batch consecutive SSE delta events into larger chunks
 * before forwarding to the client, reducing the number of tiny single-token
 * frames that reach the browser.
 *
 * Usage:
 *   const coalescer = new StreamCoalescer(sendEvent, { idleMs: 50, maxChars: 200 });
 *   // instead of calling sendEvent({ type: 'delta', content: delta }) directly:
 *   coalescer.push(delta);
 *   // on stream end:
 *   coalescer.flush();
 *
 * Flushing policy:
 *   - Flush immediately when `maxChars` is exceeded.
 *   - Flush after `idleMs` of no new pushes (idle window).
 *   - Always flush on explicit flush() / flushAll() calls.
 */

export interface StreamCoalescerOptions {
  /**
   * Milliseconds of idle time (no new push) before flushing the buffer.
   * Default: 50 ms.
   */
  idleMs?: number;
  /**
   * Maximum accumulated characters before a forced flush.
   * Default: 300 characters.
   */
  maxChars?: number;
  /**
   * Extra metadata to include in each flushed delta event alongside `content`.
   * Typically: { runId: '...' }
   */
  meta?: Record<string, unknown>;
}

export type DeltaEmitter = (event: { type: string; content: string; [k: string]: unknown }) => void;

const DEFAULT_IDLE_MS  = 50;
const DEFAULT_MAX_CHARS = 300;

export class StreamCoalescer {
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleMs: number;
  private readonly maxChars: number;
  private readonly meta: Record<string, unknown>;

  constructor(
    private readonly emit: DeltaEmitter,
    options: StreamCoalescerOptions = {},
  ) {
    this.idleMs   = options.idleMs   ?? DEFAULT_IDLE_MS;
    this.maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
    this.meta     = options.meta     ?? {};
  }

  /** Accumulate a chunk. Flushes immediately if maxChars is exceeded. */
  push(delta: string): void {
    if (!delta) return;
    this.buffer += delta;
    if (this.buffer.length >= this.maxChars) {
      this.flush();
      return;
    }
    // Reset idle timer
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.idleMs);
  }

  /** Flush buffered content immediately. */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.buffer) return;
    this.emit({ type: 'delta', content: this.buffer, ...this.meta });
    this.buffer = '';
  }

  /** Flush and prevent any further emission (call on stream close). */
  destroy(): void {
    this.flush();
  }

  /** Current buffered character count. */
  get bufferedLength(): number {
    return this.buffer.length;
  }
}
