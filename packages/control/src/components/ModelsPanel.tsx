import { useState, useEffect, useCallback } from 'react';
import {
  listProviders, addProvider, deleteProvider, pingProvider, updateProvider, refreshModels,
  getEmbeddings, activateEmbedding, deactivateEmbedding,
  getProviderCapabilities, connectOAuth, disconnectOAuth,
  type Provider, type PingResult, type Health, type ProviderCapabilities, type AuthMethod,
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
  closed:      'Provider is healthy — requests pass through normally.',
  open:        'Provider tripped: 3+ consecutive failures. Requests are paused for 30s to let it recover.',
  'half-open': 'Testing recovery — one probe request is allowed through to check if the provider is back.',
};

const DEFAULT_ENDPOINTS: Record<string, string> = {
  openai:          'https://api.openai.com/v1',
  anthropic:       'https://api.anthropic.com',
  ollama:          'http://localhost:11434',
  'openai-compat': '',
};

const INPUT_CLS  = 'bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';
const SELECT_CLS = 'bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30 transition-colors';

const Spinner = () => (
  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>
);

/** Badge shown next to provider name for connected-state. */
function AuthBadge({ p }: { p: Provider }) {
  if (p.authMethod === 'oauth' && p.oauthAccount) {
    return (
      <span className="text-xs bg-emerald-950/60 text-emerald-400 px-1.5 py-0.5 rounded" title={`Connected as ${p.oauthAccount.accountId}`}>
        OAuth ✓
      </span>
    );
  }
  if (p.authMethod === 'api_key' && p.apiKey) {
    return (
      <span className="text-xs bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded">
        API key {p.apiKey}
      </span>
    );
  }
  if (p.authMethod === 'none' || !p.authMethod) {
    // Local providers (ollama, gguf) need no auth — don't show a badge
    if (p.type === 'ollama' || p.type === 'gguf') return null;
    return (
      <span className="text-xs bg-amber-950/60 text-amber-500 px-1.5 py-0.5 rounded">not connected</span>
    );
  }
  return null;
}

interface Props {
  health?: Health | null;
}

