// ─── Provider types ───────────────────────────────────────────────────────────

export type ProviderType = 'ollama' | 'openai' | 'anthropic' | 'openai-compat' | 'gguf';

export type ModelBadge = 'local' | 'remote' | 'default' | 'agent-assigned' | 'override-active';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  endpoint: string;          // base URL or file path for gguf
  apiKey?: string;           // encrypted at rest (Phase 6); plaintext for now
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
