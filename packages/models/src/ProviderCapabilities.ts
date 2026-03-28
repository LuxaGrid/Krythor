import type { ProviderType, ProviderCapabilities } from './types.js';

/**
 * Capability registry for all known provider types.
 * UI and logic must derive behaviour from these flags — no hardcoded conditionals.
 * Adding a new provider only requires a new entry here plus an auth adapter.
 */
export const PROVIDER_CAPABILITIES: Record<ProviderType, ProviderCapabilities> = {
  ollama: {
    supportsOAuth:         false,
    supportsApiKey:        false, // Ollama is local, no auth needed
    supportsCustomBaseUrl: true,
    supportsModelListing:  true,
  },
  openai: {
    supportsOAuth:         true,  // OAuth token can be used as bearer token
    supportsApiKey:        true,
    supportsCustomBaseUrl: false,
    supportsModelListing:  true,
  },
  anthropic: {
    supportsOAuth:         true,  // OAuth token can be used as bearer token
    supportsApiKey:        true,
    supportsCustomBaseUrl: false,
    supportsModelListing:  true,
  },
  'openai-compat': {
    supportsOAuth:         false,
    supportsApiKey:        true,
    supportsCustomBaseUrl: true,
    supportsModelListing:  true,
  },
  gguf: {
    supportsOAuth:         false,
    supportsApiKey:        false, // llama-server is local, no auth
    supportsCustomBaseUrl: true,
    supportsModelListing:  false,
  },
  'claude-agent-sdk': {
    supportsOAuth:         false, // uses ANTHROPIC_API_KEY or cloud env vars (Bedrock/Vertex/Foundry)
    supportsApiKey:        true,
    supportsCustomBaseUrl: false, // endpoint is managed by the SDK internally
    supportsModelListing:  false,
  },
};

export function getCapabilities(type: ProviderType): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[type] ?? {
    supportsOAuth:         false,
    supportsApiKey:        true,
    supportsCustomBaseUrl: true,
    supportsModelListing:  false,
  };
}
