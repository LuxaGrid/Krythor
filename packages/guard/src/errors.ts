import type { GuardVerdict } from './types.js';
import type { NormalizedAction } from './ActionNormalizer.js';

// ─── BlockedActionError ───────────────────────────────────────────────────────
//
// Thrown when a guard check blocks an action in a context where the caller
// wants exceptions rather than branch logic on the verdict.
//
// Carries both the GuardVerdict (with the matched rule details) and the
// NormalizedAction so that error handlers have full context without needing
// to re-query the audit log.
//

export class BlockedActionError extends Error {
  /** The full guard verdict that caused the block */
  readonly verdict: GuardVerdict;
  /** The normalized action that was blocked */
  readonly action: NormalizedAction;

  constructor(verdict: GuardVerdict, action: NormalizedAction) {
    super(`Action blocked by policy: ${verdict.reason}`);
    this.name = 'BlockedActionError';
    this.verdict = verdict;
    this.action = action;
  }
}
