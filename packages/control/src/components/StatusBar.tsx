import { useState, useEffect } from 'react';
import { listAgents, listModels, type Health, type ModelInfo } from '../api.ts';
import { useAppConfig } from '../App.tsx';

type Tab = 'command' | 'agents' | 'memory' | 'models' | 'guard' | 'events';

interface Props {
  health: Health | null;
  connected: boolean;
  onTabChange: (tab: Tab) => void;
  onAbout: () => void;
}

export function StatusBar({ health, connected, onTabChange, onAbout }: Props) {
  const { config, setConfig } = useAppConfig();
  const [agentName, setAgentName]           = useState<string | null>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [agents, setAgents]                 = useState<{ id: string; name: string }[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [models, setModels]                 = useState<ModelInfo[]>([]);

  // Resolve active agent name
  useEffect(() => {
    if (!config.selectedAgentId) { setAgentName(null); return; }
    listAgents().then(list => {
      setAgents(list);
      const found = list.find(a => a.id === config.selectedAgentId);
      setAgentName(found?.name ?? null);
    }).catch(() => {});
  }, [config.selectedAgentId]);

  const guardMode = health?.guard.defaultAction ?? 'allow';
  const noModel = health ? health.models.providerCount === 0 : false;

  const openModelPicker = () => {
    setShowAgentPicker(false);
    setShowModelPicker(s => !s);
    if (!models.length) listModels().then(setModels).catch(() => {});
  };

  return (
    <div className="relative flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-xs select-none">
      {/* Brand */}
      <img src="/logo.png" alt="Krythor" className="h-7 w-7 shrink-0 object-contain" />
      <span className="text-zinc-200 font-semibold tracking-widest shrink-0">KRYTHOR</span>
      <span className="text-zinc-800">|</span>

      {/* Connection */}
      <span className={`flex items-center gap-1.5 shrink-0 ${connected ? 'text-emerald-400' : 'text-red-400'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
        {connected ? 'live' : 'offline'}
      </span>

      <span className="text-zinc-800">|</span>

      {/* Active agent selector */}
      <div className="relative">
        <button
          onClick={() => { setShowModelPicker(false); setShowAgentPicker(s => !s); if (!agents.length) listAgents().then(setAgents).catch(() => {}); }}
          className={`flex items-center gap-1 hover:text-zinc-200 transition-colors focus:outline-none focus:ring-1 focus:ring-brand-600/50 rounded ${agentName ? 'text-brand-400' : 'text-zinc-600'}`}
        >
          <span>agent:</span>
          <span className="font-medium">{agentName ?? 'none'}</span>
          <span className="text-zinc-700">▾</span>
        </button>
        {showAgentPicker && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded shadow-xl min-w-36">
            <div className="px-2 py-1 text-zinc-600 border-b border-zinc-800 text-xs">Select agent</div>
            {agents.length === 0 && (
              <button
                onClick={() => { setShowAgentPicker(false); onTabChange('agents'); }}
                className="w-full text-left px-3 py-2 text-zinc-500 hover:bg-zinc-800 text-xs transition-colors"
              >No agents — create one →</button>
            )}
            {agents.map(a => (
              <button
                key={a.id}
                onClick={() => { setConfig({ selectedAgentId: a.id }); setShowAgentPicker(false); }}
                className={`w-full text-left px-3 py-2 hover:bg-zinc-800 text-xs transition-colors ${config.selectedAgentId === a.id ? 'text-brand-400' : 'text-zinc-300'}`}
              >
                {a.name}
                {config.selectedAgentId === a.id && <span className="ml-1 text-brand-500">✓</span>}
              </button>
            ))}
            <button
              onClick={() => { setConfig({ selectedAgentId: undefined }); setShowAgentPicker(false); }}
              className="w-full text-left px-3 py-2 text-zinc-600 hover:bg-zinc-800 text-xs border-t border-zinc-800 transition-colors"
            >Clear selection</button>
          </div>
        )}
      </div>

      <span className="text-zinc-800">|</span>

      {/* Model picker */}
      <div className="relative">
        <button
          onClick={openModelPicker}
          className={`flex items-center gap-1 hover:text-zinc-200 transition-colors focus:outline-none focus:ring-1 focus:ring-brand-600/50 rounded ${noModel ? 'text-red-400' : config.selectedModel ? 'text-brand-400' : 'text-zinc-400'}`}
        >
          <span>model:</span>
          <span className={`font-medium ${noModel ? 'text-red-400' : ''}`}>
            {noModel ? 'none ⚠' : (config.selectedModel ?? (health?.models.hasDefault ? 'default' : 'none'))}
          </span>
          <span className="text-zinc-700">▾</span>
        </button>
        {showModelPicker && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded shadow-xl min-w-48">
            <div className="px-2 py-1 text-zinc-600 border-b border-zinc-800 text-xs">Select model</div>
            {noModel && (
              <button
                onClick={() => { setShowModelPicker(false); onTabChange('models'); }}
                className="w-full text-left px-3 py-2 text-zinc-500 hover:bg-zinc-800 text-xs transition-colors"
              >No providers — add one →</button>
            )}
            {models.length === 0 && !noModel && (
              <div className="px-3 py-2 text-zinc-600 text-xs">No models found — try refreshing providers.</div>
            )}
            {/* Default option */}
            {!noModel && (
              <button
                onClick={() => { setConfig({ selectedModel: undefined }); setShowModelPicker(false); }}
                className={`w-full text-left px-3 py-2 hover:bg-zinc-800 text-xs transition-colors ${!config.selectedModel ? 'text-brand-400' : 'text-zinc-400'}`}
              >
                default
                {!config.selectedModel && <span className="ml-1 text-brand-500">✓</span>}
              </button>
            )}
            {models.map(m => (
              <button
                key={m.id}
                onClick={() => { setConfig({ selectedModel: m.id }); setShowModelPicker(false); }}
                className={`w-full text-left px-3 py-2 hover:bg-zinc-800 text-xs flex items-center gap-2 transition-colors ${config.selectedModel === m.id ? 'text-brand-400' : 'text-zinc-300'}`}
              >
                <span className="flex-1 truncate">{m.id}</span>
                {m.badges.includes('local') && (
                  <span className="text-emerald-700 shrink-0 text-xs">local</span>
                )}
                {m.badges.includes('remote') && (
                  <span className="text-blue-700 shrink-0 text-xs">remote</span>
                )}
                {config.selectedModel === m.id && <span className="text-brand-500 shrink-0">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <span className="text-zinc-800">|</span>

      {/* Guard mode */}
      <button
        onClick={() => onTabChange('guard')}
        className="flex items-center gap-1 hover:opacity-80 transition-opacity"
      >
        <span className="text-zinc-500">guard:</span>
        <span className={`font-medium px-1.5 py-0.5 rounded text-xs ${guardMode === 'allow' ? 'bg-emerald-900/60 text-emerald-400' : 'bg-red-900/60 text-red-400'}`}>
          {guardMode.toUpperCase()}
        </span>
      </button>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {health && (
          <span className="text-zinc-500">v{health.version}</span>
        )}
        <button
          onClick={onAbout}
          title="About Krythor (Ctrl+/)"
          className="w-5 h-5 rounded-full border border-zinc-600 flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors focus:outline-none focus:ring-1 focus:ring-brand-600/50 text-xs leading-none"
        >
          ?
        </button>
      </div>

      {/* Click-away overlays */}
      {showAgentPicker && (
        <div className="fixed inset-0 z-40" onClick={() => setShowAgentPicker(false)} />
      )}
      {showModelPicker && (
        <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />
      )}
    </div>
  );
}
