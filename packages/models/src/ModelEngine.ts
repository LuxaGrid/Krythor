import { join } from 'path';
import { homedir } from 'os';
import { ModelRegistry } from './ModelRegistry.js';
import { ModelRouter } from './ModelRouter.js';
import { TokenTracker } from './TokenTracker.js';
import type {
  ProviderConfig,
  OAuthAccount,
  InferenceRequest,
  InferenceResponse,
  StreamChunk,
  RoutingContext,
  ModelInfo,
} from './types.js';

function getConfigDir(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor', 'config');
  }
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Krythor', 'config');
  }
  return join(homedir(), '.local', 'share', 'krythor', 'config');
}

// ─── ModelEngine ──────────────────────────────────────────────────────────────
//
// Single entry point for all model operations.
// Core and Gateway use only this class.
//

export class ModelEngine {
  readonly registry: ModelRegistry;
  readonly router: ModelRouter;
  readonly tokenTracker: TokenTracker;

  constructor(
    configDir?: string,
    warnFn?: (message: string, data?: Record<string, unknown>) => void,
    infoFn?: (message: string, data?: Record<string, unknown>) => void,
  ) {
    const dir = configDir ?? getConfigDir();
    this.registry = new ModelRegistry(dir);
    this.router = new ModelRouter(this.registry, warnFn, infoFn);
    this.tokenTracker = new TokenTracker();
  }

  // ── Provider management ───────────────────────────────────────────────────

  /**
   * Reload providers from disk without process restart.
   * Used by the gateway's config file watcher (hot reload).
   */
  reloadProviders(): void {
    this.registry.reload();
  }

  addProvider(input: Omit<ProviderConfig, 'id'>): ProviderConfig {
    return this.registry.addProvider(input);
  }

  updateProvider(id: string, updates: Partial<Omit<ProviderConfig, 'id'>>): ProviderConfig {
    return this.registry.updateProvider(id, updates);
  }

  removeProvider(id: string): void {
    this.registry.removeProvider(id);
  }

  /**
   * Store OAuth account credentials for a provider.
   * Sets authMethod to 'oauth' and clears any existing API key.
   */
  connectOAuth(id: string, account: OAuthAccount): ProviderConfig {
    return this.registry.connectOAuth(id, account);
  }

  /**
   * Remove OAuth credentials from a provider. Reverts authMethod to 'none'.
   */
  disconnectOAuth(id: string): ProviderConfig {
    return this.registry.disconnectOAuth(id);
  }

  /**
   * Update OAuth tokens after a token refresh.
   */
  refreshOAuthTokens(id: string, accessToken: string, refreshToken?: string, expiresAt?: number): ProviderConfig {
    return this.registry.refreshOAuthTokens(id, accessToken, refreshToken, expiresAt);
  }

  listProviders(): ProviderConfig[] {
    return this.registry.listConfigs();
  }

  // ── Model queries ─────────────────────────────────────────────────────────

  listModels(): ModelInfo[] {
    return this.router.listAllModels();
  }

  async refreshModels(providerId: string): Promise<string[]> {
    const provider = this.registry.getProvider(providerId);
    if (!provider) throw new Error(`Provider "${providerId}" not found`);
    const models = await provider.listModels();
    this.registry.updateProvider(providerId, { models });
    return models;
  }

  async checkAvailability(providerId: string): Promise<{ ok: boolean; lastUnavailableReason?: string }> {
    const provider = this.registry.getProvider(providerId);
    if (!provider) return { ok: false, lastUnavailableReason: 'Provider not found' };
    const ok = await provider.isAvailable();
    const reason = (provider as unknown as { lastUnavailableReason?: string }).lastUnavailableReason;
    return { ok, ...(reason && { lastUnavailableReason: reason }) };
  }

  /** Returns the endpoint of the first enabled Ollama provider, or null if none. */
  getFirstOllamaEndpoint(): string | null {
    const p = this.registry.listConfigs().find(c => c.type === 'ollama' && c.isEnabled);
    return p?.endpoint ?? null;
  }

  // ── Inference ─────────────────────────────────────────────────────────────

  async infer(request: InferenceRequest, context?: RoutingContext, signal?: AbortSignal): Promise<InferenceResponse> {
    try {
      const response = await this.router.infer(request, context, signal);
      this.tokenTracker.record({
        providerId:    response.providerId,
        model:         response.model,
        inputTokens:   response.promptTokens,
        outputTokens:  response.completionTokens,
      });
      return response;
    } catch (err) {
      // Best-effort: resolve provider/model for error tracking
      try {
        const resolved = this.router.resolve(request, context ?? {});
        this.tokenTracker.recordError(resolved.provider.id, resolved.model);
      } catch { /* ignore resolution failure during error tracking */ }
      throw err;
    }
  }

  async *inferStream(request: InferenceRequest, context?: RoutingContext, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    // Streaming token counts are not reliably surfaced by all providers.
    // We still record the request attempt for the stats counter.
    let providerId = '';
    let model = '';
    let hasError = false;
    try {
      for await (const chunk of this.router.inferStream(request, context, signal)) {
        if (chunk.model) model = chunk.model;
        yield chunk;
      }
    } catch (err) {
      hasError = true;
      throw err;
    } finally {
      if (providerId || model) {
        if (hasError) {
          this.tokenTracker.recordError(providerId || 'unknown', model || 'unknown');
        } else {
          this.tokenTracker.record({ providerId: providerId || 'unknown', model: model || 'unknown' });
        }
      }
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  stats(): { providerCount: number; modelCount: number; hasDefault: boolean } {
    return {
      providerCount: this.registry.listConfigs().length,
      modelCount: this.router.listAllModels().length,
      hasDefault: this.registry.getDefaultProvider() !== null,
    };
  }

  circuitStats(): Record<string, ReturnType<import('./CircuitBreaker.js').CircuitBreaker['stats']>> {
    return this.router.circuitStats();
  }
}
