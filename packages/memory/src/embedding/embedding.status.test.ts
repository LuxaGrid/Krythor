/**
 * Tests for embedding degradation detection in MemoryEngine.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryEngine } from '../MemoryEngine.js';
import { OllamaEmbeddingProvider } from './OllamaEmbeddingProvider.js';

function makeMemory(): MemoryEngine {
  const dir = mkdtempSync(join(tmpdir(), 'krythor-embed-test-'));
  return new MemoryEngine(dir);
}

describe('Embedding status detection', () => {
  it('reports degraded when only stub provider is active', () => {
    const mem = makeMemory();
    const status = mem.embeddingStatus();
    expect(status.degraded).toBe(true);
    expect(status.semantic).toBe(false);
    expect(status.providerName).toBe('stub');
    mem.close();
  });

  it('reports semantic when a non-stub provider is registered and active', () => {
    const mem = makeMemory();
    const provider = new OllamaEmbeddingProvider('http://localhost:11434', 'nomic-embed-text');
    mem.registerEmbeddingProvider(provider);
    mem.setActiveEmbeddingProvider(provider.name);
    const status = mem.embeddingStatus();
    expect(status.degraded).toBe(false);
    expect(status.semantic).toBe(true);
    expect(status.providerName).toBe('ollama:nomic-embed-text');
    mem.close();
  });

  it('stats() includes embeddingDegraded field', () => {
    const mem = makeMemory();
    const stats = mem.stats();
    expect(stats).toHaveProperty('embeddingDegraded');
    expect(typeof stats.embeddingDegraded).toBe('boolean');
    mem.close();
  });

  it('reports degraded again when provider becomes unavailable', () => {
    const mem = makeMemory();
    const provider = new OllamaEmbeddingProvider('http://localhost:11434', 'nomic-embed-text');
    mem.registerEmbeddingProvider(provider);
    mem.setActiveEmbeddingProvider(provider.name);
    // Simulate unavailability
    provider['_available'] = false;
    const status = mem.embeddingStatus();
    expect(status.degraded).toBe(true);
    expect(status.semantic).toBe(false);
    mem.close();
  });
});
