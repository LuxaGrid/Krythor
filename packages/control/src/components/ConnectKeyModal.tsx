import { useState, useEffect, useRef } from 'react';
import { connectProviderKey, type Provider } from '../api.ts';

interface ConnectKeyModalProps {
  provider: Provider;
  onConnected: (updated: Provider) => void;
  onClose: () => void;
}

type Step = 'get-key' | 'paste-key' | 'connected';

const PROVIDER_CONFIG: Record<string, {
  label: string;
  dashboardUrl: string;
  dashboardLabel: string;
  keyPrefix: string;
  keyHint: string;
  instructions: string;
}> = {
  openai: {
    label: 'OpenAI',
    dashboardUrl: 'https://platform.openai.com/api-keys',
    dashboardLabel: 'Open OpenAI dashboard ↗',
    keyPrefix: 'sk-',
    keyHint: 'Starts with sk-',
    instructions: 'Click "Create new secret key", give it a name, then copy it.',
  },
  anthropic: {
    label: 'Anthropic',
    dashboardUrl: 'https://console.anthropic.com/settings/keys',
    dashboardLabel: 'Open Anthropic console ↗',
    keyPrefix: 'sk-ant-',
    keyHint: 'Starts with sk-ant-',
    instructions: 'Click "Create Key", copy the full key before closing the dialog.',
  },
};

const Spinner = () => (
  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
  </svg>
);

export function ConnectKeyModal({ provider, onConnected, onClose }: ConnectKeyModalProps) {
  const [step, setStep] = useState<Step>('get-key');
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [connectedKey, setConnectedKey] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const cfg = PROVIDER_CONFIG[provider.type] ?? {
    label: provider.name,
    dashboardUrl: provider.endpoint ?? '',
    dashboardLabel: 'Open provider dashboard ↗',
    keyPrefix: '',
    keyHint: 'Paste your API key',
    instructions: 'Get your API key from the provider dashboard.',
  };

  useEffect(() => {
    if (step === 'paste-key') {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [step]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleConnect = async () => {
    const trimmed = key.trim();
    if (!trimmed) { setError('Please paste your API key.'); return; }
    setError(null);
    setSaving(true);
    try {
      const updated = await connectProviderKey(provider.id, trimmed);
      setConnectedKey(trimmed.slice(-4));
      setStep('connected');
      onConnected(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect. Check your key and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-brand-500" />
            <span className="text-sm font-semibold text-zinc-100">
              Connect {cfg.label}
            </span>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 text-lg leading-none transition-colors">×</button>
        </div>

        {/* Step: Get key */}
        {step === 'get-key' && (
          <div className="px-6 py-6 space-y-5">
            <div className="space-y-2">
              <p className="text-sm text-zinc-300 leading-relaxed">
                {cfg.label} uses API keys for access. Your key is stored encrypted on this machine only — it never leaves your computer except when making requests to {cfg.label}.
              </p>
            </div>

            <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 p-4 space-y-3">
              <p className="text-xs text-zinc-400 font-medium uppercase tracking-wide">Steps</p>
              <ol className="space-y-2">
                <li className="flex gap-2.5 text-sm text-zinc-400">
                  <span className="text-brand-500 font-mono font-bold shrink-0">1.</span>
                  <span>Click the button below to open the {cfg.label} dashboard.</span>
                </li>
                <li className="flex gap-2.5 text-sm text-zinc-400">
                  <span className="text-brand-500 font-mono font-bold shrink-0">2.</span>
                  <span>{cfg.instructions}</span>
                </li>
                <li className="flex gap-2.5 text-sm text-zinc-400">
                  <span className="text-brand-500 font-mono font-bold shrink-0">3.</span>
                  <span>Come back here and click "I have my key".</span>
                </li>
              </ol>
            </div>

            {cfg.dashboardUrl && (
              <a
                href={cfg.dashboardUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {cfg.dashboardLabel}
              </a>
            )}

            <button
              onClick={() => setStep('paste-key')}
              className="w-full px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-xl transition-colors"
            >
              I have my key →
            </button>
          </div>
        )}

        {/* Step: Paste key */}
        {step === 'paste-key' && (
          <div className="px-6 py-6 space-y-4">
            <p className="text-sm text-zinc-300">Paste your {cfg.label} API key below.</p>

            <div className="space-y-1.5">
              <input
                ref={inputRef}
                type="password"
                value={key}
                onChange={e => { setKey(e.target.value); setError(null); }}
                onKeyDown={e => { if (e.key === 'Enter') handleConnect(); }}
                placeholder={cfg.keyHint}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3.5 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30 transition-colors font-mono"
              />
              {cfg.keyPrefix && (
                <p className="text-[11px] text-zinc-600">{cfg.keyHint}</p>
              )}
            </div>

            {error && (
              <div className="rounded-lg bg-red-950/40 border border-red-800/40 px-3 py-2">
                <p className="text-xs text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleConnect}
                disabled={saving || !key.trim()}
                className="flex-1 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {saving ? <><Spinner /> Connecting…</> : 'Connect'}
              </button>
              <button
                onClick={() => { setStep('get-key'); setError(null); setKey(''); }}
                className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm rounded-xl transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {/* Step: Connected */}
        {step === 'connected' && (
          <div className="px-6 py-8 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-950/60 border border-emerald-700/40 flex items-center justify-center">
              <svg className="w-7 h-7 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="space-y-1">
              <p className="text-base font-semibold text-zinc-100">{cfg.label} connected</p>
              <p className="text-sm text-zinc-500">
                Key ending in <span className="font-mono text-zinc-400">····{connectedKey}</span> is stored locally and encrypted.
              </p>
            </div>
            <button
              onClick={onClose}
              className="mt-2 px-6 py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
