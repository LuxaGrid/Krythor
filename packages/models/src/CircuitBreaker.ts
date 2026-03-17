// ─── CircuitBreaker ───────────────────────────────────────────────────────────
//
// Per-provider circuit breaker with three states:
//   closed   — requests pass through normally
//   open     — requests fail immediately (provider is known down)
//   half-open — one probe request allowed to test recovery
//
// Transitions:
//   closed  → open      after FAILURE_THRESHOLD consecutive failures
//   open    → half-open after RESET_TIMEOUT_MS of being open
//   half-open → closed  on success
//   half-open → open    on failure
//

const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS  = 30_000; // 30 seconds

type State = 'closed' | 'open' | 'half-open';

export interface CircuitStats {
  state: State;
  failures: number;
  lastFailureAt: number | null;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  avgLatencyMs: number;
}

export class CircuitBreaker {
  private state: State = 'closed';
  private failures = 0;
  private lastFailureAt: number | null = null;

  // Lifetime counters for stats/observability
  private totalRequests = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;

  // Rolling latency window — last 50 successful calls
  private readonly latencyWindow: number[] = [];
  private readonly latencyWindowSize = 50;

  constructor(readonly providerId: string) {}

  // ── Execution wrapper ──────────────────────────────────────────────────────

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === 'open') {
      throw new CircuitOpenError(this.providerId);
    }

    const start = Date.now();
    this.totalRequests++;

    try {
      const result = await fn();
      this.onSuccess(Date.now() - start);
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  // ── External state mutators (for streaming path) ──────────────────────────

  /** Record a successful call from an external caller (e.g. streaming path). */
  recordSuccess(latencyMs: number): void {
    this.onSuccess(latencyMs);
  }

  /** Record a failed call from an external caller (e.g. streaming path). */
  recordFailure(): void {
    this.onFailure();
  }

  // ── State queries ─────────────────────────────────────────────────────────

  isOpen(): boolean { return this.state === 'open'; }

  stats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureAt: this.lastFailureAt,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      avgLatencyMs: this.computeAvgLatency(),
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private onSuccess(latencyMs: number): void {
    this.failures = 0;
    this.state = 'closed';
    this.totalSuccesses++;
    this.latencyWindow.push(latencyMs);
    if (this.latencyWindow.length > this.latencyWindowSize) {
      this.latencyWindow.shift();
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureAt = Date.now();
    this.totalFailures++;
    if (this.failures >= FAILURE_THRESHOLD) {
      this.state = 'open';
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (
      this.state === 'open' &&
      this.lastFailureAt !== null &&
      Date.now() - this.lastFailureAt >= RESET_TIMEOUT_MS
    ) {
      this.state = 'half-open';
    }
  }

  private computeAvgLatency(): number {
    if (this.latencyWindow.length === 0) return 0;
    const sum = this.latencyWindow.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.latencyWindow.length);
  }
}

// ─── CircuitOpenError ─────────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  constructor(readonly providerId: string) {
    super(`Provider "${providerId}" circuit is open — too many recent failures. Will retry in 30s.`);
    this.name = 'CircuitOpenError';
  }
}
