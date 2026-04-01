import { useState, useEffect, useCallback } from 'react';
import {
  listFallbackChains,
  getFallbackChain,
  createFallbackChain,
  updateFallbackChain,
  deleteFallbackChain,
  type FallbackChain,
  type FallbackProvider,
} from '../api.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString();
}

function scopeLabel(chain: FallbackChain): string {
  if (chain.skillId) return `Skill: ${chain.skillId}`;
  if (chain.agentId) return `Agent: ${chain.agentId}`;
  if (chain.taskType) return `Task: ${chain.taskType}`;
  return 'Global';
}

// ── Provider Row (edit form) ──────────────────────────────────────────────────

interface ProviderRowProps {
  provider: FallbackProvider;
  index: number;
  onChange: (index: number, updated: FallbackProvider) => void;
  onRemove: (index: number) => void;
}

function ProviderRow({ provider, index, onChange, onRemove }: ProviderRowProps) {
  return (
    <div className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/60 rounded p-2">
      <span className="text-xs text-zinc-500 w-5 text-center flex-shrink-0">{index + 1}</span>
      <input
        value={provider.providerId}
        onChange={e => onChange(index, { ...provider, providerId: e.target.value })}
        placeholder="Provider ID *"
        className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
      />
      <input
        value={provider.modelId ?? ''}
        onChange={e => onChange(index, { ...provider, modelId: e.target.value || undefined })}
        placeholder="Model ID (optional)"
        className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
      />
      <input
        type="number"
        value={provider.priority}
        onChange={e => onChange(index, { ...provider, priority: Number(e.target.value) })}
        placeholder="Priority"
        className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-indigo-500"
      />
      <button
        onClick={() => onRemove(index)}
        className="text-red-400 hover:text-red-300 text-xs px-1.5 py-1 rounded hover:bg-red-900/20 flex-shrink-0"
        title="Remove provider"
      >
        &times;
      </button>
    </div>
  );
}

// ── Chain Form ────────────────────────────────────────────────────────────────

interface ChainFormValues {
  name: string;
  description: string;
  isDefault: boolean;
  taskType: string;
  agentId: string;
  skillId: string;
  providers: FallbackProvider[];
}

function emptyForm(): ChainFormValues {
  return { name: '', description: '', isDefault: false, taskType: '', agentId: '', skillId: '', providers: [] };
}

function chainToForm(chain: FallbackChain): ChainFormValues {
  return {
    name: chain.name,
    description: chain.description ?? '',
    isDefault: chain.isDefault,
    taskType: chain.taskType ?? '',
    agentId: chain.agentId ?? '',
    skillId: chain.skillId ?? '',
    providers: chain.providers.map(p => ({ ...p })),
  };
}

interface ChainFormProps {
  initial?: ChainFormValues;
  onSave: (values: ChainFormValues) => Promise<void>;
  onCancel: () => void;
  title: string;
}

