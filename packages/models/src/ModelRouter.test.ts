import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelRouter } from './ModelRouter.js';
import type { ModelRegistry } from './ModelRegistry.js';
import type { BaseProvider } from './providers/BaseProvider.js';
import type { InferenceRequest, InferenceResponse, StreamChunk } from './types.js';

// Minimal mock provider
function makeProvider(id: string, models: string[], isEnabled = true, isDefault = false): BaseProvider {
  return {
    id,
    name: `Provider ${id}`,
    type: 'ollama',
    isEnabled,
    getModels: () => models,
    getModelInfo: (modelId: string) => ({
      id: modelId,
      providerId: id,
      badges: [],
      isAvailable: models.includes(modelId),
    }),
    infer: vi.fn(async (): Promise<InferenceResponse> => ({
      content: 'test response',
      model: models[0] ?? '',
      providerId: id,
      durationMs: 10,
    })),
    inferStream: vi.fn(async function* (): AsyncGenerator<StreamChunk> {
      yield { delta: 'test', done: true };
    }),
    isAvailable: vi.fn(async () => true),
    listModels: vi.fn(async () => models),
  } as unknown as BaseProvider;
}

// Minimal mock registry
function makeRegistry(opts: {
  providers: BaseProvider[];
  defaultProvider?: BaseProvider | null;
}): ModelRegistry {
  return {
    getProvider: (id: string) => opts.providers.find(p => p.id === id) ?? null,
    getDefaultProvider: () => opts.defaultProvider ?? null,
    listEnabled: () => opts.providers.filter(p => p.isEnabled),
    listConfigs: () => [],
    addProvider: vi.fn(),
    updateProvider: vi.fn(),
    removeProvider: vi.fn(),
  } as unknown as ModelRegistry;
}

describe('ModelRouter', () => {
  let router: ModelRouter;
  let providerA: BaseProvider;
  let providerB: BaseProvider;

  beforeEach(() => {
    providerA = makeProvider('a', ['model-a1', 'model-a2'], true,  true);
    providerB = makeProvider('b', ['model-b1'],             true,  false);
    const registry = makeRegistry({ providers: [providerA, providerB], defaultProvider: providerA });
    router = new ModelRouter(registry);
  });

  it('routes to explicit provider when providerId is set', () => {
    const request: InferenceRequest = { messages: [{ role: 'user', content: 'hi' }], providerId: 'b' };
    const { provider, model } = router.resolve(request);
    expect(provider.id).toBe('b');
    expect(model).toBe('model-b1');
  });

  it('uses default provider when no override specified', () => {
    const request: InferenceRequest = { messages: [{ role: 'user', content: 'hi' }] };
    const { provider, model } = router.resolve(request);
    expect(provider.id).toBe('a');
    expect(model).toBe('model-a1');
  });

  it('routes to provider by agentModelId context', () => {
    const request: InferenceRequest = { messages: [{ role: 'user', content: 'hi' }] };
    const { provider, model } = router.resolve(request, { agentModelId: 'model-b1' });
    expect(provider.id).toBe('b');
    expect(model).toBe('model-b1');
  });

  it('skillModelId takes priority over agentModelId', () => {
    const request: InferenceRequest = { messages: [{ role: 'user', content: 'hi' }] };
    const { provider, model } = router.resolve(request, {
      agentModelId: 'model-b1',
      skillModelId: 'model-a2',
    });
    expect(provider.id).toBe('a');
    expect(model).toBe('model-a2');
  });

  it('throws when no provider is available', () => {
    const emptyRegistry = makeRegistry({ providers: [], defaultProvider: null });
    const emptyRouter = new ModelRouter(emptyRegistry);
    expect(() => emptyRouter.resolve({ messages: [] })).toThrow();
  });

  it('listAllModels returns models from all enabled providers', () => {
    const models = router.listAllModels();
    const ids = models.map(m => m.id);
    expect(ids).toContain('model-a1');
    expect(ids).toContain('model-a2');
    expect(ids).toContain('model-b1');
  });

  it('infer calls provider.infer with resolved model', async () => {
    const request: InferenceRequest = { messages: [{ role: 'user', content: 'hello' }] };
    await router.infer(request);
    expect(providerA.infer).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'model-a1' }),
      undefined,
    );
  });
});
