/**
 * SafeCoreEngine — containment and execution control for Krythor SafeCore.
 *
 * Evaluates execution requests against per-mode policies, records executions,
 * enforces filesystem/network/command containment, and manages the approval
 * and promotion workflows.
 */

import type { SafeCoreStore, SafeCoreMode, SafeCoreExecution } from '@krythor/memory';
import type { GuardEngine } from '@krythor/guard';
import type { AuditLogger } from './AuditLogger.js';
import type { ApprovalManager } from './ApprovalManager.js';

export interface SafeCoreExecutionRequest {
  agentId?: string;
  runId?: string;
  mode: SafeCoreMode;
  requestedAction: string;
  filesystemScope?: { allowedPaths: string[]; workspaceDir?: string };
  networkScope?: { allowedHosts: string[]; blockedHosts: string[] };
  connectorScope?: { allowedConnectors: string[] };
}

export interface SafeCoreExecutionResult {
  execution: SafeCoreExecution;
  allowed: boolean;
  requiresApproval: boolean;
  approvalId?: string;
  blockedReason?: string;
}

export interface SafeCorePromotionRequest {
  executionId: string;
  promotedBy?: string;
}

export type SafeCoreLogFn = (level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>) => void;

export class SafeCoreEngine {
  constructor(
    private readonly store: SafeCoreStore,
    private readonly guard: GuardEngine,
    private readonly auditLogger: AuditLogger,
    private readonly approvalManager?: ApprovalManager,
    private readonly log: SafeCoreLogFn = () => {},
  ) {}

  /**
   * Evaluate and record an execution request.
   * Returns the created execution record and whether it is allowed to proceed.
   */
  async evaluate(req: SafeCoreExecutionRequest): Promise<SafeCoreExecutionResult> {
    const policy = this.store.getPolicy(req.mode);

    // Guard check
    const verdict = this.guard.check({
      operation: 'safecore:execute',
      source: 'agent',
      ...(req.agentId && { sourceId: req.agentId }),
      content: req.requestedAction,
      metadata: { mode: req.mode },
    });

    // Also enforce elevated-access guard check for high-risk modes
    let elevatedVerdict = null;
    if (req.mode === 'ELEVATED_HOST') {
      elevatedVerdict = this.guard.check({
        operation: 'safecore:elevate',
        source: 'agent',
        ...(req.agentId && { sourceId: req.agentId }),
        content: req.requestedAction,
        metadata: { mode: req.mode },
      });
    }

    const hardBlocked = !verdict.allowed && verdict.action === 'deny';
    const elevatedBlocked = elevatedVerdict && !elevatedVerdict.allowed && elevatedVerdict.action === 'deny';

    if (hardBlocked || elevatedBlocked) {
      const execution = this.store.create({
        ...req,
        policyResult: 'deny',
        policyReason: elevatedBlocked ? elevatedVerdict!.reason : verdict.reason,
      });
      this.store.update(execution.id, { resultState: 'blocked' });
      this.auditLogger.log({
        actionType: 'safecore:execute',
        target: req.requestedAction,
        policyDecision: 'deny',
        agentId: req.agentId,
        reason: verdict.reason,
        executionOutcome: 'blocked',
      });
      this.log('warn', '[SafeCore] Execution blocked by policy', { mode: req.mode, reason: verdict.reason });
      return { execution: this.store.getById(execution.id)!, allowed: false, requiresApproval: false, blockedReason: verdict.reason };
    }

    // Require approval: policy says so OR guard says require-approval OR mode requires it
    const requiresApproval = policy?.requireApproval ||
      verdict.action === 'require-approval' ||
      (req.mode === 'ELEVATED_HOST' && (elevatedVerdict?.action === 'require-approval'));

    const policyResult = requiresApproval ? 'require-approval' : (verdict.action === 'warn' ? 'warn' : 'allow');

    const execution = this.store.create({
      ...req,
      policyResult,
      policyReason: verdict.reason !== 'Default allow' ? verdict.reason : undefined,
    });

    if (requiresApproval) {
      this.store.update(execution.id, { approvalState: 'pending', resultState: 'pending' });
      this.auditLogger.log({
        actionType: 'safecore:execute',
        target: req.requestedAction,
        policyDecision: 'require-approval',
        agentId: req.agentId,
        reason: 'Approval required for this SafeCore mode',
        executionOutcome: 'blocked',
      });
      this.log('info', '[SafeCore] Execution pending approval', { mode: req.mode, executionId: execution.id });
      return { execution: this.store.getById(execution.id)!, allowed: false, requiresApproval: true };
    }

    // Allowed — mark as running
    this.store.update(execution.id, { resultState: 'running', approvalState: 'none' });
    this.auditLogger.log({
      actionType: 'safecore:execute',
      target: req.requestedAction,
      policyDecision: verdict.action as 'allow' | 'warn',
      agentId: req.agentId,
    });
    this.log('info', '[SafeCore] Execution allowed', { mode: req.mode, executionId: execution.id });
    return { execution: this.store.getById(execution.id)!, allowed: true, requiresApproval: false };
  }

  /** Approve a pending execution. */
  approve(executionId: string, approvedBy = 'user'): SafeCoreExecution {
    const ex = this.store.getById(executionId);
    if (!ex) throw new Error(`SafeCore execution "${executionId}" not found`);
    if (ex.approvalState !== 'pending') throw new Error(`Execution is not pending approval (state: ${ex.approvalState})`);
    const updated = this.store.update(executionId, {
      approvalState: 'approved',
      approvedAction: ex.requestedAction,
      resultState: 'running',
    });
    this.auditLogger.log({
      actionType: 'safecore:execute',
      target: ex.requestedAction,
      policyDecision: 'allow',
      agentId: ex.agentId,
      approvalResult: 'allow_once',
      reason: `Approved by ${approvedBy}`,
    });
    this.log('info', '[SafeCore] Execution approved', { executionId, approvedBy });
    return updated;
  }

