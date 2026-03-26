/**
 * Tests for ITEM H: model routing aliases in ModelEngine.resolveModelAlias()
 *
 * Aliases: claude → Anthropic, gpt4 → OpenAI, local → Ollama,
 *          fast → lowest latency, best → premium model preference.
 */

import { describe, it, expect, vi } from 'vitest';
import { ModelEngine } from './ModelEngine.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

type FakeProviderOpts = {
  id: string;
  type: string;
  models: string[];
  isEnabled?: boolean;
};

function injectProvider(engine: ModelEngine, opts: FakeProviderOpts): void {
  const fakeProvider = {
    id: opts.id,
    name: opts.id,
    type: opts.type,
    isEnabled: opts.isEnabled !== false,
    getModels: () => opts.models,
    getModelInfo: (m: string) => ({ id: m, providerId: opts.id, name: m, badges: [], isAvailable: true }),
    infer: vi.fn(),
    inferStream: vi.fn(),
    isAvailable: vi.fn(async () => true),
    listModels: vi.fn(async () => opts.models),
  };

  // Inject into the registry's internal providers map
  const providersMap = (engine.registry as unknown as { providers: Map<string, unknown> }).providers;
  providersMap.set(opts.id, fakeProvider);

  // Also inject into configs so listConfigs() returns it
  const existingConfigs: unknown[] = (engine.registry as unknown as { configs: unknown[] }).configs;
  existingConfigs.push({
    id: opts.id,
    type: opts.type,
    name: opts.id,
    models: opts.models,
    isEnabled: opts.isEnabled !== false,
    priority: 0,
  });
}

function makeEngine(): ModelEngine {
  return new ModelEngine('/tmp/krythor-alias-test');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ModelEngine.resolveModelAlias()', () => {

  it('returns null for an unknown alias string', () => {
    const engine = makeEngine();
    expect(engine.resolveModelAlias('unknown-model')).toBeNull();
    expect(engine.resolveModelAlias('gpt-4o')).toBeNull(); // full model IDs pass through
    expect(engine.resolveModelAlias('')).toBeNull();
  });

  it('"claude" alias resolves to first Anthropic provider\'s first model', () => {
    const engine = makeEngine();
    injectProvider(engine, { id: 'anthropic-1', type: 'anthropic', models: ['claude-sonnet-4-6', 'claude-haiku'] });

    const result = engine.resolveModelAlias('claude');
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('claude-sonnet-4-6');
    expect(result!.providerId).toBe('anthropic-1');
  });

  it('"claude" alias returns null when no Anthropic provider is configured', () => {
    const engine = makeEngine();
    injectProvider(engine, { id: 'ollama-1', type: 'ollama', models: ['llama3'] });

    expect(engine.resolveModelAlias('claude')).toBeNull();
  });

  it('"gpt4" alias resolves to first OpenAI provider, preferring gpt-4 model', () => {
    const engine = makeEngine();
    injectProvider(engine, { id: 'openai-1', type: 'openai', models: ['gpt-3.5-turbo', 'gpt-4o', 'gpt-4-turbo'] });

    const result = engine.resolveModelAlias('gpt4');
    expect(result).not.toBeNull();
    expect(result!.modelId).toMatch(/gpt-4/);
    expect(result!.providerId).toBe('openai-1');
  });

  it('"local" alias resolves to first Ollama provider\'s first model', () => {
    const engine = makeEngine();
    injectProvider(engine, { id: 'ollama-1', type: 'ollama', models: ['llama3.2', 'phi3'] });

    const result = engine.resolveModelAlias('local');
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('llama3.2');
    expect(result!.providerId).toBe('ollama-1');
  });

  it('"local" alias returns null when no Ollama provider is configured', () => {
    const engine = makeEngine();
    injectProvider(engine, { id: 'openai-1', type: 'openai', models: ['gpt-4o'] });

    expect(engine.resolveModelAlias('local')).toBeNull();
  });

  it('"fast" alias resolves to first enabled provider when no latency data exists', () => {
    const engine = makeEngine();
    injectProvider(engine, { id: 'prov-a', type: 'openai', models: ['gpt-4o'] });

    const result = engine.resolveModelAlias('fast');
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('gpt-4o');
  });

  it('"best" alias resolves to a premium model when available', () => {
    const engine = makeEngine();
    injectProvider(engine, { id: 'anthropic-1', type: 'anthropic', models: ['claude-sonnet-4-6'] });
    injectProvider(engine, { id: 'ollama-1', type: 'ollama', models: ['phi3'] });

    const result = engine.resolveModelAlias('best');
    expect(result).not.toBeNull();
    // Should prefer claude over phi3
    expect(result!.modelId).toBe('claude-sonnet-4-6');
  });

  it('"best" alias falls back to first model when no premium model is found', () => {
    const engine = makeEngine();
    injectProvider(engine, { id: 'ollama-1', type: 'ollama', models: ['phi3', 'llama3'] });

    const result = engine.resolveModelAlias('best');
    expect(result).not.toBeNull();
    expect(result!.modelId).toBe('phi3');
  });

  it('alias resolution is case-insensitive', () => {
    const engine = makeEngine();
    injectProvider(engine, { id: 'anthropic-1', type: 'anthropic', models: ['claude-3'] });

    expect(engine.resolveModelAlias('CLAUDE')).not.toBeNull();
    expect(engine.resolveModelAlias('Claude')).not.toBeNull();
    expect(engine.resolveModelAlias('LOCAL')).toBeNull(); // no ollama provider
  });
});
