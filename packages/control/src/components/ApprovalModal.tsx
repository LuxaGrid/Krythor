import { useState, useEffect, useCallback } from 'react';

// ─── ApprovalModal ─────────────────────────────────────────────────────────────
//
// Polls GET /api/approvals every 2s.
// When pending approvals exist, shows a modal for each one.
// The user can allow once, allow for the session, or deny.
//

interface PendingApproval {
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

type ApprovalResponse = 'allow_once' | 'allow_for_session' | 'deny';

const POLL_INTERVAL_MS = 2000;

function timeRemainingLabel(expiresAt: number): string {
  const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return remaining > 0 ? `${remaining}s` : 'expired';
}

function riskColor(actionType: string): string {
  if (actionType.includes('delete') || actionType.includes('execute') || actionType.includes('command')) {
    return 'text-red-400';
  }
  if (actionType.includes('write') || actionType.includes('webhook') || actionType.includes('network')) {
    return 'text-amber-400';
  }
  return 'text-zinc-300';
}

async function fetchPending(token: string | undefined): Promise<PendingApproval[]> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch('/api/approvals', { headers });
  if (!res.ok) return [];
  const data = await res.json() as { approvals: PendingApproval[] };
  return data.approvals ?? [];
}

async function submitResponse(
  id: string,
  response: ApprovalResponse,
  token: string | undefined,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  await fetch(`/api/approvals/${id}/respond`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ response }),
  });
}

export function ApprovalModal({ token }: { token?: string }) {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [responding, setResponding] = useState<string | null>(null);
  const [, setTick] = useState(0); // force re-render for countdown

  // Poll for pending approvals
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const pending = await fetchPending(token);
        if (!cancelled) setApprovals(pending);
      } catch {
        // Polling failure is non-fatal — gateway may be starting up
      }
    }

    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);

    // Tick every second to update the countdown timer in the UI
    const tickId = setInterval(() => { if (!cancelled) setTick(t => t + 1); }, 1000);

    return () => {
      cancelled = true;
      clearInterval(id);
      clearInterval(tickId);
    };
  }, [token]);

  const handleRespond = useCallback(async (id: string, response: ApprovalResponse) => {
    setResponding(id);
    try {
      await submitResponse(id, response, token);
      setApprovals(prev => prev.filter(a => a.id !== id));
    } catch {
      // If submit failed, the server will auto-deny on timeout
    } finally {
      setResponding(null);
    }
  }, [token]);

  if (approvals.length === 0) return null;

  const approval = approvals[0]!;
  const isResponding = responding === approval.id;

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-zinc-900 border border-amber-700/50 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 bg-amber-950/20">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-semibold text-sm">Approval Required</span>
              {approvals.length > 1 && (
                <span className="text-[10px] bg-amber-800/60 text-amber-300 px-1.5 py-0.5 rounded-full">
                  {approvals.length} pending
                </span>
              )}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5">
              Auto-denies in {timeRemainingLabel(approval.expiresAt)}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* Action type */}
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-zinc-600 w-24 shrink-0">Action</span>
            <span className={`text-sm font-mono font-medium ${riskColor(approval.actionType)}`}>
              {approval.actionType}
            </span>
          </div>

          {/* Agent */}
          {approval.agentId && (
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] text-zinc-600 w-24 shrink-0">Agent</span>
              <span className="text-sm text-zinc-300 font-mono">{approval.agentId}</span>
            </div>
          )}

          {/* Tool */}
          {approval.toolName && (
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] text-zinc-600 w-24 shrink-0">Tool</span>
              <span className="text-sm text-zinc-300 font-mono">{approval.toolName}</span>
            </div>
          )}

          {/* Target */}
          {approval.target && (
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] text-zinc-600 w-24 shrink-0">Target</span>
              <span className="text-sm text-zinc-400 font-mono truncate max-w-[280px]" title={approval.target}>
                {approval.target}
              </span>
            </div>
          )}

          {/* Reason */}
          <div className="mt-1 p-3 bg-zinc-800/60 rounded-lg border border-zinc-700/50">
            <div className="text-[11px] text-zinc-500 mb-1">Policy reason</div>
            <div className="text-sm text-zinc-300">{approval.reason}</div>
          </div>

          {/* Risk summary */}
          {approval.riskSummary && (
            <div className="text-[11px] text-amber-400/80 bg-amber-950/20 border border-amber-900/30 rounded px-3 py-2">
              {approval.riskSummary}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-4 border-t border-zinc-800 bg-zinc-950/40">
          <button
            disabled={isResponding}
            onClick={() => handleRespond(approval.id, 'deny')}
            className="flex-1 px-3 py-2 rounded-lg text-sm text-red-400 border border-red-900/50 hover:bg-red-950/30 disabled:opacity-50 transition-colors"
          >
            Deny
          </button>
          <button
            disabled={isResponding}
            onClick={() => handleRespond(approval.id, 'allow_once')}
            className="flex-1 px-3 py-2 rounded-lg text-sm text-zinc-200 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            Allow Once
          </button>
          <button
            disabled={isResponding}
            onClick={() => handleRespond(approval.id, 'allow_for_session')}
            className="flex-1 px-3 py-2 rounded-lg text-sm text-emerald-400 border border-emerald-900/50 hover:bg-emerald-950/30 disabled:opacity-50 transition-colors"
          >
            Allow for Session
          </button>
        </div>
      </div>
    </div>
  );
}
