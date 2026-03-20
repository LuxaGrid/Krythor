import type { ProviderConfig, InferenceRequest, InferenceResponse, StreamChunk, ModelInfo, ProviderCredential } from '../types.js';
import { resolveCredential } from '../credential.js';

// ─── BaseProvider ─────────────────────────────────────────────────────────────

export abstract class BaseProvider {
  constructor(protected readonly config: ProviderConfig) {}

  get id(): string { return this.config.id; }
  get name(): string { return this.config.name; }
  get type(): string { return this.config.type; }
  get isEnabled(): boolean { return this.config.isEnabled; }
  get authMethod(): string { return this.config.authMethod; }

  abstract isAvailable(): Promise<boolean>;
  abstract listModels(): Promise<string[]>;
  abstract infer(request: InferenceRequest, signal?: AbortSignal): Promise<InferenceResponse>;
  abstract inferStream(request: InferenceRequest, signal?: AbortSignal): AsyncGenerator<StreamChunk>;

  /**
   * Returns a normalised credential regardless of whether auth came from OAuth
   * or an API key. Downstream code (router, agents, skills) calls this and never
   * inspects authMethod directly.
   */
  getCredential(): ProviderCredential | null {
    return resolveCredential(this.config);
  }

  /**
   * Convenience: return the bearer token string for use in HTTP headers.
   * Returns empty string for providers that need no auth (Ollama, GGUF local).
   */
  protected getBearerToken(): string {
    return this.getCredential()?.token ?? '';
  }

  getModelInfo(modelId: string): ModelInfo {
    const isLocal = this.config.type === 'ollama' || this.config.type === 'gguf';
    return {
      id: modelId,
      name: modelId,
      providerId: this.config.id,
      badges: [
        isLocal ? 'local' : 'remote',
        ...(this.config.isDefault ? ['default' as const] : []),
      ],
      isAvailable: this.config.models.includes(modelId),
    };
  }

  // Shared HTTP helper — uses native fetch (Node 18+)
  protected async httpPost(url: string, body: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<unknown> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      // Do not include the raw response body in the error message — provider error
      // bodies can contain internal details, request IDs, or prompt fragments that
      // must not appear in API responses or logs. Use hostname only.
      const hostname = (() => { try { return new URL(url).hostname; } catch { return url; } })();
      throw new Error(`HTTP ${res.status} from ${hostname}`);
    }

    return res.json();
  }

  protected async httpGet(url: string, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<unknown> {
    const res = await fetch(url, { headers, signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return res.json();
  }

  // Expose config models for router access
  getModels(): string[] {
    return this.config.models;
  }
}
