import { describe, it, expect, vi } from 'vitest';
import { PrivacyRouter, PrivacyBlockedError } from './PrivacyRouter.js';
import type { ModelEngine } from './ModelEngine.js';
import type { ProviderConfig } from './types.js';

// ── Mock ModelEngine ──────────────────────────────────────────────────────────

function makeMockEngine(providers: Partial<ProviderConfig>[] = []): ModelEngine {
  return {
    listProviders: vi.fn(() => providers),
    infer: vi.fn(async () => ({
      content: 'mock response',
      model: 'mock-model',
      providerId: 'mock-provider',
      durationMs: 10,
    })),
  } as unknown as ModelEngine;
}

function ollamaProvider(id = 'ollama-1'): Partial<ProviderConfig> {
  return { id, type: 'ollama', isEnabled: true, endpoint: 'http://localhost:11434' };
}

function remoteProvider(id = 'openai-1'): Partial<ProviderConfig> {
  return { id, type: 'openai', isEnabled: true, endpoint: 'https://api.openai.com' };
}

function localCompatProvider(id = 'lm-1'): Partial<ProviderConfig> {
  return { id, type: 'openai-compat', isEnabled: true, endpoint: 'http://127.0.0.1:1234' };
}

function makeRequest(content: string) {
  return { messages: [{ role: 'user' as const, content }] };
}

// ── classifySensitivity ───────────────────────────────────────────────────────

describe('PrivacyRouter.classifySensitivity', () => {
  const router = new PrivacyRouter(makeMockEngine());

  it('classifies plain text as public', () => {
    expect(router.classifySensitivity('What is the capital of France?')).toBe('public');
  });

  it('detects [RESTRICTED] tag', () => {
    expect(router.classifySensitivity('[RESTRICTED] top secret data')).toBe('restricted');
  });

  it('detects SSN pattern', () => {
    expect(router.classifySensitivity('My SSN is 123-45-6789')).toBe('restricted');
  });

  it('detects credit card pattern', () => {
    expect(router.classifySensitivity('Card: 4111 1111 1111 1111')).toBe('restricted');
  });

  it('detects [PRIVATE] tag', () => {
    expect(router.classifySensitivity('[PRIVATE] my data')).toBe('private');
  });

  it('detects email address', () => {
    expect(router.classifySensitivity('contact me at alice@example.com')).toBe('private');
  });

  it('detects phone number', () => {
    expect(router.classifySensitivity('Call me at (555) 123-4567')).toBe('private');
  });

  it('detects .env file mention', () => {
    expect(router.classifySensitivity('Check the .env file for credentials')).toBe('private');
  });

  it('detects password= pattern', () => {
    expect(router.classifySensitivity('password=SuperSecretPass123')).toBe('private');
  });

  it('detects [INTERNAL] tag', () => {
    expect(router.classifySensitivity('[INTERNAL] company document')).toBe('internal');
  });

  it('restricted takes priority over private', () => {
    expect(router.classifySensitivity('[RESTRICTED] email@example.com 123-45-6789')).toBe('restricted');
  });

  it('private takes priority over internal', () => {
    expect(router.classifySensitivity('[INTERNAL] password=abc email@example.com')).toBe('private');
  });

  it('respects metadata tag override to public', () => {
    expect(router.classifySensitivity('email@example.com', { sensitivityLabel: 'public' })).toBe('public');
  });

  it('respects metadata tag override to restricted', () => {
    expect(router.classifySensitivity('hello world', { sensitivityLabel: 'restricted' })).toBe('restricted');
  });
});

// ── findLocalProvider ─────────────────────────────────────────────────────────

