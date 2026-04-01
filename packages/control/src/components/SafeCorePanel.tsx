import { useState, useEffect, useCallback, useRef } from 'react';
import { SafeCoreStatusCard } from './SafeCoreStatusCard.tsx';
import {
  getSafeCoreDashboard,
  listSafeCoreExecutions,
  getSafeCoreExecution,
  approveSafeCoreExecution,
  denySafeCoreExecution,
  promoteSafeCoreExecution,
  approvePromotion,
  rejectPromotion,
  type SafeCoreExecution,
  type SafeCoreDashboard,
  type SafeCoreMode,
  type SafeCoreResultState,
  type SafeCoreApprovalState,
  type SafeCorePromotionState,
  type SafeCorePolicyResult,
} from '../api.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatDuration(startedAt: number, completedAt?: number): string {
  if (!completedAt) return 'ongoing';
  const ms = completedAt - startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

// ── Mode badge ────────────────────────────────────────────────────────────────

const MODE_LABELS: Record<SafeCoreMode, string> = {
  READ_ONLY:          'Read Only',
  WORKSPACE:          'Workspace',
  CONNECTOR_LIMITED:  'Connector Controlled',
  ELEVATED_HOST:      'Elevated Access',
};

const MODE_COLORS: Record<SafeCoreMode, string> = {
  READ_ONLY:          'bg-zinc-800 text-zinc-300 border-zinc-700',
  WORKSPACE:          'bg-blue-950/60 text-blue-300 border-blue-800/50',
  CONNECTOR_LIMITED:  'bg-purple-950/60 text-purple-300 border-purple-800/50',
  ELEVATED_HOST:      'bg-orange-950/60 text-orange-300 border-orange-800/50',
};

