import { readFileSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import type { PolicyConfig, PolicyRule, PolicyCondition, GuardAction, OperationType } from './types.js';

// ─── PolicyLoader ─────────────────────────────────────────────────────────────
//
// Loads a YAML (or JSON) policy file and returns a PolicyConfig.
// Uses js-yaml for YAML parsing; falls back to JSON if js-yaml is unavailable.
// The loaded config can be merged into an existing PolicyConfig via
// mergePolicyConfigs() before passing to PolicyEngine.loadPolicy().
//
// Usage:
//   const yamlCfg = loadPolicyFromYaml('/path/to/policy.yaml');
//   const merged  = mergePolicyConfigs(existingConfig, yamlCfg);
//   engine.loadPolicy(merged);
//

// ── YAML raw shape (what we parse before validation) ──────────────────────────

interface RawCondition {
  operations?: unknown;
  sources?: unknown;
  scopes?: unknown;
  minRisk?: unknown;
  contentPattern?: unknown;
}

interface RawRule {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  enabled?: unknown;
  priority?: unknown;
  condition?: RawCondition;
  action?: unknown;
  reason?: unknown;
}

interface RawPolicyDoc {
  version?: unknown;
  defaultAction?: unknown;
  rules?: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_ACTIONS = new Set<string>(['allow', 'deny', 'warn', 'require-approval']);
const VALID_RISK    = new Set<string>(['low', 'medium', 'high', 'critical']);
const VALID_OPS     = new Set<string>([
  'memory:write', 'memory:delete', 'memory:read', 'memory:export',
  'model:infer',
  'agent:run', 'agent:create', 'agent:delete',
  'command:execute',
  'provider:add', 'provider:delete',
  'skill:execute', 'skill:create', 'skill:delete',
  'network:fetch', 'network:search',
  'webhook:call',
]);

function toStringArray(val: unknown, field: string): string[] {
  if (val === undefined || val === null) return [];
  if (!Array.isArray(val)) throw new Error(`Policy field "${field}" must be an array`);
  return val.map((v, i) => {
    if (typeof v !== 'string') throw new Error(`Policy field "${field}[${i}]" must be a string`);
    return v;
  });
}

function parseCondition(raw: RawCondition | undefined): PolicyCondition {
  if (!raw) return {};
  const condition: PolicyCondition = {};

  const ops = toStringArray(raw.operations, 'condition.operations');
  if (ops.length > 0) {
    const invalid = ops.filter(o => !VALID_OPS.has(o));
    if (invalid.length > 0) {
      // Warn but don't throw — future op types should not break policy loading
      process.stderr.write(`[guard/PolicyLoader] Unknown operation type(s): ${invalid.join(', ')} — skipped\n`);
    }
    condition.operations = ops.filter(o => VALID_OPS.has(o)) as OperationType[];
  }

  const sources = toStringArray(raw.sources, 'condition.sources');
  if (sources.length > 0) condition.sources = sources;

  const scopes = toStringArray(raw.scopes, 'condition.scopes');
  if (scopes.length > 0) condition.scopes = scopes;

  if (raw.minRisk !== undefined && raw.minRisk !== null) {
    const mr = String(raw.minRisk);
    if (!VALID_RISK.has(mr)) throw new Error(`condition.minRisk "${mr}" is not valid — use low|medium|high|critical`);
    condition.minRisk = mr as PolicyCondition['minRisk'];
  }

  if (raw.contentPattern !== undefined && raw.contentPattern !== null) {
    const cp = String(raw.contentPattern);
    if (cp.length > 500) throw new Error('condition.contentPattern exceeds 500-char limit (ReDoS guard)');
    condition.contentPattern = cp;
  }

  return condition;
}

function parseRule(raw: RawRule, idx: number): PolicyRule {
  const id = raw.id !== undefined ? String(raw.id) : randomUUID();
  const name = raw.name !== undefined ? String(raw.name) : `Rule ${idx + 1}`;
  const description = raw.description !== undefined ? String(raw.description) : '';
  const enabled = raw.enabled !== undefined ? Boolean(raw.enabled) : true;
  const priority = raw.priority !== undefined ? Number(raw.priority) : (idx + 1) * 10;

  if (!Number.isFinite(priority)) {
    throw new Error(`Rule "${name}" has non-numeric priority: ${raw.priority}`);
  }

  const action = raw.action !== undefined ? String(raw.action) : 'allow';
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(`Rule "${name}" has invalid action "${action}" — use allow|deny|warn|require-approval`);
  }

  const reason = raw.reason !== undefined ? String(raw.reason) : '';
  const condition = parseCondition(raw.condition);

  return { id, name, description, enabled, priority, condition, action: action as GuardAction, reason };
}

// ── loadPolicyFromYaml ────────────────────────────────────────────────────────

/**
 * Loads a policy from a YAML or JSON file and returns a validated PolicyConfig.
 * Throws if the file cannot be read or fails validation.
 */
export function loadPolicyFromYaml(filePath: string): PolicyConfig {
  if (!existsSync(filePath)) {
    throw new Error(`Policy file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, 'utf8');
  let doc: unknown;

  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    // Try js-yaml; fall back to JSON if not available
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const jsYaml = require('js-yaml') as { load(s: string): unknown };
      doc = jsYaml.load(raw);
    } catch (importErr) {
      // js-yaml not available — try JSON fallback
      process.stderr.write('[guard/PolicyLoader] js-yaml not available, attempting JSON fallback\n');
      try {
        doc = JSON.parse(raw);
      } catch {
        throw new Error(`Cannot parse ${filePath}: js-yaml unavailable and content is not valid JSON`);
      }
    }
  } else {
    // Treat as JSON
    doc = JSON.parse(raw);
  }

  return validateAndNormalize(doc, filePath);
}

function validateAndNormalize(doc: unknown, source: string): PolicyConfig {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw new Error(`${source}: expected a YAML/JSON object at the top level`);
  }

  const raw = doc as RawPolicyDoc;

  const version = raw.version !== undefined ? String(raw.version) : '1';

  const da = raw.defaultAction !== undefined ? String(raw.defaultAction) : 'allow';
  if (da !== 'allow' && da !== 'deny') {
    throw new Error(`${source}: defaultAction must be "allow" or "deny", got "${da}"`);
  }

  const rawRules = raw.rules;
  const rules: PolicyRule[] = [];

  if (rawRules !== undefined && rawRules !== null) {
    if (!Array.isArray(rawRules)) {
      throw new Error(`${source}: "rules" must be an array`);
    }
    for (let i = 0; i < rawRules.length; i++) {
      const r = rawRules[i];
      if (typeof r !== 'object' || r === null) {
        throw new Error(`${source}: rules[${i}] must be an object`);
      }
      rules.push(parseRule(r as RawRule, i));
    }
  }

  return { version, defaultAction: da, rules };
}

// ── mergePolicyConfigs ────────────────────────────────────────────────────────

/**
 * Merges an override config into a base config.
 * - defaultAction from override wins if provided
 * - Rules are merged by id: override rules replace base rules with same id;
 *   new override rules are appended
 *
 * The merge is non-destructive to the base object — a new PolicyConfig is returned.
 */
export function mergePolicyConfigs(base: PolicyConfig, override: Partial<PolicyConfig>): PolicyConfig {
  const merged: PolicyConfig = {
    version: override.version ?? base.version,
    defaultAction: override.defaultAction ?? base.defaultAction,
    rules: [...base.rules],
  };

  if (override.rules && override.rules.length > 0) {
    for (const overrideRule of override.rules) {
      const idx = merged.rules.findIndex(r => r.id === overrideRule.id);
      if (idx !== -1) {
        merged.rules[idx] = { ...merged.rules[idx]!, ...overrideRule };
      } else {
        merged.rules.push(overrideRule);
      }
    }
  }

  return merged;
}