export function ModelsPanel({ health }: Props) {
  const [providers, setProviders]       = useState<Provider[]>([]);
  const [caps, setCaps]                 = useState<Record<string, ProviderCapabilities>>({});
  const [pings, setPings]               = useState<Record<string, PingResult>>({});
  const [showAdd, setShowAdd]           = useState(false);
  const [form, setForm]                 = useState({
    name: '', type: 'ollama', endpoint: '',
    authMethod: 'none' as AuthMethod,
    apiKey: '', isDefault: false,
  });
  const [adding, setAdding]             = useState(false);
  const [loading, setLoading]           = useState(true);
  const [addError, setAddError]         = useState<string | null>(null);
  const [refreshing, setRefreshing]     = useState<Record<string, boolean>>({});
  const [pinging, setPinging]           = useState<Record<string, boolean>>({});
  const [refreshedModels, setRefreshedModels] = useState<Record<string, string[]>>({});

  // OAuth connect panel state (per-provider)
  const [oauthPanel, setOauthPanel]     = useState<string | null>(null); // provider id
  const [oauthForm, setOauthForm]       = useState({ accountId: '', displayName: '', accessToken: '', refreshToken: '' });
  const [oauthError, setOauthError]     = useState<string | null>(null);
  const [oauthSaving, setOauthSaving]   = useState(false);
  const [disconnecting, setDisconnecting] = useState<Record<string, boolean>>({});

  // Embeddings state
  const [embeddingInfo, setEmbeddingInfo]   = useState<{ active: string; providers: string[] } | null>(null);
  const [embeddingForm, setEmbeddingForm]   = useState({ baseUrl: 'http://localhost:11434', model: '' });
  const [showEmbeddingForm, setShowEmbeddingForm] = useState(false);
  const [embeddingError, setEmbeddingError] = useState<string | null>(null);
  const [savingEmbedding, setSavingEmbedding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [data, capsData, emb] = await Promise.all([
        listProviders(),
        getProviderCapabilities().catch(() => ({})),
        getEmbeddings().catch(() => null),
      ]);
      setProviders(data);
      setCaps(capsData);
      if (emb) setEmbeddingInfo(emb);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // When provider type changes, auto-fill endpoint and pick sensible default authMethod
  const handleTypeChange = (type: string) => {
    const typeCaps = caps[type];
    let authMethod: AuthMethod = 'none';
    if (typeCaps?.supportsApiKey) authMethod = 'api_key';
    setForm(f => ({ ...f, type, endpoint: DEFAULT_ENDPOINTS[type] ?? '', authMethod }));
  };

  // ── Add provider ──────────────────────────────────────────────────────────

  const handleAdd = async () => {
    if (!form.name || !form.type) { setAddError('Name and type are required.'); return; }

    if (form.authMethod === 'api_key' && !form.apiKey.trim()) {
      setAddError('API key is required for this auth method.');
      return;
    }
    setAddError(null);
    setAdding(true);
    try {
      const p = await addProvider({
        name:       form.name,
        type:       form.type,
        endpoint:   form.endpoint || DEFAULT_ENDPOINTS[form.type] || 'http://localhost',
        authMethod: form.authMethod,
        ...(form.authMethod === 'api_key' && form.apiKey && { apiKey: form.apiKey }),
        isDefault:  form.isDefault,
      } as Omit<Provider, 'id'>);
      setProviders(prev => [...prev, p]);
      setForm({ name: '', type: 'ollama', endpoint: '', authMethod: 'none', apiKey: '', isDefault: false });
      setShowAdd(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add provider');
    } finally {
      setAdding(false);
    }
  };

  // ── Delete provider ───────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    try {
      await deleteProvider(id);
      setProviders(p => p.filter(x => x.id !== id));
    } catch { /* ignore */ }
  };

  // ── Ping ─────────────────────────────────────────────────────────────────

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

  // ── Refresh models ────────────────────────────────────────────────────────

  const handleRefresh = async (id: string) => {
    setRefreshing(r => ({ ...r, [id]: true }));
    try {
      const result = await refreshModels(id);
      setRefreshedModels(m => ({ ...m, [id]: result.models }));
      load();
    } catch { /* ignore */ }
    finally { setRefreshing(r => ({ ...r, [id]: false })); }
  };

  // ── Set default ───────────────────────────────────────────────────────────

  const handleSetDefault = async (id: string) => {
    try {
      const updated = await updateProvider(id, { isDefault: true });
      setProviders(prev => prev.map(p =>
        p.id === id ? updated : { ...p, isDefault: false }
      ));
    } catch { /* ignore */ }
  };

  // ── OAuth connect ─────────────────────────────────────────────────────────

  const handleOAuthConnect = async (id: string) => {
    if (!oauthForm.accountId.trim() || !oauthForm.accessToken.trim()) {
      setOauthError('Account ID and Access Token are required.');
      return;
    }
    setOauthError(null);
    setOauthSaving(true);
    try {
      const updated = await connectOAuth(id, {
        accountId:    oauthForm.accountId.trim(),
        displayName:  oauthForm.displayName.trim() || undefined,
        accessToken:  oauthForm.accessToken.trim(),
        refreshToken: oauthForm.refreshToken.trim() || undefined,
      });
      setProviders(prev => prev.map(p => p.id === id ? updated : p));
      setOauthPanel(null);
      setOauthForm({ accountId: '', displayName: '', accessToken: '', refreshToken: '' });
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : 'Failed to connect OAuth');
    } finally {
      setOauthSaving(false);
    }
  };

  // ── OAuth disconnect ──────────────────────────────────────────────────────

  const handleOAuthDisconnect = async (id: string) => {
    setDisconnecting(d => ({ ...d, [id]: true }));
    try {
      const updated = await disconnectOAuth(id);
      setProviders(prev => prev.map(p => p.id === id ? updated : p));
    } catch { /* ignore */ }
    finally { setDisconnecting(d => ({ ...d, [id]: false })); }
  };

  // ── Embeddings ────────────────────────────────────────────────────────────

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

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Auth method selector shown inside the add-provider form. */
  function AuthMethodSelector({ type }: { type: string }) {
    const typeCaps = caps[type];
    if (!typeCaps) return null;
    const options: { value: AuthMethod; label: string }[] = [{ value: 'none', label: 'No auth (local)' }];
    if (typeCaps.supportsApiKey) options.push({ value: 'api_key', label: 'API Key' });
    if (typeCaps.supportsOAuth)  options.push({ value: 'oauth',   label: 'OAuth' });
    if (options.length === 1) return null; // Only 'none' — no choice needed

    return (
      <div className="col-span-2 space-y-1">
        <p className="text-xs text-zinc-500">Authentication</p>
        <div className="flex gap-2">
          {options.map(o => (
            <button
              key={o.value}
              onClick={() => setForm(f => ({ ...f, authMethod: o.value }))}
              className={`px-3 py-1 rounded-lg text-xs transition-colors ${
                form.authMethod === o.value
                  ? 'bg-brand-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
        {typeCaps.supportsOAuth && typeCaps.supportsApiKey && (
          <p className="text-[10px] text-zinc-600 leading-relaxed">
            OAuth connects via your account — no key to copy.
            API Key gives direct access using a token from the provider dashboard.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-xs text-zinc-500">{providers.length} provider{providers.length !== 1 ? 's' : ''}</span>
        <button
          onClick={() => { setShowAdd(s => !s); setAddError(null); }}
          className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
        >+ add provider</button>
      </div>

      {/* Add provider form */}
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

            {(caps[form.type]?.supportsCustomBaseUrl !== false) && (
              <input
                value={form.endpoint}
                onChange={e => setForm(f => ({ ...f, endpoint: e.target.value }))}
                placeholder="Endpoint URL"
                className={`col-span-2 ${INPUT_CLS}`}
              />
            )}
            {!caps[form.type]?.supportsCustomBaseUrl && form.type !== 'ollama' && form.type !== 'gguf' && (
              <input
                value={form.endpoint}
                onChange={e => setForm(f => ({ ...f, endpoint: e.target.value }))}
                placeholder="Endpoint URL"
                className={`col-span-2 ${INPUT_CLS}`}
              />
            )}

            <AuthMethodSelector type={form.type} />

            {form.authMethod === 'api_key' && (
              <input
                value={form.apiKey}
                onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
                placeholder="API Key *"
                type="password"
                className={`col-span-2 ${INPUT_CLS}`}
              />
            )}

            {form.authMethod === 'oauth' && (
              <p className="col-span-2 text-xs text-zinc-500 leading-relaxed px-1">
                After adding this provider, use the <span className="text-brand-400">Connect OAuth</span> button to link your account.
              </p>
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

      {/* Provider list */}
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
              Connect via OAuth or API Key — both are supported.
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
            const typeCaps = caps[p.type] ?? { supportsOAuth: false, supportsApiKey: true, supportsCustomBaseUrl: true, supportsModelListing: true };
            const isOAuthConnected = p.authMethod === 'oauth' && !!p.oauthAccount;
            const showOAuthPanel   = oauthPanel === p.id;

            return (
              <div key={p.id} className="px-4 py-3 group">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {/* Name row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-zinc-200">{p.name}</span>
                      {p.isDefault && <span className="text-xs bg-brand-900 text-brand-400 px-1.5 py-0.5 rounded">default</span>}
                      <span className="text-xs text-zinc-600">{p.type}</span>
                      <AuthBadge p={p} />
                      {circuitState === 'open' && (
                        <span className="text-xs bg-red-950/60 text-red-400 px-1.5 py-0.5 rounded" title={CIRCUIT_EXPLANATIONS['open']}>circuit open</span>
                      )}
                      {circuitState === 'half-open' && (
                        <span className="text-xs bg-amber-950/60 text-amber-400 px-1.5 py-0.5 rounded" title={CIRCUIT_EXPLANATIONS['half-open']}>recovering</span>
                      )}
                      {circuit && circuit.avgLatencyMs > 0 && circuitState === 'closed' && (
                        <span className="text-xs text-zinc-700" title="Average inference latency">{circuit.avgLatencyMs}ms avg</span>
                      )}
                    </div>

                    {/* OAuth account info */}
                    {isOAuthConnected && p.oauthAccount && (
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Connected as <span className="text-zinc-400">{p.oauthAccount.displayName ?? p.oauthAccount.accountId}</span>
                        {p.oauthAccount.expiresAt > 0 && (
                          <span className="ml-1 text-zinc-600">
                            · expires {new Date(p.oauthAccount.expiresAt * 1000).toLocaleDateString()}
                          </span>
                        )}
                      </p>
                    )}

                    {p.endpoint && <p className="text-xs text-zinc-600 mt-0.5 truncate">{p.endpoint}</p>}
                    {PROVIDER_DESCRIPTIONS[p.type] && (
                      <p className="text-xs text-zinc-700 mt-0.5 leading-relaxed">{PROVIDER_DESCRIPTIONS[p.type]}</p>
                    )}

                    {/* Ping result */}
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

                    {/* Refreshed models */}
                    {refreshedModels[p.id] && (
                      <p className="text-xs mt-0.5 text-zinc-500">
                        {refreshedModels[p.id]!.length} model{refreshedModels[p.id]!.length !== 1 ? 's' : ''} found: {refreshedModels[p.id]!.slice(0, 3).join(', ')}{refreshedModels[p.id]!.length > 3 ? '…' : ''}
                      </p>
                    )}

                    {/* OAuth connect panel (inline) */}
                    {showOAuthPanel && (
                      <div className="mt-2 p-3 bg-zinc-900/60 rounded-lg border border-zinc-700/60 space-y-2">
                        <p className="text-xs text-zinc-400 font-medium">Connect OAuth account</p>
                        <p className="text-[10px] text-zinc-600 leading-relaxed">
                          Paste the access token obtained from the provider's OAuth flow.
                          Tokens are stored encrypted on this machine and never logged.
                        </p>
                        <input
                          value={oauthForm.accountId}
                          onChange={e => setOauthForm(f => ({ ...f, accountId: e.target.value }))}
                          placeholder="Account ID (e.g. email or user ID) *"
                          className={`w-full ${INPUT_CLS}`}
                        />
                        <input
                          value={oauthForm.displayName}
                          onChange={e => setOauthForm(f => ({ ...f, displayName: e.target.value }))}
                          placeholder="Display name (optional)"
                          className={`w-full ${INPUT_CLS}`}
                        />
                        <input
                          value={oauthForm.accessToken}
                          onChange={e => setOauthForm(f => ({ ...f, accessToken: e.target.value }))}
                          placeholder="Access token *"
                          type="password"
                          className={`w-full ${INPUT_CLS}`}
                        />
                        <input
                          value={oauthForm.refreshToken}
                          onChange={e => setOauthForm(f => ({ ...f, refreshToken: e.target.value }))}
                          placeholder="Refresh token (optional)"
                          type="password"
                          className={`w-full ${INPUT_CLS}`}
                        />
                        {oauthError && <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{oauthError}</p>}
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleOAuthConnect(p.id)}
                            disabled={oauthSaving}
                            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            {oauthSaving ? <Spinner /> : 'Connect'}
                          </button>
                          <button
                            onClick={() => { setOauthPanel(null); setOauthError(null); }}
                            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
                          >Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action buttons (visible on hover) */}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-wrap justify-end">
                    {!p.isDefault && (
                      <button onClick={() => handleSetDefault(p.id)} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 transition-colors">default</button>
                    )}

                    {/* OAuth: show Connect or Disconnect based on current state */}
                    {typeCaps.supportsOAuth && !isOAuthConnected && (
                      <button
                        onClick={() => { setOauthPanel(oauthPanel === p.id ? null : p.id); setOauthError(null); }}
                        className="text-xs px-2 py-1 bg-emerald-950/40 hover:bg-emerald-950/70 rounded-lg text-emerald-400 transition-colors"
                      >OAuth</button>
                    )}
                    {typeCaps.supportsOAuth && isOAuthConnected && (
                      <button
                        onClick={() => handleOAuthDisconnect(p.id)}
                        disabled={disconnecting[p.id]}
                        className="text-xs px-2 py-1 bg-zinc-800 hover:bg-red-950/30 hover:text-red-400 rounded-lg text-zinc-500 transition-colors disabled:opacity-40 flex items-center gap-1"
                      >
                        {disconnecting[p.id] ? <Spinner /> : 'disconnect'}
                      </button>
                    )}

                    <button
                      onClick={() => handlePing(p.id)}
                      disabled={pinging[p.id]}
                      className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 transition-colors disabled:opacity-40 flex items-center gap-1"
                    >{pinging[p.id] ? <Spinner /> : 'ping'}</button>

                    {typeCaps.supportsModelListing && (
                      <button
                        onClick={() => handleRefresh(p.id)}
                        disabled={refreshing[p.id]}
                        className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 disabled:opacity-40 transition-colors flex items-center gap-1"
                        title="Refresh available models"
                      >{refreshing[p.id] ? <Spinner /> : 'refresh'}</button>
                    )}

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
