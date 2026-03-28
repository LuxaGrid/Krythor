import { randomUUID } from 'crypto';

// ─── ApprovalManager ──────────────────────────────────────────────────────────
//
// Manages pending approval requests for 'require-approval' guard decisions.
//
// Flow:
//   1. Guard returns verdict.action === 'require-approval'
//   2. Caller calls approvalManager.requestApproval(...)
//   3. requestApproval() creates a PendingApproval, stores it, and waits
//   4. UI polls GET /api/approvals and shows a modal
//   5. User clicks Allow Once / Allow for Session / Deny
//   6. UI calls POST /api/approvals/:id/respond
//   7. respond() resolves the waiting Promise
//   8. If no response within timeoutMs → auto-deny (never deadlock)
//
// Session approvals: 'allow_for_session' stores a pattern in the session set.
// Subsequent requests with matching agentId+actionType are auto-allowed.
//

export type ApprovalResponse = 'allow_once' | 'allow_for_session' | 'deny';

export interface PendingApproval {
  id: string;
  requestedAt: number;
  expiresAt: number;
  agentId?: string;
  toolName?: string;
  actionType: string;
  target?: string;
  reason: string;
  riskSummary: string;
  context: Record<string, unknown>;
}

export class ApprovalManager {
  private pending = new Map<string, {
    approval: PendingApproval;
    resolve: (response: ApprovalResponse) => void;
  }>();

  // Session overrides — set of "<agentId>:<actionType>" keys that were
  // approved for the session via 'allow_for_session'.
  private sessionApprovals = new Set<string>();

  /** Optional broadcast callback — called when a new approval is created so
   *  connected UI clients can be notified immediately via WebSocket. */
  private onNewApproval?: (approval: PendingApproval) => void;

  /** Wire in a broadcast callback after construction (avoids circular dep). */
  setOnNewApproval(cb: (approval: PendingApproval) => void): void {
    this.onNewApproval = cb;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Request user approval for an action.
   * Blocks until the user responds (or timeout expires → deny).
   *
   * @param approval  PendingApproval metadata (without id/requestedAt/expiresAt)
   * @param timeoutMs How long to wait before auto-denying (default: 30s)
   */
  async requestApproval(
    approval: Omit<PendingApproval, 'id' | 'requestedAt' | 'expiresAt'>,
    timeoutMs = 30_000,
  ): Promise<ApprovalResponse> {
    // Check session override first — no need to prompt
    const sessionKey = this.buildSessionKey(approval.agentId, approval.actionType);
    if (this.sessionApprovals.has(sessionKey)) {
      return 'allow_once'; // approved for session → silently allow
    }

    const id = randomUUID();
    const now = Date.now();
    const full: PendingApproval = {
      ...approval,
      id,
      requestedAt: now,
      expiresAt: now + timeoutMs,
    };

    // Notify broadcast listeners immediately so UI shows the approval without waiting for next poll
    this.onNewApproval?.(full);

    return new Promise<ApprovalResponse>((resolve) => {
      this.pending.set(id, { approval: full, resolve });

      // Auto-deny after timeout — prevents deadlock if UI is not open
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resolve('deny');
        }
      }, timeoutMs);

      // Keep timer ref in a WeakRef-friendly way: override resolve to also clear timer
      const wrappedResolve = (response: ApprovalResponse) => {
        clearTimeout(timer);
        resolve(response);
      };
      // Replace stored resolve with the wrapped version
      this.pending.set(id, { approval: full, resolve: wrappedResolve });
    });
  }

  /**
   * Returns all pending approvals (sorted oldest-first).
   */
  getPending(): PendingApproval[] {
    const now = Date.now();
    const result: PendingApproval[] = [];
    for (const [id, entry] of this.pending) {
      // Auto-expire items past their deadline
      if (entry.approval.expiresAt < now) {
        entry.resolve('deny');
        this.pending.delete(id);
        continue;
      }
      result.push(entry.approval);
    }
    return result.sort((a, b) => a.requestedAt - b.requestedAt);
  }

  /**
   * Respond to a pending approval by id.
   * Throws if the id is not found or has already expired.
   */
  respond(id: string, response: ApprovalResponse): void {
    const entry = this.pending.get(id);
    if (!entry) {
      throw new Error(`Approval request "${id}" not found or already resolved`);
    }

    this.pending.delete(id);

    // Record session approval if requested
    if (response === 'allow_for_session') {
      const key = this.buildSessionKey(entry.approval.agentId, entry.approval.actionType);
      this.sessionApprovals.add(key);
    }

    entry.resolve(response);
  }

  /**
   * Clear all session-level approvals (e.g. on agent restart).
   */
  clearSessionApprovals(): void {
    this.sessionApprovals.clear();
  }

  /**
   * Returns the count of pending approvals (useful for polling/badges).
   */
  pendingCount(): number {
    return this.getPending().length;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private buildSessionKey(agentId: string | undefined, actionType: string): string {
    return `${agentId ?? '*'}:${actionType}`;
  }
}
