import { useState, useEffect, useCallback, useRef } from 'react';
import { PanelHeader } from './PanelHeader.tsx';

// ─── AuditPanel ───────────────────────────────────────────────────────────────
//
// Shows structured audit events from GET /api/audit.
// Supports filtering by actionType, agentId, execution outcome, and time range.
// Auto-refresh toggle (5s interval).
// Row expand to show full event JSON.
//

interface AuditEvent {
  id: string;
  timestamp: string;
  requestId?: string;
  agentId?: string;
  agentName?: string;
  toolName?: string;
  skillName?: string;
  actionType: string;
  target?: string;
  policyDecision?: 'allow' | 'deny' | 'warn' | 'require-approval';
  approvalResult?: string;
  executionOutcome?: 'success' | 'error' | 'blocked' | 'timeout';
  modelUsed?: string;
  providerId?: string;
  fallbackOccurred?: boolean;
  reason?: string;
  durationMs?: number;
  contentHash?: string;
  privacyDecision?: {
    sensitivityLabel: string;
    remoteAllowed: boolean;
    reroutedTo?: string;
    reason: string;
  };
}

const PAGE_SIZE = 50;
const REFRESH_INTERVAL_MS = 5000;

// ── Colour helpers ────────────────────────────────────────────────────────────

function outcomeColor(outcome?: string): string {
  switch (outcome) {
    case 'success': return 'text-emerald-400';
    case 'blocked': return 'text-red-400';
    case 'error':   return 'text-red-300';
    case 'timeout': return 'text-amber-400';
    default:        return 'text-zinc-500';
  }
}

function policyColor(decision?: string): string {
  switch (decision) {
    case 'allow':            return 'text-emerald-400';
    case 'deny':             return 'text-red-400';
    case 'warn':             return 'text-amber-400';
    case 'require-approval': return 'text-sky-400';
    default:                 return 'text-zinc-500';
  }
}

function privacyBadge(event: AuditEvent): React.ReactNode | null {
  if (!event.privacyDecision) return null;
  const { sensitivityLabel, reroutedTo, remoteAllowed } = event.privacyDecision;
  if (reroutedTo) {
    return (
      <span className="ml-1 text-[10px] bg-sky-900/40 text-sky-300 border border-sky-800/30 px-1 rounded">
        local
      </span>
    );
  }
  if (!remoteAllowed) {
    return (
      <span className="ml-1 text-[10px] bg-red-900/40 text-red-300 border border-red-800/30 px-1 rounded">
        blocked
      </span>
    );
  }
  if (sensitivityLabel !== 'public') {
    return (
      <span className="ml-1 text-[10px] bg-amber-900/30 text-amber-400 border border-amber-800/30 px-1 rounded">
        {sensitivityLabel}
      </span>
    );
  }
  return null;
}

// ── API fetch ─────────────────────────────────────────────────────────────────

async function fetchAudit(params: {
  limit?: number;
  agentId?: string;
  actionType?: string;
  executionOutcome?: string;
  from?: string;
  to?: string;
}): Promise<{ events: AuditEvent[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.limit)            qs.set('limit', String(params.limit));
  if (params.agentId)          qs.set('agentId', params.agentId);
  if (params.actionType)       qs.set('actionType', params.actionType);
  if (params.executionOutcome) qs.set('executionOutcome', params.executionOutcome);
  if (params.from)             qs.set('from', params.from);
  if (params.to)               qs.set('to', params.to);

  const res = await fetch(`/api/audit?${qs.toString()}`);
  if (!res.ok) return { events: [], total: 0 };
  return res.json() as Promise<{ events: AuditEvent[]; total: number }>;
}

// ── AuditPanel ────────────────────────────────────────────────────────────────

