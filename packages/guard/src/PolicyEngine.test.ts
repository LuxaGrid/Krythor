import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine } from './PolicyEngine.js';
import type { PolicyConfig, PolicyRule, GuardContext } from './types.js';

function makeConfig(overrides: Partial<PolicyConfig> = {}): PolicyConfig {
  return {
    version: '1',
    defaultAction: 'allow',
    rules: [],
    ...overrides,
  };
}

function makeRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 'rule-1',
    name: 'Test Rule',
    description: '',
    enabled: true,
    priority: 10,
    condition: {},
    action: 'deny',
    reason: 'Test denial',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    operation: 'command:execute',
    source: 'user',
    ...overrides,
  };
}

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  it('allows by default when no rules match', () => {
    engine.loadPolicy(makeConfig({ defaultAction: 'allow' }));
    const verdict = engine.evaluate(makeCtx());
    expect(verdict.allowed).toBe(true);
    expect(verdict.action).toBe('allow');
  });

  it('denies by default when defaultAction is deny and no rules match', () => {
    engine.loadPolicy(makeConfig({ defaultAction: 'deny' }));
    const verdict = engine.evaluate(makeCtx());
    expect(verdict.allowed).toBe(false);
    expect(verdict.action).toBe('deny');
  });

  it('deny rule blocks matching operation', () => {
    engine.loadPolicy(makeConfig({
      rules: [makeRule({ action: 'deny', condition: { operations: ['command:execute'] } })],
    }));
    const verdict = engine.evaluate(makeCtx({ operation: 'command:execute' }));
    expect(verdict.allowed).toBe(false);
    expect(verdict.ruleId).toBe('rule-1');
  });

  it('allow rule allows matching operation', () => {
    engine.loadPolicy(makeConfig({
      defaultAction: 'deny',
      rules: [makeRule({ action: 'allow', condition: { operations: ['memory:read'] } })],
    }));
    const verdict = engine.evaluate(makeCtx({ operation: 'memory:read' }));
    expect(verdict.allowed).toBe(true);
  });

  it('warn rule is additive and does not stop evaluation', () => {
    engine.loadPolicy(makeConfig({
      defaultAction: 'allow',
      rules: [makeRule({ action: 'warn', reason: 'Heads up', condition: {} })],
    }));
    const verdict = engine.evaluate(makeCtx());
    expect(verdict.allowed).toBe(true);
    expect(verdict.warnings).toHaveLength(1);
    expect(verdict.warnings[0]).toContain('Heads up');
  });

  it('disabled rules are ignored', () => {
    engine.loadPolicy(makeConfig({
      rules: [makeRule({ enabled: false, action: 'deny', condition: {} })],
    }));
    const verdict = engine.evaluate(makeCtx());
    expect(verdict.allowed).toBe(true);
  });

  it('lower priority rule fires before higher priority rule', () => {
    const rules: PolicyRule[] = [
      makeRule({ id: 'low-p',  priority: 1,  action: 'deny',  reason: 'First',  condition: {} }),
      makeRule({ id: 'high-p', priority: 10, action: 'allow', reason: 'Second', condition: {} }),
    ];
    engine.loadPolicy(makeConfig({ rules }));
    const verdict = engine.evaluate(makeCtx());
    expect(verdict.ruleId).toBe('low-p');
    expect(verdict.allowed).toBe(false);
  });

  it('contentPattern condition matches against content', () => {
    engine.loadPolicy(makeConfig({
      rules: [makeRule({ action: 'deny', condition: { contentPattern: 'secret' } })],
    }));
    const denied = engine.evaluate(makeCtx({ content: 'reveal the secret now' }));
    expect(denied.allowed).toBe(false);

    const allowed = engine.evaluate(makeCtx({ content: 'tell me a joke' }));
    expect(allowed.allowed).toBe(true);
  });

  it('source condition filters by source', () => {
    engine.loadPolicy(makeConfig({
      rules: [makeRule({ action: 'deny', condition: { sources: ['agent'] } })],
    }));
    const fromAgent = engine.evaluate(makeCtx({ source: 'agent' }));
    expect(fromAgent.allowed).toBe(false);

    const fromUser = engine.evaluate(makeCtx({ source: 'user' }));
    expect(fromUser.allowed).toBe(true);
  });

  it('getRules returns only enabled rules', () => {
    engine.loadPolicy(makeConfig({
      rules: [
        makeRule({ id: 'r1', enabled: true  }),
        makeRule({ id: 'r2', enabled: false }),
      ],
    }));
    const rules = engine.getRules();
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe('r1');
  });
});
