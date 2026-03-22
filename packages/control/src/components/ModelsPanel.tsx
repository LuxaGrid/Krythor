import { useState, useEffect, useCallback } from 'react';
import {
  listProviders, addProvider, deleteProvider, pingProvider, updateProvider, refreshModels,
  testProvider, updateProviderMeta, discoverLocalModels,
  getEmbeddings, activateEmbedding, deactivateEmbedding,
  getProviderCapabilities, connectOAuth, disconnectOAuth,
  type Provider, type PingResult, type Health, type ProviderCapabilities, type AuthMethod,
  type ProviderTestResult, type LocalModelDiscovery,
} from '../api.ts';
import { ConnectKeyModal } from './ConnectKeyModal.tsx';
import { PanelHeader } from './PanelHeader.tsx';

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

// ── Provider quick-add presets ─────────────────────────────────────────────
// Named providers that map to openai-compat internally but have guided setup.
interface ProviderPreset {
  id: string;
  label: string;
  tagline: string;
  endpoint: string;
  authMethod: 'api_key' | 'none';
  models: string[];
  keyHint: string;
  dashboardUrl?: string;
  dashboardLabel?: string;
  color: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'groq',
    label: 'Groq',
    tagline: 'Ultra-fast inference — fastest Llama & Mixtral available',
    endpoint: 'https://api.groq.com/openai/v1',
    authMethod: 'api_key',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    keyHint: 'Starts with gsk_',
    dashboardUrl: 'https://console.groq.com/keys',
    dashboardLabel: 'Open Groq Console ↗',
    color: '#f97316',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    tagline: '100+ models — one API key for GPT, Claude, Gemini, Llama',
    endpoint: 'https://openrouter.ai/api/v1',
    authMethod: 'api_key',
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4-5', 'google/gemini-2.5-pro', 'meta-llama/llama-3.3-70b-instruct', 'mistralai/mixtral-8x7b-instruct'],
    keyHint: 'Starts with sk-or-',
    dashboardUrl: 'https://openrouter.ai/keys',
    dashboardLabel: 'Open OpenRouter ↗',
    color: '#8b5cf6',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    tagline: 'Gemini 2.5 Pro — Google\'s frontier model via AI Studio',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    authMethod: 'api_key',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    keyHint: 'Starts with AIza',
    dashboardUrl: 'https://aistudio.google.com/app/apikey',
    dashboardLabel: 'Open AI Studio ↗',
    color: '#4285f4',
  },
  {
    id: 'venice',
    label: 'Venice',
    tagline: 'Privacy-first AI — no logs, no training on your data',
    endpoint: 'https://api.venice.ai/api/v1',
    authMethod: 'api_key',
    models: ['llama-3.3-70b', 'llama-3.1-405b', 'mistral-31-24b', 'deepseek-r1-671b'],
    keyHint: 'Venice API key',
    dashboardUrl: 'https://venice.ai/settings/api',
    dashboardLabel: 'Open Venice Settings ↗',
    color: '#06b6d4',
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    tagline: 'Moonshot AI — 128K context, strong at long documents',
    endpoint: 'https://api.moonshot.cn/v1',
    authMethod: 'api_key',
    models: ['moonshot-v1-128k', 'moonshot-v1-32k', 'moonshot-v1-8k'],
    keyHint: 'Moonshot API key',
    dashboardUrl: 'https://platform.moonshot.cn/console/api-keys',
    dashboardLabel: 'Open Moonshot Console ↗',
    color: '#ec4899',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    tagline: 'European frontier AI — Mistral Large, Codestral, and more',
    endpoint: 'https://api.mistral.ai/v1',
    authMethod: 'api_key',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'open-mistral-nemo'],
    keyHint: 'Mistral API key',
    dashboardUrl: 'https://console.mistral.ai/api-keys',
    dashboardLabel: 'Open Mistral Console ↗',
    color: '#f59e0b',
  },
];

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

  // Provider test results (per-provider)
  const [testResults, setTestResults]   = useState<Record<string, ProviderTestResult>>({});
  const [testing, setTesting]           = useState<Record<string, boolean>>({});
  const [toggling, setToggling]         = useState<Record<string, boolean>>({});
  // Local model discovery
  const [discovering, setDiscovering]   = useState(false);
  const [discovered, setDiscovered]     = useState<LocalModelDiscovery | null>(null);
  const [showDiscovery, setShowDiscovery] = useState(false);

  // Guided connect modal
  const [connectModalProvider, setConnectModalProvider] = useState<Provider | null>(null);

  // Preset quick-add modal
  const [presetModal, setPresetModal] = useState<ProviderPreset | null>(null);
  const [presetKey, setPresetKey] = useState('');
  const [presetAdding, setPresetAdding] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);

  // OAuth connect panel state (per-provider, for non-openai/anthropic providers)
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

  // ── Add via preset ───────────────────────────────────────────────────────

  const handlePresetAdd = async () => {
    if (!presetModal) return;
    const trimmed = presetKey.trim();
    if (!trimmed) { setPresetError('Paste your API key to continue.'); return; }
    setPresetError(null);
    setPresetAdding(true);
    try {
      const p = await addProvider({
        name:       presetModal.label,
        type:       'openai-compat',
        endpoint:   presetModal.endpoint,
        authMethod: 'api_key',
        apiKey:     trimmed,
        isDefault:  false,
        models:     presetModal.models,
      } as Omit<Provider, 'id'>);
      setProviders(prev => [...prev, p]);
      setPresetModal(null);
      setPresetKey('');
    } catch (err) {
      setPresetError(err instanceof Error ? err.message : 'Failed to add provider');
    } finally {
      setPresetAdding(false);
    }
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

  // ── Test provider ─────────────────────────────────────────────────────────

  const handleTest = async (id: string) => {
    setTesting(t => ({ ...t, [id]: true }));
    try {
      const result = await testProvider(id);
      setTestResults(r => ({ ...r, [id]: result }));
    } catch {
      setTestResults(r => ({ ...r, [id]: { ok: false, latencyMs: 0, error: 'Request failed' } }));
    } finally {
      setTesting(t => ({ ...t, [id]: false }));
    }
  };

  // ── Enable / Disable provider ─────────────────────────────────────────────

  const handleToggleEnabled = async (id: string, currentEnabled: boolean) => {
    setToggling(t => ({ ...t, [id]: true }));
    try {
      await updateProviderMeta(id, { isEnabled: !currentEnabled });
      setProviders(prev => prev.map(p => p.id === id ? { ...p, isEnabled: !currentEnabled } : p));
    } catch { /* ignore */ }
    finally { setToggling(t => ({ ...t, [id]: false })); }
  };

  // ── Discover local models ─────────────────────────────────────────────────

  const handleDiscover = async () => {
    setDiscovering(true);
    setShowDiscovery(true);
    try {
      const result = await discoverLocalModels();
      setDiscovered(result);
    } catch { /* ignore */ }
    finally { setDiscovering(false); }
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
      <PanelHeader
        title="Models"
        description="Connect AI providers and manage available models. Supports Ollama (local), OpenAI, Anthropic, and any OpenAI-compatible API."
        tip="Click Connect to add your API key for OpenAI or Anthropic. Use Discover Local to auto-detect Ollama and LM Studio running on your machine. Ping a provider to check if it's reachable."
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-600">{providers.length} provider{providers.length !== 1 ? 's' : ''}</span>
            <button
              onClick={handleDiscover}
              disabled={discovering}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              title="Probe Ollama, LM Studio, and llama-server on default ports"
            >
              {discovering ? 'Probing…' : 'Discover local'}
            </button>
            <button
              onClick={() => { setShowPresets(s => !s); setShowAdd(false); }}
              className="text-xs bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 border border-purple-600/30 rounded px-2 py-1 transition-colors"
            >Quick add</button>
            <button
              onClick={() => { setShowAdd(s => !s); setShowPresets(false); setAddError(null); }}
              className="text-xs bg-brand-600/20 text-brand-400 hover:bg-brand-600/30 hover:text-brand-300 border border-brand-600/30 rounded px-2 py-1 transition-colors"
            >+ custom</button>
          </div>
        }
      />

      {/* Preset quick-add modal */}
      {presetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) { setPresetModal(null); setPresetKey(''); setPresetError(null); } }}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full" style={{ background: presetModal.color }} />
                <span className="text-sm font-semibold text-zinc-100">Connect {presetModal.label}</span>
              </div>
              <button onClick={() => { setPresetModal(null); setPresetKey(''); setPresetError(null); }}
                className="text-zinc-600 hover:text-zinc-300 text-lg leading-none">×</button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <p className="text-sm text-zinc-400 leading-relaxed">{presetModal.tagline}</p>
              <div className="rounded-xl bg-zinc-800/40 border border-zinc-700/40 p-4 space-y-2">
                <p className="text-xs text-zinc-500 font-medium uppercase tracking-wide">Steps</p>
                <ol className="space-y-2">
                  <li className="flex gap-2.5 text-sm text-zinc-400">
                    <span className="font-mono font-bold shrink-0" style={{ color: presetModal.color }}>1.</span>
                    <span>Get your API key from the {presetModal.label} dashboard.</span>
                  </li>
                  <li className="flex gap-2.5 text-sm text-zinc-400">
                    <span className="font-mono font-bold shrink-0" style={{ color: presetModal.color }}>2.</span>
                    <span>Paste it below and click Connect.</span>
                  </li>
                </ol>
              </div>
              {presetModal.dashboardUrl && (
                <a href={presetModal.dashboardUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-colors"
                  style={{ background: presetModal.color }}>
                  {presetModal.dashboardLabel}
                </a>
              )}
              <input
                type="password"
                value={presetKey}
                onChange={e => { setPresetKey(e.target.value); setPresetError(null); }}
                onKeyDown={e => { if (e.key === 'Enter') void handlePresetAdd(); }}
                placeholder={presetModal.keyHint}
                autoFocus
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 transition-colors font-mono"
              />
              {presetError && (
                <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/30 rounded-lg px-3 py-2">{presetError}</p>
              )}
              <div className="flex gap-2">
                <button onClick={() => void handlePresetAdd()} disabled={presetAdding || !presetKey.trim()}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-900 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                  style={{ background: presetModal.color }}>
                  {presetAdding ? <><Spinner /> Connecting…</> : 'Connect'}
                </button>
                <button onClick={() => { setPresetModal(null); setPresetKey(''); setPresetError(null); }}
                  className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-xl transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick-add preset cards */}
      {showPresets && (
        <div className="border-b border-zinc-800 bg-zinc-950/40 p-4 space-y-2">
          <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Quick Add — Popular Providers</p>
          <div className="grid grid-cols-2 gap-2">
            {PROVIDER_PRESETS.map(preset => (
              <button key={preset.id}
                onClick={() => { setPresetModal(preset); setShowPresets(false); }}
                className="text-left p-3 rounded-xl border border-zinc-800 hover:border-zinc-600 bg-zinc-900/60 hover:bg-zinc-800/60 transition-all group">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: preset.color }} />
                  <span className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors">{preset.label}</span>
                </div>
                <p className="text-[10px] text-zinc-600 leading-tight">{preset.tagline}</p>
              </button>
            ))}
          </div>
          <button onClick={() => { setShowPresets(false); setShowAdd(true); }}
            className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
            Need something else? → Custom provider
          </button>
        </div>
      )}

      {/* Local model discovery results */}
      {showDiscovery && (
        <div className="p-3 border-b border-zinc-800 bg-zinc-900/30 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-400 font-medium">Local Model Discovery</p>
            <button onClick={() => setShowDiscovery(false)} className="text-zinc-600 hover:text-zinc-300 text-xs">×</button>
          </div>
          {discovering && <p className="text-xs text-zinc-600">Probing local servers…</p>}
          {discovered && !discovering && (
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${discovered.ollama.detected ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                <span className="text-zinc-400">Ollama</span>
                <span className="text-zinc-600">{discovered.ollama.baseUrl}</span>
                {discovered.ollama.detected && (
                  <span className="text-emerald-500">{discovered.ollama.models.length} models</span>
                )}
                {!discovered.ollama.detected && <span className="text-zinc-700">not running</span>}
                {discovered.ollama.detected && (
                  <button
                    onClick={() => {
                      setShowAdd(true);
                      setForm(f => ({
                        ...f, type: 'ollama',
                        endpoint: discovered.ollama.baseUrl,
                        name: 'Ollama (local)',
                        authMethod: 'none',
                      }));
                      setShowDiscovery(false);
                    }}
                    className="ml-auto text-brand-400 hover:text-brand-300 text-xs"
                  >pre-fill form →</button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${discovered.lmStudio.detected ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                <span className="text-zinc-400">LM Studio</span>
                <span className="text-zinc-600">{discovered.lmStudio.baseUrl}</span>
                {discovered.lmStudio.detected && (
                  <span className="text-emerald-500">{discovered.lmStudio.models.length} models</span>
                )}
                {!discovered.lmStudio.detected && <span className="text-zinc-700">not running</span>}
                {discovered.lmStudio.detected && (
                  <button
                    onClick={() => {
                      setShowAdd(true);
                      setForm(f => ({
                        ...f, type: 'openai-compat',
                        endpoint: `${discovered.lmStudio.baseUrl}/v1`,
                        name: 'LM Studio',
                        authMethod: 'none',
                      }));
                      setShowDiscovery(false);
                    }}
                    className="ml-auto text-brand-400 hover:text-brand-300 text-xs"
                  >pre-fill form →</button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${discovered.llamaServer.detected ? 'bg-emerald-400' : 'bg-zinc-700'}`} />
                <span className="text-zinc-400">llama-server</span>
                <span className="text-zinc-600">{discovered.llamaServer.baseUrl}</span>
                {discovered.llamaServer.detected
                  ? <span className="text-emerald-500">running</span>
                  : <span className="text-zinc-700">not running</span>
                }
                {discovered.llamaServer.detected && (
                  <button
                    onClick={() => {
                      setShowAdd(true);
                      setForm(f => ({
                        ...f, type: 'gguf',
                        endpoint: discovered.llamaServer.baseUrl,
                        name: 'llama-server (local)',
                        authMethod: 'none',
                      }));
                      setShowDiscovery(false);
                    }}
                    className="ml-auto text-brand-400 hover:text-brand-300 text-xs"
                  >pre-fill form →</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* OAuth pending CTAs — shown for providers where the user chose "connect OAuth later" */}
      {providers.filter(p => p.setupHint === 'oauth_available').map(p => (
        <div key={p.id} className="px-4 py-2.5 border-b border-amber-800/40 bg-amber-950/20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
            <p className="text-xs text-amber-300 truncate">
              <span className="font-medium">{p.name}</span>
              {' '}— finish connecting with OAuth to start using this provider.
            </p>
          </div>
          <button
            onClick={() => {
              if (p.type === 'openai' || p.type === 'anthropic') {
                setConnectModalProvider(p);
              } else {
                setOauthPanel(oauthPanel === p.id ? null : p.id);
                setOauthError(null);
              }
            }}
            className="text-xs px-2.5 py-1 bg-amber-700 hover:bg-amber-600 text-white rounded-lg transition-colors shrink-0"
          >
            Connect
          </button>
        </div>
      ))}

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

            // Resolve the provider dashboard URL for the "Connect" button
            const oauthDashboardUrl = (() => {
              if (p.type === 'anthropic') return 'https://console.anthropic.com/settings/keys';
              if (p.type === 'openai')    return 'https://platform.openai.com/api-keys';
              // For other providers, fall back to their endpoint base URL if available
              return p.endpoint ?? null;
            })();

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
                      {/* OAuth Pending badge — shown when user deferred OAuth connection during setup */}
                      {p.setupHint === 'oauth_available' && (
                        <span className="text-xs bg-amber-950/60 text-amber-400 border border-amber-700/40 px-1.5 py-0.5 rounded">
                          OAuth Pending
                        </span>
                      )}
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

                    {/* OAuth Pending — Connect button opens provider dashboard to get API key */}
                    {p.setupHint === 'oauth_available' && oauthDashboardUrl && (
                      <div className="mt-1.5 flex items-center gap-2">
                        <p className="text-xs text-amber-500/80">
                          Finish connecting: get your API key from the provider dashboard, then add it here.
                        </p>
                        <a
                          href={oauthDashboardUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs px-2 py-0.5 bg-amber-700 hover:bg-amber-600 text-white rounded transition-colors shrink-0"
                        >
                          Connect ↗
                        </a>
                      </div>
                    )}

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

                    {/* Test result */}
                    {testResults[p.id] && (
                      <div className="mt-0.5">
                        <p className={`text-xs ${testResults[p.id]!.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                          {testResults[p.id]!.ok
                            ? `✓ test ok (${testResults[p.id]!.latencyMs}ms)`
                            : `✗ test failed: ${testResults[p.id]!.error ?? 'error'}`}
                        </p>
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

                  {/* Action buttons */}
                  <div className="flex gap-1 flex-wrap justify-end">
                    {!p.isDefault && (
                      <button onClick={() => handleSetDefault(p.id)} className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 transition-colors">default</button>
                    )}
                    <button
                      onClick={() => handleToggleEnabled(p.id, p.isEnabled !== false)}
                      disabled={!!toggling[p.id]}
                      className={`text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-40 ${
                        p.isEnabled !== false
                          ? 'bg-zinc-800 hover:bg-amber-950/30 hover:text-amber-400 text-zinc-400'
                          : 'bg-amber-950/30 text-amber-400 hover:bg-zinc-800 hover:text-zinc-400'
                      }`}
                      title={p.isEnabled !== false ? 'Disable provider' : 'Enable provider'}
                    >
                      {p.isEnabled !== false ? 'disable' : 'enable'}
                    </button>
                    <button
                      onClick={() => handleTest(p.id)}
                      disabled={!!testing[p.id]}
                      className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-400 transition-colors disabled:opacity-40 flex items-center gap-1"
                      title="Send a test inference to this provider"
                    >{testing[p.id] ? <Spinner /> : 'test'}</button>

                    {/* Connect: guided modal for openai/anthropic, raw panel for others */}
                    {typeCaps.supportsOAuth && !isOAuthConnected && (
                      <button
                        onClick={() => {
                          if (p.type === 'openai' || p.type === 'anthropic') {
                            setConnectModalProvider(p);
                          } else {
                            setOauthPanel(oauthPanel === p.id ? null : p.id);
                            setOauthError(null);
                          }
                        }}
                        className="text-xs px-2 py-1 bg-emerald-950/40 hover:bg-emerald-950/70 rounded-lg text-emerald-400 transition-colors"
                      >Connect</button>
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

      {/* Guided connect modal */}
      {connectModalProvider && (
        <ConnectKeyModal
          provider={connectModalProvider}
          onConnected={updated => {
            setProviders(prev => prev.map(p => p.id === updated.id ? updated : p));
            setConnectModalProvider(null);
          }}
          onClose={() => setConnectModalProvider(null)}
        />
      )}

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
