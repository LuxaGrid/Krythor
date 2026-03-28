import { useState, useEffect, useCallback } from 'react';
import {
  addProvider,
  patchAppConfig,
  listChatChannelProviders,
  saveChatChannel,
  type Provider,
  type ChatChannelProviderMeta,
} from '../api.ts';

interface DetectedProvider {
  type: string;
  endpoint: string;
  label: string;
  models: string[];
}

async function detectLocalProviders(): Promise<DetectedProvider[]> {
  const found: DetectedProvider[] = [];

  // 1. Ollama
  try {
    const res = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json() as { models?: Array<{ name: string }> };
      const models = (data.models ?? []).map(m => m.name);
      found.push({ type: 'ollama', endpoint: 'http://localhost:11434', label: 'Ollama (running locally)', models });
    }
  } catch { /* not running */ }

  // 2. LM Studio
  try {
    const res = await fetch('http://localhost:1234/v1/models', { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json() as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).map(m => m.id);
      found.push({ type: 'openai-compat', endpoint: 'http://localhost:1234/v1', label: 'LM Studio (running locally)', models });
    }
  } catch { /* not running */ }

  // 3. llama-server (GGUF)
  try {
    const res = await fetch('http://localhost:8080/v1/models', { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json() as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).map(m => m.id);
      found.push({ type: 'gguf', endpoint: 'http://localhost:8080/v1', label: 'llama-server (running locally)', models });
    }
  } catch { /* not running */ }

  return found;
}

interface Props {
  onComplete: () => void;
}

type Step = 'welcome' | 'provider' | 'channels' | 'security_profile' | 'guard_policy' | 'privacy_routing' | 'workspace' | 'done';

// ─── Provider metadata ────────────────────────────────────────────────────────
//
// recommendation_label, recommendation_reason, priority_rank, and
// recommended_for_onboarding are future-proofing hooks for the broader
// model recommendation engine. They are display-only and do not affect routing.
//

interface ProviderMeta {
  label:                    string;        // display name
  recommendation_label?:    string;        // e.g. "Recommended", "Best Overall"
  recommendation_reason?:   string;        // one-line rationale shown as helper text
  priority_rank:            number;        // lower = higher priority (1 = top)
  recommended_for_onboarding: boolean;
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  anthropic: {
    label:                    'Anthropic (Claude)',
    recommendation_label:     'Best Overall',
    recommendation_reason:    'Claude is highly capable for reasoning, code, and general tasks.',
    priority_rank:            1,
    recommended_for_onboarding: true,
  },
  openai: {
    label:                    'OpenAI (ChatGPT)',
    recommendation_label:     'Most Versatile',
    recommendation_reason:    'Broad model selection with wide ecosystem support.',
    priority_rank:            2,
    recommended_for_onboarding: true,
  },
  ollama: {
    label:                    'Ollama',
    recommendation_reason:    'Free and fully local — no API key needed.',
    priority_rank:            3,
    recommended_for_onboarding: true,
  },
  'openai-compat': {
    label:                    'OpenAI-compatible',
    recommendation_reason:    'Any API that speaks the OpenAI protocol (LM Studio, Together, etc.).',
    priority_rank:            4,
    recommended_for_onboarding: false,
  },
  gguf: {
    label:                    'GGUF (Local)',
    recommendation_reason:    'Run GGUF model files locally via llama-server. No API key needed.',
    priority_rank:            5,
    recommended_for_onboarding: false,
  },
};

// Ordered by priority_rank for display
const PROVIDER_TYPES = Object.keys(PROVIDER_META).sort(
  (a, b) => PROVIDER_META[a]!.priority_rank - PROVIDER_META[b]!.priority_rank,
);

const PROVIDER_HINTS: Record<string, string> = {
  ollama:          'Free, runs locally. Install from ollama.com — no API key needed.',
  openai:          'Requires an OpenAI API key from platform.openai.com.',
  anthropic:       'Requires an Anthropic API key from console.anthropic.com.',
  'openai-compat': 'Any API that speaks the OpenAI protocol (LM Studio, Together, etc.).',
  gguf:            'Requires llama-server running locally. See llama.cpp releases for downloads.',
};

