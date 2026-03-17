import { OpenAIProvider } from './OpenAIProvider.js';

// OpenAI-compatible endpoints (LM Studio, vLLM, LocalAI, Together, Groq, etc.)
// Identical to OpenAIProvider — the base URL points to the compatible server.
// Separate class so UI can display "openai-compat" badge and allow custom naming.

export class OpenAICompatProvider extends OpenAIProvider {
  // Inherits all OpenAI logic — endpoint is set per-provider in config.
  // No overrides needed; type badge differentiation is handled by config.type.
}
