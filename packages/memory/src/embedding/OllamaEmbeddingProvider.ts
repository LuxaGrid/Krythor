import type { EmbeddingProvider, EmbeddingVector } from '../types.js';

// ─── Ollama Embedding Provider ────────────────────────────────────────────────
//
// Calls Ollama's POST /api/embeddings endpoint to produce real semantic vectors.
// The provider is available only when the Ollama server is reachable.
// Registered in MemoryEngine when an Ollama model provider is configured.
//

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  private baseUrl: string;
  private model: string;
  private _available = true;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.name = `ollama:${model}`;
  }

  isAvailable(): boolean {
    return this._available;
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      this._available = false;
      throw new Error(`Ollama embeddings error: ${res.status}`);
    }
    const data = await res.json() as { embedding: number[] };
    this._available = true;
    return { values: data.embedding, model: this.model };
  }

  similarity(a: EmbeddingVector, b: EmbeddingVector): number {
    if (a.values.length !== b.values.length) return 0;
    const dot = a.values.reduce((s, v, i) => s + v * (b.values[i] ?? 0), 0);
    const normA = Math.sqrt(a.values.reduce((s, v) => s + v * v, 0));
    const normB = Math.sqrt(b.values.reduce((s, v) => s + v * v, 0));
    if (normA === 0 || normB === 0) return 0;
    return dot / (normA * normB);
  }
}