export function AuditPanel() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [loading, setLoading]         = useState(false);

  // Filter state
  const [filterAction,  setFilterAction]  = useState('');
  const [filterAgent,   setFilterAgent]   = useState('');
  const [filterOutcome, setFilterOutcome] = useState('');
  const [filterFrom,    setFilterFrom]    = useState('');
  const [filterTo,      setFilterTo]      = useState('');

  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchAudit({
        limit: PAGE_SIZE * (page + 1),
        agentId: filterAgent || undefined,
        actionType: filterAction || undefined,
        executionOutcome: filterOutcome || undefined,
        from: filterFrom || undefined,
        to: filterTo || undefined,
      });
      setEvents(result.events);
      setTotal(result.total);
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, [page, filterAction, filterAgent, filterOutcome, filterFrom, filterTo]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => { if (autoRefreshRef.current) load(); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const handleFilter = useCallback(() => {
    setPage(0);
    load();
  }, [load]);

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-200">
      <PanelHeader title="Audit Log" description="Structured event history — agent runs, guard decisions, approvals" />

      {/* Filter bar */}
      <div className="px-4 py-2 border-b border-zinc-800 flex flex-wrap gap-2 items-center">
        <input
          value={filterAction}
          onChange={e => setFilterAction(e.target.value)}
          placeholder="Action type…"
          className="h-7 px-2 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 outline-none w-32"
        />
        <input
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
          placeholder="Agent ID…"
          className="h-7 px-2 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-600 outline-none w-32"
        />
        <select
          value={filterOutcome}
          onChange={e => setFilterOutcome(e.target.value)}
          className="h-7 px-2 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 outline-none"
        >
          <option value="">All outcomes</option>
          <option value="success">Success</option>
          <option value="blocked">Blocked</option>
          <option value="error">Error</option>
          <option value="timeout">Timeout</option>
        </select>
        <input
          type="datetime-local"
          value={filterFrom}
          onChange={e => setFilterFrom(e.target.value)}
          className="h-7 px-2 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 outline-none"
          title="From date"
        />
        <input
          type="datetime-local"
          value={filterTo}
          onChange={e => setFilterTo(e.target.value)}
          className="h-7 px-2 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-200 outline-none"
          title="To date"
        />
        <button
          onClick={handleFilter}
          className="h-7 px-3 bg-zinc-700 hover:bg-zinc-600 rounded text-xs transition-colors"
        >
          Filter
        </button>
        <button
          onClick={() => { setFilterAction(''); setFilterAgent(''); setFilterOutcome(''); setFilterFrom(''); setFilterTo(''); setPage(0); }}
          className="h-7 px-2 text-zinc-500 hover:text-zinc-300 text-xs"
        >
          Clear
        </button>
        <label className="flex items-center gap-1 ml-auto text-xs text-zinc-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            className="w-3 h-3"
          />
          Auto-refresh
        </label>
        <span className="text-[11px] text-zinc-600">{total} events</span>
        {loading && <span className="text-[11px] text-zinc-600 animate-pulse">loading…</span>}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            No audit events found.
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-zinc-900 z-10">
              <tr className="text-zinc-500 text-[11px] border-b border-zinc-800">
                <th className="text-left px-3 py-2 w-36">Time</th>
                <th className="text-left px-3 py-2 w-36">Action</th>
                <th className="text-left px-3 py-2 w-28">Agent</th>
                <th className="text-left px-3 py-2 w-24">Outcome</th>
                <th className="text-left px-3 py-2 w-24">Policy</th>
                <th className="text-left px-3 py-2">Model / Notes</th>
              </tr>
            </thead>
            <tbody>
              {events.map(event => (
                <>
                  <tr
                    key={event.id}
                    className="border-b border-zinc-900 hover:bg-zinc-800/30 cursor-pointer transition-colors"
                    onClick={() => setExpandedId(id => id === event.id ? null : event.id)}
                  >
                    <td className="px-3 py-1.5 text-zinc-500 whitespace-nowrap">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-zinc-300">
                      {event.actionType}
                      {privacyBadge(event)}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-400 truncate max-w-[100px]">
                      {event.agentName ?? event.agentId ?? '-'}
                    </td>
                    <td className={`px-3 py-1.5 font-medium ${outcomeColor(event.executionOutcome)}`}>
                      {event.executionOutcome ?? '-'}
                    </td>
                    <td className={`px-3 py-1.5 ${policyColor(event.policyDecision)}`}>
                      {event.policyDecision ?? '-'}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-500 truncate max-w-[200px]">
                      {event.modelUsed ?? event.reason ?? event.toolName ?? '-'}
                      {event.durationMs !== undefined && (
                        <span className="ml-2 text-zinc-700">{event.durationMs}ms</span>
                      )}
                    </td>
                  </tr>
                  {expandedId === event.id && (
                    <tr key={`${event.id}-exp`} className="bg-zinc-900/60">
                      <td colSpan={6} className="px-4 py-3">
                        <pre className="text-[11px] text-zinc-300 font-mono whitespace-pre-wrap break-all overflow-auto max-h-64">
                          {JSON.stringify(event, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination footer */}
      {total > PAGE_SIZE && (
        <div className="px-4 py-2 border-t border-zinc-800 flex items-center gap-2 text-xs text-zinc-500">
          <span>Showing {Math.min(events.length, PAGE_SIZE * (page + 1))} of {total}</span>
          {page > 0 && (
            <button onClick={() => setPage(p => p - 1)} className="px-2 py-1 bg-zinc-800 rounded hover:bg-zinc-700">
              Prev
            </button>
          )}
          {events.length === PAGE_SIZE * (page + 1) && (
            <button onClick={() => setPage(p => p + 1)} className="px-2 py-1 bg-zinc-800 rounded hover:bg-zinc-700">
              Next
            </button>
          )}
        </div>
      )}
    </div>
  );
}