const DEFAULT_ENDPOINTS: Record<string, string> = {
  ollama:          'http://localhost:11434',
  openai:          'https://api.openai.com/v1',
  anthropic:       'https://api.anthropic.com',
  'openai-compat': '',
  gguf:            'http://localhost:8080/v1',
};

// Smart default: prefer Anthropic (Claude) when no saved preference exists
const DEFAULT_PROVIDER_TYPE = 'anthropic';

// ─── Channel provider display config ──────────────────────────────────────────

const CHANNEL_ICONS: Record<string, string> = {
  telegram:  '📨',
  discord:   '💬',
  whatsapp:  '📱',
  webchat:   '🌐',
};

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep]         = useState<Step>('welcome');
  const [type, setType]         = useState(DEFAULT_PROVIDER_TYPE);
  const [name, setName]         = useState('');
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINTS[DEFAULT_PROVIDER_TYPE]!);
  const [apiKey, setApiKey]     = useState('');
  const [model, setModel]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detected, setDetected]   = useState<DetectedProvider[]>([]);

  // ── Chat channel state ───────────────────────────────────────────────────────
  const [channelDrafts, setChannelDrafts]       = useState<Record<string, Record<string, string>>>({});
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const [channelProviders, setChannelProviders] = useState<ChatChannelProviderMeta[]>([]);
  const [channelSaving, setChannelSaving]       = useState(false);
  const [channelError, setChannelError]         = useState<string | null>(null);
  const [channelsConfigured, setChannelsConfigured] = useState(0);
  const [webchatCopied, setWebchatCopied]       = useState<'url' | 'embed' | null>(null);

  // ── Security wizard state ─────────────────────────────────────────────────────
  const [selectedProfile, setSelectedProfile]   = useState<'safe' | 'standard' | 'full_access'>('standard');
  const [guardPreset, setGuardPreset]           = useState<'permissive' | 'balanced' | 'strict'>('balanced');
  const [privacyEnabled, setPrivacyEnabled]     = useState(false);
  const [workspacePath, setWorkspacePath]       = useState('');
  const [securitySaving, setSecuritySaving]     = useState(false);
  const [securityError, setSecurityError]       = useState<string | null>(null);

  useEffect(() => {
    setDetecting(true);
    detectLocalProviders().then(found => {
      setDetected(found);
      setDetecting(false);
    }).catch(() => setDetecting(false));
  }, []);

  // Load channel providers when we enter the channels step
  useEffect(() => {
    if (step !== 'channels') return;
    listChatChannelProviders()
      .then(r => setChannelProviders(r.providers))
      .catch(() => { /* non-fatal — cards will be empty */ });
  }, [step]);

  const handleTypeChange = (t: string) => {
    setType(t);
    setEndpoint(DEFAULT_ENDPOINTS[t] ?? '');
    setError(null);
  };

  const handleAddProvider = async () => {
    setError(null);
    if (!endpoint && type !== 'ollama') { setError('Endpoint is required.'); return; }
    if ((type === 'openai' || type === 'anthropic') && !apiKey) { setError('API key is required.'); return; }
    setLoading(true);
    try {
      const models = model.trim() ? [model.trim()] : [];
      await addProvider({
        name: name || type.charAt(0).toUpperCase() + type.slice(1),
        type,
        endpoint: endpoint || undefined,
        isDefault: true,
        isEnabled: true,
        models,
      } as Omit<Provider, 'id'>);
      await patchAppConfig({ onboardingComplete: true });
      setStep('channels');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add provider');
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    await patchAppConfig({ onboardingComplete: true }).catch(() => {});
    onComplete();
  };

  // ── Channel step helpers ─────────────────────────────────────────────────────

  const toggleChannel = (providerId: string) => {
    setSelectedChannels(prev => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
        // Clear any drafted credentials when collapsing
        setChannelDrafts(d => {
          const copy = { ...d };
          delete copy[providerId];
          return copy;
        });
      } else {
        next.add(providerId);
      }
      return next;
    });
    setChannelError(null);
  };

  const setDraftField = (providerId: string, key: string, value: string) => {
    setChannelDrafts(prev => ({
      ...prev,
      [providerId]: { ...(prev[providerId] ?? {}), [key]: value },
    }));
  };

  const copyToClipboard = useCallback((text: string, which: 'url' | 'embed') => {
    void navigator.clipboard.writeText(text).then(() => {
      setWebchatCopied(which);
      setTimeout(() => setWebchatCopied(null), 2000);
    });
  }, []);

  // Return true if a channel card has all required fields filled
  const isChannelFilled = (meta: ChatChannelProviderMeta): boolean => {
    if (meta.requiresPairing) return false;
    const draft = channelDrafts[meta.id] ?? {};
    return meta.credentialFields
      .filter(f => f.required)
      .every(f => (draft[f.key] ?? '').trim().length > 0);
  };

  const handleSaveChannels = async () => {
    setChannelError(null);
    const toSave = channelProviders.filter(
      p => selectedChannels.has(p.id) && isChannelFilled(p),
    );
    if (toSave.length === 0) {
      setStep('security_profile');
      return;
    }
    setChannelSaving(true);
    try {
      for (const meta of toSave) {
        const draft = channelDrafts[meta.id] ?? {};
        await saveChatChannel({
          id:          meta.id,
          type:        meta.type,
          displayName: meta.displayName,
          enabled:     true,
          credentials: draft,
        });
      }
      setChannelsConfigured(toSave.length);
      setStep('security_profile');
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : 'Failed to save channel');
    } finally {
      setChannelSaving(false);
    }
  };

  // ── Render: welcome ──────────────────────────────────────────────────────────

  if (step === 'welcome') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
        <div className="animate-[fadeIn_0.2s_ease-in] w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-8 space-y-6">
          <div className="text-center space-y-3">
            <img src="/logo.png" alt="Krythor" className="h-28 w-28 mx-auto object-contain drop-shadow-lg" />
            <p className="text-zinc-500 text-sm">Local-first AI command platform</p>
          </div>
          <div className="space-y-3 text-sm text-zinc-400 leading-relaxed">
            <p>Welcome. To get started, you need to connect at least one AI provider.</p>
            <p>Krythor works with <span className="text-zinc-200">Anthropic</span> (Claude), <span className="text-zinc-200">OpenAI</span>, <span className="text-zinc-200">Ollama</span> (free, local), or any OpenAI-compatible API.</p>
          </div>
          {detected.length > 0 && (
            <div className="bg-emerald-950/30 border border-emerald-800/40 rounded-lg p-3 space-y-1.5">
              <p className="text-emerald-400 text-xs font-medium">Local providers detected</p>
              {detected.map(d => (
                <button
                  key={d.endpoint}
                  onClick={() => {
                    setStep('provider');
                    handleTypeChange(d.type);
                    setEndpoint(d.endpoint);
                    if (d.models.length > 0) setModel(d.models[0] ?? '');
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded bg-emerald-900/30 hover:bg-emerald-900/50 text-xs text-emerald-300 border border-emerald-800/30 transition-colors"
                >
                  <span className="font-medium">{d.label}</span>
                  {d.models.length > 0 && <span className="text-emerald-600 ml-2">{d.models.slice(0, 2).join(', ')}{d.models.length > 2 ? '…' : ''}</span>}
                </button>
              ))}
              <p className="text-zinc-700 text-[10px]">Click to pre-fill provider settings, then confirm.</p>
            </div>
          )}
          {detecting && detected.length === 0 && (
            <p className="text-zinc-700 text-xs">Scanning for local providers…</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setStep('provider')}
              className="flex-1 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg font-medium"
            >
              Add a provider →
            </button>
            <button
              onClick={handleSkip}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: provider ─────────────────────────────────────────────────────────

  if (step === 'provider') {
    const activeMeta = PROVIDER_META[type];

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
        <div className="animate-[fadeIn_0.2s_ease-in] w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-8 space-y-5">
          <div>
            <h2 className="text-zinc-100 font-semibold text-lg">Add AI Provider</h2>
            <p className="text-zinc-500 text-xs mt-1">Recommended choices for most users</p>
          </div>

          {/* Provider type selector */}
          <div className="grid grid-cols-2 gap-2">
            {PROVIDER_TYPES.map(t => {
              const meta = PROVIDER_META[t]!;
              const isActive = type === t;
              return (
                <button
                  key={t}
                  onClick={() => handleTypeChange(t)}
                  className={`px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors text-left relative
                    ${isActive
                      ? 'bg-brand-900/50 border-brand-600 text-brand-300'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
                >
                  <span className="block truncate">{meta.label}</span>
                  {meta.recommendation_label && (
                    <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] font-semibold
                      ${isActive
                        ? 'bg-brand-700/60 text-brand-200'
                        : 'bg-zinc-700 text-zinc-400'}`}>
                      {meta.recommendation_label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Contextual hint — recommendation_reason when available, else PROVIDER_HINTS */}
          <p className="text-zinc-600 text-xs -mt-1">
            {activeMeta?.recommendation_reason ?? PROVIDER_HINTS[type]}
          </p>
          {detected.find(d => d.endpoint === endpoint) && (
            <p className="text-emerald-600 text-xs -mt-1">Auto-detected and running locally.</p>
          )}

          {/* Fields */}
          <div className="space-y-2">
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={`Name (default: ${type})`}
              className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none border border-zinc-700 focus:border-zinc-500"
            />
            <input
              value={endpoint}
              onChange={e => setEndpoint(e.target.value)}
              placeholder="Endpoint URL"
              className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none border border-zinc-700 focus:border-zinc-500"
            />
            {(type === 'openai' || type === 'anthropic' || type === 'openai-compat') && (
              <input
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="API Key"
                type="password"
                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none border border-zinc-700 focus:border-zinc-500"
              />
            )}
            <input
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder={
                type === 'ollama'     ? 'Model name (e.g. llama3.2)' :
                type === 'openai'     ? 'Model (e.g. gpt-4o-mini)' :
                type === 'anthropic'  ? 'Model (e.g. claude-sonnet-4-6)' :
                'Default model name'
              }
              className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none border border-zinc-700 focus:border-zinc-500"
            />
          </div>

          {error && <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{error}</p>}

          <div className="flex gap-3">
            <button
              onClick={handleAddProvider}
              disabled={loading}
              className="flex-1 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm rounded-lg font-medium"
            >
              {loading ? 'Adding…' : 'Add Provider'}
            </button>
            <button
              onClick={() => setStep('welcome')}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg"
            >
              Back
            </button>
          </div>

          <p className="text-center">
            <button
              onClick={() => setStep('channels')}
              className="text-zinc-600 hover:text-zinc-400 text-xs underline underline-offset-2 transition-colors"
            >
              Skip channels →
            </button>
          </p>

          <p className="text-zinc-700 text-[10px] text-center">You can add more providers later in the Models tab.</p>
        </div>
      </div>
    );
  }

  // ── Render: channels ─────────────────────────────────────────────────────────

  if (step === 'channels') {
    const chatUrl    = `${window.location.protocol}//${window.location.host}/chat`;
    const embedSnippet = `<iframe src="${chatUrl}" width="400" height="600" frameborder="0" allow="microphone"></iframe>`;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
        <div className="animate-[fadeIn_0.2s_ease-in] w-full max-w-2xl mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-8 space-y-5">
          <div>
            <h2 className="text-zinc-100 font-semibold text-lg">Connect Chat Channels</h2>
            <p className="text-zinc-500 text-xs mt-1">
              Optional — connect channels so your agents can receive messages.
            </p>
          </div>

          {/* Provider cards */}
          <div className="grid grid-cols-2 gap-3">
            {channelProviders.length === 0
              ? /* Loading placeholders */
                (['telegram', 'discord', 'whatsapp', 'webchat'] as const).map(id => (
                  <div key={id} className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 opacity-40 animate-pulse h-20" />
                ))
              : channelProviders.map(meta => {
                  const isWhatsApp = meta.type === 'whatsapp' || meta.id === 'whatsapp';
                  const isWebChat  = meta.id === 'webchat';
                  const isSelected = selectedChannels.has(meta.id);
                  const icon       = CHANNEL_ICONS[meta.id] ?? CHANNEL_ICONS[meta.type] ?? '💬';
                  const draft      = channelDrafts[meta.id] ?? {};

                  // ── Web Chat card ────────────────────────────────────────
                  if (isWebChat) {
                    return (
                      <div key={meta.id} className="bg-zinc-800/80 border border-zinc-700 rounded-lg p-3 col-span-2">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">{icon}</span>
                          <p className="text-zinc-200 text-xs font-medium">{meta.displayName}</p>
                          <span className="ml-auto text-[10px] bg-emerald-900/40 text-emerald-400 border border-emerald-800/30 px-1.5 py-0.5 rounded">
                            Ready — no setup needed
                          </span>
                        </div>
                        <p className="text-zinc-500 text-[11px] mb-3 leading-relaxed">
                          Your chat page is live. Share the URL or embed it on any webpage.
                        </p>
                        {/* Chat URL row */}
                        <div className="flex items-center gap-2 mb-2">
                          <code className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-300 font-mono truncate">
                            {chatUrl}
                          </code>
                          <button
                            onClick={() => copyToClipboard(chatUrl, 'url')}
                            className="px-2.5 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-[11px] rounded transition-colors whitespace-nowrap"
                          >
                            {webchatCopied === 'url' ? '✓ Copied' : 'Copy URL'}
                          </button>
                          <a
                            href={chatUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1.5 bg-brand-700 hover:bg-brand-600 text-white text-[11px] rounded transition-colors whitespace-nowrap"
                          >
                            Open →
                          </a>
                        </div>
                        {/* Embed snippet row */}
                        <div className="flex items-center gap-2">
                          <code className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-400 font-mono truncate">
                            {embedSnippet}
                          </code>
                          <button
                            onClick={() => copyToClipboard(embedSnippet, 'embed')}
                            className="px-2.5 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-[11px] rounded transition-colors whitespace-nowrap"
                          >
                            {webchatCopied === 'embed' ? '✓ Copied' : 'Copy embed'}
                          </button>
                        </div>
                        <p className="text-zinc-700 text-[10px] mt-2">
                          The chat URL includes your auth token — keep it private or use it only on trusted networks.
                        </p>
                      </div>
                    );
                  }

                  // ── WhatsApp card ────────────────────────────────────────
                  if (isWhatsApp) {
                    return (
                      <div
                        key={meta.id}
                        className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 opacity-60 cursor-not-allowed"
                        title="Requires manual setup"
                      >
                        <div className="text-lg mb-1">{icon}</div>
                        <p className="text-zinc-300 text-xs font-medium truncate">{meta.displayName}</p>
                        <p className="text-zinc-600 text-[10px] mt-1 leading-tight">
                          Requires manual setup — configure in Chat Channels after setup.
                        </p>
                      </div>
                    );
                  }

                  // ── Telegram / Discord cards ─────────────────────────────
                  return (
                    <div
                      key={meta.id}
                      className={`rounded-lg border transition-colors cursor-pointer
                        ${isSelected
                          ? 'bg-brand-900/50 border-brand-600'
                          : 'bg-zinc-800 border-zinc-700 hover:border-zinc-600'}`}
                    >
                      <div className="p-3" onClick={() => toggleChannel(meta.id)}>
                        <div className="text-lg mb-1">{icon}</div>
                        <p className={`text-xs font-medium truncate ${isSelected ? 'text-brand-200' : 'text-zinc-300'}`}>
                          {meta.displayName}
                        </p>
                        <p className="text-zinc-600 text-[10px] mt-0.5 leading-tight line-clamp-2">
                          {meta.description}
                        </p>
                      </div>
                      {isSelected && (
                        <div className="px-3 pb-3 space-y-1.5 border-t border-brand-800/40 pt-2">
                          {meta.credentialFields
                            .filter(f => f.required || f.key === 'botToken' || f.key === 'channelId')
                            .map(field => (
                              <input
                                key={field.key}
                                type={field.secret ? 'password' : 'text'}
                                value={draft[field.key] ?? ''}
                                onChange={e => setDraftField(meta.id, field.key, e.target.value)}
                                placeholder={
                                  field.key === 'botToken'  ? (meta.type === 'telegram' ? '123456:ABC-DEF…' : 'Bot token…') :
                                  field.key === 'channelId' ? '123456789012345678' :
                                  field.hint || field.label
                                }
                                className="w-full bg-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 outline-none border border-zinc-700 focus:border-zinc-500"
                                onClick={e => e.stopPropagation()}
                              />
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
          </div>

          {channelError && (
            <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{channelError}</p>
          )}

          <div className="flex gap-3 items-center">
            <button
              onClick={handleSaveChannels}
              disabled={channelSaving}
              className="flex-1 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm rounded-lg font-medium"
            >
              {channelSaving ? 'Saving…' : 'Continue →'}
            </button>
            <button
              onClick={() => setStep('security_profile')}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg"
            >
              Skip for now
            </button>
          </div>

          <p className="text-zinc-700 text-[10px] text-center">
            You can configure chat channels at any time in the Channels tab.
          </p>
        </div>
      </div>
    );
  }

  // ── Render: security_profile ─────────────────────────────────────────────────

  if (step === 'security_profile') {
    const profiles: Array<{
      id: 'safe' | 'standard' | 'full_access';
      label: string;
      description: string;
      warn?: boolean;
    }> = [
      {
        id:          'safe',
        label:       'Safe',
        description: 'Read-only operations only. Cannot write files, run commands, or make external requests.',
      },
      {
        id:          'standard',
        label:       'Standard',
        description: 'Balanced defaults — reads and writes within the workspace, limited external access.',
      },
      {
        id:          'full_access',
        label:       'Full Access',
        description: 'No operation restrictions. Use only if you trust all agents and inputs.',
        warn:        true,
      },
    ];

    const handleApplyProfile = async () => {
      setSecurityError(null);
      setSecuritySaving(true);
      try {
        await patchAppConfig({ defaultProfile: selectedProfile });
        setStep('guard_policy');
      } catch (err) {
        setSecurityError(err instanceof Error ? err.message : 'Failed to save profile');
      } finally {
        setSecuritySaving(false);
      }
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
        <div className="animate-[fadeIn_0.2s_ease-in] w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-8 space-y-5">
          <div>
            <h2 className="text-zinc-100 font-semibold text-lg">Security Profile</h2>
            <p className="text-zinc-500 text-xs mt-1">
              Choose the default permission profile applied to agent runs.
            </p>
          </div>

          <div className="space-y-2">
            {profiles.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedProfile(p.id)}
                className={`w-full text-left rounded-lg border px-4 py-3 transition-colors
                  ${selectedProfile === p.id
                    ? p.warn
                      ? 'bg-amber-950/40 border-amber-700 text-amber-200'
                      : 'bg-brand-900/50 border-brand-600 text-brand-200'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
              >
                <p className="text-sm font-medium">{p.label}</p>
                <p className="text-xs mt-0.5 leading-relaxed opacity-80">{p.description}</p>
              </button>
            ))}
          </div>

          {selectedProfile === 'full_access' && (
            <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg p-3 text-xs text-amber-400 leading-relaxed">
              Full Access removes all guard-level restrictions. Agents can read and write anywhere on the system. Only use this in fully controlled environments.
            </div>
          )}

          {securityError && (
            <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{securityError}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleApplyProfile}
              disabled={securitySaving}
              className="flex-1 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm rounded-lg font-medium"
            >
              {securitySaving ? 'Saving…' : 'Continue →'}
            </button>
            <button
              onClick={() => setStep('guard_policy')}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg"
            >
              Skip
            </button>
          </div>
          <p className="text-zinc-700 text-[10px] text-center">
            You can change the security profile per-agent in the Agents tab.
          </p>
        </div>
      </div>
    );
  }

  // ── Render: guard_policy ──────────────────────────────────────────────────────

  if (step === 'guard_policy') {
    const presets: Array<{
      id: 'permissive' | 'balanced' | 'strict';
      label: string;
      description: string;
    }> = [
      {
        id:          'permissive',
        label:       'Permissive',
        description: 'Minimal content filtering. Recommended for internal or developer use.',
      },
      {
        id:          'balanced',
        label:       'Balanced',
        description: 'Moderate filtering — blocks harmful content while allowing broad utility.',
      },
      {
        id:          'strict',
        label:       'Strict',
        description: 'Strong filtering with approval gates for sensitive operations.',
      },
    ];

    const handleApplyGuard = async () => {
      setSecurityError(null);
      setSecuritySaving(true);
      try {
        await patchAppConfig({ guardPreset });
        setStep('privacy_routing');
      } catch (err) {
        setSecurityError(err instanceof Error ? err.message : 'Failed to save guard policy');
      } finally {
        setSecuritySaving(false);
      }
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
        <div className="animate-[fadeIn_0.2s_ease-in] w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-8 space-y-5">
          <div>
            <h2 className="text-zinc-100 font-semibold text-lg">Guard Policy</h2>
            <p className="text-zinc-500 text-xs mt-1">
              Set the content-filtering level applied to all agent outputs.
            </p>
          </div>

          <div className="space-y-2">
            {presets.map(p => (
              <button
                key={p.id}
                onClick={() => setGuardPreset(p.id)}
                className={`w-full text-left rounded-lg border px-4 py-3 transition-colors
                  ${guardPreset === p.id
                    ? 'bg-brand-900/50 border-brand-600 text-brand-200'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
              >
                <p className="text-sm font-medium">{p.label}</p>
                <p className="text-xs mt-0.5 leading-relaxed opacity-80">{p.description}</p>
              </button>
            ))}
          </div>

          {securityError && (
            <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{securityError}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleApplyGuard}
              disabled={securitySaving}
              className="flex-1 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm rounded-lg font-medium"
            >
              {securitySaving ? 'Saving…' : 'Continue →'}
            </button>
            <button
              onClick={() => setStep('privacy_routing')}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg"
            >
              Skip
            </button>
          </div>
          <p className="text-zinc-700 text-[10px] text-center">
            Guard policies can be fine-tuned in Settings after setup.
          </p>
        </div>
      </div>
    );
  }

  // ── Render: privacy_routing ───────────────────────────────────────────────────

  if (step === 'privacy_routing') {
    const hasLocalProvider = detected.length > 0;

    const handleApplyPrivacy = async () => {
      setSecurityError(null);
      setSecuritySaving(true);
      try {
        await patchAppConfig({ privacyMode: privacyEnabled });
        setStep('workspace');
      } catch (err) {
        setSecurityError(err instanceof Error ? err.message : 'Failed to save privacy setting');
      } finally {
        setSecuritySaving(false);
      }
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
        <div className="animate-[fadeIn_0.2s_ease-in] w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-8 space-y-5">
          <div>
            <h2 className="text-zinc-100 font-semibold text-lg">Privacy Routing</h2>
            <p className="text-zinc-500 text-xs mt-1">
              Route sensitive prompts to a local provider instead of cloud APIs.
            </p>
          </div>

          <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-3">
              <button
                onClick={() => setPrivacyEnabled(v => !v)}
                className={`mt-0.5 w-10 h-5 rounded-full flex-shrink-0 relative transition-colors
                  ${privacyEnabled ? 'bg-brand-600' : 'bg-zinc-700'}`}
                aria-checked={privacyEnabled}
                role="switch"
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform
                  ${privacyEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
              <div>
                <p className="text-zinc-200 text-sm font-medium">Enable privacy routing</p>
                <p className="text-zinc-500 text-xs mt-0.5 leading-relaxed">
                  When enabled, requests tagged as sensitive will be redirected to a local provider if one is available.
                </p>
              </div>
            </div>

            {privacyEnabled && !hasLocalProvider && (
              <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg p-2.5 text-xs text-amber-400 leading-relaxed">
                No local provider detected. Privacy routing will have no effect until a local provider (e.g. Ollama) is added.
              </div>
            )}
            {privacyEnabled && hasLocalProvider && (
              <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg p-2.5 text-xs text-emerald-400">
                Local provider detected — privacy routing is ready.
              </div>
            )}
          </div>

          {securityError && (
            <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{securityError}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleApplyPrivacy}
              disabled={securitySaving}
              className="flex-1 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm rounded-lg font-medium"
            >
              {securitySaving ? 'Saving…' : 'Continue →'}
            </button>
            <button
              onClick={() => setStep('workspace')}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg"
            >
              Skip
            </button>
          </div>
          <p className="text-zinc-700 text-[10px] text-center">
            Privacy routing can be toggled in Settings at any time.
          </p>
        </div>
      </div>
    );
  }

  // ── Render: workspace ─────────────────────────────────────────────────────────

  if (step === 'workspace') {
    const handleApplyWorkspace = async () => {
      setSecurityError(null);
      setSecuritySaving(true);
      try {
        if (workspacePath.trim()) {
          await patchAppConfig({ workspacePath: workspacePath.trim() });
        }
        setStep('done');
      } catch (err) {
        setSecurityError(err instanceof Error ? err.message : 'Failed to save workspace path');
      } finally {
        setSecuritySaving(false);
      }
    };

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
        <div className="animate-[fadeIn_0.2s_ease-in] w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-8 space-y-5">
          <div>
            <h2 className="text-zinc-100 font-semibold text-lg">Workspace</h2>
            <p className="text-zinc-500 text-xs mt-1">
              Set the default directory agents can read and write files in.
            </p>
          </div>

          <div className="space-y-3">
            <input
              value={workspacePath}
              onChange={e => setWorkspacePath(e.target.value)}
              placeholder="/home/user/workspace  or  C:\Users\you\workspace"
              className="w-full bg-zinc-800 rounded-lg px-3 py-2.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none border border-zinc-700 focus:border-zinc-500 font-mono"
            />
            <p className="text-zinc-600 text-xs leading-relaxed">
              Agents with the Standard or Safe profile are restricted to this directory. Leave blank to use the system default.
            </p>
          </div>

          {securityError && (
            <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{securityError}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleApplyWorkspace}
              disabled={securitySaving}
              className="flex-1 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm rounded-lg font-medium"
            >
              {securitySaving ? 'Saving…' : 'Finish Setup →'}
            </button>
            <button
              onClick={() => setStep('done')}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-lg"
            >
              Skip
            </button>
          </div>
          <p className="text-zinc-700 text-[10px] text-center">
            You can change the workspace path in Settings at any time.
          </p>
        </div>
      </div>
    );
  }

  // ── Render: done ─────────────────────────────────────────────────────────────

  const chosenMeta   = PROVIDER_META[type];
  const displayName  = name || (type.charAt(0).toUpperCase() + type.slice(1));
  const setupNote    = chosenMeta?.recommendation_label
    ? `Configured with ${chosenMeta.recommendation_label} provider (${displayName}).`
    : `Configured with ${displayName}.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
      <div className="animate-[fadeIn_0.2s_ease-in] w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-8 space-y-6 text-center">
        <div className="space-y-3">
          <img src="/logo.png" alt="Krythor" className="h-20 w-20 mx-auto object-contain drop-shadow-lg" />
          <h2 className="text-zinc-100 font-semibold text-lg">You're ready</h2>
          <p className="text-zinc-500 text-sm">{setupNote} The default Krythor agent is selected and ready to use.</p>
        </div>

        {/* Inline setup summary */}
        <div className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-3 text-left space-y-1 text-xs">
          <p className="text-zinc-500 font-medium mb-1.5">Setup summary</p>
          <div className="flex justify-between">
            <span className="text-zinc-500">Primary AI</span>
            <span className="text-zinc-200 font-medium">{displayName}</span>
          </div>
          {chosenMeta?.recommendation_label && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Recommendation</span>
              <span className="text-zinc-400">{chosenMeta.recommendation_label}</span>
            </div>
          )}
          {model.trim() && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Model</span>
              <span className="text-zinc-300 font-mono">{model.trim()}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-zinc-500">Web Chat</span>
            <span className="text-emerald-400">ready</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Other Channels</span>
            <span className={channelsConfigured > 0 ? 'text-emerald-400' : 'text-zinc-600'}>
              {channelsConfigured > 0 ? `${channelsConfigured} connected` : 'none configured'}
            </span>
          </div>
        </div>

        {/* System readiness */}
        <div className="bg-zinc-800/40 border border-zinc-700/60 rounded-lg p-3 text-left space-y-1 text-xs">
          <p className="text-zinc-500 font-medium mb-1.5">System readiness</p>
          <div className="flex justify-between">
            <span className="text-zinc-500">Provider</span>
            <span className="text-emerald-400">connected</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Memory</span>
            <span className="text-emerald-400">active</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Search mode</span>
            <span className="text-zinc-400">keyword</span>
          </div>
          <p className="text-zinc-700 text-[10px] mt-1">Add an Ollama provider with nomic-embed-text to enable semantic search.</p>
        </div>

        <div className="bg-zinc-800 rounded-lg p-4 text-left space-y-1 text-xs text-zinc-400">
          <p>› Type a message in the <span className="text-zinc-200">Command</span> tab to chat with the agent.</p>
          <p>› Add more providers in the <span className="text-zinc-200">Models</span> tab.</p>
          <p>› Create custom agents in the <span className="text-zinc-200">Agents</span> tab.</p>
        </div>
        <button
          onClick={onComplete}
          className="w-full px-4 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-sm rounded-lg font-medium"
        >
          Open Krythor
        </button>
      </div>
    </div>
  );
}
