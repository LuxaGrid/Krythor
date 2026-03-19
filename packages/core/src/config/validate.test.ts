/**
 * Tests for config validation utilities.
 *
 * These are pure unit tests — no file I/O, no DB, no network.
 * Covers: valid input, missing required fields, invalid enum values,
 * type coercion / defaults, and bulk list parsing with mixed valid/invalid entries.
 */

import { describe, it, expect } from 'vitest';
import {
  validateAgentDefinition,
  parseAgentList,
  parseAppConfig,
  validateProviderConfig,
  parseProviderList,
} from './validate.js';

// ── validateAgentDefinition ──────────────────────────────────────────────────

describe('validateAgentDefinition', () => {
  const minimal = {
    id: 'abc-123',
    name: 'Test Agent',
    systemPrompt: 'You are a test agent.',
  };

  it('accepts a minimal valid agent and applies defaults', () => {
    const result = validateAgentDefinition(minimal);
    expect(result.value).not.toBeNull();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.value!.memoryScope).toBe('agent');       // default
    expect(result.value!.maxTurns).toBe(10);               // default
    expect(result.value!.tags).toEqual([]);                // default
    expect(result.value!.description).toBe('');            // default
  });

  it('rejects if id is missing', () => {
    const result = validateAgentDefinition({ ...minimal, id: undefined });
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
    expect(result.errors.some(e => e.includes('id'))).toBe(true);
  });

  it('rejects if name is missing', () => {
    const result = validateAgentDefinition({ ...minimal, name: '' });
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
  });

  it('rejects if systemPrompt is missing', () => {
    const result = validateAgentDefinition({ ...minimal, systemPrompt: undefined });
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(validateAgentDefinition(null).valid).toBe(false);
    expect(validateAgentDefinition('string').valid).toBe(false);
    expect(validateAgentDefinition(42).valid).toBe(false);
  });

  it('applies default memoryScope when value is invalid', () => {
    const result = validateAgentDefinition({ ...minimal, memoryScope: 'galaxy' });
    expect(result.value).not.toBeNull();
    expect(result.value!.memoryScope).toBe('agent');
    expect(result.errors.some(e => e.includes('memoryScope'))).toBe(true);
  });

  it('accepts valid memoryScope values', () => {
    for (const scope of ['session', 'agent', 'workspace'] as const) {
      const result = validateAgentDefinition({ ...minimal, memoryScope: scope });
      expect(result.value!.memoryScope).toBe(scope);
    }
  });

  it('applies default maxTurns when value is invalid', () => {
    const result = validateAgentDefinition({ ...minimal, maxTurns: 'a lot' });
    expect(result.value!.maxTurns).toBe(10);
  });

  it('strips non-string tags', () => {
    const result = validateAgentDefinition({ ...minimal, tags: ['valid', 42, null, 'also-valid'] });
    expect(result.value!.tags).toEqual(['valid', 'also-valid']);
  });

  it('preserves all optional fields when valid', () => {
    const full = {
      ...minimal,
      description: 'A full agent',
      modelId: 'claude-opus',
      providerId: 'prov-1',
      memoryScope: 'workspace',
      maxTurns: 5,
      temperature: 0.7,
      maxTokens: 2048,
      tags: ['code', 'analysis'],
      createdAt: 1000,
      updatedAt: 2000,
    };
    const result = validateAgentDefinition(full);
    expect(result.valid).toBe(true);
    expect(result.value!.description).toBe('A full agent');
    expect(result.value!.temperature).toBe(0.7);
    expect(result.value!.maxTokens).toBe(2048);
    expect(result.value!.createdAt).toBe(1000);
  });
});

// ── parseAgentList ────────────────────────────────────────────────────────────

