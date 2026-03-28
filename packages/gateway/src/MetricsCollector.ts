/**
 * MetricsCollector — lightweight sliding-window request metrics.
 *
 * Records one sample per minute (rolling 60-minute window by default).
 * Each sample captures: request count, error count, and sum of response
 * latencies so callers can derive req/min, error rate, and avg latency.
 *
 * Usage:
 *   const mc = new MetricsCollector();
 *   // In Fastify onResponse hook:
 *   mc.record(res.statusCode, responseTimeMs);
 *   // In route handler:
 *   return mc.getSeries();
 */

export interface MetricSample {
  /** Unix epoch seconds — start of this 1-minute bucket */
  ts:          number;
  /** Number of requests completed in this bucket */
  requests:    number;
  /** Number of requests that returned a 5xx status code */
  errors:      number;
  /** Sum of response latency (ms) for all requests in this bucket */
  latencySum:  number;
}

export interface MetricsSeries {
  /** Window size in minutes */
  windowMinutes: number;
  /** Ordered oldest → newest (may have gaps for idle minutes) */
  samples: MetricSample[];
  /** Derived totals for the entire window */
  totals: {
    requests:      number;
    errors:        number;
    avgLatencyMs:  number;
    errorRate:     number;   // 0–1
  };
}

export class MetricsCollector {
  private readonly windowMinutes: number;
  /** Map from bucket-epoch-second (floored to minute) → mutable sample */
  private readonly buckets = new Map<number, MetricSample>();

  constructor(windowMinutes = 60) {
    this.windowMinutes = windowMinutes;
  }

  /** Record a single completed request. */
  record(statusCode: number, latencyMs: number): void {
    const bucket = this.currentBucket();
    let sample = this.buckets.get(bucket);
    if (!sample) {
      sample = { ts: bucket, requests: 0, errors: 0, latencySum: 0 };
      this.buckets.set(bucket, sample);
    }
    sample.requests  += 1;
    sample.latencySum += latencyMs;
    if (statusCode >= 500) sample.errors += 1;
    this.evict();
  }

  /** Return the full series, ordered oldest → newest. */
  getSeries(): MetricsSeries {
    this.evict();
    const samples = [...this.buckets.values()].sort((a, b) => a.ts - b.ts);

    let totalRequests = 0;
    let totalErrors   = 0;
    let totalLatency  = 0;

    for (const s of samples) {
      totalRequests += s.requests;
      totalErrors   += s.errors;
      totalLatency  += s.latencySum;
    }

    return {
      windowMinutes: this.windowMinutes,
      samples,
      totals: {
        requests:     totalRequests,
        errors:       totalErrors,
        avgLatencyMs: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
        errorRate:    totalRequests > 0 ? totalErrors / totalRequests : 0,
      },
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private currentBucket(): number {
    // Floor to the nearest whole minute in epoch seconds
    return Math.floor(Date.now() / 60_000) * 60;
  }

  /** Remove buckets older than the window. */
  private evict(): void {
    const cutoff = Math.floor(Date.now() / 60_000) * 60 - this.windowMinutes * 60;
    for (const key of this.buckets.keys()) {
      if (key < cutoff) this.buckets.delete(key);
    }
  }
}
