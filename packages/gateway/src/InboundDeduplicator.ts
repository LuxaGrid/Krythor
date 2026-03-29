/**
 * InboundDeduplicator — prevent duplicate inbound messages from triggering
 * multiple agent runs. Maintains a short-lived cache keyed by a caller-
 * supplied deduplication key (typically: channel + account + messageId).
 *
 * When a message arrives, call `seen(key)`:
 *   - Returns `false` the first time for a given key → process the message.
 *   - Returns `true` on subsequent calls within `ttlMs` → skip it.
 *
 * Entries expire automatically via a periodic sweep, keeping memory bounded.
 */

const DEFAULT_TTL_MS  = 60_000;  // 60 seconds
const DEFAULT_SWEEP_MS = 30_000;  // sweep every 30 seconds

export class InboundDeduplicator {
  private readonly cache = new Map<string, number>(); // key → expiresAt
  private readonly ttlMs: number;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs = DEFAULT_TTL_MS, sweepMs = DEFAULT_SWEEP_MS) {
    this.ttlMs = ttlMs;
    this.sweepTimer = setInterval(() => this.sweep(), sweepMs);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  /**
   * Returns `true` if this key has been seen within the TTL window (duplicate).
   * Returns `false` and records the key if it is new or has expired.
   */
  seen(key: string): boolean {
    const now = Date.now();
    const expiry = this.cache.get(key);
    if (expiry !== undefined && expiry > now) return true; // duplicate
    this.cache.set(key, now + this.ttlMs);
    return false;
  }

  /** Manually mark a key as expired (e.g., after a failed run — allow retry). */
  evict(key: string): void {
    this.cache.delete(key);
  }

  /** Current number of tracked keys. */
  get size(): number {
    return this.cache.size;
  }

  /** Stop the background sweep timer. Call on graceful shutdown. */
  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, expiry] of this.cache) {
      if (expiry <= now) this.cache.delete(key);
    }
  }
}
