import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelRecommender } from './ModelRecommender.js';
import type { ModelEngine } from './ModelEngine.js';
import type { ModelInfo, ProviderConfig } from './types.js';

function makeModel(overrides: Partial<ModelInfo>): ModelInfo {
  return {
    id: 'test-model',
    name: 'Test Model',
    providerId: 'test-provider',
    badges: [],
    isAvailable: true,
    circuitState: 'closed',
    ...overrides,
  };
}

function makeMockEngine(models: ModelInfo[], providers: Partial<ProviderConfig>[] = []): ModelEngine {
  return {
    listModels: () => models,
    listProviders: () => providers as ProviderConfig[],
    stats: () => ({ providerCount: providers.length, modelCount: models.length, hasDefault: false }),
  } as unknown as ModelEngine;
}

describe('ModelRecommender', () => {
  describe('when only one model is available', () => {
    it('returns null — no choice to make', () => {
      const engine = makeMockEngine([makeModel({ id: 'llama3' })]);
      const rec = new ModelRecommender(engine);
      expect(rec.recommend('summarize')).toBeNull();
    });
  });

  describe('when no models are available', () => {
    it('returns null', () => {
      const engine = makeMockEngine([]);
      const rec = new ModelRecommender(engine);
      expect(rec.recommend('code')).toBeNull();
    });
  });

  describe('with multiple models', () => {
    let engine: ModelEngine;

    beforeEach(() => {
      engine = makeMockEngine(
        [
          makeModel({ id: 'claude-sonnet-4-6', providerId: 'anthropic', badges: ['remote'] }),
          makeModel({ id: 'llama3.1:8b',       providerId: 'ollama',    badges: ['local'] }),
          makeModel({ id: 'llama3.1:70b',      providerId: 'ollama',    badges: ['local'] }),
        ],
        [
          { id: 'anthropic', type: 'anthropic', isEnabled: true },
          { id: 'ollama',    type: 'ollama',    isEnabled: true },
        ],
      );
    });

    it('recommends a model for summarize (local preferred)', () => {
      const rec = new ModelRecommender(engine);
      const result = rec.recommend('summarize');
      expect(result).not.toBeNull();
      expect(result!.modelId).toBeTruthy();
      expect(result!.reason).toBeTruthy();
    });

    it('recommends a premium model for code tasks', () => {
      const rec = new ModelRecommender(engine);
      const result = rec.recommend('code');
      expect(result).not.toBeNull();
      // Claude Sonnet should win for code — higher capability tier
      expect(result!.modelId).toBe('claude-sonnet-4-6');
    });

    it('includes isLocal flag', () => {
      const rec = new ModelRecommender(engine);
      const result = rec.recommend('triage');
      expect(result).not.toBeNull();
      expect(typeof result!.isLocal).toBe('boolean');
    });
  });

  describe('pinned preferences', () => {
    it('honors always_use preference — returns pinned model', () => {
      const engine = makeMockEngine(
        [
          makeModel({ id: 'model-a', providerId: 'p1' }),
          makeModel({ id: 'model-b', providerId: 'p1' }),
        ],
        [{ id: 'p1', type: 'ollama', isEnabled: true }],
      );
      const rec = new ModelRecommender(engine);
      rec.setPreference({ taskType: 'summarize', modelId: 'model-a', providerId: 'p1', preference: 'always_use' });
      const result = rec.recommend('summarize');
      expect(result).not.toBeNull();
      expect(result!.modelId).toBe('model-a');
    });

    it('clearPreference removes pinned preference', () => {
      const engine = makeMockEngine(
        [makeModel({ id: 'a', providerId: 'p1' }), makeModel({ id: 'b', providerId: 'p1' })],
        [{ id: 'p1', type: 'ollama', isEnabled: true }],
      );
      const rec = new ModelRecommender(engine);
      rec.setPreference({ taskType: 'code', modelId: 'a', providerId: 'p1', preference: 'always_use' });
      rec.clearPreference('code');
      expect(rec.getPreference('code')).toBeNull();
    });

    it('listPreferences returns all set preferences', () => {
      const engine = makeMockEngine([], []);
      const rec = new ModelRecommender(engine);
      rec.setPreference({ taskType: 'code',      modelId: 'a', providerId: 'p', preference: 'always_use' });
      rec.setPreference({ taskType: 'summarize', modelId: 'b', providerId: 'p', preference: 'ask' });
      expect(rec.listPreferences()).toHaveLength(2);
    });
  });

  describe('circuit-open models', () => {
    it('excludes models with open circuits', () => {
      const engine = makeMockEngine(
        [
          makeModel({ id: 'good-model',   providerId: 'p1', circuitState: 'closed' }),
          makeModel({ id: 'broken-model', providerId: 'p2', circuitState: 'open' }),
        ],
        [{ id: 'p1', type: 'ollama', isEnabled: true }],
      );
      const rec = new ModelRecommender(engine);
      // Only 1 eligible (good-model) — returns null (single eligible)
      const result = rec.recommend('general');
      expect(result).toBeNull(); // only 1 eligible after filtering
    });
  });
});
