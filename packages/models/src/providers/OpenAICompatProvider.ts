import { OpenAIProvider } from './OpenAIProvider.js';

// OpenAI-compatible endpoints (LM Studio, vLLM, LocalAI, Together, Groq, etc.)
// Also used for GGUF providers — llama-server exposes an OpenAI-compat API.
//
// GGUF providers get a descriptive unavailable reason so logs and UI can guide
// the user to start llama-server rather than showing a generic connection error.

export class OpenAICompatProvider extends OpenAIProvider {
  /** Last known unavailable reason — populated when isAvailable() returns false. */
  lastUnavailableReason?: string;

  /**
   * Fetch the model list from the provider's /models endpoint without applying
   * the OpenAI chat-prefix filter. OpenAI-compat providers (Groq, Mistral,
   * Venice, OpenRouter, Gemini, LM Studio, etc.) use their own model naming
   * conventions that don't share OpenAI prefixes.
   */
  override async listModels(): Promise<string[]> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.getBearerToken();
    if (token) h['Authorization'] = `Bearer ${token}`;
    try {
      const data = await this.httpGet(`${this.config.endpoint}/models`, h) as {
        data?: Array<{ id: string }>;
      };
      const ids = (data.data ?? [])
        .map((m: { id: string }) => m.id.replace(/^models\//, '')) // strip Gemini "models/" prefix
        .filter((id: string) => {
          if (!id) return false;
          // Exclude known non-chat model types that appear in Gemini and other APIs
          const nonChat = [
            'embedding', 'imagen', 'veo', 'tts', 'aqa', 'lyria',
            'robotics', 'computer-use', 'deep-research', 'audio-latest',
            'native-audio', 'realtime', 'live-preview', 'image-preview',
            'clip-preview',
          ];
          return !nonChat.some(nc => id.toLowerCase().includes(nc));
        });
      return ids.length > 0 ? ids : this.config.models;
    } catch {
      return this.config.models;
    }
  }

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
