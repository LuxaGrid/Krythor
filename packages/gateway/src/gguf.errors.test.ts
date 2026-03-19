/**
 * Tests for GGUF-specific error classification and provider messaging.
 */
import { describe, it, expect } from 'vitest';
import { classifyError } from './errors.js';

describe('GGUF error classification', () => {
  it('classifies localhost ECONNREFUSED as LOCAL_SERVER_UNAVAILABLE', () => {
    const err = new Error('fetch failed: ECONNREFUSED 127.0.0.1:8080');
    const result = classifyError(err);
    expect(result.code).toBe('LOCAL_SERVER_UNAVAILABLE');
    expect(result.hint).toContain('llama-server');
    expect(result.hint).toContain('ollama serve');
  });

  it('classifies localhost connection refused as LOCAL_SERVER_UNAVAILABLE', () => {
    const err = new Error('ECONNREFUSED localhost:8080');
    const result = classifyError(err);
    expect(result.code).toBe('LOCAL_SERVER_UNAVAILABLE');
  });

  it('classifies remote ECONNREFUSED as MODEL_UNAVAILABLE (not local)', () => {
    const err = new Error('ECONNREFUSED 52.0.0.1:443');
    const result = classifyError(err);
    expect(result.code).toBe('MODEL_UNAVAILABLE');
  });

  it('classifies ENOTFOUND as MODEL_UNAVAILABLE', () => {
    const err = new Error('getaddrinfo ENOTFOUND api.openai.com');
    const result = classifyError(err);
    expect(result.code).toBe('MODEL_UNAVAILABLE');
  });

  it('classifies no-provider message as NO_PROVIDER', () => {
    const err = new Error('No provider configured');
    const result = classifyError(err);
    expect(result.code).toBe('NO_PROVIDER');
  });
});
