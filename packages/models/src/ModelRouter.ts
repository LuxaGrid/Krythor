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

/** Global fallback for max retries — overridden per-provider via config.maxRetries */
const DEFAULT_MAX_RETRIES = 2;   // total attempts = 1 initial + 2 retries
const RETRY_BASE_MS       = 500; // 500ms → 1000ms (+ jitter)
const RETRY_JITTER_MS     = 100; // up to 100ms of random jitter per retry

export class ModelRouter {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly registry: ModelRegistry,
    private readonly warnFn?: (message: string, data?: Record<string, unknown>) => void,
    private readonly infoFn?: (message: string, data?: Record<string, unknown>) => void,
  ) {}

  async infer(request: InferenceRequest, context: RoutingContext = {}, signal?: AbortSignal): Promise<InferenceResponse> {
    const { provider, model, selectionReason } = this.resolve(request, context);
    try {
      const response = await this.inferWithRetry(provider, { ...request, model }, signal);
      return { ...response, selectionReason, fallbackOccurred: false };
    } catch (primaryErr) {
      // Primary provider exhausted retries (or circuit opened mid-retry).
      // Attempt cross-provider fallback: re-resolve with the primary provider's
      // circuit tripped, pick the next available provider, and try once.
      // Only attempt fallback for transient errors — not aborts or 4xx client errors.
      if (signal?.aborted) throw primaryErr;
      if (isClientError(primaryErr)) throw primaryErr;

      // Mark primary provider as failed so resolve() skips it
      const primaryBreaker = this.getBreaker(provider.id);
      if (!primaryBreaker.isOpen()) {
        // Circuit not yet open (e.g. only 1 attempt failed) — force open via recordFailure loop
        // so resolve() will skip it for the fallback resolution.
        // We don't want to permanently damage the breaker state if we have a fallback,
        // but we do need resolve() to skip the same provider. Instead, we call resolve()
        // with a set of providers to exclude explicitly.
      }

      const fallback = this.resolveExcluding(request, context, new Set([provider.id]));
      if (!fallback) {
        // No fallback available — re-throw primary error
        throw primaryErr;
      }

      const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      const logData = {
        primaryProviderId: provider.id,
        fallbackProviderId: fallback.provider.id,
        fallbackModel: fallback.model,
        reason: errMsg,
      };
      if (this.infoFn) {
        this.infoFn('[ModelRouter] Primary provider failed — attempting fallback provider.', logData);
      } else if (this.warnFn) {
        this.warnFn('[ModelRouter] Primary provider failed — attempting fallback provider.', logData);
      }

      // Single attempt on fallback — no further cross-provider retry chain
      const fallbackResponse = await this.inferWithRetry(fallback.provider, { ...request, model: fallback.model }, signal);
      return { ...fallbackResponse, selectionReason: `fallback from ${provider.id}: ${errMsg.slice(0, 120)}`, fallbackOccurred: true };
    }
  }

  async *inferStream(request: InferenceRequest, context: RoutingContext = {}, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    // Streaming is NOT retried and NOT fallen back mid-stream — partial output has
    // already been sent to the client once the first chunk yields.
    //
    // Exception: if the primary provider's circuit is open *before* any bytes are
    // sent, we can transparently fall back to the next provider — no partial output
    // has been delivered yet so the switch is safe.
    const { provider, model, selectionReason } = this.resolve(request, context);
    const breaker = this.getBreaker(provider.id);

    let resolvedProvider = provider;
    let resolvedModel = model;
    let fallbackOccurred = false;
    let resolvedSelectionReason = selectionReason;

    if (breaker.isOpen()) {
      // Circuit is open before the stream begins — attempt pre-stream fallback.
      if (!signal?.aborted) {
        const fallback = this.resolveExcluding(request, context, new Set([provider.id]));
        if (fallback) {
          if (this.infoFn) {
            this.infoFn('[ModelRouter] Primary provider circuit open — using fallback for stream.', {
              primaryProviderId: provider.id,
              fallbackProviderId: fallback.provider.id,
            });
          }
          resolvedProvider = fallback.provider;
          resolvedModel    = fallback.model;
          fallbackOccurred = true;
          resolvedSelectionReason = `fallback from ${provider.id}: circuit open`;
        } else {
          // No fallback available — throw the circuit-open error as before
          throw new CircuitOpenError(provider.id);
        }
      } else {
        throw new CircuitOpenError(provider.id);
      }
    }

    const activeBreaker = this.getBreaker(resolvedProvider.id);
    try {
      for await (const chunk of resolvedProvider.inferStream({ ...request, model: resolvedModel }, signal)) {
        if (chunk.done) {
          yield { ...chunk, selectionReason: resolvedSelectionReason, fallbackOccurred, retryCount: 0 };
        } else {
          yield chunk;
        }
      }
      // Count the completed stream as a success so latency is tracked
      activeBreaker.recordSuccess(0);
    } catch (err) {
      // Trip the breaker on stream failure (connection error, mid-stream abort, etc.)
      // but not on AbortError — abort is caller-initiated, not a provider failure.
      if (!signal?.aborted) {
        activeBreaker.recordFailure();
      }
      throw err;
    }
  }

  // Resolve which provider + model to use for a given request + routing context.
  resolve(request: InferenceRequest, context: RoutingContext = {}): { provider: BaseProvider; model: string; selectionReason: string } {
    // 1. Explicit provider + model on the request itself (direct override)
    if (request.providerId) {
      const p = this.registry.getProvider(request.providerId);
      if (p && p.isEnabled) {
        return { provider: p, model: this.resolveModel(p, request.model), selectionReason: `explicit providerId=${request.providerId}` };
      }
    }

    // 2. Skill model override
    if (context.skillModelId) {
      const found = this.findByModelId(context.skillModelId);
      if (found) return { ...found, selectionReason: `skill override modelId=${context.skillModelId}` };
    }

    // 3. Agent model override
    if (context.agentModelId) {
      const found = this.findByModelId(context.agentModelId);
      if (found) return { ...found, selectionReason: `agent override modelId=${context.agentModelId}` };
    }

    // 4. Walk all enabled providers sorted by priority (desc), with default first
    //    when priorities are tied.  Skip providers with open circuits.
    const enabled = this.registry.listEnabled();
    const configs = this.registry.listConfigs();
    const defaultProvider = this.registry.getDefaultProvider();

    // Build priority-sorted order: higher priority first.
    // When priorities are equal, the default provider wins; then stable insertion order.
    const ordered = [...enabled].sort((a, b) => {
      const cfgA = configs.find(c => c.id === a.id);
      const cfgB = configs.find(c => c.id === b.id);
      const priA = cfgA?.priority ?? 0;
      const priB = cfgB?.priority ?? 0;
      if (priB !== priA) return priB - priA;                   // higher priority wins
      const isDefA = a.id === defaultProvider?.id ? 1 : 0;
      const isDefB = b.id === defaultProvider?.id ? 1 : 0;
      return isDefB - isDefA;                                   // default wins tie
    });

    for (const provider of ordered) {
      const breaker = this.breakers.get(provider.id);
      if (breaker?.isOpen()) continue; // skip tripped providers
      const cfg = configs.find(c => c.id === provider.id);
      const isDefault = provider.id === defaultProvider?.id;
      const reason = isDefault
        ? 'default provider'
        : cfg && (cfg.priority ?? 0) > 0
          ? `priority=${cfg.priority ?? 0}`
          : 'first available enabled provider';
      return { provider, model: this.resolveModel(provider, request.model), selectionReason: reason };
    }

    // All circuits open — use highest-priority anyway and let the error surface naturally
    if (ordered.length > 0) {
      const p = ordered[0]!;
      return { provider: p, model: this.resolveModel(p, request.model), selectionReason: 'all circuits open — using highest-priority as last resort' };
    }

    throw new Error('No model provider is configured or enabled. Add a provider via /api/models/providers.');
  }

  /**
   * Resolve the model string for a given provider.
   * If the requested model is not in the provider's list, fall back to the
   * provider's first model and log a warning rather than passing an empty string.
   */
  private resolveModel(provider: BaseProvider, requestedModel?: string): string {
    const models = provider.getModels();
    if (!requestedModel) return models[0] ?? '';
    if (models.length === 0 || models.includes(requestedModel)) return requestedModel;
    // Model not available on this provider — use first available and warn
    const msg = `Requested model "${requestedModel}" not found on provider "${provider.id}" — using "${models[0]}" instead.`;
    if (this.warnFn) {
      this.warnFn('[ModelRouter] ' + msg, { requestedModel, providerId: provider.id, fallbackModel: models[0] });
    } else {
      console.warn('[ModelRouter]', msg);
    }
    return models[0]!;
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
      breaker = new CircuitBreaker(providerId, this.warnFn);
      this.breakers.set(providerId, breaker);
    }
    return breaker;
  }

  /**
   * Resolve to a provider+model, explicitly skipping providers in the exclusion set.
   * Used for cross-provider fallback after primary exhausts retries.
   * Returns null when no alternative provider is available.
   */
  private resolveExcluding(
    request: InferenceRequest,
    context: RoutingContext,
    exclude: Set<string>,
  ): { provider: BaseProvider; model: string } | null {
    // Explicit provider override — respect it even for fallback (user chose it directly)
    if (request.providerId && !exclude.has(request.providerId)) {
      const p = this.registry.getProvider(request.providerId);
      if (p && p.isEnabled) {
        return { provider: p, model: this.resolveModel(p, request.model) };
      }
    }

    // Walk enabled providers in priority order, skip excluded and open circuits
    const enabled = this.registry.listEnabled();
    const configs = this.registry.listConfigs();
    const defaultProvider = this.registry.getDefaultProvider();
    const ordered = [...enabled].sort((a, b) => {
      const cfgA = configs.find(c => c.id === a.id);
      const cfgB = configs.find(c => c.id === b.id);
      const priA = cfgA?.priority ?? 0;
      const priB = cfgB?.priority ?? 0;
      if (priB !== priA) return priB - priA;
      return (b.id === defaultProvider?.id ? 1 : 0) - (a.id === defaultProvider?.id ? 1 : 0);
    });

    for (const provider of ordered) {
      if (exclude.has(provider.id)) continue;
      const breaker = this.breakers.get(provider.id);
      if (breaker?.isOpen()) continue;
      return { provider, model: this.resolveModel(provider, request.model) };
    }
    return null;
  }

  private async inferWithRetry(provider: BaseProvider, request: InferenceRequest, signal?: AbortSignal): Promise<InferenceResponse> {
    const breaker = this.getBreaker(provider.id);
    // Per-provider maxRetries from config, fallback to global default
    const cfg = this.registry.listConfigs().find(c => c.id === provider.id);
    const maxRetries = typeof cfg?.maxRetries === 'number' ? cfg.maxRetries : DEFAULT_MAX_RETRIES;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        // Exponential backoff with jitter — do not retry if the signal is already aborted
        if (signal?.aborted) throw lastError;
        const base  = RETRY_BASE_MS * Math.pow(2, attempt - 1); // 500ms, 1000ms, ...
        const jitter = Math.random() * RETRY_JITTER_MS;
        const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
        if (this.warnFn) {
          this.warnFn('[ModelRouter] Retrying inference', { providerId: provider.id, attempt, maxRetries, delayMs: Math.round(base + jitter), error: errMsg });
        }
        await sleep(base + jitter, signal);
      }

      try {
        const response = await breaker.execute(() => provider.infer(request, signal));
        return { ...response, retryCount: attempt };
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
