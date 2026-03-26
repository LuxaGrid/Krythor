import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalManager } from './ApprovalManager.js';

function makeApproval(overrides: Record<string, unknown> = {}) {
  return {
    actionType: 'network:fetch',
    reason: 'Policy requires approval',
    riskSummary: 'Outbound network request from agent',
    context: {},
    ...overrides,
  };
}

describe('ApprovalManager', () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    manager = new ApprovalManager();
    vi.useFakeTimers();
  });

  it('returns empty list when no pending approvals', () => {
    expect(manager.getPending()).toHaveLength(0);
    expect(manager.pendingCount()).toBe(0);
  });

  it('auto-denies after timeout (prevent deadlock)', async () => {
    const promise = manager.requestApproval(makeApproval(), 1000);
    vi.advanceTimersByTime(1001);
    const response = await promise;
    expect(response).toBe('deny');
  });

  it('allows respond() before timeout', async () => {
    const promise = manager.requestApproval(makeApproval({ agentId: 'agent-1' }), 5000);

    // Respond before timeout
    const pending = manager.getPending();
    expect(pending).toHaveLength(1);
    manager.respond(pending[0]!.id, 'allow_once');

    const response = await promise;
    expect(response).toBe('allow_once');
  });

  it('respond() with allow_for_session stores session approval', async () => {
    const promise = manager.requestApproval(
      makeApproval({ agentId: 'agent-2', actionType: 'webhook:call' }),
      5000,
    );
    const [approval] = manager.getPending();
    manager.respond(approval!.id, 'allow_for_session');
    await promise;

    // A second request for same agent+actionType should be auto-allowed
    const promise2 = manager.requestApproval(
      makeApproval({ agentId: 'agent-2', actionType: 'webhook:call' }),
      5000,
    );
    const response2 = await promise2;
    expect(response2).toBe('allow_once'); // session-allowed → silently allow_once
    // No new pending entry should have been created
    expect(manager.getPending()).toHaveLength(0);
  });

  it('respond() with deny resolves as deny', async () => {
    const promise = manager.requestApproval(makeApproval(), 5000);
    const [approval] = manager.getPending();
    manager.respond(approval!.id, 'deny');
    const response = await promise;
    expect(response).toBe('deny');
  });

  it('throws when responding to unknown id', () => {
    expect(() => manager.respond('nonexistent-id', 'allow_once')).toThrow('not found');
  });

  it('clearSessionApprovals removes all session overrides', async () => {
    const promise = manager.requestApproval(
      makeApproval({ agentId: 'a3', actionType: 'network:search' }),
      5000,
    );
    const [approval] = manager.getPending();
    manager.respond(approval!.id, 'allow_for_session');
    await promise;

    manager.clearSessionApprovals();

    // Now same request should go to pending again (session override cleared)
    let secondPending: ReturnType<typeof manager.getPending> = [];
    const promise2 = manager.requestApproval(
      makeApproval({ agentId: 'a3', actionType: 'network:search' }),
      5000,
    );
    secondPending = manager.getPending();
    expect(secondPending).toHaveLength(1);

    // Clean up
    manager.respond(secondPending[0]!.id, 'deny');
    await promise2;
  });

  it('getPending auto-expires items past their deadline', async () => {
    const promise = manager.requestApproval(makeApproval(), 500);
    // Advance past deadline before calling getPending
    vi.advanceTimersByTime(600);
    const pending = manager.getPending(); // should auto-expire the entry
    expect(pending).toHaveLength(0);
    // The auto-denied promise should resolve
    const response = await promise;
    expect(response).toBe('deny');
  });

  it('includes correct metadata in pending approval', () => {
    const promise = manager.requestApproval(
      makeApproval({
        agentId: 'agent-x',
        toolName: 'web_fetch',
        target: 'https://example.com',
      }),
      10_000,
    );
    const [approval] = manager.getPending();
    expect(approval!.agentId).toBe('agent-x');
    expect(approval!.toolName).toBe('web_fetch');
    expect(approval!.target).toBe('https://example.com');
    expect(approval!.expiresAt).toBeGreaterThan(Date.now());

    // Clean up
    manager.respond(approval!.id, 'deny');
    return promise;
  });
});