describe('parseAgentList', () => {
  const valid1 = { id: 'a1', name: 'Agent 1', systemPrompt: 'sp1' };
  const valid2 = { id: 'a2', name: 'Agent 2', systemPrompt: 'sp2' };
  const invalid = { id: '', name: 'Bad' }; // missing systemPrompt and id

  it('returns all valid agents from a clean list', () => {
    const { agents, skipped, errors } = parseAgentList([valid1, valid2]);
    expect(agents).toHaveLength(2);
    expect(skipped).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it('skips invalid entries and reports them', () => {
    const { agents, skipped, errors } = parseAgentList([valid1, invalid, valid2]);
    expect(agents).toHaveLength(2);
    expect(skipped).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('returns empty list for non-array input', () => {
    const { agents, skipped, errors } = parseAgentList({ id: 'a1' });
    expect(agents).toHaveLength(0);
    expect(skipped).toBe(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('returns empty list for empty array', () => {
    const { agents, skipped } = parseAgentList([]);
    expect(agents).toHaveLength(0);
    expect(skipped).toBe(0);
  });
});

// ── parseAppConfig ────────────────────────────────────────────────────────────

describe('parseAppConfig', () => {
  it('returns empty object for empty input', () => {
    const { value, valid } = parseAppConfig({});
    expect(value).toEqual({});
    expect(valid).toBe(true);
  });

  it('accepts valid fields', () => {
    const { value, valid } = parseAppConfig({
      selectedAgentId: 'abc',
      selectedModel: 'claude',
      onboardingComplete: true,
    });
    expect(valid).toBe(true);
    expect(value.selectedAgentId).toBe('abc');
    expect(value.selectedModel).toBe('claude');
    expect(value.onboardingComplete).toBe(true);
  });

  it('rejects non-object input', () => {
    expect(parseAppConfig(null).valid).toBe(false);
    expect(parseAppConfig([]).valid).toBe(false);
    expect(parseAppConfig('string').valid).toBe(false);
  });

  it('treats null selectedAgentId as clear (omits from value)', () => {
    const { value } = parseAppConfig({ selectedAgentId: null });
    expect('selectedAgentId' in value).toBe(false);
  });

  it('reports type errors without crashing', () => {
    const { value, errors } = parseAppConfig({ onboardingComplete: 'yes' });
    expect(errors.some(e => e.includes('onboardingComplete'))).toBe(true);
    expect('onboardingComplete' in value).toBe(false);
  });
});

// ── validateProviderConfig ────────────────────────────────────────────────────

describe('validateProviderConfig', () => {
  const minimal = {
    id: 'p1',
    name: 'Local Ollama',
    type: 'ollama',
    endpoint: 'http://localhost:11434',
  };

  it('accepts a minimal valid provider and applies defaults', () => {
    const result = validateProviderConfig(minimal);
    expect(result.value).not.toBeNull();
    expect(result.valid).toBe(true);
    expect(result.value!.isDefault).toBe(false);   // default
    expect(result.value!.isEnabled).toBe(true);    // default
    expect(result.value!.models).toEqual([]);      // default
  });

  it('rejects unknown provider type', () => {
    const result = validateProviderConfig({ ...minimal, type: 'gemini' });
    expect(result.valid).toBe(false);
    expect(result.value).toBeNull();
  });

  it('accepts all valid provider types', () => {
    for (const type of ['ollama', 'openai', 'anthropic', 'openai-compat', 'gguf']) {
      const result = validateProviderConfig({ ...minimal, type });
      expect(result.value).not.toBeNull();
    }
  });

  it('rejects missing endpoint', () => {
    const result = validateProviderConfig({ ...minimal, endpoint: '' });
    expect(result.valid).toBe(false);
  });

  it('strips non-string models', () => {
    const result = validateProviderConfig({ ...minimal, models: ['gpt-4', 42, null] });
    expect(result.value!.models).toEqual(['gpt-4']);
  });
});

// ── parseProviderList ─────────────────────────────────────────────────────────

describe('parseProviderList', () => {
  const p1 = { id: 'p1', name: 'Ollama', type: 'ollama', endpoint: 'http://localhost:11434' };
  const p2 = { id: 'p2', name: 'OpenAI', type: 'openai', endpoint: 'https://api.openai.com' };
  const bad = { id: '', type: 'unknown' };

  it('handles flat array format', () => {
    const { providers, skipped } = parseProviderList([p1, p2]);
    expect(providers).toHaveLength(2);
    expect(skipped).toBe(0);
  });

  it('returns empty for wrapped { providers: [...] } format (flat array only in core)', () => {
    // core parseProviderList expects a flat array; the wrapped format is handled
    // by packages/models/src/config/validate.ts which has no dep on core.
    const { providers, errors } = parseProviderList({ version: '1', providers: [p1] });
    expect(providers).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('skips invalid providers', () => {
    const { providers, skipped, errors } = parseProviderList([p1, bad, p2]);
    expect(providers).toHaveLength(2);
    expect(skipped).toBe(1);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('returns empty for unrecognised format', () => {
    const { providers, errors } = parseProviderList({ foo: 'bar' });
    expect(providers).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });
});
