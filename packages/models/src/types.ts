// ─── Provider auth types ──────────────────────────────────────────────────────

export type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'openai-compat' | 'gguf';

export type AuthMethod = 'api_key' | 'oauth' | 'none';

export type ModelBadge = 'local' | 'remote' | 'default' | 'agent-assigned' | 'override-active';

/** Stored OAuth account metadata (tokens encrypted at rest alongside config). */
export interface OAuthAccount {
  /** Provider-specific account identifier (e.g. email, sub claim). */
  accountId: string;
  /** Display label for the connected account. */
  displayName?: string;
  /** Encrypted access token — same AES-256-GCM scheme as API keys. */
  accessToken: string;
  /** Encrypted refresh token, if the provider supports it. */
  refreshToken?: string;
  /** Unix epoch (seconds) when the access token expires. 0 = unknown/no expiry. */
  expiresAt: number;
  /** ISO timestamp when this account was connected. */
  connectedAt: string;
}

/** Capability flags for a provider type. UI and logic derive behaviour from these. */
export interface ProviderCapabilities {
  supportsOAuth: boolean;
  supportsApiKey: boolean;
  supportsCustomBaseUrl: boolean;
  supportsModelListing: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  endpoint: string;          // base URL or file path for gguf
  /** Which auth method is active for this provider instance. */
  authMethod: AuthMethod;
  apiKey?: string;           // AES-256-GCM encrypted at rest
  /** Populated when authMethod === 'oauth'. */
  oauthAccount?: OAuthAccount;
  isDefault: boolean;
  isEnabled: boolean;
  models: string[];          // list of available model IDs
}

export interface ModelInfo {
  id: string;                // e.g. "llama3.2", "gpt-4o", "claude-sonnet-4-6"
  name: string;              // display name — defaults to model ID for Ollama/OpenAI models
  providerId: string;
  badges: ModelBadge[];
  contextWindow?: number;
  isAvailable: boolean;
  circuitState?: 'closed' | 'open' | 'half-open'; // undefined = no data yet (first use)
}

// ─── Credential abstraction ───────────────────────────────────────────────────
// Normalised credential handed to providers at runtime. Downstream code (router,
// agents, skills) does not need to know whether auth came from OAuth or an API key.

export interface ProviderCredential {
  /** The bearer/api-key token to use in outgoing requests. */
  token: string;
  /** Source of the token — for observability only, never logged. */
  source: AuthMethod;
}

// ─── Inference types ──────────────────────────────────────────────────────────

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceRequest {
  messages: Message[];
  model?: string;            // override specific model ID
  providerId?: string;       // override specific provider
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface InferenceResponse {
  content: string;
  model: string;
  providerId: string;
  promptTokens?: number;
  completionTokens?: number;
  durationMs: number;
  // Observability / Phase 2 transparency fields
  retryCount?: number;         // number of retry attempts (0 = first attempt succeeded)
  selectionReason?: string;    // why this provider/model was chosen
  fallbackOccurred?: boolean;  // true when a fallback provider was used
}

export interface StreamChunk {
  delta: string;
  done: boolean;
  model?: string;
  // Routing metadata — populated on the final chunk (done === true)
  selectionReason?: string;
  fallbackOccurred?: boolean;
  retryCount?: number;
}

// ─── Routing context ─────────────────────────────────────────────────────────

export interface RoutingContext {
  agentModelId?: string;     // agent-specific model override
  skillModelId?: string;     // skill-specific model override
  taskType?: string;         // hint for future smart routing
}