function ModeBadge({ mode }: { mode: SafeCoreMode }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${MODE_COLORS[mode]}`}>
      {MODE_LABELS[mode]}
    </span>
  );
}

// ── Result state badge ────────────────────────────────────────────────────────

function ResultStateBadge({ state }: { state: SafeCoreResultState }) {
  switch (state) {
    case 'pending':
      return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-zinc-800 text-zinc-400 border-zinc-700">pending</span>;
    case 'running':
      return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-blue-950/60 text-blue-300 border-blue-800/50 animate-pulse">running</span>;
    case 'completed':
      return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-950/60 text-emerald-300 border-emerald-800/50">completed</span>;
    case 'failed':
      return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-950/60 text-red-300 border-red-800/50">failed</span>;
    case 'blocked':
      return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-950/60 text-red-300 border-red-800/50">Blocked by Policy</span>;
    case 'promoted':
      return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-indigo-950/60 text-indigo-300 border-indigo-800/50">promoted</span>;
    default:
      return null;
  }
}

// ── Approval state badge ──────────────────────────────────────────────────────

function ApprovalStateBadge({ state }: { state: SafeCoreApprovalState }) {
  switch (state) {
    case 'none':    return null;
    case 'pending': return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-950/60 text-amber-300 border-amber-800/50">Awaiting Review</span>;
    case 'approved':return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-950/60 text-emerald-300 border-emerald-800/50">Approved</span>;
    case 'denied':  return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-950/60 text-red-300 border-red-800/50">Denied</span>;
    default:        return null;
  }
}

// ── Promotion state badge ─────────────────────────────────────────────────────

function PromotionStateBadge({ state }: { state: SafeCorePromotionState }) {
  switch (state) {
    case 'none':     return null;
    case 'pending':  return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-950/60 text-amber-300 border-amber-800/50">Ready for Promotion</span>;
    case 'approved': return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-950/60 text-emerald-300 border-emerald-800/50">Approved</span>;
    case 'promoted': return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-indigo-950/60 text-indigo-300 border-indigo-800/50">Promoted</span>;
    case 'rejected': return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-950/60 text-red-300 border-red-800/50">Rejected</span>;
    default:         return null;
  }
}

// ── Policy result badge ───────────────────────────────────────────────────────

function PolicyResultBadge({ result }: { result: SafeCorePolicyResult }) {
  switch (result) {
    case 'allow':            return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-950/60 text-emerald-300 border-emerald-800/50">allow</span>;
    case 'deny':             return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-950/60 text-red-300 border-red-800/50">deny</span>;
    case 'warn':             return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-950/60 text-amber-300 border-amber-800/50">warn</span>;
    case 'require-approval': return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-sky-950/60 text-sky-300 border-sky-800/50">require-approval</span>;
    default:                 return null;
  }
}

// ── Section heading ───────────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2 mt-4 first:mt-0">
      {children}
    </p>
  );
}

// ── Run Detail view ───────────────────────────────────────────────────────────

interface RunDetailViewProps {
  executionId: string;
  onBack: () => void;
}

function RunDetailView({ executionId, onBack }: RunDetailViewProps) {
  const [exec, setExec] = useState<SafeCoreExecution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getSafeCoreExecution(executionId)
      .then(data => { setExec(data); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, [executionId]);

  useEffect(() => { load(); }, [load]);

  const doAction = useCallback(async (fn: () => Promise<SafeCoreExecution>) => {
    setActionLoading(true);
    try {
      const updated = await fn();
      setExec(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setActionLoading(false);
    }
  }, []);

  if (loading) return <div className="text-gray-400 animate-pulse p-8 text-center">Loading...</div>;
  if (error) return <div className="text-red-400 p-4">{error}</div>;
  if (!exec) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
        <button
          onClick={onBack}
          className="text-zinc-500 hover:text-zinc-200 text-sm transition-colors"
        >
          ← Back
        </button>
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <ModeBadge mode={exec.mode} />
          <span className="text-zinc-200 text-sm font-medium truncate">{exec.requestedAction}</span>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 text-sm">

        {/* Execution Info */}
        <SectionHeading>Execution Info</SectionHeading>
        <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5 space-y-1.5 text-xs">
          <div className="flex gap-2"><span className="text-zinc-500 w-24 shrink-0">ID</span><span className="text-zinc-300 font-mono break-all">{exec.id}</span></div>
          {exec.agentId && <div className="flex gap-2"><span className="text-zinc-500 w-24 shrink-0">Agent</span><span className="text-zinc-300 font-mono">{exec.agentId}</span></div>}
          {exec.runId && <div className="flex gap-2"><span className="text-zinc-500 w-24 shrink-0">Run ID</span><span className="text-zinc-300 font-mono">{exec.runId}</span></div>}
          <div className="flex gap-2"><span className="text-zinc-500 w-24 shrink-0">Started</span><span className="text-zinc-300">{new Date(exec.startedAt).toLocaleString()}</span></div>
          {exec.completedAt && <div className="flex gap-2"><span className="text-zinc-500 w-24 shrink-0">Completed</span><span className="text-zinc-300">{new Date(exec.completedAt).toLocaleString()}</span></div>}
          <div className="flex gap-2"><span className="text-zinc-500 w-24 shrink-0">Duration</span><span className="text-zinc-300">{formatDuration(exec.startedAt, exec.completedAt)}</span></div>
        </div>

        {/* Policy */}
        <SectionHeading>Policy</SectionHeading>
        <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5 space-y-1.5 text-xs">
          <div className="flex items-center gap-2"><span className="text-zinc-500 w-24 shrink-0">Result</span><PolicyResultBadge result={exec.policyResult} /></div>
          {exec.policyReason && <div className="flex gap-2"><span className="text-zinc-500 w-24 shrink-0">Reason</span><span className="text-zinc-300">{exec.policyReason}</span></div>}
          <div className="flex items-center gap-2"><span className="text-zinc-500 w-24 shrink-0">Approval</span><ApprovalStateBadge state={exec.approvalState} />{exec.approvalState === 'none' && <span className="text-zinc-600">—</span>}</div>
        </div>

        {/* Containment Scope */}
        {(exec.filesystemScope || exec.networkScope || exec.connectorScope) && (
          <>
            <SectionHeading>Containment Scope</SectionHeading>
            <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5 space-y-2 text-xs">
              {exec.filesystemScope && (
                <div>
                  <p className="text-zinc-500 mb-1">Filesystem</p>
                  {exec.filesystemScope.workspaceDir && (
                    <p className="text-zinc-400 font-mono ml-2">workspace: {exec.filesystemScope.workspaceDir}</p>
                  )}
                  {exec.filesystemScope.allowedPaths.length > 0 && (
                    <div className="ml-2 space-y-0.5">
                      {exec.filesystemScope.allowedPaths.map((p, i) => (
                        <p key={i} className="text-zinc-300 font-mono">{p}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {exec.networkScope && (
                <div>
                  <p className="text-zinc-500 mb-1">Network</p>
                  {exec.networkScope.allowedHosts.length > 0 && (
                    <div className="ml-2">
                      <span className="text-zinc-600">allowed: </span>
                      <span className="text-zinc-300 font-mono">{exec.networkScope.allowedHosts.join(', ')}</span>
                    </div>
                  )}
                  {exec.networkScope.blockedHosts.length > 0 && (
                    <div className="ml-2">
                      <span className="text-zinc-600">blocked: </span>
                      <span className="text-red-300 font-mono">{exec.networkScope.blockedHosts.join(', ')}</span>
                    </div>
                  )}
                </div>
              )}
              {exec.connectorScope && exec.connectorScope.allowedConnectors.length > 0 && (
                <div>
                  <p className="text-zinc-500 mb-1">Connectors</p>
                  <div className="ml-2 flex flex-wrap gap-1">
                    {exec.connectorScope.allowedConnectors.map((c, i) => (
                      <span key={i} className="text-zinc-300 font-mono bg-zinc-700/40 px-1 rounded">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Output */}
        {exec.output && (
          <>
            <SectionHeading>Output</SectionHeading>
            <pre className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-300 font-mono overflow-y-auto max-h-48 whitespace-pre-wrap break-all">
              {exec.output}
            </pre>
          </>
        )}

        {/* Files Touched */}
        {exec.filesTouched && exec.filesTouched.length > 0 && (
          <>
            <SectionHeading>Files Touched</SectionHeading>
            <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5 space-y-1 text-xs">
              {exec.filesTouched.map((f, i) => (
                <p key={i} className="text-zinc-300 font-mono">{f}</p>
              ))}
            </div>
          </>
        )}

        {/* Commands Run */}
        {exec.commandsRun && exec.commandsRun.length > 0 && (
          <>
            <SectionHeading>Commands Run</SectionHeading>
            <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5 space-y-2 text-xs">
              {exec.commandsRun.map((c, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-zinc-300 font-mono">{c.cmd} {c.args.join(' ')}</span>
                  {c.exitCode !== undefined && (
                    <span className={`ml-auto shrink-0 font-mono ${c.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      exit {c.exitCode}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Network Attempts */}
        {exec.networkAttempts && exec.networkAttempts.length > 0 && (
          <>
            <SectionHeading>Network Attempts</SectionHeading>
            <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5 space-y-1.5 text-xs">
              {exec.networkAttempts.map((n, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-mono text-zinc-300 flex-1 min-w-0 truncate">{n.url}</span>
                  {n.blocked
                    ? <span className="text-red-400 shrink-0">blocked</span>
                    : <span className="text-emerald-400 shrink-0">allowed</span>
                  }
                </div>
              ))}
            </div>
          </>
        )}

        {/* Promotion */}
        {exec.promotionState !== 'none' && (
          <>
            <SectionHeading>Promotion</SectionHeading>
            <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5 space-y-1.5 text-xs">
              <div className="flex items-center gap-2"><span className="text-zinc-500 w-24 shrink-0">State</span><PromotionStateBadge state={exec.promotionState} /></div>
              {exec.promotedAt && <div className="flex gap-2"><span className="text-zinc-500 w-24 shrink-0">Promoted at</span><span className="text-zinc-300">{new Date(exec.promotedAt).toLocaleString()}</span></div>}
              {exec.promotedBy && <div className="flex gap-2"><span className="text-zinc-500 w-24 shrink-0">Promoted by</span><span className="text-zinc-300">{exec.promotedBy}</span></div>}
            </div>
          </>
        )}

        {/* Error */}
        {exec.errorMessage && (
          <>
            <SectionHeading>Error</SectionHeading>
            <div className="bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2.5 text-xs text-red-300">
              {exec.errorMessage}
            </div>
          </>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-2 pt-4">
          {exec.approvalState === 'pending' && (
            <>
              <button
                disabled={actionLoading}
                onClick={() => doAction(() => approveSafeCoreExecution(exec.id))}
                className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-50"
              >
                Approve
              </button>
              <button
                disabled={actionLoading}
                onClick={() => doAction(() => denySafeCoreExecution(exec.id))}
                className="px-3 py-1.5 text-xs rounded bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
              >
                Deny
              </button>
            </>
          )}
          {exec.resultState === 'completed' && exec.promotionState === 'none' && (
            <button
              disabled={actionLoading}
              onClick={() => doAction(() => promoteSafeCoreExecution(exec.id))}
              className="px-3 py-1.5 text-xs rounded bg-indigo-700 hover:bg-indigo-600 text-white transition-colors disabled:opacity-50"
            >
              Promote to Host
            </button>
          )}
          {exec.promotionState === 'pending' && (
            <>
              <button
                disabled={actionLoading}
                onClick={() => doAction(() => approvePromotion(exec.id))}
                className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-50"
              >
                Approve Promotion
              </button>
              <button
                disabled={actionLoading}
                onClick={() => doAction(() => rejectPromotion(exec.id))}
                className="px-3 py-1.5 text-xs rounded bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
              >
                Reject Promotion
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard view ────────────────────────────────────────────────────────────

interface DashboardViewProps {
  onSelectExecution: (id: string) => void;
}

function DashboardView({ onSelectExecution }: DashboardViewProps) {
  const [data, setData] = useState<SafeCoreDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getSafeCoreDashboard()
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, []);

  if (loading) return <div className="text-gray-400 animate-pulse p-8 text-center">Loading...</div>;
  if (error) return <div className="text-red-400 p-4">{error}</div>;
  if (!data) return null;

  const statCards: { label: string; value: number; color: string }[] = [
    { label: 'Total Runs',          value: data.totalRuns,         color: 'text-zinc-200' },
    { label: 'Pending Approvals',   value: data.pendingApprovals,  color: data.pendingApprovals > 0  ? 'text-amber-300' : 'text-zinc-200' },
    { label: 'Pending Promotions',  value: data.pendingPromotions, color: data.pendingPromotions > 0 ? 'text-indigo-300' : 'text-zinc-200' },
    { label: 'Blocked Actions',     value: data.blockedActions,    color: data.blockedActions > 0    ? 'text-red-300'   : 'text-zinc-200' },
  ];

  const modeOrder: SafeCoreMode[] = ['READ_ONLY', 'WORKSPACE', 'CONNECTOR_LIMITED', 'ELEVATED_HOST'];

  // Derive evaluation state from dashboard data
  const evalState = data.pendingApprovals > 0 ? 'pending' : data.blockedActions > 0 ? 'error' : 'complete';

  return (
    <div className="p-4 space-y-6 overflow-y-auto h-full">
      {/* SafeCore status card */}
      <SafeCoreStatusCard
        evaluationState={evalState}
        scopeSummary={`${data.totalRuns} total runs · ${data.pendingApprovals} pending approval${data.pendingApprovals !== 1 ? 's' : ''}`}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {statCards.map(c => (
          <div key={c.label} className="bg-zinc-800/50 border border-zinc-700/50 rounded-xl px-4 py-3">
            <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Runs by mode */}
      <div>
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Runs by Mode</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {modeOrder.map(m => (
            <div key={m} className="bg-zinc-800/40 border border-zinc-700/40 rounded-lg px-3 py-2 flex items-center gap-2">
              <ModeBadge mode={m} />
              <span className="text-zinc-200 text-sm font-medium ml-auto">{data.runsByMode[m] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent runs */}
      <div>
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2">Recent Runs</p>
        {data.recentRuns.length === 0 ? (
          <p className="text-zinc-600 text-sm">No executions in SafeCore yet.</p>
        ) : (
          <div className="space-y-1">
            {data.recentRuns.slice(0, 10).map(run => (
              <button
                key={run.id}
                onClick={() => onSelectExecution(run.id)}
                className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-800/40 border border-zinc-700/40 hover:bg-zinc-700/40 transition-colors group"
              >
                <ModeBadge mode={run.mode} />
                <span className="text-zinc-300 text-xs flex-1 min-w-0 truncate group-hover:text-zinc-100 transition-colors">
                  {run.requestedAction.slice(0, 60)}{run.requestedAction.length > 60 ? '…' : ''}
                </span>
                <ResultStateBadge state={run.resultState} />
                <span className="text-zinc-600 text-[10px] shrink-0">{relativeTime(run.createdAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Runs list view ────────────────────────────────────────────────────────────

interface RunsViewProps {
  onSelectExecution: (id: string) => void;
}

function RunsView({ onSelectExecution }: RunsViewProps) {
  const [executions, setExecutions] = useState<SafeCoreExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState<SafeCoreMode | ''>('');
  const [stateFilter, setStateFilter] = useState<SafeCoreResultState | ''>('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const filter: Parameters<typeof listSafeCoreExecutions>[0] = { limit: 200 };
    if (modeFilter) filter.mode = modeFilter as SafeCoreMode;
    if (stateFilter) filter.resultState = stateFilter as SafeCoreResultState;
    listSafeCoreExecutions(filter)
      .then(r => { setExecutions(r.executions); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, [modeFilter, stateFilter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800 shrink-0 flex-wrap">
        <select
          value={modeFilter}
          onChange={e => setModeFilter(e.target.value as SafeCoreMode | '')}
          className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1 outline-none focus:border-zinc-500"
        >
          <option value="">All Modes</option>
          <option value="READ_ONLY">Read Only</option>
          <option value="WORKSPACE">Workspace</option>
          <option value="CONNECTOR_LIMITED">Connector Controlled</option>
          <option value="ELEVATED_HOST">Elevated Access</option>
        </select>
        <select
          value={stateFilter}
          onChange={e => setStateFilter(e.target.value as SafeCoreResultState | '')}
          className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-2 py-1 outline-none focus:border-zinc-500"
        >
          <option value="">All States</option>
          <option value="pending">pending</option>
          <option value="running">running</option>
          <option value="completed">completed</option>
          <option value="failed">failed</option>
          <option value="blocked">blocked</option>
          <option value="promoted">promoted</option>
        </select>
        <button
          onClick={load}
          className="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="text-gray-400 animate-pulse p-8 text-center">Loading...</div>}
        {error && <div className="text-red-400 p-4">{error}</div>}
        {!loading && !error && executions.length === 0 && (
          <p className="text-zinc-600 text-sm p-4">No executions in SafeCore yet.</p>
        )}
        {!loading && !error && executions.map(exec => (
          <button
            key={exec.id}
            onClick={() => onSelectExecution(exec.id)}
            className="w-full text-left flex items-center gap-2 px-4 py-2.5 border-b border-zinc-800/60 hover:bg-zinc-800/40 transition-colors"
          >
            <ModeBadge mode={exec.mode} />
            <span className="text-zinc-300 text-xs flex-1 min-w-0 truncate">
              {exec.requestedAction.slice(0, 60)}{exec.requestedAction.length > 60 ? '…' : ''}
            </span>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
              <ResultStateBadge state={exec.resultState} />
              {exec.approvalState !== 'none' && <ApprovalStateBadge state={exec.approvalState} />}
              {exec.promotionState !== 'none' && <PromotionStateBadge state={exec.promotionState} />}
            </div>
            <span className="text-zinc-600 text-[10px] shrink-0 ml-2">{relativeTime(exec.createdAt)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Review Queue view ─────────────────────────────────────────────────────────

interface ReviewQueueViewProps {
  onSelectExecution: (id: string) => void;
}

function ReviewQueueView({ onSelectExecution }: ReviewQueueViewProps) {
  const [pendingApprovals, setPendingApprovals]   = useState<SafeCoreExecution[]>([]);
  const [pendingPromotions, setPendingPromotions] = useState<SafeCoreExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      listSafeCoreExecutions({ approvalState: 'pending', limit: 100 }),
      listSafeCoreExecutions({ promotionState: 'pending', limit: 100 }),
    ])
      .then(([approvals, promotions]) => {
        setPendingApprovals(approvals.executions);
        setPendingPromotions(promotions.executions);
        setLoading(false);
      })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, []);

  if (loading) return <div className="text-gray-400 animate-pulse p-8 text-center">Loading...</div>;
  if (error) return <div className="text-red-400 p-4">{error}</div>;

  const renderList = (items: SafeCoreExecution[], emptyMessage: string) => {
    if (items.length === 0) return <p className="text-zinc-600 text-sm">{emptyMessage}</p>;
    return (
      <div className="space-y-1">
        {items.map(exec => (
          <button
            key={exec.id}
            onClick={() => onSelectExecution(exec.id)}
            className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-800/40 border border-zinc-700/40 hover:bg-zinc-700/40 transition-colors"
          >
            <ModeBadge mode={exec.mode} />
            <span className="text-zinc-300 text-xs flex-1 min-w-0 truncate">
              {exec.requestedAction.slice(0, 60)}{exec.requestedAction.length > 60 ? '…' : ''}
            </span>
            <span className="text-zinc-600 text-[10px] shrink-0">{relativeTime(exec.createdAt)}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="p-4 space-y-6 overflow-y-auto h-full">
      <div>
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-3">Awaiting Approval</p>
        {renderList(pendingApprovals, 'No approvals pending.')}
      </div>
      <div>
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-3">Awaiting Promotion Review</p>
        {renderList(pendingPromotions, 'No promotions waiting for review.')}
      </div>
    </div>
  );
}

// ── Promotion Review view ─────────────────────────────────────────────────────

interface PromotionReviewViewProps {
  onSelectExecution: (id: string) => void;
}

function PromotionReviewView({ onSelectExecution }: PromotionReviewViewProps) {
  const [executions, setExecutions] = useState<SafeCoreExecution[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listSafeCoreExecutions({ promotionState: 'pending', limit: 100 })
      .then(r => { setExecutions(r.executions); setLoading(false); })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const doAction = useCallback(async (fn: () => Promise<SafeCoreExecution>) => {
    setActionLoading(true);
    try {
      await fn();
      setExpanded(null);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setActionLoading(false);
    }
  }, [load]);

  if (loading) return <div className="text-gray-400 animate-pulse p-8 text-center">Loading...</div>;
  if (error) return <div className="text-red-400 p-4">{error}</div>;
  if (executions.length === 0) return <p className="text-zinc-600 text-sm p-4">No promotions waiting for review.</p>;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 space-y-2">
        {executions.map(exec => (
          <div key={exec.id} className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl overflow-hidden">
            {/* Row */}
            <button
              onClick={() => {
                if (expanded === exec.id) {
                  setExpanded(null);
                } else {
                  setExpanded(exec.id);
                }
              }}
              className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-zinc-700/30 transition-colors"
            >
              <ModeBadge mode={exec.mode} />
              <span className="text-zinc-300 text-xs flex-1 min-w-0 truncate">
                {exec.requestedAction.slice(0, 60)}{exec.requestedAction.length > 60 ? '…' : ''}
              </span>
              {exec.completedAt && (
                <span className="text-zinc-500 text-[10px] shrink-0">{relativeTime(exec.completedAt)}</span>
              )}
              {exec.output && (
                <span className="text-zinc-500 text-[10px] shrink-0 max-w-[100px] truncate">
                  {exec.output.slice(0, 100)}
                </span>
              )}
              <span className="text-zinc-600 text-[10px] shrink-0 ml-1">{expanded === exec.id ? '▲' : '▼'}</span>
            </button>

            {/* Expanded detail */}
            {expanded === exec.id && (
              <div className="border-t border-zinc-700/40 px-4 py-3 space-y-3">
                {exec.output && (
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Output</p>
                    <pre className="bg-zinc-900 border border-zinc-800 rounded p-2 text-xs text-zinc-300 font-mono overflow-y-auto max-h-48 whitespace-pre-wrap break-all">
                      {exec.output}
                    </pre>
                  </div>
                )}
                {exec.filesTouched && exec.filesTouched.length > 0 && (
                  <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Files Touched</p>
                    <div className="space-y-0.5">
                      {exec.filesTouched.map((f, i) => (
                        <p key={i} className="text-zinc-300 font-mono text-xs">{f}</p>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    disabled={actionLoading}
                    onClick={() => doAction(() => approvePromotion(exec.id))}
                    className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white transition-colors disabled:opacity-50"
                  >
                    Approve Promotion
                  </button>
                  <button
                    disabled={actionLoading}
                    onClick={() => doAction(() => rejectPromotion(exec.id))}
                    className="px-3 py-1.5 text-xs rounded bg-red-700 hover:bg-red-600 text-white transition-colors disabled:opacity-50"
                  >
                    Reject Promotion
                  </button>
                  <button
                    onClick={() => onSelectExecution(exec.id)}
                    className="px-3 py-1.5 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
                  >
                    Full Detail
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Activity view ─────────────────────────────────────────────────────────────

interface ActivityViewProps {
  onSelectExecution: (id: string) => void;
}

function ActivityView({ onSelectExecution }: ActivityViewProps) {
  const [executions, setExecutions] = useState<SafeCoreExecution[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    listSafeCoreExecutions({ limit: 50 })
      .then(r => { setExecutions(r.executions); setLoading(false); setError(null); })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
    intervalRef.current = setInterval(load, 10_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [load]);

  if (loading) return <div className="text-gray-400 animate-pulse p-8 text-center">Loading...</div>;
  if (error) return <div className="text-red-400 p-4">{error}</div>;
  if (executions.length === 0) return <p className="text-zinc-600 text-sm p-4">No executions in SafeCore yet.</p>;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 shrink-0">
        <span className="text-[10px] text-zinc-600 uppercase tracking-wider">Auto-refreshes every 10s</span>
        <button onClick={load} className="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Refresh now</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {executions.map(exec => (
          <button
            key={exec.id}
            onClick={() => onSelectExecution(exec.id)}
            className="w-full text-left flex items-center gap-2 px-4 py-2 border-b border-zinc-800/60 hover:bg-zinc-800/40 transition-colors"
          >
            <span className="text-zinc-600 text-[10px] shrink-0 w-20 text-right">{relativeTime(exec.createdAt)}</span>
            <ModeBadge mode={exec.mode} />
            <span className="text-zinc-300 text-xs flex-1 min-w-0 truncate">
              {exec.requestedAction.slice(0, 60)}{exec.requestedAction.length > 60 ? '…' : ''}
            </span>
            <ResultStateBadge state={exec.resultState} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── SafeCorePanel (root) ──────────────────────────────────────────────────────

type InnerTab = 'dashboard' | 'runs' | 'review-queue' | 'promotion-review' | 'activity';

const INNER_TABS: { id: InnerTab; label: string }[] = [
  { id: 'dashboard',        label: 'Dashboard' },
  { id: 'runs',             label: 'Runs' },
  { id: 'review-queue',     label: 'Review Queue' },
  { id: 'promotion-review', label: 'Promotion Review' },
  { id: 'activity',         label: 'Activity' },
];

export function SafeCorePanel() {
  const [innerTab, setInnerTab]             = useState<InnerTab>('dashboard');
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);

  const handleSelectExecution = useCallback((id: string) => {
    setSelectedExecutionId(id);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedExecutionId(null);
  }, []);

  // If an execution is selected, show its detail view regardless of inner tab
  if (selectedExecutionId) {
    return (
      <div className="flex flex-col h-full bg-zinc-950 text-white overflow-hidden">
        <RunDetailView executionId={selectedExecutionId} onBack={handleBack} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-white overflow-hidden">
      {/* SafeCore Console brand header */}
      <div className="px-4 pt-4 pb-3 border-b border-zinc-800/60">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[11px] font-semibold tracking-widest text-zinc-400 uppercase">Krythor SafeCore™</span>
            </div>
            <p className="text-[11px] text-zinc-600">
              Every action is evaluated · Every action is visible · Every action can be approved · Nothing runs silently
            </p>
          </div>
        </div>
      </div>

      {/* Inner tab bar */}
      <div className="flex items-stretch border-b border-zinc-800 shrink-0 px-4 pt-2">
        {INNER_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setInnerTab(t.id)}
            className={`px-3 py-2 text-xs font-medium transition-colors relative whitespace-nowrap ${
              innerTab === t.id
                ? 'text-zinc-100 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-indigo-500'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        {innerTab === 'dashboard'        && <DashboardView       onSelectExecution={handleSelectExecution} />}
        {innerTab === 'runs'             && <RunsView            onSelectExecution={handleSelectExecution} />}
        {innerTab === 'review-queue'     && <ReviewQueueView     onSelectExecution={handleSelectExecution} />}
        {innerTab === 'promotion-review' && <PromotionReviewView onSelectExecution={handleSelectExecution} />}
        {innerTab === 'activity'         && <ActivityView        onSelectExecution={handleSelectExecution} />}
      </div>
    </div>
  );
}
