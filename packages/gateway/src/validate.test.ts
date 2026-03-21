/**
 * Tests for validate.ts — input sanitization helpers
 */

import { describe, it, expect } from 'vitest';
import {
  validateString,
  validateUrl,
  validateTags,
  MAX_NAME_LEN,
  MAX_DESCRIPTION_LEN,
  MAX_SYSTEM_PROMPT_LEN,
  MAX_ENDPOINT_LEN,
} from './validate.js';

describe('validateString', () => {
  it('returns trimmed value for valid string', () => {
    const { value, error } = validateString('  hello  ', 'name', 100);
    expect(value).toBe('hello');
    expect(error).toBeUndefined();
  });

  it('returns error when string exceeds maxLen', () => {
    const long = 'x'.repeat(MAX_NAME_LEN + 1);
    const { error } = validateString(long, 'name', MAX_NAME_LEN);
    expect(error).toMatch(/name must be/);
    expect(error).toMatch(/≤ 100/);
  });

  it('returns error when required field is blank', () => {
    const { error } = validateString('   ', 'name', 100, true);
    expect(error).toMatch(/blank/);
  });

  it('returns empty value when optional field is undefined', () => {
    const { value, error } = validateString(undefined, 'name', 100, false);
    expect(value).toBe('');
    expect(error).toBeUndefined();
  });

  it('returns error when required field is undefined', () => {
    const { error } = validateString(undefined, 'name', 100, true);
    expect(error).toMatch(/required/);
  });

  it('returns error when value is not a string', () => {
    const { error } = validateString(42, 'name', 100);
    expect(error).toMatch(/must be a string/);
  });

  it('accepts exactly MAX_DESCRIPTION_LEN chars', () => {
    const { error } = validateString('x'.repeat(MAX_DESCRIPTION_LEN), 'description', MAX_DESCRIPTION_LEN);
    expect(error).toBeUndefined();
  });

  it('rejects MAX_DESCRIPTION_LEN + 1 chars', () => {
    const { error } = validateString('x'.repeat(MAX_DESCRIPTION_LEN + 1), 'description', MAX_DESCRIPTION_LEN);
    expect(error).toMatch(/≤ 500/);
  });

  it('rejects systemPrompt over limit', () => {
    const { error } = validateString('x'.repeat(MAX_SYSTEM_PROMPT_LEN + 1), 'systemPrompt', MAX_SYSTEM_PROMPT_LEN);
    expect(error).toMatch(/≤ 10000/);
  });

  it('rejects endpoint over limit', () => {
    const { error } = validateString('x'.repeat(MAX_ENDPOINT_LEN + 1), 'endpoint', MAX_ENDPOINT_LEN);
    expect(error).toMatch(/≤ 500/);
  });
});

describe('validateUrl', () => {
  it('accepts http:// URL', () => {
    expect(validateUrl('http://localhost:11434')).toBeUndefined();
  });

  it('accepts https:// URL', () => {
    expect(validateUrl('https://api.openai.com/v1')).toBeUndefined();
  });

  it('rejects file:// scheme', () => {
    const err = validateUrl('file:///etc/passwd');
    expect(err).toMatch(/http:\/\/ or https:\/\//);
  });

  it('rejects javascript: scheme', () => {
    const err = validateUrl('javascript:alert(1)');
    expect(err).toMatch(/http:\/\/ or https:\/\//);
  });

  it('rejects data: scheme', () => {
    const err = validateUrl('data:text/html,<h1>XSS</h1>');
    expect(err).toMatch(/http:\/\/ or https:\/\//);
  });

  it('rejects malformed URL', () => {
    const err = validateUrl('not-a-url');
    expect(err).toMatch(/not a valid URL/);
  });

  it('returns undefined for empty string (caller checks required)', () => {
    expect(validateUrl('')).toBeUndefined();
  });
});

describe('validateTags', () => {
  it('returns empty array for undefined', () => {
    const { value, error } = validateTags(undefined);
    expect(value).toEqual([]);
    expect(error).toBeUndefined();
  });

  it('trims and returns valid tags', () => {
    const { value, error } = validateTags(['  foo  ', 'bar']);
    expect(value).toEqual(['foo', 'bar']);
    expect(error).toBeUndefined();
  });

  it('filters out blank tags', () => {
    const { value } = validateTags(['foo', '   ', 'bar']);
    expect(value).toEqual(['foo', 'bar']);
  });

  it('returns error for non-array input', () => {
    const { error } = validateTags('not-an-array');
    expect(error).toMatch(/must be an array/);
  });

  it('returns error when a tag exceeds 100 chars', () => {
    const { error } = validateTags(['x'.repeat(101)]);
    expect(error).toMatch(/exceeds 100/);
  });

  it('returns error when a tag is not a string', () => {
    const { error } = validateTags([42]);
    expect(error).toMatch(/must be a string/);
  });
});
