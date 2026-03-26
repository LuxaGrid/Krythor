import { describe, it, expect } from 'vitest';
import { normalizeAction, toGuardContext } from './ActionNormalizer.js';

describe('normalizeAction', () => {
  it('normalizes a known operation type', () => {
    const action = normalizeAction('memory:write', 'agent', 'user', { actorId: 'agent-123' });
    expect(action.operation).toBe('memory:write');
    expect(action.source).toBe('agent');
    expect(action.sourceId).toBe('agent-123');
    expect(action.scope).toBe('user'); // 'user' is a known scope
    expect(action.target).toBe('user');
  });

  it('defaults unknown operation types to command:execute', () => {
    const action = normalizeAction('some:unknown:op', 'user', '/tmp/file');
    expect(action.operation).toBe('command:execute');
    expect(action.source).toBe('user');
    expect(action.target).toBe('/tmp/file');
  });

  it('includes summary with actor and operation', () => {
    const action = normalizeAction('model:infer', 'agent', 'gpt-4', { actorId: 'a1' });
    expect(action.summary).toContain('agent(a1)');
    expect(action.summary).toContain('model:infer');
    expect(action.summary).toContain('gpt-4');
  });

  it('summary without actorId does not include parentheses', () => {
    const action = normalizeAction('network:fetch', 'user', 'https://example.com');
    expect(action.summary).not.toContain('(');
    expect(action.summary).toContain('user');
    expect(action.summary).toContain('network:fetch');
  });

  it('extracts scope from metadata', () => {
    const action = normalizeAction('memory:write', 'agent', '/some/path', { scope: 'session' });
    expect(action.scope).toBe('session');
  });

  it('extracts content from metadata', () => {
    const action = normalizeAction('memory:write', 'user', undefined, { content: 'hello world' });
    expect(action.content).toBe('hello world');
  });

  it('does not set scope for non-memory operations', () => {
    const action = normalizeAction('command:execute', 'agent', '/usr/bin/ls', { scope: 'user' });
    // scope is only extracted for memory: operations
    expect(action.scope).toBeUndefined();
  });

  it('handles undefined target and metadata gracefully', () => {
    const action = normalizeAction('model:infer', 'system');
    expect(action.target).toBeUndefined();
    expect(action.content).toBeUndefined();
    expect(action.scope).toBeUndefined();
    expect(action.metadata).toBeUndefined();
    expect(action.summary).toBeTruthy();
  });

  it('handles network:fetch operation', () => {
    const action = normalizeAction('network:fetch', 'skill', 'https://api.example.com/data');
    expect(action.operation).toBe('network:fetch');
    expect(action.source).toBe('skill');
  });

  it('handles webhook:call operation', () => {
    const action = normalizeAction('webhook:call', 'agent', 'https://hooks.slack.com/xxx');
    expect(action.operation).toBe('webhook:call');
  });

  it('handles memory:export operation', () => {
    const action = normalizeAction('memory:export', 'user');
    expect(action.operation).toBe('memory:export');
  });
});

describe('toGuardContext', () => {
  it('converts NormalizedAction to GuardContext', () => {
    const action = normalizeAction('memory:delete', 'agent', 'session', { actorId: 'a99', scope: 'session' });
    const ctx = toGuardContext(action);
    expect(ctx.operation).toBe('memory:delete');
    expect(ctx.source).toBe('agent');
    expect(ctx.sourceId).toBe('a99');
    expect(ctx.scope).toBe('session');
  });

  it('omits undefined optional fields from GuardContext', () => {
    const action = normalizeAction('model:infer', 'user');
    const ctx = toGuardContext(action);
    expect('sourceId' in ctx).toBe(false);
    expect('scope' in ctx).toBe(false);
    expect('content' in ctx).toBe(false);
    expect('metadata' in ctx).toBe(false);
  });

  it('includes content when provided', () => {
    const action = normalizeAction('memory:write', 'user', undefined, { content: 'payload text' });
    const ctx = toGuardContext(action);
    expect(ctx.content).toBe('payload text');
  });

  it('round-trips through GuardContext cleanly', () => {
    const action = normalizeAction('network:search', 'agent', 'bitcoin price', {
      actorId: 'agent-7',
      content: 'what is bitcoin?',
      scope: 'session',
    });
    const ctx = toGuardContext(action);
    expect(ctx.operation).toBe('network:search');
    expect(ctx.source).toBe('agent');
    expect(ctx.sourceId).toBe('agent-7');
    // scope is only set for memory: operations, so should be undefined here
    expect(ctx.scope).toBeUndefined();
  });
});
