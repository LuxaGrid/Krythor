import { OpenAIProvider } from './OpenAIProvider.js';

// OpenAI-compatible endpoints (LM Studio, vLLM, LocalAI, Together, Groq, etc.)
// Also used for GGUF providers — llama-server exposes an OpenAI-compat API.
//
// GGUF providers get a descriptive unavailable reason so logs and UI can guide
// the user to start llama-server rather than showing a generic connection error.

export class OpenAICompatProvider extends OpenAIProvider {
  /** Last known unavailable reason — populated when isAvailable() returns false. */
  lastUnavailableReason?: string;

  override async isAvailable(): Promise<boolean> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.getBearerToken();
    if (token) h['Authorization'] = `Bearer ${token}`;

    try {
      await this.httpGet(`${this.config.endpoint}/models`, h);
      this.lastUnavailableReason = undefined;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.config.type === 'gguf' && (msg.includes('ECONNREFUSED') || msg.includes('fetch failed'))) {
        this.lastUnavailableReason =
          `llama-server is not running at ${this.config.endpoint}. ` +
          `Start it with: llama-server --model <model.gguf> --port 8080`;
      } else {
        this.lastUnavailableReason = msg;
      }
      return false;
    }
  }
}
