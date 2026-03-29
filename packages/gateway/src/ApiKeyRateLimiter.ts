/**
 * ApiKeyRateLimiter — per-API-key sliding-window rate limiting and daily quotas.
 *
 * Two independent limits:
 *   rateLimit  — max requests per minute (sliding window, in-memory)
 *   dailyLimit — max requests per UTC calendar day (resets at midnight UTC)
 *
 * Both limits are optional per-key. If a key has neither set, all requests pass.
 * The master gateway token bypasses this entirely — it is never subject to key limits.
 *
 * Usage:
 *   const limiter = new ApiKeyRateLimiter();
 *   const result = limiter.check(apiKey);
 *   if (!result.allowed) {
 *     reply.header('Retry-After', String(result.retryAfterSeconds));
 *     return reply.code(429).send({ error: result.reason });
 *   }
 */

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfterSeconds?: number;
  /** Remaining requests in the current minute window (undefined if no per-minute limit). */
  remainingMinute?: number;
  /** Remaining requests for today (undefined if no daily limit). */
  remainingDay?: number;
}

interface KeyCounters {
  /** Minute-bucket timestamps for sliding window. Each entry is the epoch-second of the request, floored to the minute. */
  minuteBuckets: Map<number, number>;
  /** UTC date string (YYYY-MM-DD) for the current daily bucket. */
  dailyDate: string;
  /** Request count for the current daily bucket. */
  dailyCount: number;
}

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export class ApiKeyRateLimiter {
  private readonly counters = new Map<string, KeyCounters>();

  /**
   * Check whether the key is within its rate and quota limits.
   * If allowed, increments the counters.
   */
  check(key: { id: string; rateLimit?: number; dailyLimit?: number }): RateLimitResult {
    if (!key.rateLimit && !key.dailyLimit) return { allowed: true };

    let c = this.counters.get(key.id);
    if (!c) {
      c = { minuteBuckets: new Map(), dailyDate: utcDateString(), dailyCount: 0 };
      this.counters.set(key.id, c);
    }

    // ── Daily quota check ─────────────────────────────────────────────────────
    const today = utcDateString();
    if (c.dailyDate !== today) {
      // New day — reset counter
      c.dailyDate = today;
      c.dailyCount = 0;
    }
    if (key.dailyLimit !== undefined) {
      if (c.dailyCount >= key.dailyLimit) {
        // Seconds until midnight UTC
        const now = new Date();
        const msUntilMidnight = 86_400_000 - (now.getUTCHours() * 3_600_000 + now.getUTCMinutes() * 60_000 + now.getUTCSeconds() * 1_000 + now.getUTCMilliseconds());
        return {
          allowed: false,
          reason: `Daily quota exceeded (${key.dailyLimit} requests/day)`,
          retryAfterSeconds: Math.ceil(msUntilMidnight / 1_000),
          remainingDay: 0,
        };
      }
    }

    // ── Per-minute sliding window check ───────────────────────────────────────
    if (key.rateLimit !== undefined) {
      const nowBucket = Math.floor(Date.now() / 60_000) * 60;
      const cutoff = nowBucket - 60; // one-minute window

      // Evict stale buckets
      for (const [ts] of c.minuteBuckets) {
        if (ts <= cutoff) c.minuteBuckets.delete(ts);
      }

      const windowCount = [...c.minuteBuckets.values()].reduce((sum, n) => sum + n, 0);
      if (windowCount >= key.rateLimit) {
        // Retry after the oldest bucket expires (at most 60s)
        const oldestTs = Math.min(...c.minuteBuckets.keys());
        const retryAfterMs = Math.max(0, (oldestTs + 60) * 1_000 - Date.now());
        return {
          allowed: false,
          reason: `Rate limit exceeded (${key.rateLimit} requests/minute)`,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1_000) || 1,
          remainingMinute: 0,
        };
      }

      // Increment minute bucket
      c.minuteBuckets.set(nowBucket, (c.minuteBuckets.get(nowBucket) ?? 0) + 1);
      const newWindowCount = [...c.minuteBuckets.values()].reduce((sum, n) => sum + n, 0);

      // Increment daily counter
      c.dailyCount += 1;

      return {
        allowed: true,
        remainingMinute: key.rateLimit - newWindowCount,
        remainingDay: key.dailyLimit !== undefined ? key.dailyLimit - c.dailyCount : undefined,
      };
    }

    // No per-minute limit, only daily
    c.dailyCount += 1;
    return {
      allowed: true,
      remainingDay: key.dailyLimit !== undefined ? key.dailyLimit - c.dailyCount : undefined,
    };
  }

  /** Reset all counters for a key (e.g. after revoking). */
  reset(keyId: string): void {
    this.counters.delete(keyId);
  }
}
