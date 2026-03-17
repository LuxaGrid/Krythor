import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { PolicyConfig, PolicyRule } from './types.js';

// ─── Default built-in policy ──────────────────────────────────────────────────

const DEFAULT_POLICY: PolicyConfig = {
  version: '1',
  defaultAction: 'allow',
  rules: [
    {
      id: 'builtin-deny-provider-delete',
      name: 'Block provider deletion from non-user sources',
      description: 'Only user-initiated provider deletions are allowed',
      enabled: true,
      priority: 10,
      condition: {
        operations: ['provider:delete'],
        sources: ['agent', 'skill', 'system'],
      },
      action: 'deny',
      reason: 'Provider deletion must be initiated by a user, not an agent or skill.',
    },
    {
      id: 'builtin-deny-user-scope-from-agent',
      name: 'Block agent writes to user scope',
      description: 'Agents cannot write to user-scope memory directly',
      enabled: true,
      priority: 20,
      condition: {
        operations: ['memory:write'],
        sources: ['agent'],
        scopes: ['user'],
      },
      action: 'deny',
      reason: 'Agents are not permitted to write to user-scope memory.',
    },
    {
      id: 'builtin-warn-high-risk-delete',
      name: 'Warn on high-risk delete operations',
      description: 'Emit a warning when any delete operation is performed',
      enabled: true,
      priority: 30,
      condition: {
        operations: ['memory:delete', 'agent:delete', 'provider:delete'],
      },
      action: 'warn',
      reason: 'Destructive operation — this cannot be undone.',
    },
    {
      id: 'builtin-warn-user-scope-write',
      name: 'Warn on user-scope memory writes',
      description: 'Warn whenever anything writes to user-scope memory',
      enabled: true,
      priority: 40,
      condition: {
        operations: ['memory:write'],
        scopes: ['user'],
      },
      action: 'warn',
      reason: 'Writing to user-scope memory has persistent, cross-session effects.',
    },
  ],
};

// ─── PolicyStore ──────────────────────────────────────────────────────────────
//
// Persists the policy config as JSON. Ships a default policy on first run.
//

export class PolicyStore {
  private readonly filePath: string;

  constructor(configDir: string) {
    mkdirSync(configDir, { recursive: true });
    this.filePath = join(configDir, 'policy.json');
  }

  load(): PolicyConfig {
    if (!existsSync(this.filePath)) {
      this.save(DEFAULT_POLICY);
      return DEFAULT_POLICY;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw) as PolicyConfig;
    } catch (err) {
      console.error(`[guard] Failed to parse ${this.filePath} — loading default policy. Error: ${err instanceof Error ? err.message : String(err)}`);
      return DEFAULT_POLICY;
    }
  }

  save(config: PolicyConfig): void {
    writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf8');
  }

  // ── Rule CRUD ─────────────────────────────────────────────────────────────

  addRule(config: PolicyConfig, rule: Omit<PolicyRule, 'id'>): PolicyRule {
    const newRule: PolicyRule = { ...rule, id: randomUUID() };
    config.rules.push(newRule);
    this.save(config);
    return newRule;
  }

  updateRule(config: PolicyConfig, id: string, patch: Partial<Omit<PolicyRule, 'id'>>): PolicyRule {
    const idx = config.rules.findIndex(r => r.id === id);
    if (idx === -1) throw new Error(`Policy rule "${id}" not found`);
    config.rules[idx] = { ...config.rules[idx]!, ...patch };
    this.save(config);
    return config.rules[idx]!;
  }

  deleteRule(config: PolicyConfig, id: string): void {
    const idx = config.rules.findIndex(r => r.id === id);
    if (idx === -1) throw new Error(`Policy rule "${id}" not found`);
    // Never delete built-in rules
    if (config.rules[idx]!.id.startsWith('builtin-')) {
      throw new Error(`Built-in rule "${id}" cannot be deleted. Disable it instead.`);
    }
    config.rules.splice(idx, 1);
    this.save(config);
  }
}
