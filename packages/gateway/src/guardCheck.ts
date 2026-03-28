import type { GuardEngine, OperationType } from '@krythor/guard';
import type { ApprovalManager } from './ApprovalManager.js';
import { sendError } from './errors.js';
import type { FastifyReply } from 'fastify';

// ─── guardCheck ───────────────────────────────────────────────────────────────
//
// Thin wrapper around guard.check() that handles all three verdict outcomes:
//   allow            → returns true (caller proceeds)
//   deny             → sends 403 GUARD_DENIED and returns false
//   require-approval → routes through ApprovalManager, then allow/deny based
//                      on user response (or auto-deny on timeout)
//
// This is the single integration point between the guard policy engine and
// the approval flow. Before this helper existed, every route only handled
// allow/deny — require-approval verdicts silently fell through as denials.
//
// Usage:
//   const allowed = await guardCheck({ guard, approvalManager, reply, operation, source, sourceId, target });
//   if (!allowed) return; // reply already sent
//   // ... proceed with action
//
// All parameters except guard and reply are optional — callers pass what they
// have. approvalManager is optional; if absent, require-approval falls back to deny.
//

export interface GuardCheckOptions {
  guard: GuardEngine;
  reply: FastifyReply;
  operation: OperationType;
  source?: 'user' | 'agent' | 'system';
  sourceId?: string;
  target?: string;
  /** ApprovalManager instance. When provided, require-approval verdicts prompt the user. */
  approvalManager?: ApprovalManager;
  /** Human-readable description of the action being guarded (shown in approval UI). */
  actionSummary?: string;
}

/**
 * Run a guard check and handle all outcomes.
 * Returns true when the caller should proceed, false when the reply has already
 * been sent (action blocked or denied).
 */
export async function guardCheck(opts: GuardCheckOptions): Promise<boolean> {
  const {
    guard,
    reply,
    operation,
    source = 'agent',
    sourceId,
    target,
    approvalManager,
    actionSummary,
  } = opts;

  const verdict = guard.check({ operation, source, sourceId, content: target });

  if (verdict.allowed) return true;

  // require-approval: route through approval manager if available
  if (verdict.action === 'require-approval' && approvalManager) {
    let approvalResponse: import('./ApprovalManager.js').ApprovalResponse;
    try {
      approvalResponse = await approvalManager.requestApproval({
        agentId:     sourceId,
        actionType:  operation,
        target,
        reason:      verdict.reason ?? 'Policy requires approval for this action.',
        riskSummary: actionSummary ?? `${source ?? 'agent'} requested: ${operation}${target ? ` on ${target}` : ''}`,
        context:     { verdict: verdict as unknown as Record<string, unknown> },
      });
    } catch {
      // Should not happen — requestApproval never throws — but be safe
      approvalResponse = 'deny';
    }

    if (approvalResponse !== 'deny') {
      // allow_once or allow_for_session → proceed
      return true;
    }

    // User denied
    sendError(reply, 403, 'APPROVAL_DENIED', 'Approval request denied by user.', 'The action was blocked by the approval flow.');
    return false;
  }

  // Plain deny (or require-approval without an approvalManager)
  sendError(
    reply,
    403,
    'GUARD_DENIED',
    verdict.reason ?? 'Guard denied operation',
    'Adjust your Guard policy in the Guard tab if this is unexpected.',
  );
  return false;
}
