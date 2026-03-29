/**
 * SenderRateLimiter — per-sender rate limiting for inbound chat channels.
 *
 * Tracks message counts per (channel, senderId) pair using a rolling
 * time window. Callers check via allowed(channelId, senderId):
 *   - Returns true if the sender is within their quota.
 *   - Returns false if the quota is exceeded (request should be dropped or
 *     replied-to with a rate-limit message).
 *
 * Config:
 *   maxMessages   — max messages allowed in the window (default: 20)
 *   windowMs      — rolling window duration in ms (default: 60_000 — 1 minute)
 *
 * Memory: O(unique senders * windowMs / meanInterval). A periodic sweep
 * evicts stale entries after 2x windowMs to keep memory bounded.
 */

export interface SenderRateLimiterConfig {
  /** Maximum number of messages per sender per window. Default: 20. */
  maxMessages?: number;
  /** Rolling window duration in milliseconds. Default: 60 000 (1 minute). */
  windowMs?: number;
}

const DEFAULT_MAX_MESSAGES = 20;
const DEFAULT_WINDOW_MS    = 60_000;

export class SenderRateLimiter {
  private readonly maxMessages: number;
  private readonly windowMs: number;
  // key: `${channelId}:${senderId}` → sorted list of message timestamps
  private readonly history = new Map<string, number[]>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: SenderRateLimiterConfig = {}) {
    this.maxMessages = config.maxMessages ?? DEFAULT_MAX_MESSAGES;
    this.windowMs    = config.windowMs    ?? DEFAULT_WINDOW_MS;

    // Sweep stale entries every 2x windowMs
    this.sweepTimer = setInterval(() => this.sweep(), this.windowMs * 2);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  /**
   * Check if a message from `senderId` on `channelId` is within quota.
   * Records the message timestamp if allowed.
   * Returns true if allowed, false if rate-limited.
   */
  allowed(channelId: string, senderId: string): boolean {
    const key = `${channelId}:${senderId}`;
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.history.get(key);
    if (!timestamps) {
      timestamps = [];
      this.history.set(key, timestamps);
    }

    // Prune expired entries from the front (list is kept in insertion order ≈ sorted)
    while (timestamps.length > 0 && timestamps[0]! < cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxMessages) {
      return false; // quota exceeded
    }

    timestamps.push(now);
    return true;
  }

  /**
   * How many messages the sender has sent in the current window.
   * Does not record a new message.
   */
  count(channelId: string, senderId: string): number {
    const key = `${channelId}:${senderId}`;
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.history.get(key) ?? [];
    return timestamps.filter(t => t >= cutoff).length;
  }

  /** Stop the background sweep timer. Call on graceful shutdown. */
  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweep(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, timestamps] of this.history) {
      while (timestamps.length > 0 && timestamps[0]! < cutoff) {
        timestamps.shift();
      }
      if (timestamps.length === 0) this.history.delete(key);
    }
  }
}
