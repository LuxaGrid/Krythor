import { useState, useEffect } from 'react';
import { addProvider, patchAppConfig, type Provider } from '../api.ts';

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

type Step = 'welcome' | 'provider' | 'done';

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

  useEffect(() => {
    setDetecting(true);
    detectLocalProviders().then(found => {
      setDetected(found);
      setDetecting(false);
    }).catch(() => setDetecting(false));
  }, []);

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
      setStep('done');
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

          <p className="text-zinc-700 text-[10px] text-center">You can add more providers later in the Models tab.</p>
        </div>
      </div>
    );
  }

  // done — show inline summary of what was configured
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
