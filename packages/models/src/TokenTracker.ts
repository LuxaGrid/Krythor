// ─── TokenTracker ─────────────────────────────────────────────────────────────
//
// Tracks token usage per provider per session.
// A "session" is the lifetime of the gateway process.
// Exposed via GET /api/stats so users can see how many tokens they've consumed.
//
// Also maintains a ring buffer of last 1000 inference records for history.
// Exposed via GET /api/stats/history.
//

export interface ProviderTokenStats {
  name: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  errors: number;
}

/** A single inference record stored in the history ring buffer. */
export interface InferenceRecord {
  timestamp: number;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const HISTORY_WINDOW_SIZE = 1000;

export interface SessionStats {
  startTime: string;             // ISO timestamp of gateway start
  providers: ProviderTokenStats[];
}

export interface TotalStats {
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export interface StatsSnapshot {
  session: SessionStats;
  totals: TotalStats;
}

export class TokenTracker {
  private readonly startTime = new Date().toISOString();
  /** Map from `{providerId}:{model}` → stats entry */
  private readonly entries = new Map<string, ProviderTokenStats>();
  /** Ring buffer of last HISTORY_WINDOW_SIZE inference records. */
  private readonly history: InferenceRecord[] = [];

  /**
   * Record a completed inference call.
   * `inputTokens` and `outputTokens` may be undefined when the provider did not
   * return usage data (common with streaming Ollama). They are treated as 0 in
   * that case — callers should pass the values when available.
   */
  record(opts: {
    providerId: string;
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    error?: boolean;
  }): void {
    const key = `${opts.providerId}:${opts.model}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.inputTokens  += opts.inputTokens  ?? 0;
      existing.outputTokens += opts.outputTokens ?? 0;
      existing.requests     += 1;
      if (opts.error) existing.errors += 1;
    } else {
      this.entries.set(key, {
        name:         opts.providerId,
        model:        opts.model,
        inputTokens:  opts.inputTokens  ?? 0,
        outputTokens: opts.outputTokens ?? 0,
        requests:     1,
        errors:       opts.error ? 1 : 0,
      });
    }

    // Only push non-error calls into the history ring buffer
    if (!opts.error) {
      const record: InferenceRecord = {
        timestamp:    Date.now(),
        provider:     opts.providerId,
        model:        opts.model,
        inputTokens:  opts.inputTokens  ?? 0,
        outputTokens: opts.outputTokens ?? 0,
      };
      this.history.push(record);
      // Trim to the last HISTORY_WINDOW_SIZE entries (ring buffer semantics)
      if (this.history.length > HISTORY_WINDOW_SIZE) {
        this.history.splice(0, this.history.length - HISTORY_WINDOW_SIZE);
      }
    }
  }

  /** Record an inference error — increments error count without modifying tokens. */
  recordError(providerId: string, model: string): void {
    this.record({ providerId, model, error: true });
  }

  snapshot(): StatsSnapshot {
    const providers = Array.from(this.entries.values());
    const totals: TotalStats = providers.reduce(
      (acc, p) => ({
        inputTokens:  acc.inputTokens  + p.inputTokens,
        outputTokens: acc.outputTokens + p.outputTokens,
        requests:     acc.requests     + p.requests,
      }),
      { inputTokens: 0, outputTokens: 0, requests: 0 },
    );

    return {
      session: {
        startTime: this.startTime,
        providers,
      },
      totals,
    };
  }

  totalTokens(): number {
    const { totals } = this.snapshot();
    return totals.inputTokens + totals.outputTokens;
  }

  /**
   * Returns the inference history ring buffer (last HISTORY_WINDOW_SIZE entries).
   * Each entry contains timestamp, provider, model, inputTokens, and outputTokens.
   */
  getHistory(): { history: InferenceRecord[]; windowSize: number } {
    return { history: [...this.history], windowSize: HISTORY_WINDOW_SIZE };
  }

  reset(): void {
    this.entries.clear();
    this.history.splice(0);
  }
}
