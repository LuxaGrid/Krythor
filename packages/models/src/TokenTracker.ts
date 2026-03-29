// ─── TokenTracker ─────────────────────────────────────────────────────────────
//
// Tracks token usage per provider per session.
// A "session" is the lifetime of the gateway process.
// Exposed via GET /api/stats so users can see how many tokens they've consumed.
//
// Also maintains a ring buffer of last 1000 inference records for history.
// Exposed via GET /api/stats/history.
//

// ── Cost table — USD per 1M tokens ────────────────────────────────────────────
// Source: public pricing pages as of 2025. Approximate — use for estimates only.
// Keys are partial model ID strings matched with `startsWith`.

export interface ModelPricing {
  /** USD per 1M input tokens */
  inputPerMillion: number;
  /** USD per 1M output tokens */
  outputPerMillion: number;
}

const PRICING_TABLE: Array<{ prefix: string; pricing: ModelPricing }> = [
  // Anthropic Claude
  { prefix: 'claude-opus-4',     pricing: { inputPerMillion: 15,    outputPerMillion: 75    } },
  { prefix: 'claude-sonnet-4',   pricing: { inputPerMillion: 3,     outputPerMillion: 15    } },
  { prefix: 'claude-haiku-4',    pricing: { inputPerMillion: 0.8,   outputPerMillion: 4     } },
  { prefix: 'claude-3-5-sonnet', pricing: { inputPerMillion: 3,     outputPerMillion: 15    } },
  { prefix: 'claude-3-5-haiku',  pricing: { inputPerMillion: 0.8,   outputPerMillion: 4     } },
  { prefix: 'claude-3-opus',     pricing: { inputPerMillion: 15,    outputPerMillion: 75    } },
  // OpenAI
  { prefix: 'gpt-4o-mini',       pricing: { inputPerMillion: 0.15,  outputPerMillion: 0.6   } },
  { prefix: 'gpt-4o',            pricing: { inputPerMillion: 5,     outputPerMillion: 15    } },
  { prefix: 'gpt-4-turbo',       pricing: { inputPerMillion: 10,    outputPerMillion: 30    } },
  { prefix: 'gpt-4',             pricing: { inputPerMillion: 30,    outputPerMillion: 60    } },
  { prefix: 'gpt-3.5',           pricing: { inputPerMillion: 0.5,   outputPerMillion: 1.5   } },
  { prefix: 'o1-mini',           pricing: { inputPerMillion: 3,     outputPerMillion: 12    } },
  { prefix: 'o1',                pricing: { inputPerMillion: 15,    outputPerMillion: 60    } },
  // Google Gemini
  { prefix: 'gemini-2.0-flash',  pricing: { inputPerMillion: 0.1,   outputPerMillion: 0.4   } },
  { prefix: 'gemini-1.5-flash',  pricing: { inputPerMillion: 0.075, outputPerMillion: 0.3   } },
  { prefix: 'gemini-1.5-pro',    pricing: { inputPerMillion: 3.5,   outputPerMillion: 10.5  } },
  // DeepSeek
  { prefix: 'deepseek-chat',     pricing: { inputPerMillion: 0.14,  outputPerMillion: 0.28  } },
  { prefix: 'deepseek-reasoner', pricing: { inputPerMillion: 0.55,  outputPerMillion: 2.19  } },
  // Groq (inference only — fast but no training)
  { prefix: 'llama-3.3-70b',     pricing: { inputPerMillion: 0.59,  outputPerMillion: 0.79  } },
  { prefix: 'llama-3.1-70b',     pricing: { inputPerMillion: 0.59,  outputPerMillion: 0.79  } },
  { prefix: 'mixtral-8x7b',      pricing: { inputPerMillion: 0.27,  outputPerMillion: 0.27  } },
];

/**
 * Estimate cost in USD for a given model ID and token counts.
 * Returns undefined when no pricing entry matches (e.g. local Ollama models).
 */
export function estimateCostUSD(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const modelLower = modelId.toLowerCase();
  const entry = PRICING_TABLE.find(e => modelLower.startsWith(e.prefix));
  if (!entry) return undefined;
  const { inputPerMillion, outputPerMillion } = entry.pricing;
  return (inputTokens * inputPerMillion + outputTokens * outputPerMillion) / 1_000_000;
}

export interface ProviderTokenStats {
  name: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  errors: number;
  /** Estimated USD cost for this provider+model combination. undefined for local/unknown models. */
  estimatedCostUSD?: number;
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
  /** Sum of all estimated costs where pricing is available, in USD. */
  estimatedCostUSD: number;
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
    const newInput  = opts.inputTokens  ?? 0;
    const newOutput = opts.outputTokens ?? 0;
    const existing = this.entries.get(key);
    if (existing) {
      existing.inputTokens  += newInput;
      existing.outputTokens += newOutput;
      existing.requests     += 1;
      if (opts.error) existing.errors += 1;
      // Recompute cost estimate
      existing.estimatedCostUSD = estimateCostUSD(opts.model, existing.inputTokens, existing.outputTokens);
    } else {
      this.entries.set(key, {
        name:             opts.providerId,
        model:            opts.model,
        inputTokens:      newInput,
        outputTokens:     newOutput,
        requests:         1,
        errors:           opts.error ? 1 : 0,
        estimatedCostUSD: estimateCostUSD(opts.model, newInput, newOutput),
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
        inputTokens:      acc.inputTokens      + p.inputTokens,
        outputTokens:     acc.outputTokens     + p.outputTokens,
        requests:         acc.requests         + p.requests,
        estimatedCostUSD: acc.estimatedCostUSD + (p.estimatedCostUSD ?? 0),
      }),
      { inputTokens: 0, outputTokens: 0, requests: 0, estimatedCostUSD: 0 },
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
