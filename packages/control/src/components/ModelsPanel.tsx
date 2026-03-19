import { useState, useEffect, useCallback } from 'react';
import {
  listProviders, addProvider, deleteProvider, pingProvider, updateProvider, refreshModels,
  getEmbeddings, activateEmbedding, deactivateEmbedding,
  type Provider, type PingResult, type Health,
} from '../api.ts';

const PROVIDER_TYPES = ['ollama', 'openai', 'anthropic', 'openai-compat', 'gguf'];

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  ollama:          'Free, runs fully local — no API key required. Install from ollama.com.',
  openai:          'OpenAI (GPT-4o, o1, etc.) — requires an API key from platform.openai.com.',
  anthropic:       'Anthropic (Claude) — recommended for reasoning and code. Key from console.anthropic.com.',
  'openai-compat': 'Any API that speaks the OpenAI protocol: LM Studio, Together, Groq, and more.',
  gguf:            'Local GGUF model file via llama-server. Requires llama.cpp installed and llama-server running. Endpoint: http://localhost:8080.',
};

const CIRCUIT_EXPLANATIONS: Record<string, string> = {
  closed:    'Provider is healthy — requests pass through normally.',
  open:      'Provider tripped: 3+ consecutive failures. Requests are paused for 30s to let it recover.',
  'half-open': 'Testing recovery — one probe request is allowed through to check if the provider is back.',
};

const DEFAULT_ENDPOINTS: Record<string, string> = {
  openai:       'https://api.openai.com/v1',
  anthropic:    'https://api.anthropic.com',
  ollama:       'http://localhost:11434',
  'openai-compat': '',
};

const INPUT_CLS = 'bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';
const SELECT_CLS = 'bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';

const Spinner = () => (
  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>
);

interface Props {
  health?: Health | null;
}

