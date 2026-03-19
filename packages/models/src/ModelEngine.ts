import { join } from 'path';
import { homedir } from 'os';
import { ModelRegistry } from './ModelRegistry.js';
import { ModelRouter } from './ModelRouter.js';
import type {
  ProviderConfig,
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

  constructor(
    configDir?: string,
    warnFn?: (message: string, data?: Record<string, unknown>) => void,
    infoFn?: (message: string, data?: Record<string, unknown>) => void,
  ) {
    const dir = configDir ?? getConfigDir();
    this.registry = new ModelRegistry(dir);
    this.router = new ModelRouter(this.registry, warnFn, infoFn);
  }

  // ── Provider management ───────────────────────────────────────────────────

  addProvider(input: Omit<ProviderConfig, 'id'>): ProviderConfig {
    return this.registry.addProvider(input);
  }

  updateProvider(id: string, updates: Partial<Omit<ProviderConfig, 'id'>>): ProviderConfig {
    return this.registry.updateProvider(id, updates);
  }

  removeProvider(id: string): void {
    this.registry.removeProvider(id);
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
    return this.router.infer(request, context, signal);
  }

  async *inferStream(request: InferenceRequest, context?: RoutingContext, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
    yield* this.router.inferStream(request, context, signal);
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
