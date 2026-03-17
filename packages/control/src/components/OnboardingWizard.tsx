import { useState } from 'react';
import { addProvider, patchAppConfig, type Provider } from '../api.ts';

interface Props {
  onComplete: () => void;
}

type Step = 'welcome' | 'provider' | 'done';

const PROVIDER_TYPES = ['ollama', 'openai', 'anthropic', 'openai-compat'];

const PROVIDER_HINTS: Record<string, string> = {
  ollama:         'Free, runs locally. Install from ollama.com — no API key needed.',
  openai:         'Requires an OpenAI API key from platform.openai.com.',
  anthropic:      'Requires an Anthropic API key from console.anthropic.com.',
  'openai-compat': 'Any API that speaks the OpenAI protocol (LM Studio, Together, etc.).',
};

const DEFAULT_ENDPOINTS: Record<string, string> = {
  ollama:          'http://localhost:11434',
  openai:          'https://api.openai.com/v1',
  anthropic:       'https://api.anthropic.com',
  'openai-compat': '',
};

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep]         = useState<Step>('welcome');
  const [type, setType]         = useState('ollama');
  const [name, setName]         = useState('');
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINTS['ollama']!);
  const [apiKey, setApiKey]     = useState('');
  const [model, setModel]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

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
            <p>Krythor works with <span className="text-zinc-200">Ollama</span> (free, local), <span className="text-zinc-200">OpenAI</span>, <span className="text-zinc-200">Anthropic</span>, or any OpenAI-compatible API.</p>
          </div>
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
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
        <div className="animate-[fadeIn_0.2s_ease-in] w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-8 space-y-5">
          <div>
            <h2 className="text-zinc-100 font-semibold text-lg">Add AI Provider</h2>
            <p className="text-zinc-500 text-xs mt-1">You can add more providers later in the Models tab.</p>
          </div>

          {/* Provider type selector */}
          <div className="grid grid-cols-2 gap-2">
            {PROVIDER_TYPES.map(t => (
              <button
                key={t}
                onClick={() => handleTypeChange(t)}
                className={`px-3 py-2.5 rounded-lg text-xs font-medium border transition-colors text-left
                  ${type === t
                    ? 'bg-brand-900/50 border-brand-600 text-brand-300'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="text-zinc-600 text-xs -mt-1">{PROVIDER_HINTS[type]}</p>

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
                type === 'ollama' ? 'Model name (e.g. llama3.2)' :
                type === 'openai' ? 'Model (e.g. gpt-4o-mini)' :
                type === 'anthropic' ? 'Model (e.g. claude-sonnet-4-6)' :
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
        </div>
      </div>
    );
  }

  // done
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
      <div className="animate-[fadeIn_0.2s_ease-in] w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-8 space-y-6 text-center">
        <div className="space-y-3">
          <img src="/logo.png" alt="Krythor" className="h-20 w-20 mx-auto object-contain drop-shadow-lg" />
          <h2 className="text-zinc-100 font-semibold text-lg">You're ready</h2>
          <p className="text-zinc-500 text-sm">Provider added. The default Krythor agent is selected and ready to use.</p>
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