describe('PrivacyRouter.findLocalProvider', () => {
  it('returns null when no providers', () => {
    const router = new PrivacyRouter(makeMockEngine([]));
    expect(router.findLocalProvider()).toBeNull();
  });

  it('returns null when only remote providers', () => {
    const router = new PrivacyRouter(makeMockEngine([remoteProvider()]));
    expect(router.findLocalProvider()).toBeNull();
  });

  it('returns ollama provider id', () => {
    const router = new PrivacyRouter(makeMockEngine([remoteProvider(), ollamaProvider('my-ollama')]));
    expect(router.findLocalProvider()).toBe('my-ollama');
  });

  it('returns gguf provider id when no ollama', () => {
    const gguf = { id: 'gguf-1', type: 'gguf' as const, isEnabled: true, endpoint: '/models/file.gguf' };
    const router = new PrivacyRouter(makeMockEngine([remoteProvider(), gguf]));
    expect(router.findLocalProvider()).toBe('gguf-1');
  });

  it('returns localhost openai-compat provider', () => {
    const router = new PrivacyRouter(makeMockEngine([remoteProvider(), localCompatProvider('lm-1')]));
    expect(router.findLocalProvider()).toBe('lm-1');
  });

  it('ignores disabled local providers', () => {
    const disabled = { ...ollamaProvider('ollama-off'), isEnabled: false };
    const router = new PrivacyRouter(makeMockEngine([disabled]));
    expect(router.findLocalProvider()).toBeNull();
  });
});

// ── infer ─────────────────────────────────────────────────────────────────────

describe('PrivacyRouter.infer', () => {
  it('returns privacyDecision with public label for safe content', async () => {
    const engine = makeMockEngine([remoteProvider()]);
    const router = new PrivacyRouter(engine);
    const result = await router.infer(makeRequest('what is 2+2'));
    expect(result.privacyDecision.sensitivityLabel).toBe('public');
    expect(result.privacyDecision.remoteAllowed).toBe(true);
    expect(result.privacyDecision.reroutedTo).toBeUndefined();
    expect(result.privacyDecision.redactionApplied).toBe(false);
  });

  it('re-routes private content to local provider when available', async () => {
    const engine = makeMockEngine([remoteProvider(), ollamaProvider('local-ollama')]);
    const router = new PrivacyRouter(engine);
    const result = await router.infer(makeRequest('my password=abc123'));
    expect(result.privacyDecision.sensitivityLabel).toBe('private');
    expect(result.privacyDecision.reroutedTo).toBe('local-ollama');
    expect(result.privacyDecision.remoteAllowed).toBe(false);
    // Verify engine was called with local provider override
    const mockInfer = engine.infer as ReturnType<typeof vi.fn>;
    expect(mockInfer.mock.calls[0][0].providerId).toBe('local-ollama');
  });

  it('allows remote for private content when no local provider (blockOnPrivate=false)', async () => {
    const engine = makeMockEngine([remoteProvider()]);
    const router = new PrivacyRouter(engine, false);
    const result = await router.infer(makeRequest('my email is alice@example.com'));
    expect(result.privacyDecision.sensitivityLabel).toBe('private');
    expect(result.privacyDecision.reroutedTo).toBeUndefined();
    // Engine still called
    expect((engine.infer as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('throws PrivacyBlockedError for restricted content when blockOnPrivate=true', async () => {
    const engine = makeMockEngine([remoteProvider()]);
    const router = new PrivacyRouter(engine, true);
    await expect(
      router.infer(makeRequest('SSN: 123-45-6789'))
    ).rejects.toThrow(PrivacyBlockedError);
  });

  it('does NOT block when blockOnPrivate=true but local provider exists', async () => {
    const engine = makeMockEngine([remoteProvider(), ollamaProvider()]);
    const router = new PrivacyRouter(engine, true);
    // Should re-route to local instead of throwing
    const result = await router.infer(makeRequest('SSN: 123-45-6789'));
    expect(result.privacyDecision.reroutedTo).toBeTruthy();
  });

  it('passes signal to underlying engine', async () => {
    const engine = makeMockEngine([remoteProvider()]);
    const router = new PrivacyRouter(engine);
    const signal = AbortSignal.timeout(5000);
    await router.infer(makeRequest('hello'), undefined, signal);
    const mockInfer = engine.infer as ReturnType<typeof vi.fn>;
    expect(mockInfer.mock.calls[0][2]).toBe(signal);
  });
});
