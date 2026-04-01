import { useState, useEffect, useCallback } from 'react';
import { TrustIndicator, inferTrustLevel } from './TrustIndicator.tsx';

// ─── ApprovalModal ─────────────────────────────────────────────────────────────
//
// Polls GET /api/approvals every 2s.
// When pending approvals exist, shows a modal for each one.
// The user can approve once, approve for the session, or deny.
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

function timeRemainingUrgent(expiresAt: number): boolean {
  return Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) < 15;
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
  const [showPayload, setShowPayload] = useState(false);
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
      setShowPayload(false);
    }
  }, [token]);

  if (approvals.length === 0) return null;

  const approval = approvals[0]!;
  const isResponding = responding === approval.id;
  const trustLevel = inferTrustLevel(approval.actionType, approval.target);
  const urgent = timeRemainingUrgent(approval.expiresAt);

  return (
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 bg-zinc-900 border border-amber-700/50 rounded-xl shadow-2xl overflow-hidden">

        {/* Brand header */}
        <div className="px-5 py-3 border-b border-zinc-800/60 bg-zinc-950/60 flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">
            Krythor SafeCore™
          </span>
          <span className="text-[10px] text-zinc-600">·</span>
          <span className="text-[10px] text-zinc-600">Every action is evaluated before it runs.</span>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 bg-amber-950/20">
          <div className="flex-1">
            <div className="flex items-center gap-2.5">
              <span className="text-amber-400 font-semibold text-sm">Action Requires Approval</span>
              <TrustIndicator level={trustLevel} />
              {approvals.length > 1 && (
                <span className="text-[10px] bg-amber-800/60 text-amber-300 px-1.5 py-0.5 rounded-full">
                  {approvals.length} pending
                </span>
              )}
            </div>
            <div className={`text-[11px] mt-0.5 ${urgent ? 'text-red-400 animate-pulse font-medium' : 'text-zinc-500'}`}>
              Auto-denies in {timeRemainingLabel(approval.expiresAt)}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* Action type */}
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-zinc-600 w-24 shrink-0">Action</span>
            <span className="text-sm font-mono font-medium text-zinc-200">
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
            <div className="text-[11px] text-zinc-500 mb-1">Why this needs review</div>
            <div className="text-sm text-zinc-300">{approval.reason}</div>
          </div>

          {/* Risk summary */}
          {approval.riskSummary && (
            <div className="text-[11px] text-amber-400/80 bg-amber-950/20 border border-amber-900/30 rounded px-3 py-2">
              {approval.riskSummary}
            </div>
          )}

          {/* Collapsible payload */}
          {Object.keys(approval.context).length > 0 && (
            <div>
              <button
                onClick={() => setShowPayload(v => !v)}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
              >
                <span className={`inline-block transition-transform ${showPayload ? 'rotate-90' : ''}`}>▶</span>
                {showPayload ? 'Hide' : 'Review'} request context
              </button>
              {showPayload && (
                <pre className="mt-2 text-[10px] text-zinc-400 bg-zinc-950/60 border border-zinc-800 rounded-lg p-3 overflow-auto max-h-40 leading-relaxed">
                  {JSON.stringify(approval.context, null, 2)}
                </pre>
              )}
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
            Approve Once
          </button>
          <button
            disabled={isResponding}
            onClick={() => handleRespond(approval.id, 'allow_for_session')}
            className="flex-1 px-3 py-2 rounded-lg text-sm text-emerald-400 border border-emerald-900/50 hover:bg-emerald-950/30 disabled:opacity-50 transition-colors"
          >
            Approve for Session
          </button>
        </div>

        {/* Footer */}
        <div className="px-5 py-2 border-t border-zinc-800/40 bg-zinc-950/30">
          <p className="text-[10px] text-zinc-600 tracking-wide">
            Nothing happens silently in the background. Your Machine. Your Data. Your Rules.
          </p>
        </div>
      </div>
    </div>
  );
}
