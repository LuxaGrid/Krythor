import type {
  GuardContext,
  GuardVerdict,
  PolicyRule,
  PolicyConfig,
  RiskLevel,
} from './types.js';
import { SCOPE_TO_RISK, OPERATION_RISK, RISK_ORDER } from './types.js';

// ─── PolicyEngine ─────────────────────────────────────────────────────────────
//
// Evaluates a GuardContext against an ordered list of PolicyRules.
// Rules are sorted by priority (ascending). First matching rule wins for
// deny/allow/require-approval. Warn rules are additive — all matching
// warn rules contribute to the warnings list without stopping evaluation.
//

export class PolicyEngine {
  private rules: PolicyRule[] = [];
  private defaultAction: 'allow' | 'deny' = 'allow';

  loadPolicy(config: PolicyConfig): void {
    this.defaultAction = config.defaultAction;
    this.rules = config.rules
      .filter(r => r.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  getRules(): PolicyRule[] {
    return [...this.rules];
  }

  evaluate(ctx: GuardContext): GuardVerdict {
    const warnings: string[] = [];
    const risk = this.resolveRisk(ctx);

    for (const rule of this.rules) {
      if (!this.matches(rule, ctx, risk)) continue;

      if (rule.action === 'warn') {
        warnings.push(`[${rule.name}] ${rule.reason}`);
        continue; // warn rules don't stop evaluation
      }

      // deny / allow / require-approval — first match wins
      return {
        allowed: rule.action === 'allow',
        action: rule.action,
        ruleId: rule.id,
        ruleName: rule.name,
        reason: rule.reason,
        warnings,
      };
    }

    // No decisive rule matched — use default
    return {
      allowed: this.defaultAction === 'allow',
      action: this.defaultAction,
      reason: warnings.length > 0
        ? `Default policy: ${this.defaultAction} (${warnings.length} warning${warnings.length !== 1 ? 's' : ''})`
        : `Default policy: ${this.defaultAction}`,
      warnings,
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private resolveRisk(ctx: GuardContext): RiskLevel {
    const opRisk = OPERATION_RISK[ctx.operation] ?? 'low';
    const scopeRisk = ctx.scope ? (SCOPE_TO_RISK[ctx.scope] ?? 'low') : 'low';
    return RISK_ORDER[opRisk] >= RISK_ORDER[scopeRisk] ? opRisk : scopeRisk;
  }

  private matches(rule: PolicyRule, ctx: GuardContext, risk: RiskLevel): boolean {
    const c = rule.condition;

    if (c.operations && c.operations.length > 0) {
      if (!c.operations.includes(ctx.operation)) return false;
    }

    if (c.sources && c.sources.length > 0) {
      if (!c.sources.includes(ctx.source)) return false;
    }

    if (c.scopes && c.scopes.length > 0) {
      if (!ctx.scope || !c.scopes.includes(ctx.scope)) return false;
    }

    if (c.minRisk) {
      if (RISK_ORDER[risk] < RISK_ORDER[c.minRisk]) return false;
    }

    if (c.contentPattern) {
      if (!ctx.content) return false;
      // Cap pattern length to mitigate ReDoS (catastrophic backtracking).
      // 500 chars is ample for real content filters.
      if (c.contentPattern.length > 500) return false;
      try {
        const re = new RegExp(c.contentPattern, 'i');
        // Truncate tested content to 50 KB to bound worst-case match time.
        const testContent = ctx.content.length > 51200
          ? ctx.content.slice(0, 51200)
          : ctx.content;
        if (!re.test(testContent)) return false;
      } catch {
        // invalid regex — skip this condition
        return false;
      }
    }

    if (c.allowedHours) {
      const { from, to } = c.allowedHours;
      const hour = new Date().getUTCHours();
      const inRange = from <= to
        ? hour >= from && hour <= to
        : hour >= from || hour <= to; // wraps midnight
      if (!inRange) return false;
    }

    if (c.allowedDays && c.allowedDays.length > 0) {
      const day = new Date().getUTCDay();
      if (!c.allowedDays.includes(day)) return false;
    }

    return true;
  }
}
