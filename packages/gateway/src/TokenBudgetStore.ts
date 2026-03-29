/**
 * TokenBudgetStore — per-agent token budgets with daily and session limits.
 *
 * Budgets are optional and stored in JSON. When a budget is configured:
 *   dailyLimit   — max (input+output) tokens per UTC calendar day
 *   sessionLimit — max tokens per gateway session (resets on restart)
 *
 * `check()` returns whether a run is allowed to proceed.
 * `record()` is called after a run completes with actual token usage.
 *
 * Usage:
 *   const budgets = new TokenBudgetStore(configDir);
 *   const result = budgets.check(agentId);
 *   if (!result.allowed) throw new Error(result.reason);
 *   ... run agent ...
 *   budgets.record(agentId, tokensUsed);
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface TokenBudget {
  agentId:       string;
  /** Max tokens per UTC calendar day (undefined = unlimited). */
  dailyLimit?:   number;
  /** Max tokens per gateway session (resets on process restart). */
  sessionLimit?: number;
  createdAt:     number;
  updatedAt:     number;
}

export interface BudgetCheckResult {
  allowed:               boolean;
  reason?:               string;
  dailyUsed?:            number;
  dailyRemaining?:       number;
  sessionUsed?:          number;
  sessionRemaining?:     number;
}

function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export class TokenBudgetStore {
  private readonly filePath: string;
  private budgets: TokenBudget[] = [];

  /** In-memory session usage (resets on restart). */
  private readonly sessionUsage = new Map<string, number>();

  /** In-memory daily usage counters: agentId → { date, tokens }. */
  private readonly dailyUsage = new Map<string, { date: string; tokens: number }>();

  constructor(configDir: string) {
    this.filePath = join(configDir, 'token-budgets.json');
    this.load();
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      this.budgets = JSON.parse(readFileSync(this.filePath, 'utf8')) as TokenBudget[];
    } catch {
      this.budgets = [];
    }
  }

  private save(): void {
    mkdirSync(join(this.filePath, '..'), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.budgets, null, 2), 'utf8');
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  get(agentId: string): TokenBudget | null {
    return this.budgets.find(b => b.agentId === agentId) ?? null;
  }

  list(): TokenBudget[] {
    return [...this.budgets];
  }

  upsert(agentId: string, limits: { dailyLimit?: number | null; sessionLimit?: number | null }): TokenBudget {
    const now = Date.now();
    const existing = this.budgets.find(b => b.agentId === agentId);
    if (existing) {
      if (limits.dailyLimit !== undefined) {
        existing.dailyLimit = limits.dailyLimit === null ? undefined : limits.dailyLimit;
      }
      if (limits.sessionLimit !== undefined) {
        existing.sessionLimit = limits.sessionLimit === null ? undefined : limits.sessionLimit;
      }
      existing.updatedAt = now;
      this.save();
      return existing;
    }
    const budget: TokenBudget = {
      agentId,
      dailyLimit:   limits.dailyLimit   === null ? undefined : limits.dailyLimit,
      sessionLimit: limits.sessionLimit === null ? undefined : limits.sessionLimit,
      createdAt: now,
      updatedAt: now,
    };
    this.budgets.push(budget);
    this.save();
    return budget;
  }

  remove(agentId: string): void {
    this.budgets = this.budgets.filter(b => b.agentId !== agentId);
    this.sessionUsage.delete(agentId);
    this.dailyUsage.delete(agentId);
    this.save();
  }

  // ── Budget enforcement ────────────────────────────────────────────────────

  /** Check whether the agent is within budget. Does NOT record usage. */
  check(agentId: string): BudgetCheckResult {
    const budget = this.get(agentId);
    if (!budget) return { allowed: true };

    const sessionUsed = this.sessionUsage.get(agentId) ?? 0;
    const today = utcDateString();
    let dc = this.dailyUsage.get(agentId);
    if (!dc || dc.date !== today) {
      dc = { date: today, tokens: 0 };
      this.dailyUsage.set(agentId, dc);
    }
    const dailyUsed = dc.tokens;

    // Check session limit
    if (budget.sessionLimit !== undefined && sessionUsed >= budget.sessionLimit) {
      return {
        allowed: false,
        reason: `Session token budget exceeded (${sessionUsed}/${budget.sessionLimit} tokens)`,
        sessionUsed,
        sessionRemaining: 0,
        dailyUsed,
        dailyRemaining: budget.dailyLimit !== undefined ? Math.max(0, budget.dailyLimit - dailyUsed) : undefined,
      };
    }

    // Check daily limit
    if (budget.dailyLimit !== undefined && dailyUsed >= budget.dailyLimit) {
      return {
        allowed: false,
        reason: `Daily token budget exceeded (${dailyUsed}/${budget.dailyLimit} tokens)`,
        dailyUsed,
        dailyRemaining: 0,
        sessionUsed,
        sessionRemaining: budget.sessionLimit !== undefined ? Math.max(0, budget.sessionLimit - sessionUsed) : undefined,
      };
    }

    return {
      allowed: true,
      dailyUsed,
      dailyRemaining: budget.dailyLimit !== undefined ? budget.dailyLimit - dailyUsed : undefined,
      sessionUsed,
      sessionRemaining: budget.sessionLimit !== undefined ? budget.sessionLimit - sessionUsed : undefined,
    };
  }

  /** Record token usage after a completed run. */
  record(agentId: string, tokens: number): void {
    if (tokens <= 0) return;

    // Session usage
    this.sessionUsage.set(agentId, (this.sessionUsage.get(agentId) ?? 0) + tokens);

    // Daily usage
    const today = utcDateString();
    let dc = this.dailyUsage.get(agentId);
    if (!dc || dc.date !== today) {
      dc = { date: today, tokens: 0 };
      this.dailyUsage.set(agentId, dc);
    }
    dc.tokens += tokens;
  }

  /** Return live usage stats for an agent. */
  usage(agentId: string): {
    sessionUsed: number;
    dailyUsed: number;
    budget: TokenBudget | null;
  } {
    const today = utcDateString();
    const dc = this.dailyUsage.get(agentId);
    return {
      sessionUsed: this.sessionUsage.get(agentId) ?? 0,
      dailyUsed: (dc?.date === today ? dc.tokens : 0),
      budget: this.get(agentId),
    };
  }
}
