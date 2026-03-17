import type { ModelRegistry } from './ModelRegistry.js';
import type { InferenceRequest, InferenceResponse, StreamChunk, RoutingContext, ModelInfo } from './types.js';
import type { BaseProvider } from './providers/BaseProvider.js';
import { CircuitBreaker, CircuitOpenError } from './CircuitBreaker.js';

// ─── ModelRouter ──────────────────────────────────────────────────────────────
//
// Routing hierarchy (highest priority first):
//   1. Skill/task model override  (context.skillModelId)
//   2. Agent model override       (context.agentModelId)
//   3. Global default provider    (registry.getDefaultProvider())
//   4. Fallback: first enabled provider
//
// Reliability features:
//   - Per-provider circuit breakers (open after 3 consecutive failures, reset after 30s)
//   - Exponential backoff retry (up to MAX_RETRIES attempts, non-stream only)
//   - Latency tracked inside each circuit breaker (last 50 calls)
//

const MAX_RETRIES      = 2;   // total attempts = 1 initial + 2 retries
const RETRY_BASE_MS    = 500; // 500ms → 1000ms

export class ModelRouter {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly registry: ModelRegistry) {}

  async infer(request: InferenceRequest, context: RoutingContext = {}, signal?: AbortSignal): Promise<InferenceResponse> {
    const { provider, model } = this.resolve(request, context);
    return this.inferWithRetry(provider, { ...request, model }, signal);
  }

  async *inferStream(request: InferenceRequest, context: RoutingContext = {}, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    // Streaming is not retried — partial output has already been sent to the client.
    // The circuit breaker open-check happens before the stream begins; any error
    // thrown during streaming also trips the breaker so it reflects the failure.
    const { provider, model } = this.resolve(request, context);
    const breaker = this.getBreaker(provider.id);
    if (breaker.isOpen()) throw new CircuitOpenError(provider.id);

    try {
      yield* provider.inferStream({ ...request, model }, signal);
      // Count the completed stream as a success so latency is tracked
      breaker.recordSuccess(0);
    } catch (err) {
      // Trip the breaker on stream failure (connection error, mid-stream abort, etc.)
      // but not on AbortError — abort is caller-initiated, not a provider failure.
      if (!signal?.aborted) {
        breaker.recordFailure();
      }
      throw err;
    }
  }

  // Resolve which provider + model to use for a given request + routing context.
  resolve(request: InferenceRequest, context: RoutingContext = {}): { provider: BaseProvider; model: string } {
    // 1. Explicit provider + model on the request itself (direct override)
    if (request.providerId) {
      const p = this.registry.getProvider(request.providerId);
      if (p && p.isEnabled) {
        return { provider: p, model: request.model ?? p.getModels()[0] ?? '' };
      }
    }

    // 2. Skill model override
    if (context.skillModelId) {
      const found = this.findByModelId(context.skillModelId);
      if (found) return found;
    }

    // 3. Agent model override
    if (context.agentModelId) {
      const found = this.findByModelId(context.agentModelId);
      if (found) return found;
    }

    // 4. Global default provider
    const defaultProvider = this.registry.getDefaultProvider();
    if (defaultProvider) {
      const model = request.model ?? defaultProvider.getModels()[0] ?? '';
      return { provider: defaultProvider, model };
    }

    // 5. Fallback: first enabled provider
    const enabled = this.registry.listEnabled();
    if (enabled.length > 0) {
      const p = enabled[0]!;
      return { provider: p, model: request.model ?? p.getModels()[0] ?? '' };
    }

    throw new Error('No model provider is configured or enabled. Add a provider via /api/models/providers.');
  }

  // List all models across all enabled providers with badges and circuit state
  listAllModels(): ModelInfo[] {
    const result: ModelInfo[] = [];
    for (const provider of this.registry.listEnabled()) {
      const breaker = this.breakers.get(provider.id);
      const circuitState = breaker?.stats().state;
      for (const modelId of provider.getModels()) {
        const info = provider.getModelInfo(modelId);
        result.push({ ...info, circuitState });
      }
    }
    return result;
  }

  // Return per-provider circuit breaker stats for observability
  circuitStats(): Record<string, ReturnType<CircuitBreaker['stats']>> {
    const out: Record<string, ReturnType<CircuitBreaker['stats']>> = {};
    for (const [id, breaker] of this.breakers) {
      out[id] = breaker.stats();
    }
    return out;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private getBreaker(providerId: string): CircuitBreaker {
    let breaker = this.breakers.get(providerId);
    if (!breaker) {
      breaker = new CircuitBreaker(providerId);
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }

  private async inferWithRetry(provider: BaseProvider, request: InferenceRequest, signal?: AbortSignal): Promise<InferenceResponse> {
    const breaker = this.getBreaker(provider.id);
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        // Exponential backoff — do not retry if the signal is already aborted
        if (signal?.aborted) throw lastError;
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1); // 500ms, 1000ms
        await sleep(delay, signal);
      }

      try {
        return await breaker.execute(() => provider.infer(request, signal));
      } catch (err) {
        lastError = err;
        // Do not retry on circuit-open — the breaker has already tripped
        if (err instanceof CircuitOpenError) throw err;
        // Do not retry on abort
        if (signal?.aborted) throw err;
        // Do not retry on 4xx (client errors — retrying won't help)
        if (isClientError(err)) throw err;
        // Retryable error — continue loop
      }
    }

    throw lastError;
  }

  private findByModelId(modelId: string): { provider: BaseProvider; model: string } | null {
    // Search enabled providers for a provider that lists this model ID
    for (const provider of this.registry.listEnabled()) {
      if (provider.getModels().includes(modelId)) {
        return { provider, model: modelId };
      }
    }
    // Not found in any provider's model list — try matching by prefix (e.g. "gpt-4o")
    for (const provider of this.registry.listEnabled()) {
      const match = provider.getModels().find(m => m.startsWith(modelId) || modelId.startsWith(m));
      if (match) return { provider, model: match };
    }
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    }, { once: true });
  });
}

function isClientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // HTTP 4xx errors from BaseProvider.httpPost
  return /HTTP 4\d\d/.test(err.message);
}