  /** Deny a pending execution. */
  deny(executionId: string, deniedBy = 'user', reason?: string): SafeCoreExecution {
    const ex = this.store.getById(executionId);
    if (!ex) throw new Error(`SafeCore execution "${executionId}" not found`);
    if (ex.approvalState !== 'pending') throw new Error(`Execution is not pending approval (state: ${ex.approvalState})`);
    const updated = this.store.update(executionId, {
      approvalState: 'denied',
      resultState: 'blocked',
      errorMessage: reason ?? `Denied by ${deniedBy}`,
    });
    this.auditLogger.log({
      actionType: 'safecore:execute',
      target: ex.requestedAction,
      policyDecision: 'deny',
      agentId: ex.agentId,
      approvalResult: 'deny',
      reason: reason ?? `Denied by ${deniedBy}`,
      executionOutcome: 'blocked',
    });
    this.log('info', '[SafeCore] Execution denied', { executionId, deniedBy });
    return updated;
  }

  /** Complete a running execution with results. */
  complete(executionId: string, result: {
    output?: string;
    filesTouched?: string[];
    commandsRun?: { cmd: string; args: string[]; exitCode?: number }[];
    networkAttempts?: { url: string; blocked: boolean }[];
    errorMessage?: string;
    success: boolean;
  }): SafeCoreExecution {
    const ex = this.store.getById(executionId);
    if (!ex) throw new Error(`SafeCore execution "${executionId}" not found`);
    const updated = this.store.update(executionId, {
      resultState: result.success ? 'completed' : 'failed',
      completedAt: Date.now(),
      output: result.output,
      filesTouched: result.filesTouched,
      commandsRun: result.commandsRun,
      networkAttempts: result.networkAttempts,
      errorMessage: result.errorMessage,
      // If completed successfully and mode produces promotable output, mark for promotion review
      promotionState: result.success && ex.mode !== 'READ_ONLY' ? 'pending' : 'none',
    });
    this.auditLogger.log({
      actionType: 'safecore:execute',
      target: ex.requestedAction,
      agentId: ex.agentId,
      executionOutcome: result.success ? 'success' : 'error',
      durationMs: ex.startedAt ? Date.now() - ex.startedAt : undefined,
    });
    return updated;
  }

  /** Request promotion of a completed execution to host. */
  async requestPromotion(req: SafeCorePromotionRequest): Promise<SafeCoreExecution> {
    const ex = this.store.getById(req.executionId);
    if (!ex) throw new Error(`SafeCore execution "${req.executionId}" not found`);
    if (ex.resultState !== 'completed') {
      throw new Error(`Only completed executions can be promoted (state: ${ex.resultState})`);
    }
    const policy = this.store.getPolicy(ex.mode);

    // Guard check for promotion
    const verdict = this.guard.check({
      operation: 'safecore:promote',
      source: 'user',
      content: ex.requestedAction,
      metadata: { mode: ex.mode, executionId: ex.id },
    });

    if (!verdict.allowed && verdict.action === 'deny') {
      this.store.update(ex.id, { promotionState: 'rejected' });
      this.auditLogger.log({
        actionType: 'safecore:promote',
        target: ex.requestedAction,
        policyDecision: 'deny',
        agentId: ex.agentId,
        reason: verdict.reason,
        executionOutcome: 'blocked',
      });
      throw new Error(`Promotion blocked by policy: ${verdict.reason}`);
    }

    if (policy?.requirePromotionApproval || verdict.action === 'require-approval') {
      const updated = this.store.update(ex.id, { promotionState: 'pending' });
      this.auditLogger.log({
        actionType: 'safecore:promote',
        target: ex.requestedAction,
        policyDecision: 'require-approval',
        agentId: ex.agentId,
      });
      this.log('info', '[SafeCore] Promotion pending approval', { executionId: ex.id });
      return updated;
    }

    // Auto-promote
    return this.promoteToHost(ex.id, req.promotedBy ?? 'system');
  }

  /** Approve and execute promotion to host. */
  promoteToHost(executionId: string, promotedBy = 'user'): SafeCoreExecution {
    const ex = this.store.getById(executionId);
    if (!ex) throw new Error(`SafeCore execution "${executionId}" not found`);
    const updated = this.store.update(executionId, {
      promotionState: 'promoted',
      promotedAt: Date.now(),
      promotedBy,
      resultState: 'promoted',
    });
    this.auditLogger.log({
      actionType: 'safecore:promote',
      target: ex.requestedAction,
      policyDecision: 'allow',
      agentId: ex.agentId,
      approvalResult: 'allow_once',
      reason: `Promoted to host by ${promotedBy}`,
      executionOutcome: 'success',
    });
    this.log('info', '[SafeCore] Execution promoted to host', { executionId, promotedBy });
    return updated;
  }

  /** Reject a pending promotion. */
  rejectPromotion(executionId: string, rejectedBy = 'user', reason?: string): SafeCoreExecution {
    const ex = this.store.getById(executionId);
    if (!ex) throw new Error(`SafeCore execution "${executionId}" not found`);
    const updated = this.store.update(executionId, {
      promotionState: 'rejected',
      errorMessage: reason ?? `Promotion rejected by ${rejectedBy}`,
    });
    this.auditLogger.log({
      actionType: 'safecore:promote',
      target: ex.requestedAction,
      policyDecision: 'deny',
      agentId: ex.agentId,
      approvalResult: 'deny',
      reason: reason ?? `Promotion rejected by ${rejectedBy}`,
    });
    return updated;
  }
}
