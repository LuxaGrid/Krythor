/**
 * Tests for OllamaEmbeddingProvider.probe() — lightweight availability refresh.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaEmbeddingProvider } from './OllamaEmbeddingProvider.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OllamaEmbeddingProvider.probe()', () => {
  it('returns true and sets _available when server responds ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    const provider = new OllamaEmbeddingProvider('http://localhost:11434', 'nomic-embed-text');
    // @ts-expect-error set private
    provider['_available'] = false;

    const result = await provider.probe();

    expect(result).toBe(true);
    expect(provider.isAvailable()).toBe(true);
  });

  it('returns false and sets _available=false when server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const provider = new OllamaEmbeddingProvider('http://localhost:11434', 'nomic-embed-text');

    const result = await provider.probe();

    expect(result).toBe(false);
    expect(provider.isAvailable()).toBe(false);
  });

  it('returns false when server returns non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const provider = new OllamaEmbeddingProvider('http://localhost:11434', 'nomic-embed-text');

    const result = await provider.probe();

    expect(result).toBe(false);
    expect(provider.isAvailable()).toBe(false);
  });

  it('never throws — returns false on any error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network error')));
    const provider = new OllamaEmbeddingProvider('http://localhost:11434', 'nomic-embed-text');

    await expect(provider.probe()).resolves.toBe(false);
  });

  it('StubEmbeddingProvider does not have probe (returns undefined)', async () => {
    const { StubEmbeddingProvider } = await import('./EmbeddingProvider.js');
    const stub = new StubEmbeddingProvider();
    expect(stub.probe).toBeUndefined();
  });
});
