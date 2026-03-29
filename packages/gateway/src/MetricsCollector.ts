/**
 * MetricsCollector — lightweight sliding-window request metrics.
 *
 * Records one sample per minute (rolling 60-minute window by default).
 * Each sample captures: request count, error count, and sum of response
 * latencies so callers can derive req/min, error rate, and avg latency.
 *
 * Also tracks per-agent run metrics: total runs, errors, latency, and
 * token usage — kept as lifetime counters (not windowed) so dashboards
 * can rank agents by usage without waiting for a full window to fill.
 *
 * Usage:
 *   const mc = new MetricsCollector();
 *   // In Fastify onResponse hook:
 *   mc.record(res.statusCode, responseTimeMs);
 *   // After an agent run completes:
 *   mc.recordAgentRun(agentId, agentName, durationMs, success, tokensUsed);
 *   // In route handler:
 *   return mc.getSeries();
 *   return mc.getAgentStats();
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

/** Lifetime per-agent run statistics. */
export interface AgentRunStats {
  agentId:        string;
  agentName:      string;
  totalRuns:      number;
  failedRuns:     number;
  totalTokens:    number;
  totalLatencyMs: number;
  avgLatencyMs:   number;
  errorRate:      number;  // 0–1
  lastRunAt:      number;  // Unix epoch ms
}

export class MetricsCollector {
  private readonly windowMinutes: number;
  /** Map from bucket-epoch-second (floored to minute) → mutable sample */
  private readonly buckets = new Map<number, MetricSample>();
  /** Lifetime per-agent run counters */
  private readonly agentCounters = new Map<string, {
    agentId:        string;
    agentName:      string;
    totalRuns:      number;
    failedRuns:     number;
    totalTokens:    number;
    totalLatencyMs: number;
    lastRunAt:      number;
  }>();

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

  /** Record a completed agent run. */
  recordAgentRun(
    agentId:    string,
    agentName:  string,
    latencyMs:  number,
    success:    boolean,
    tokens = 0,
  ): void {
    let c = this.agentCounters.get(agentId);
    if (!c) {
      c = { agentId, agentName, totalRuns: 0, failedRuns: 0, totalTokens: 0, totalLatencyMs: 0, lastRunAt: 0 };
      this.agentCounters.set(agentId, c);
    }
    c.agentName      = agentName;  // update in case name changed
    c.totalRuns      += 1;
    c.totalLatencyMs += latencyMs;
    c.totalTokens    += tokens;
    c.lastRunAt       = Date.now();
    if (!success) c.failedRuns += 1;
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

  /** Return per-agent stats, sorted by totalRuns descending. */
  getAgentStats(): AgentRunStats[] {
    return [...this.agentCounters.values()]
      .map(c => ({
        agentId:        c.agentId,
        agentName:      c.agentName,
        totalRuns:      c.totalRuns,
        failedRuns:     c.failedRuns,
        totalTokens:    c.totalTokens,
        totalLatencyMs: c.totalLatencyMs,
        avgLatencyMs:   c.totalRuns > 0 ? Math.round(c.totalLatencyMs / c.totalRuns) : 0,
        errorRate:      c.totalRuns > 0 ? c.failedRuns / c.totalRuns : 0,
        lastRunAt:      c.lastRunAt,
      }))
      .sort((a, b) => b.totalRuns - a.totalRuns);
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