export function ModelsPanel({ health }: Props) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [pings, setPings]         = useState<Record<string, PingResult>>({});
  const [showAdd, setShowAdd]     = useState(false);
  const [form, setForm]           = useState({ name: '', type: 'ollama', endpoint: '', apiKey: '', isDefault: false });
  const [adding, setAdding]       = useState(false);
  const [loading, setLoading]     = useState(true);
  const [addError, setAddError]   = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [pinging, setPinging]     = useState<Record<string, boolean>>({});
  const [refreshedModels, setRefreshedModels] = useState<Record<string, string[]>>({});

  // Embeddings state
  const [embeddingInfo, setEmbeddingInfo] = useState<{ active: string; providers: string[] } | null>(null);
  const [embeddingForm, setEmbeddingForm] = useState({ baseUrl: 'http://localhost:11434', model: '' });
  const [showEmbeddingForm, setShowEmbeddingForm] = useState(false);
  const [embeddingError, setEmbeddingError] = useState<string | null>(null);
  const [savingEmbedding, setSavingEmbedding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, emb] = await Promise.all([
        listProviders(),
        getEmbeddings().catch(() => null),
      ]);
      setProviders(data);
      if (emb) setEmbeddingInfo(emb);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const handleActivateEmbedding = async () => {
    if (!embeddingForm.model.trim()) { setEmbeddingError('Model name is required.'); return; }
    setEmbeddingError(null);
    setSavingEmbedding(true);
    try {
      const result = await activateEmbedding(embeddingForm.baseUrl, embeddingForm.model.trim());
      setEmbeddingInfo(prev => prev ? { ...prev, active: result.active } : { active: result.active, providers: [result.active] });
      setShowEmbeddingForm(false);
    } catch (err) {
      setEmbeddingError(err instanceof Error ? err.message : 'Failed to activate');
    } finally {
      setSavingEmbedding(false);
    }
  };

  const handleDeactivateEmbedding = async () => {
    try {
      const result = await deactivateEmbedding();
      setEmbeddingInfo(prev => prev ? { ...prev, active: result.active } : null);
    } catch { /* ignore */ }
  };

  useEffect(() => { void load(); }, [load]);

  // Auto-fill endpoint when provider type changes
  const handleTypeChange = (type: string) => {
    setForm(f => ({ ...f, type, endpoint: DEFAULT_ENDPOINTS[type] ?? '' }));
  };

  const handlePing = async (id: string) => {
    setPinging(p => ({ ...p, [id]: true }));
    try {
      const result = await pingProvider(id);
      setPings(p => ({ ...p, [id]: result }));
    } catch {
      setPings(p => ({ ...p, [id]: { ok: false, latencyMs: 0, error: 'request failed' } }));
    } finally {
      setPinging(p => ({ ...p, [id]: false }));
    }
  };

  const handleAdd = async () => {
    if (!form.name || !form.type) { setAddError('Name and type are required.'); return; }
    setAddError(null);
    setAdding(true);
    try {
      const p = await addProvider({
        name: form.name,
        type: form.type,
        endpoint: form.endpoint || DEFAULT_ENDPOINTS[form.type] || 'http://localhost',
        ...(form.apiKey && { apiKey: form.apiKey }),
        isDefault: form.isDefault,
      } as Omit<Provider, 'id'>);
      setProviders(prev => [...prev, p]);
      setForm({ name: '', type: 'ollama', endpoint: '', apiKey: '', isDefault: false });
      setShowAdd(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add provider');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProvider(id);
      setProviders(p => p.filter(x => x.id !== id));
    } catch { /* ignore */ }
  };

  const handleRefresh = async (id: string) => {
    setRefreshing(r => ({ ...r, [id]: true }));
    try {
      const result = await refreshModels(id);
      setRefreshedModels(m => ({ ...m, [id]: result.models }));
      // Also reload providers to get updated model list
      load();
    } catch { /* ignore */ }
    finally { setRefreshing(r => ({ ...r, [id]: false })); }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const updated = await updateProvider(id, { isDefault: true });
      setProviders(prev => prev.map(p =>
        p.id === id ? updated : { ...p, isDefault: false }
      ));
    } catch { /* ignore */ }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-xs text-zinc-500">{providers.length} provider{providers.length !== 1 ? 's' : ''}</span>
        <button
          onClick={() => { setShowAdd(s => !s); setAddError(null); }}
          className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
        >+ add provider</button>
      </div>

      {showAdd && (
        <div className="p-4 border-b border-zinc-800 space-y-2 bg-zinc-900/30">
          <p className="text-xs text-zinc-400 font-medium">Add Provider</p>
          {form.type && PROVIDER_DESCRIPTIONS[form.type] && (
            <p className="text-xs text-zinc-600 leading-relaxed">{PROVIDER_DESCRIPTIONS[form.type]}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Name *"
              className={INPUT_CLS}
            />
            <select
              value={form.type}
              onChange={e => handleTypeChange(e.target.value)}
              className={SELECT_CLS}
            >
              {PROVIDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              value={form.endpoint}
              onChange={e => setForm(f => ({ ...f, endpoint: e.target.value }))}
              placeholder="Endpoint URL"
              className={`col-span-2 ${INPUT_CLS}`}
            />
            {(form.type === 'openai' || form.type === 'anthropic' || form.type === 'openai-compat') && (
              <input
                value={form.apiKey}
                onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                placeholder="API Key"
                type="password"
                className={`col-span-2 ${INPUT_CLS}`}
              />
            )}
            {form.type === 'gguf' && (
              <p className="col-span-2 text-xs text-amber-600/80 leading-relaxed px-1">
                GGUF requires <span className="font-mono">llama-server</span> from llama.cpp to be running locally.
                Start it with: <span className="font-mono text-zinc-400">llama-server --model your-model.gguf --port 8080</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is-default"
              checked={form.isDefault}
              onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))}
              className="accent-brand-500"
            />
            <label htmlFor="is-default" className="text-xs text-zinc-400">Set as default</label>
          </div>
          {addError && <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{addError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={adding}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors flex items-center gap-1.5"
            >
              {adding ? <Spinner /> : 'Add'}
            </button>
            <button
              onClick={() => { setShowAdd(false); setAddError(null); }}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
            >Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin divide-y divide-zinc-800/50">
        {loading ? (
          <div className="divide-y divide-zinc-800/50">
            {[1, 2].map(i => (
              <div key={i} className="px-4 py-3">
                <div className="h-3 bg-zinc-800 rounded animate-pulse w-1/4 mb-2" />
                <div className="h-2 bg-zinc-800 rounded animate-pulse w-1/2" />
              </div>
            ))}
          </div>
        ) : providers.length === 0 ? (
          <div className="p-6 flex flex-col items-center gap-3 text-center">
            <p className="text-zinc-500 text-sm">No AI providers configured</p>
            <p className="text-zinc-700 text-xs leading-relaxed max-w-xs">
              Add a provider to start using Krythor. Supports Ollama (local, free), OpenAI, Anthropic, and any OpenAI-compatible API.
            </p>
            <p className="text-zinc-800 text-xs leading-relaxed max-w-xs">
              The default provider is used for all commands. If it fails, Krythor automatically falls back to the next available provider.
            </p>
            <button
              onClick={() => { setShowAdd(true); setAddError(null); }}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs rounded-lg transition-colors"
            >+ add provider</button>
          </div>
        ) : (
          providers.map(p => {
            const ping = pings[p.id];
            const circuit = health?.circuits?.[p.id];
            const circuitState = circuit?.state ?? 'closed';
            return (
              <div key={p.id} className="px-4 py-3 group">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-zinc-200">{p.name}</span>
                      {p.isDefault && <span className="text-xs bg-brand-900 text-brand-400 px-1.5 py-0.5 rounded">default</span>}
                      <span className="text-xs text-zinc-600">{p.type}</span>
                      {circuitState === 'open' && (
                        <span className="text-xs bg-red-950/60 text-red-400 px-1.5 py-0.5 rounded" title={CIRCUIT_EXPLANATIONS['open']}>circuit open</span>
                      )}
                      {circuitState === 'half-open' && (
                        <span className="text-xs bg-amber-950/60 text-amber-400 px-1.5 py-0.5 rounded" title={CIRCUIT_EXPLANATIONS['half-open']}>recovering</span>
                      )}
                      {circuit && circuit.avgLatencyMs > 0 && circuitState === 'closed' && (
                        <span className="text-xs text-zinc-700" title={`Average inference latency across last ${circuit.totalSuccesses} successful call(s). Lower is faster.`}>{circuit.avgLatencyMs}ms avg</span>
                      )}
                    </div>
                    {p.endpoint && <p className="text-xs text-zinc-600 mt-0.5 truncate">{p.endpoint}</p>}
                    {PROVIDER_DESCRIPTIONS[p.type] && (
                      <p className="text-xs text-zinc-700 mt-0.5 leading-relaxed">{PROVIDER_DESCRIPTIONS[p.type]}</p>
                    )}
                    {ping && (
                      <div className="mt-0.5">
                        <p className={`text-xs ${ping.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                          {ping.ok ? `✓ ${ping.latencyMs}ms` : `✗ ${ping.error ?? 'unreachable'}`}
                        </p>
                        {!ping.ok && ping.lastUnavailableReason && (
                          <p className="text-[10px] text-zinc-600 mt-0.5 leading-snug">{ping.lastUnavailableReason}</p>
                        )}
                      </div>
                    )}
                    {refreshedModels[p.id] && (
                      <p className="text-xs mt-0.5 text-zinc-500">
                        {refreshedModels[p.id]!.length} model{refreshedModels[p.id]!.length !== 1 ? 's' : ''} found: {refreshedModels[p.id]!.slice(0, 3).join(', ')}{refreshedModels[p.id]!.length > 3 ? '…' : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!p.isDefault && (
                      <button
                        onClick={() => handleSetDefault(p.id)}
                        className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 transition-colors"
                      >default</button>
                    )}
                    <button
                      onClick={() => handlePing(p.id)}
                      disabled={pinging[p.id]}
                      className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 transition-colors disabled:opacity-40 flex items-center gap-1"
                    >{pinging[p.id] ? <Spinner /> : 'ping'}</button>
                    <button
                      onClick={() => handleRefresh(p.id)}
                      disabled={refreshing[p.id]}
                      className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 disabled:opacity-40 transition-colors flex items-center gap-1"
                      title="Refresh available models"
                    >{refreshing[p.id] ? <Spinner /> : 'refresh'}</button>
                    <button
                      onClick={() => handleDelete(p.id)}
                      className="text-xs px-2 py-1 bg-zinc-800 hover:bg-red-950/30 hover:text-red-400 rounded-lg text-zinc-600 transition-colors"
                    >✕</button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Embedding Provider Section */}
      <div className="border-t border-zinc-800 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-zinc-400 font-medium">Semantic Memory (Embeddings)</p>
            <p className="text-xs text-zinc-600 mt-0.5">
              Active: <span className="text-zinc-400 font-mono">{embeddingInfo?.active ?? 'stub'}</span>
              {embeddingInfo?.active === 'stub' && <span className="ml-1 text-zinc-700">— keyword search only</span>}
            </p>
          </div>
          <div className="flex gap-1">
            {embeddingInfo?.active !== 'stub' && embeddingInfo?.active && (
              <button
                onClick={handleDeactivateEmbedding}
                className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-500 rounded-lg transition-colors"
                title="Revert to stub (keyword search)"
              >disable</button>
            )}
            <button
              onClick={() => { setShowEmbeddingForm(s => !s); setEmbeddingError(null); }}
              className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
            >{showEmbeddingForm ? 'cancel' : 'configure'}</button>
          </div>
        </div>
        {showEmbeddingForm && (
          <div className="space-y-2">
            <input
              value={embeddingForm.baseUrl}
              onChange={e => setEmbeddingForm(f => ({ ...f, baseUrl: e.target.value }))}
              placeholder="Ollama base URL"
              className={INPUT_CLS}
            />
            <input
              value={embeddingForm.model}
              onChange={e => setEmbeddingForm(f => ({ ...f, model: e.target.value }))}
              placeholder="Embedding model (e.g. nomic-embed-text)"
              className={INPUT_CLS}
            />
            {embeddingError && <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{embeddingError}</p>}
            <button
              onClick={handleActivateEmbedding}
              disabled={savingEmbedding}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors flex items-center gap-1.5"
            >
              {savingEmbedding ? <Spinner /> : 'Activate'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
