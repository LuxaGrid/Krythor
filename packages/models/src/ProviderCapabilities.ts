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
    supportsOAuth:         false, // OpenAI API does not offer OAuth for direct API use
    supportsApiKey:        true,
    supportsCustomBaseUrl: false,
    supportsModelListing:  true,
  },
  anthropic: {
    supportsOAuth:         false, // Anthropic API is API-key only for now
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
};

export function getCapabilities(type: ProviderType): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[type] ?? {
    supportsOAuth:         false,
    supportsApiKey:        true,
    supportsCustomBaseUrl: true,
    supportsModelListing:  false,
  };
}
