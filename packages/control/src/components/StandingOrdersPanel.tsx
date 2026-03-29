import { useState, useEffect, useCallback } from 'react';
import {
  listStandingOrders,
  createStandingOrder,
  updateStandingOrder,
  deleteStandingOrder,
  runStandingOrderNow,
  type StandingOrder,
  type CreateStandingOrderInput,
} from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

// ─── StandingOrdersPanel ──────────────────────────────────────────────────────
//
// Manage persistent agent authorization programs (standing orders).
// These are structured instructions injected into the agent context on demand
// or on cron schedule.
//

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ─── Create form ──────────────────────────────────────────────────────────────

interface CreateFormProps {
  onCreated: () => void;
  onCancel: () => void;
}

function CreateForm({ onCreated, onCancel }: CreateFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState('');
  const [triggers, setTriggers] = useState('');
  const [executionSteps, setExecutionSteps] = useState('');
  const [approvalGates, setApprovalGates] = useState('');
  const [escalation, setEscalation] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !scope.trim()) { setError('Name and scope are required.'); return; }
    const triggerList = triggers.split('\n').map(t => t.trim()).filter(Boolean);
    if (triggerList.length === 0) { setError('At least one trigger is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const input: CreateStandingOrderInput = {
        name: name.trim(),
        scope: scope.trim(),
        triggers: triggerList,
        enabled,
        ...(description.trim() && { description: description.trim() }),
        ...(escalation.trim() && { escalation: escalation.trim() }),
      };
      const steps = executionSteps.split('\n').map(s => s.trim()).filter(Boolean);
      if (steps.length > 0) input.executionSteps = steps;
      const gates = approvalGates.split('\n').map(g => g.trim()).filter(Boolean);
      if (gates.length > 0) input.approvalGates = gates;
      await createStandingOrder(input);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const fieldCls = 'bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600';
  const textareaCls = `${fieldCls} resize-none`;
  const labelCls = 'text-[11px] text-zinc-600';

  return (
    <form onSubmit={handleSubmit} className="border border-zinc-700 rounded-lg p-4 space-y-3 bg-zinc-900/60">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">New Standing Order</div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Nightly security audit" className={fieldCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Scope *</label>
          <input value={scope} onChange={e => setScope(e.target.value)} placeholder="security · monitoring · finance" className={fieldCls} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Description</label>
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description of this standing order" className={fieldCls} />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Triggers — one per line *</label>
        <textarea
          value={triggers}
          onChange={e => setTriggers(e.target.value)}
          placeholder={"On every agent run\nWhen a new conversation starts\nOn cron schedule"}
          rows={3}
          className={textareaCls}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Execution steps — one per line</label>
        <textarea
          value={executionSteps}
          onChange={e => setExecutionSteps(e.target.value)}
          placeholder={"1. Check system status\n2. Generate report\n3. Notify if anomalies detected"}
          rows={3}
          className={textareaCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Approval gates — one per line</label>
          <textarea
            value={approvalGates}
            onChange={e => setApprovalGates(e.target.value)}
            placeholder={"Require explicit user confirmation\nCheck trust level >= 2"}
            rows={2}
            className={textareaCls}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Escalation policy</label>
          <textarea
            value={escalation}
            onChange={e => setEscalation(e.target.value)}
            placeholder="If action blocked, notify admin and halt"
            rows={2}
            className={textareaCls}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id="so-enabled" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="accent-brand-600" />
        <label htmlFor="so-enabled" className="text-xs text-zinc-400">Enabled</label>
      </div>

      {error && <div className="text-xs text-red-400">{error}</div>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="px-4 py-1.5 bg-brand-700 hover:bg-brand-600 disabled:opacity-40 text-white text-xs rounded transition-colors">
          {saving ? 'Creating…' : 'Create'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs rounded transition-colors">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Order row ────────────────────────────────────────────────────────────────

function OrderRow({
  order,
  onToggle,
  onRun,
  onDelete,
  running,
  toggling,
  deleting,
}: {
  order: StandingOrder;
  onToggle: () => void;
  onRun: () => void;
  onDelete: () => void;
  running: boolean;
  toggling: boolean;
  deleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border rounded-lg transition-colors ${order.enabled ? 'border-zinc-700 bg-zinc-900/40' : 'border-zinc-800 bg-zinc-950/40 opacity-70'}`}>
      {/* Header */}
      <div className="flex items-start gap-2 p-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <button
              className="text-sm font-medium text-zinc-200 truncate hover:text-zinc-100 text-left"
              onClick={() => setExpanded(e => !e)}
            >{order.name}</button>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${order.enabled ? 'bg-emerald-900/40 text-emerald-500' : 'bg-zinc-800 text-zinc-600'}`}>
              {order.enabled ? 'active' : 'inactive'}
            </span>
            {order.cronJobId && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-500 border border-blue-800/30">scheduled</span>
            )}
          </div>
          {order.description && (
            <div className="text-[11px] text-zinc-600 mt-0.5 truncate">{order.description}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onToggle}
            disabled={toggling}
            className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 transition-colors"
          >{toggling ? '…' : order.enabled ? 'Disable' : 'Enable'}</button>
          <button
            onClick={onRun}
            disabled={running}
            title="Run now"
            className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 transition-colors"
          >{running ? '…' : 'Run now'}</button>
          <button
            onClick={() => setExpanded(e => !e)}
            className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
          >{expanded ? '▲' : '▼'}</button>
          <button
            onClick={onDelete}
            disabled={deleting}
            title="Delete"
            className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-red-950/40 text-zinc-600 hover:text-red-400 disabled:opacity-40 transition-colors"
          >{deleting ? '…' : 'Delete'}</button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 px-3 pb-2 text-[10px]">
        <span className="text-zinc-600">scope: <span className="text-zinc-400">{order.scope}</span></span>
        <span className="text-zinc-600">runs: <span className="text-zinc-400">{order.runCount}</span></span>
        {order.failureCount > 0 && <span className="text-zinc-600">failures: <span className="text-red-500">{order.failureCount}</span></span>}
        {order.lastRunAt && <span className="text-zinc-600">last run: <span className="text-emerald-600">{timeAgo(order.lastRunAt)}</span></span>}
        {order.lastFailedAt && <span className="text-zinc-600">last fail: <span className="text-red-500">{timeAgo(order.lastFailedAt)}</span></span>}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-zinc-800 px-3 py-2 space-y-2">
          {order.triggers.length > 0 && (
            <div>
              <div className="text-[10px] text-zinc-600 mb-1">Triggers</div>
              <ul className="space-y-0.5">
                {order.triggers.map((t, i) => (
                  <li key={i} className="text-[11px] text-zinc-400 pl-2 border-l border-zinc-700">• {t}</li>
                ))}
              </ul>
            </div>
          )}
          {order.executionSteps && order.executionSteps.length > 0 && (
            <div>
              <div className="text-[10px] text-zinc-600 mb-1">Execution steps</div>
              <ol className="space-y-0.5">
                {order.executionSteps.map((s, i) => (
                  <li key={i} className="text-[11px] text-zinc-400 pl-2 border-l border-zinc-700">{i + 1}. {s}</li>
                ))}
              </ol>
            </div>
          )}
          {order.approvalGates && order.approvalGates.length > 0 && (
            <div>
              <div className="text-[10px] text-zinc-600 mb-1">Approval gates</div>
              <ul className="space-y-0.5">
                {order.approvalGates.map((g, i) => (
                  <li key={i} className="text-[11px] text-amber-500 pl-2 border-l border-amber-800/50">⚠ {g}</li>
                ))}
              </ul>
            </div>
          )}
          {order.escalation && (
            <div>
              <div className="text-[10px] text-zinc-600 mb-1">Escalation</div>
              <div className="text-[11px] text-zinc-400 pl-2 border-l border-zinc-700">{order.escalation}</div>
            </div>
          )}
          {order.lastError && (
            <div className="text-[11px] text-red-400 bg-red-950/20 border border-red-900/30 rounded px-2 py-1">
              {order.lastError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function StandingOrdersPanel() {
  const [orders, setOrders] = useState<StandingOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listStandingOrders();
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleToggle = async (order: StandingOrder) => {
    setTogglingId(order.id);
    try {
      const updated = await updateStandingOrder(order.id, { enabled: !order.enabled });
      setOrders(prev => prev.map(o => o.id === order.id ? updated : o));
    } catch { /* ignore */ }
    finally { setTogglingId(null); }
  };

  const handleRunNow = async (id: string) => {
    setRunningId(id);
    try {
      await runStandingOrderNow(id);
      setTimeout(() => { void load(); }, 1500);
    } catch { /* ignore */ }
    finally { setRunningId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this standing order?')) return;
    setDeletingId(id);
    try {
      await deleteStandingOrder(id);
      setOrders(prev => prev.filter(o => o.id !== id));
    } catch { /* ignore */ }
    finally { setDeletingId(null); }
  };

  const activeCount = orders.filter(o => o.enabled).length;

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Standing Orders"
        description="Persistent agent authorization programs — structured instructions injected into agent context on demand or schedule."
        tip="Standing orders define scope, triggers, execution steps, and approval gates. Attach a cron job ID to run them on a schedule."
      />

      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <button
          onClick={() => setShowCreate(s => !s)}
          className="px-3 py-1.5 bg-brand-700 hover:bg-brand-600 text-white text-xs rounded transition-colors"
        >+ New Order</button>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-400 text-xs rounded transition-colors"
        >{loading ? '…' : 'Refresh'}</button>
        {orders.length > 0 && (
          <span className="text-[11px] text-zinc-600">
            {orders.length} order{orders.length !== 1 ? 's' : ''}{activeCount !== orders.length ? ` · ${activeCount} active` : ''}
          </span>
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

        {orders.length === 0 && !loading && !showCreate && (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <span className="text-zinc-600 text-sm">No standing orders yet</span>
            <span className="text-zinc-700 text-xs">Click "+ New Order" to define an agent authorization program</span>
          </div>
        )}

        {orders.map(order => (
          <OrderRow
            key={order.id}
            order={order}
            onToggle={() => void handleToggle(order)}
            onRun={() => void handleRunNow(order.id)}
            onDelete={() => void handleDelete(order.id)}
            running={runningId === order.id}
            toggling={togglingId === order.id}
            deleting={deletingId === order.id}
          />
        ))}
      </div>
    </div>
  );
}
