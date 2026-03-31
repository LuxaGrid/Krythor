import { EventEmitter } from 'events';
import { PolicyEngine } from './PolicyEngine.js';
import { PolicyStore } from './PolicyStore.js';
import { GuardAuditLog } from './GuardAuditLog.js';
import type {
  GuardContext,
  GuardVerdict,
  PolicyConfig,
  PolicyRule,
} from './types.js';

// ─── GuardEngine ──────────────────────────────────────────────────────────────
//
// Single entry point for all Guard operations.
// Composes PolicyStore (persistence) + PolicyEngine (evaluation).
// Emits 'guard:denied' and 'guard:warned' events for observability.
//

export class GuardEngine extends EventEmitter {
  private readonly store: PolicyStore;
  private readonly engine: PolicyEngine;
  private readonly auditLog: GuardAuditLog;
  private config: PolicyConfig;

  /**
   * @param configDir  Directory containing policy.json (e.g. <dataDir>/config)
   * @param dataDir    Root data directory for logs; defaults to configDir/../
   */
  constructor(configDir: string, dataDir?: string) {
    super();
    this.store = new PolicyStore(configDir);
    this.engine = new PolicyEngine();
    this.config = this.store.load();
    this.engine.loadPolicy(this.config);
    // Audit log lives in <dataDir>/logs/; fall back to configDir/.. if not provided.
    const resolvedDataDir = dataDir ?? require('path').dirname(configDir);
    this.auditLog = new GuardAuditLog(resolvedDataDir);
  }

  // ── Core evaluation ────────────────────────────────────────────────────────

  check(ctx: GuardContext): GuardVerdict {
    const verdict = this.engine.evaluate(ctx);

    if (!verdict.allowed) {
      this.emit('guard:denied', { context: ctx, verdict });
    }

    if (verdict.warnings.length > 0) {
      this.emit('guard:warned', { context: ctx, verdict });
    }

    // Always emit guard:decided for observability hooks
    this.emit('guard:decided', { context: ctx, verdict });

    // Persist every decision to the audit log (append-only NDJSON)
    this.auditLog.record(ctx, verdict);

    return verdict;
  }

  // Throws if the operation is denied — convenience wrapper for callers
  // that want to raise rather than branch on the verdict.
  assert(ctx: GuardContext): GuardVerdict {
    const verdict = this.check(ctx);
    if (!verdict.allowed) {
      throw new GuardDeniedError(verdict);
    }
    return verdict;
  }

  // ── Policy management ──────────────────────────────────────────────────────

  getPolicy(): PolicyConfig {
    return this.config;
  }

  setDefaultAction(action: 'allow' | 'deny'): void {
    this.config.defaultAction = action;
    this.store.save(this.config);
    this.engine.loadPolicy(this.config);
  }

  addRule(rule: Omit<PolicyRule, 'id'>): PolicyRule {
    const newRule = this.store.addRule(this.config, rule);
    this.engine.loadPolicy(this.config);
    return newRule;
  }

  updateRule(id: string, patch: Partial<Omit<PolicyRule, 'id'>>): PolicyRule {
    const updated = this.store.updateRule(this.config, id, patch);
    this.engine.loadPolicy(this.config);
    return updated;
  }

  deleteRule(id: string): void {
    this.store.deleteRule(this.config, id);
    this.engine.loadPolicy(this.config);
  }

  getRules(): PolicyRule[] {
    return this.engine.getRules();
  }

  reload(): void {
    this.config = this.store.load();
    this.engine.loadPolicy(this.config);
  }

  stats(): { ruleCount: number; enabledRules: number; defaultAction: string } {
    const rules = this.config.rules;
    return {
      ruleCount: rules.length,
      enabledRules: rules.filter(r => r.enabled).length,
      defaultAction: this.config.defaultAction,
    };
  }

  /**
   * Returns the model routing policy for a given operation.
   * Reads from the policy config's modelPolicy map if present.
   * Falls back to { preferLocal: false, allowExternal: true } when no specific rule exists.
   */
  getModelPolicy(operation: string): { preferLocal: boolean; allowExternal: boolean } {
    const defaultPolicy = { preferLocal: false, allowExternal: true };
    const modelPolicies = (this.config as unknown as Record<string, unknown>)['modelPolicies'];
    if (!modelPolicies || typeof modelPolicies !== 'object') return defaultPolicy;
    const opPolicy = (modelPolicies as Record<string, unknown>)[operation];
    if (!opPolicy || typeof opPolicy !== 'object') return defaultPolicy;
    const p = opPolicy as Record<string, unknown>;
    return {
      preferLocal:   typeof p['preferLocal']   === 'boolean' ? p['preferLocal']   : defaultPolicy.preferLocal,
      allowExternal: typeof p['allowExternal']  === 'boolean' ? p['allowExternal'] : defaultPolicy.allowExternal,
    };
  }
}

// ─── GuardDeniedError ─────────────────────────────────────────────────────────

export class GuardDeniedError extends Error {
  readonly verdict: GuardVerdict;

  constructor(verdict: GuardVerdict) {
    super(verdict.reason);
    this.name = 'GuardDeniedError';
    this.verdict = verdict;
  }
}