function ChainForm({ initial, onSave, onCancel, title }: ChainFormProps) {
  const [values, setValues] = useState<ChainFormValues>(initial ?? emptyForm());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const updateProvider = (index: number, updated: FallbackProvider) => {
    setValues(v => ({ ...v, providers: v.providers.map((p, i) => i === index ? updated : p) }));
  };

  const removeProvider = (index: number) => {
    setValues(v => ({ ...v, providers: v.providers.filter((_, i) => i !== index) }));
  };

  const addProvider = () => {
    setValues(v => ({
      ...v,
      providers: [...v.providers, { providerId: '', priority: v.providers.length + 1 }],
    }));
  };

  const submit = async () => {
    setErr('');
    if (!values.name.trim()) { setErr('Name is required'); return; }
    for (const p of values.providers) {
      if (!p.providerId.trim()) { setErr('All providers must have a Provider ID'); return; }
    }
    setBusy(true);
    try {
      await onSave(values);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-zinc-400 mb-1">Name <span className="text-red-400">*</span></label>
          <input
            value={values.name}
            onChange={e => setValues(v => ({ ...v, name: e.target.value }))}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            placeholder="e.g. Production Primary"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-zinc-400 mb-1">Description</label>
          <input
            value={values.description}
            onChange={e => setValues(v => ({ ...v, description: e.target.value }))}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            placeholder="Optional description"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Task Type <span className="text-zinc-600">(scope)</span></label>
          <input
            value={values.taskType}
            onChange={e => setValues(v => ({ ...v, taskType: e.target.value }))}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            placeholder="optional"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Agent ID <span className="text-zinc-600">(scope)</span></label>
          <input
            value={values.agentId}
            onChange={e => setValues(v => ({ ...v, agentId: e.target.value }))}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            placeholder="optional"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Skill ID <span className="text-zinc-600">(scope)</span></label>
          <input
            value={values.skillId}
            onChange={e => setValues(v => ({ ...v, skillId: e.target.value }))}
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500"
            placeholder="optional"
          />
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input
            type="checkbox"
            id="isDefault"
            checked={values.isDefault}
            onChange={e => setValues(v => ({ ...v, isDefault: e.target.checked }))}
            className="rounded border-zinc-600"
          />
          <label htmlFor="isDefault" className="text-sm text-zinc-300 cursor-pointer">Set as default chain</label>
        </div>
      </div>

      {/* Providers */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-zinc-400 font-medium">Providers (ordered by priority)</label>
          <button
            onClick={addProvider}
            className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-700/50 hover:border-indigo-600 px-2 py-0.5 rounded"
          >
            + Add Provider
          </button>
        </div>
        {values.providers.length === 0 && (
          <p className="text-xs text-zinc-600">No providers added yet.</p>
        )}
        <div className="space-y-2">
          {values.providers.map((p, i) => (
            <ProviderRow key={i} provider={p} index={i} onChange={updateProvider} onRemove={removeProvider} />
          ))}
        </div>
      </div>

      {err && <p className="text-red-400 text-xs">{err}</p>}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
        <button onClick={onCancel} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Chain Detail ──────────────────────────────────────────────────────────────

interface ChainDetailProps {
  chainId: string;
  onBack: () => void;
  onRefresh: () => void;
}

function ChainDetail({ chainId, onBack, onRefresh }: ChainDetailProps) {
  const [chain, setChain] = useState<FallbackChain | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const c = await getFallbackChain(chainId);
      setChain(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [chainId]);

  useEffect(() => { void load(); }, [load]);

  const doDelete = async () => {
    setDeleteBusy(true);
    setDeleteErr('');
    try {
      await deleteFallbackChain(chainId);
      onRefresh();
      onBack();
    } catch (e) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
      setDeleteBusy(false);
    }
  };

  const doSave = async (values: ChainFormValues) => {
    await updateFallbackChain(chainId, {
      name: values.name,
      description: values.description || undefined,
      isDefault: values.isDefault,
      taskType: values.taskType || undefined,
      agentId: values.agentId || undefined,
      skillId: values.skillId || undefined,
      providers: values.providers,
    });
    onRefresh();
    setEditing(false);
    void load();
  };

  if (loading) return <div className="p-6 text-zinc-400 animate-pulse text-sm">Loading chain...</div>;
  if (err) return <div className="p-6 text-red-400 text-sm">{err}</div>;
  if (!chain) return null;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center gap-3">
        <button onClick={onBack} className="text-indigo-400 hover:text-indigo-300 text-sm">
          &larr; Back to list
        </button>
        <span className="text-zinc-700">/</span>
        <h2 className="text-sm font-semibold text-white truncate">{chain.name}</h2>
        {chain.isDefault && (
          <span className="text-[10px] px-2 py-0.5 rounded-full border bg-indigo-900/50 text-indigo-300 border-indigo-700/40 font-medium">
            default
          </span>
        )}
      </div>

      <div className="px-6 py-5 space-y-5">
        {editing ? (
          <ChainForm
            initial={chainToForm(chain)}
            onSave={doSave}
            onCancel={() => setEditing(false)}
            title="Edit Chain"
          />
        ) : (
          <>
            <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-white">{chain.name}</p>
                  {chain.description && <p className="text-xs text-zinc-400 mt-0.5">{chain.description}</p>}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(true)}
                    className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded text-xs"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <div><span className="text-zinc-500">Scope:</span> <span className="text-zinc-300">{scopeLabel(chain)}</span></div>
                <div><span className="text-zinc-500">Default:</span> <span className="text-zinc-300">{chain.isDefault ? 'Yes' : 'No'}</span></div>
                <div><span className="text-zinc-500">Created:</span> <span className="text-zinc-300">{fmtTs(chain.createdAt)}</span></div>
                <div><span className="text-zinc-500">Updated:</span> <span className="text-zinc-300">{fmtTs(chain.updatedAt)}</span></div>
              </div>
            </div>

            {/* Providers */}
            <div>
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                Providers ({chain.providers.length})
              </h3>
              {chain.providers.length === 0 ? (
                <p className="text-xs text-zinc-600">No providers configured.</p>
              ) : (
                <div className="space-y-2">
                  {chain.providers.map((p, i) => (
                    <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 flex items-center gap-3">
                      <span className="text-xs text-zinc-500 w-5 text-center flex-shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-zinc-200 font-medium">{p.providerId}</span>
                        {p.modelId && <span className="text-xs text-zinc-500 ml-2">{p.modelId}</span>}
                      </div>
                      <span className="text-xs text-zinc-500 flex-shrink-0">priority: {p.priority}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Delete confirm */}
            {deleteConfirm && (
              <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4 space-y-3">
                <p className="text-sm text-red-300">Delete chain "{chain.name}"? This cannot be undone.</p>
                {deleteErr && <p className="text-red-400 text-xs">{deleteErr}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={doDelete}
                    disabled={deleteBusy}
                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm"
                  >
                    {deleteBusy ? 'Deleting...' : 'Confirm Delete'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Chain List Row ────────────────────────────────────────────────────────────

function ChainRow({ chain, onClick }: { chain: FallbackChain; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-zinc-800 border border-zinc-700 rounded-lg p-4 hover:border-zinc-600 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white">{chain.name}</span>
            {chain.isDefault && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border bg-indigo-900/50 text-indigo-300 border-indigo-700/40 font-medium">
                default
              </span>
            )}
          </div>
          {chain.description && <p className="text-xs text-zinc-400 mt-0.5">{chain.description}</p>}
        </div>
        <div className="flex-shrink-0 text-right">
          <span className="text-xs text-zinc-400">{chain.providers.length} provider{chain.providers.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-500">
        <span>{scopeLabel(chain)}</span>
        <span>{fmtTs(chain.createdAt)}</span>
      </div>
    </button>
  );
}

// ── FallbackChainsPanel ───────────────────────────────────────────────────────

export function FallbackChainsPanel() {
  const [chains, setChains] = useState<FallbackChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const { chains: c } = await listFallbackChains();
      setChains(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const doCreate = async (values: ChainFormValues) => {
    await createFallbackChain({
      name: values.name,
      description: values.description || undefined,
      isDefault: values.isDefault,
      taskType: values.taskType || undefined,
      agentId: values.agentId || undefined,
      skillId: values.skillId || undefined,
      providers: values.providers,
    });
    void load();
    setShowNewForm(false);
  };

  if (selectedId) {
    return (
      <div className="flex flex-col h-full bg-zinc-900 text-white overflow-hidden">
        <ChainDetail chainId={selectedId} onBack={() => setSelectedId(null)} onRefresh={() => void load()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white">Fallback Chains</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Configure provider fallback chains for routing</p>
        </div>
        <button
          onClick={() => setShowNewForm(v => !v)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded text-sm"
        >
          {showNewForm ? 'Cancel' : 'New Chain'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {showNewForm && (
          <ChainForm
            onSave={doCreate}
            onCancel={() => setShowNewForm(false)}
            title="New Fallback Chain"
          />
        )}

        {loading && <p className="text-zinc-400 text-sm animate-pulse">Loading chains...</p>}
        {!loading && err && <p className="text-red-400 text-sm">{err}</p>}
        {!loading && !err && chains.length === 0 && !showNewForm && (
          <p className="text-zinc-500 text-sm">No fallback chains configured.</p>
        )}
        {!loading && !err && chains.length > 0 && (
          <div className="space-y-3">
            {chains.map(c => (
              <ChainRow key={c.id} chain={c} onClick={() => { setShowNewForm(false); setSelectedId(c.id); }} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
