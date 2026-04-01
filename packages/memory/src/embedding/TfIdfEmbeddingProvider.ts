import type { EmbeddingProvider, EmbeddingVector } from '../types.js';

// ─── TF-IDF Embedding Provider ────────────────────────────────────────────────
//
// Pure JS/TS implementation that produces real TF-IDF term vectors for semantic
// similarity. No external service or GPU required — works fully offline.
//
// Approach:
//   1. Tokenise text into lowercase alpha tokens (>= 2 chars), removing English
//      stop-words.
//   2. Maintain an in-process vocabulary of terms seen across all embed() calls
//      and a document-frequency count per term.
//   3. For a given text, compute a sparse TF-IDF vector; project into a fixed
//      DIMS dense space via a deterministic hash bucketing scheme (locality-
//      sensitive-ish: each term maps to one of DIMS buckets additively).
//   4. L2-normalise the result so cosine similarity equals dot product.
//
// Similarity quality is far better than the hash-based stub because it actually
// distinguishes between documents that share no vocabulary vs. documents that
// share many terms, and rewards rare shared terms more than common ones.
//

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','as','is','are','was','were','be','been','being','have',
  'has','had','do','does','did','will','would','could','should','may',
  'might','shall','can','it','its','this','that','these','those','i',
  'me','my','we','our','you','your','he','him','his','she','her','they',
  'them','their','what','which','who','whom','not','no','nor','so','yet',
  'both','either','neither','if','then','than','also','just','more','some',
  'any','all','each','every','about','into','through','up','out','there',
  'here','how','when','where','why','us',
]);

/** Fixed output dimensionality for the dense projected vector. */
const DIMS = 256;

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * Deterministic bucket for a term: djb2-style hash mapped to [0, DIMS).
 * Two distinct terms may collide into the same bucket (acceptable trade-off
 * for a fixed-size dense vector without a global vocabulary index).
 */
function termBucket(term: string): number {
  let h = 5381;
  for (let i = 0; i < term.length; i++) {
    h = ((h << 5) + h) ^ term.charCodeAt(i);
    h = h >>> 0; // keep 32-bit unsigned
  }
  return h % DIMS;
}

export class TfIdfEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'tfidf';

  /** document-frequency: how many embed() calls contained each term */
  private df = new Map<string, number>();
  /** total number of documents (embed calls) processed */
  private docCount = 0;

  isAvailable(): boolean {
    return true;
  }

  async embed(text: string): Promise<EmbeddingVector> {
    const tokens = tokenise(text);
    if (tokens.length === 0) {
      return { values: new Array<number>(DIMS).fill(0), model: this.name };
    }

    // Term frequency for this document
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }

    // Update global document-frequency counts
    this.docCount++;
    for (const term of tf.keys()) {
      this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }

    // Compute TF-IDF weights and project into dense vector via hash bucketing
    const vec = new Array<number>(DIMS).fill(0);
    const maxTf = Math.max(...tf.values());

    for (const [term, count] of tf) {
      // Augmented TF: 0.5 + 0.5 * (tf / max_tf) — avoids bias toward longer docs
      const termTf = 0.5 + 0.5 * (count / maxTf);
      // Smooth IDF: log((N + 1) / (df + 1)) + 1
      const df = this.df.get(term) ?? 1;
      const idf = Math.log((this.docCount + 1) / (df + 1)) + 1;
      const weight = termTf * idf;
      const bucket = termBucket(term);
      vec[bucket] += weight;
    }

    // L2 normalise
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return {
      values: vec.map(v => v / norm),
      model: this.name,
    };
  }

  similarity(a: EmbeddingVector, b: EmbeddingVector): number {
    if (a.values.length !== b.values.length) return 0;
    // Cosine similarity — vectors are L2-normalised so this equals dot product
    const dot = a.values.reduce((s, v, i) => s + v * (b.values[i] ?? 0), 0);
    const normA = Math.sqrt(a.values.reduce((s, v) => s + v * v, 0));
    const normB = Math.sqrt(b.values.reduce((s, v) => s + v * v, 0));
    if (normA === 0 || normB === 0) return 0;
    return dot / (normA * normB);
  }
}
