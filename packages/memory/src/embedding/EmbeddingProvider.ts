import type { EmbeddingProvider, EmbeddingVector } from '../types.js';

// ─── Stub Embedding Provider ──────────────────────────────────────────────────
//
// This is the Phase 3 placeholder. It does NOT produce real semantic vectors.
// It returns a deterministic hash-based pseudo-vector so the interface works
// end-to-end without external dependencies.
//
// Future providers (Ollama embeddings, OpenAI text-embedding, local GGUF) will
// implement the same EmbeddingProvider interface and be registered via
// EmbeddingRegistry without changing any other code.
//

export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'stub';

  isAvailable(): boolean {
    return true;
  }

  async embed(text: string): Promise<EmbeddingVector> {
    // Deterministic 64-dim pseudo-vector derived from text characters.
    // NOT semantically meaningful — replaced in Phase 4 by a real provider.
    const dims = 64;
    const values = new Array<number>(dims).fill(0);
    for (let i = 0; i < text.length; i++) {
      values[i % dims] += text.charCodeAt(i) / 255;
    }
    // Normalize
    const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0)) || 1;
    return {
      values: values.map(v => v / norm),
      model: this.name,
    };
  }

  similarity(a: EmbeddingVector, b: EmbeddingVector): number {
    // Cosine similarity
    if (a.values.length !== b.values.length) return 0;
    const dot = a.values.reduce((s, v, i) => s + v * (b.values[i] ?? 0), 0);
    const normA = Math.sqrt(a.values.reduce((s, v) => s + v * v, 0));
    const normB = Math.sqrt(b.values.reduce((s, v) => s + v * v, 0));
    if (normA === 0 || normB === 0) return 0;
    return dot / (normA * normB);
  }
}

// ─── Embedding Registry ───────────────────────────────────────────────────────

export class EmbeddingRegistry {
  private providers = new Map<string, EmbeddingProvider>();
  private activeKey = 'stub';

  constructor() {
    this.register(new StubEmbeddingProvider());
  }

  register(provider: EmbeddingProvider): void {
    this.providers.set(provider.name, provider);
  }

  setActive(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Embedding provider "${name}" is not registered`);
    }
    this.activeKey = name;
  }

  getActive(): EmbeddingProvider {
    const p = this.providers.get(this.activeKey);
    if (!p) throw new Error(`Active embedding provider "${this.activeKey}" not found`);
    return p;
  }

  list(): string[] {
    return Array.from(this.providers.keys());
  }
}
