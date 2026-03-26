import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { loadPolicyFromYaml, mergePolicyConfigs } from './PolicyLoader.js';
import type { PolicyConfig } from './types.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), `krythor-policy-loader-test-${randomUUID()}`);

function writeTemp(filename: string, content: string): string {
  const filePath = join(TEST_DIR, filename);
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function baseConfig(): PolicyConfig {
  return {
    version: '1',
    defaultAction: 'allow',
    rules: [
      {
        id: 'base-rule-1',
        name: 'Base rule',
        description: '',
        enabled: true,
        priority: 10,
        condition: { operations: ['memory:read'] },
        action: 'allow',
        reason: 'Base allow',
      },
    ],
  };
}

// ── Setup/teardown ────────────────────────────────────────────────────────────

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

// ── loadPolicyFromYaml — YAML ─────────────────────────────────────────────────

describe('loadPolicyFromYaml', () => {
  it('loads a minimal YAML policy', () => {
    const p = writeTemp('minimal.yaml', `
version: "1"
defaultAction: allow
rules: []
`);
    const cfg = loadPolicyFromYaml(p);
    expect(cfg.version).toBe('1');
    expect(cfg.defaultAction).toBe('allow');
    expect(cfg.rules).toHaveLength(0);
  });

  it('loads a YAML policy with rules', () => {
    const p = writeTemp('rules.yaml', `
version: "1"
defaultAction: deny
rules:
  - id: r1
    name: Test Rule
    description: A test
    enabled: true
    priority: 10
    condition:
      operations:
        - memory:write
      sources:
        - agent
    action: deny
    reason: Denied by test
`);
    const cfg = loadPolicyFromYaml(p);
    expect(cfg.defaultAction).toBe('deny');
    expect(cfg.rules).toHaveLength(1);
    expect(cfg.rules[0]!.id).toBe('r1');
    expect(cfg.rules[0]!.action).toBe('deny');
    expect(cfg.rules[0]!.condition.operations).toContain('memory:write');
    expect(cfg.rules[0]!.condition.sources).toContain('agent');
  });

  it('loads a JSON file (no YAML library required)', () => {
    const p = writeTemp('policy.json', JSON.stringify({
      version: '1',
      defaultAction: 'allow',
      rules: [{
        id: 'json-rule',
        name: 'JSON Rule',
        description: '',
        enabled: true,
        priority: 5,
        condition: {},
        action: 'warn',
        reason: 'From JSON',
      }],
    }));
    const cfg = loadPolicyFromYaml(p);
    expect(cfg.rules[0]!.id).toBe('json-rule');
    expect(cfg.rules[0]!.action).toBe('warn');
  });

  it('throws if file does not exist', () => {
    expect(() => loadPolicyFromYaml('/nonexistent/path/policy.yaml'))
      .toThrow('not found');
  });

  it('throws if defaultAction is invalid', () => {
    const p = writeTemp('bad-action.yaml', `
version: "1"
defaultAction: maybe
rules: []
`);
    expect(() => loadPolicyFromYaml(p)).toThrow('defaultAction');
  });

  it('rejects rule with invalid action', () => {
    const p = writeTemp('bad-rule-action.yaml', `
version: "1"
defaultAction: allow
rules:
  - id: bad
    name: Bad
    action: explode
    reason: test
`);
    expect(() => loadPolicyFromYaml(p)).toThrow('invalid action');
  });

  it('assigns a UUID to rules missing an id', () => {
    const p = writeTemp('no-id.yaml', `
version: "1"
defaultAction: allow
rules:
  - name: Auto ID Rule
    action: warn
    reason: no id given
`);
    const cfg = loadPolicyFromYaml(p);
    expect(cfg.rules[0]!.id).toBeTruthy();
    expect(cfg.rules[0]!.id.length).toBeGreaterThan(8);
  });

  it('skips unknown operation types with a warning', () => {
    const p = writeTemp('unknown-op.yaml', `
version: "1"
defaultAction: allow
rules:
  - id: r1
    name: Unknown op rule
    action: deny
    reason: test
    condition:
      operations:
        - memory:read
        - future:unknown:op
`);
    const cfg = loadPolicyFromYaml(p);
    // future:unknown:op is filtered out; memory:read is kept
    expect(cfg.rules[0]!.condition.operations).toEqual(['memory:read']);
  });

  it('loads new operation types (network:fetch, webhook:call, memory:export)', () => {
    const p = writeTemp('new-ops.yaml', `
version: "1"
defaultAction: allow
rules:
  - id: r1
    name: Network fetch
    action: warn
    reason: test
    condition:
      operations:
        - network:fetch
        - network:search
        - webhook:call
        - memory:export
`);
    const cfg = loadPolicyFromYaml(p);
    const ops = cfg.rules[0]!.condition.operations ?? [];
    expect(ops).toContain('network:fetch');
    expect(ops).toContain('network:search');
    expect(ops).toContain('webhook:call');
    expect(ops).toContain('memory:export');
  });

  it('validates minRisk', () => {
    const p = writeTemp('bad-risk.yaml', `
version: "1"
defaultAction: allow
rules:
  - id: r1
    name: Bad risk
    action: warn
    reason: test
    condition:
      minRisk: extreme
`);
    expect(() => loadPolicyFromYaml(p)).toThrow('minRisk');
  });
});

// ── mergePolicyConfigs ────────────────────────────────────────────────────────

describe('mergePolicyConfigs', () => {
  it('returns base config when override is empty', () => {
    const base = baseConfig();
    const merged = mergePolicyConfigs(base, {});
    expect(merged.defaultAction).toBe('allow');
    expect(merged.rules).toHaveLength(1);
  });

  it('override defaultAction wins', () => {
    const base = baseConfig();
    const merged = mergePolicyConfigs(base, { defaultAction: 'deny' });
    expect(merged.defaultAction).toBe('deny');
  });

  it('override rules with same id replace base rules', () => {
    const base = baseConfig();
    const override: Partial<PolicyConfig> = {
      rules: [{
        id: 'base-rule-1',
        name: 'Replaced Rule',
        description: '',
        enabled: false,
        priority: 99,
        condition: {},
        action: 'deny',
        reason: 'Overridden',
      }],
    };
    const merged = mergePolicyConfigs(base, override);
    expect(merged.rules).toHaveLength(1);
    expect(merged.rules[0]!.name).toBe('Replaced Rule');
    expect(merged.rules[0]!.enabled).toBe(false);
  });

  it('new override rules are appended', () => {
    const base = baseConfig();
    const override: Partial<PolicyConfig> = {
      rules: [{
        id: 'new-rule',
        name: 'New Rule',
        description: '',
        enabled: true,
        priority: 20,
        condition: {},
        action: 'warn',
        reason: 'New',
      }],
    };
    const merged = mergePolicyConfigs(base, override);
    expect(merged.rules).toHaveLength(2);
    expect(merged.rules.some(r => r.id === 'new-rule')).toBe(true);
  });

  it('does not mutate the base config', () => {
    const base = baseConfig();
    const original = JSON.stringify(base);
    mergePolicyConfigs(base, { defaultAction: 'deny', rules: [] });
    expect(JSON.stringify(base)).toBe(original);
  });
});
