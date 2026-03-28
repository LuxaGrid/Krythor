import { useState, useEffect, useCallback } from 'react';
import {
  listCronJobs,
  createCronJob,
  updateCronJob,
  deleteCronJob,
  runCronJobNow,
  type CronJob,
  type CreateCronJobInput,
  type CronSchedule,
} from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

// ─── CronPanel ────────────────────────────────────────────────────────────────
//
// Lists all cron jobs with enable/disable toggle, run-now button, and delete.
// Create new jobs via a simple inline form.
// Shows last run time, run count, and last error per job.
//

function scheduleLabel(s: CronSchedule): string {
  if (s.kind === 'at') return `once at ${new Date(s.at).toLocaleString()}`;
  if (s.kind === 'every') {
    const ms = s.everyMs;
    if (ms < 60_000) return `every ${ms / 1000}s`;
    if (ms < 3_600_000) return `every ${ms / 60_000}m`;
    if (ms < 86_400_000) return `every ${ms / 3_600_000}h`;
    return `every ${ms / 86_400_000}d`;
  }
  return `cron: ${s.expr}${s.tz ? ` (${s.tz})` : ''}`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function nextRunLabel(job: CronJob): string {
  if (!job.enabled) return 'disabled';
  if (!job.nextRunAt) return '—';
  const diff = job.nextRunAt - Date.now();
  if (diff <= 0) return 'imminent';
  if (diff < 60_000) return `in ${Math.ceil(diff / 1000)}s`;
  if (diff < 3_600_000) return `in ${Math.ceil(diff / 60_000)}m`;
  return `in ${Math.ceil(diff / 3_600_000)}h`;
}

// ─── Create form ─────────────────────────────────────────────────────────────

interface CreateFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

function CreateForm({ onCreated, onCancel }: CreateFormProps) {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [agentId, setAgentId] = useState('');
  const [scheduleKind, setScheduleKind] = useState<'cron' | 'every' | 'at'>('cron');
  const [cronExpr, setCronExpr] = useState('0 * * * *');
  const [everyMs, setEveryMs] = useState('3600000');
  const [atTime, setAtTime] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !message.trim()) { setError('Name and message are required.'); return; }
    setSaving(true);
    setError('');
    try {
      let schedule: CronSchedule;
      if (scheduleKind === 'cron') {
        if (cronExpr.trim().split(/\s+/).length !== 5) { setError('Cron expression must have 5 fields.'); setSaving(false); return; }
        schedule = { kind: 'cron', expr: cronExpr.trim() };
      } else if (scheduleKind === 'every') {
        const ms = parseInt(everyMs, 10);
        if (isNaN(ms) || ms < 60_000) { setError('Interval must be at least 60000ms (1 minute).'); setSaving(false); return; }
        schedule = { kind: 'every', everyMs: ms };
      } else {
        if (!atTime) { setError('Please pick a date/time for the one-shot run.'); setSaving(false); return; }
        schedule = { kind: 'at', at: new Date(atTime).toISOString() };
      }
      const input: CreateCronJobInput = {
        name: name.trim(),
        message: message.trim(),
        schedule,
        enabled,
        ...(agentId.trim() && { agentId: agentId.trim() }),
      };
      await createCronJob(input);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border border-zinc-700 rounded-lg p-4 space-y-3 bg-zinc-900/60">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">New Cron Job</div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-zinc-600">Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Daily report"
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-zinc-600">Agent ID (optional)</label>
          <input
            value={agentId}
            onChange={e => setAgentId(e.target.value)}
            placeholder="default"
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-zinc-600">Message</label>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Generate the daily summary report…"
          rows={2}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 resize-none"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-[11px] text-zinc-600">Schedule type</label>
        <div className="flex gap-2">
          {(['cron', 'every', 'at'] as const).map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setScheduleKind(k)}
              className={`px-3 py-1 rounded text-xs transition-colors ${scheduleKind === k ? 'bg-brand-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
            >
              {k === 'cron' ? 'Cron expression' : k === 'every' ? 'Interval' : 'One-shot'}
            </button>
          ))}
        </div>
        {scheduleKind === 'cron' && (
          <input
            value={cronExpr}
            onChange={e => setCronExpr(e.target.value)}
            placeholder="0 * * * *  (every hour)"
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600"
          />
        )}
        {scheduleKind === 'every' && (
          <div className="flex items-center gap-2">
            <input
              value={everyMs}
              onChange={e => setEveryMs(e.target.value)}
              placeholder="3600000"
              className="w-36 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs font-mono text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600"
            />
            <span className="text-[11px] text-zinc-600">ms (min 60000)</span>
          </div>
        )}
        {scheduleKind === 'at' && (
          <input
            type="datetime-local"
            value={atTime}
            onChange={e => setAtTime(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-brand-600"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id="cron-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-brand-600" />
        <label htmlFor="cron-enabled" className="text-xs text-zinc-400">Enabled</label>
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-1.5 bg-brand-700 hover:bg-brand-600 disabled:opacity-40 text-white text-xs rounded transition-colors"
        >
          {saving ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── CronPanel ────────────────────────────────────────────────────────────────

export function CronPanel() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCronJobs();
      setJobs(Array.isArray(data) ? data : []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = async (job: CronJob) => {
    setTogglingId(job.id);
    try {
      const updated = await updateCronJob(job.id, { enabled: !job.enabled });
      setJobs(prev => prev.map(j => j.id === job.id ? updated : j));
    } catch { /* ignore */ }
    finally { setTogglingId(null); }
  };

  const handleRunNow = async (id: string) => {
    setRunningId(id);
    try {
      await runCronJobNow(id);
      // Refresh after a short delay to show updated lastRunAt
      setTimeout(() => { void load(); }, 1500);
    } catch { /* ignore */ }
    finally { setRunningId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this cron job?')) return;
    setDeletingId(id);
    try {
      await deleteCronJob(id);
      setJobs(prev => prev.filter(j => j.id !== id));
    } catch { /* ignore */ }
    finally { setDeletingId(null); }
  };

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Cron Jobs"
        description="Schedule agents to run automatically on a time-based schedule."
        tip="Use cron expressions (e.g. 0 7 * * * for 7am daily), fixed intervals (every N milliseconds), or one-shot timestamps. Enable/disable without deleting."
      />

      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <button
          onClick={() => setShowCreate(s => !s)}
          className="px-3 py-1.5 bg-brand-700 hover:bg-brand-600 text-white text-xs rounded transition-colors"
        >
          + New Job
        </button>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-400 text-xs rounded transition-colors"
        >
          {loading ? '…' : 'Refresh'}
        </button>
        {jobs.length > 0 && (
          <span className="text-[11px] text-zinc-600">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</span>
        )}
        {error && <span className="text-xs text-red-400 ml-2">{error}</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {showCreate && (
          <CreateForm
            onCreated={() => { setShowCreate(false); void load(); }}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {jobs.length === 0 && !loading && !showCreate && (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="text-zinc-600 text-sm">No cron jobs yet</span>
            <span className="text-zinc-700 text-xs">Click "+ New Job" to create a scheduled task</span>
          </div>
        )}

        {jobs.map(job => (
          <div
            key={job.id}
            className={`border rounded-lg p-4 space-y-2 transition-colors ${job.enabled ? 'border-zinc-700 bg-zinc-900/40' : 'border-zinc-800 bg-zinc-950/40 opacity-70'}`}
          >
            {/* Header row */}
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200 truncate">{job.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${job.enabled ? 'bg-emerald-900/40 text-emerald-500' : 'bg-zinc-800 text-zinc-600'}`}>
                    {job.enabled ? 'enabled' : 'disabled'}
                  </span>
                </div>
                {job.description && (
                  <div className="text-[11px] text-zinc-600 mt-0.5 truncate">{job.description}</div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => void handleToggle(job)}
                  disabled={togglingId === job.id}
                  title={job.enabled ? 'Disable' : 'Enable'}
                  className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 transition-colors"
                >
                  {togglingId === job.id ? '…' : job.enabled ? 'Disable' : 'Enable'}
                </button>
                <button
                  onClick={() => void handleRunNow(job.id)}
                  disabled={runningId === job.id}
                  title="Run now"
                  className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 transition-colors"
                >
                  {runningId === job.id ? '…' : 'Run now'}
                </button>
                <button
                  onClick={() => void handleDelete(job.id)}
                  disabled={deletingId === job.id}
                  title="Delete"
                  className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-red-950/40 text-zinc-600 hover:text-red-400 disabled:opacity-40 transition-colors"
                >
                  {deletingId === job.id ? '…' : 'Delete'}
                </button>
              </div>
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-600 w-16 shrink-0">Schedule</span>
                <span className="text-zinc-400 font-mono truncate">{scheduleLabel(job.schedule)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-600 w-16 shrink-0">Next run</span>
                <span className="text-zinc-400">{nextRunLabel(job)}</span>
              </div>
              {job.agentId && (
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-600 w-16 shrink-0">Agent</span>
                  <span className="text-zinc-400 font-mono truncate">{job.agentId}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-zinc-600 w-16 shrink-0">Runs</span>
                <span className="text-zinc-400">{job.runCount}</span>
              </div>
              {job.lastRunAt && (
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-600 w-16 shrink-0">Last run</span>
                  <span className="text-emerald-600">{timeAgo(job.lastRunAt)}</span>
                </div>
              )}
              {job.lastFailedAt && (
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-600 w-16 shrink-0">Last fail</span>
                  <span className="text-red-500">{timeAgo(job.lastFailedAt)}</span>
                </div>
              )}
            </div>

            {/* Message preview */}
            <div className="text-[11px] text-zinc-600 bg-zinc-950/60 rounded px-2 py-1 font-mono truncate">
              {job.message.length > 120 ? `${job.message.slice(0, 120)}…` : job.message}
            </div>

            {/* Error */}
            {job.lastError && (
              <div className="text-[11px] text-red-400 bg-red-950/20 border border-red-900/30 rounded px-2 py-1">
                {job.lastError}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
