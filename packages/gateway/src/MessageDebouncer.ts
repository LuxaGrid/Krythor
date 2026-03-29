// ─── MessageDebouncer ────────────────────────────────────────────────────────
//
// Per-conversation inbound message debouncing.
//
// When a conversation receives multiple messages in quick succession, it is
// often better to coalesce them into a single agent run rather than spawning
// a separate run for each. This class implements an idle-window debounce:
//
//   - The first message for a key starts a timer.
//   - Subsequent messages before the timer fires append to the buffer.
//   - When the idle window elapses with no new messages, the callback is called
//     with the combined text.
//   - Media messages (isMedia=true) flush immediately — no debounce.
//
// Usage:
//   const debouncer = new MessageDebouncer({ idleMs: 800, maxMs: 5000 });
//   debouncer.push(convId, 'first message');
//   debouncer.push(convId, 'second message');
//   // ~800ms later → callback fires with 'first message\nsecond message'
//

export interface MessageDebouncerOptions {
  /** Idle window in ms before flushing. Default: 800. */
  idleMs?: number;
  /** Hard maximum wait in ms regardless of activity. Default: 5000. */
  maxMs?: number;
  /** Separator between coalesced messages. Default: '\n'. */
  separator?: string;
}

export interface DebouncedMessage {
  conversationKey: string;
  text: string;
  count: number;
  firstAt: number;
}

type FlushCallback = (msg: DebouncedMessage) => void;

interface Bucket {
  parts: string[];
  idleTimer: ReturnType<typeof setTimeout>;
  maxTimer: ReturnType<typeof setTimeout> | null;
  firstAt: number;
}

export class MessageDebouncer {
  private readonly idleMs: number;
  private readonly maxMs: number;
  private readonly separator: string;
  private readonly buckets = new Map<string, Bucket>();
  private readonly callback: FlushCallback;

  constructor(callback: FlushCallback, options: MessageDebouncerOptions = {}) {
    this.callback = callback;
    this.idleMs    = options.idleMs    ?? 800;
    this.maxMs     = options.maxMs     ?? 5_000;
    this.separator = options.separator ?? '\n';
  }

  /**
   * Push an inbound message fragment for a conversation key.
   * @param key  Conversation / session identifier.
   * @param text Message text.
   * @param isMedia When true, flush any pending buffer immediately then fire callback.
   */
  push(key: string, text: string, isMedia = false): void {
    if (isMedia) {
      this.flush(key);
      this.callback({ conversationKey: key, text, count: 1, firstAt: Date.now() });
      return;
    }

    let bucket = this.buckets.get(key);

    if (!bucket) {
      const now = Date.now();
      const maxTimer = this.maxMs < Infinity
        ? setTimeout(() => this.flush(key), this.maxMs)
        : null;

      bucket = {
        parts:     [text],
        idleTimer: setTimeout(() => this.flush(key), this.idleMs),
        maxTimer,
        firstAt:   now,
      };
      this.buckets.set(key, bucket);
      return;
    }

    // Extend idle window
    clearTimeout(bucket.idleTimer);
    bucket.parts.push(text);
    bucket.idleTimer = setTimeout(() => this.flush(key), this.idleMs);
  }

  /**
   * Force-flush a conversation key immediately.
   * No-op if there is nothing buffered.
   */
  flush(key: string): void {
    const bucket = this.buckets.get(key);
    if (!bucket) return;

    clearTimeout(bucket.idleTimer);
    if (bucket.maxTimer) clearTimeout(bucket.maxTimer);
    this.buckets.delete(key);

    const text  = bucket.parts.join(this.separator);
    const count = bucket.parts.length;
    this.callback({ conversationKey: key, text, count, firstAt: bucket.firstAt });
  }

  /**
   * Flush all pending buckets (e.g. on graceful shutdown).
   */
  flushAll(): void {
    for (const key of [...this.buckets.keys()]) {
      this.flush(key);
    }
  }

  /** Number of active pending buckets. */
  get pendingCount(): number {
    return this.buckets.size;
  }

  /** Cancel and discard a pending bucket without firing the callback. */
  cancel(key: string): void {
    const bucket = this.buckets.get(key);
    if (!bucket) return;
    clearTimeout(bucket.idleTimer);
    if (bucket.maxTimer) clearTimeout(bucket.maxTimer);
    this.buckets.delete(key);
  }
}
