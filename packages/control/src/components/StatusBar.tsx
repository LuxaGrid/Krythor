import { useState, useEffect, useRef } from 'react';
import { listAgents, listModels, getSafeCoreDashboard, type Health, type ModelInfo, type SafeCoreDashboard } from '../api.ts';
import { useAppConfig } from '../App.tsx';
import { NotificationFeed } from './NotificationFeed.tsx';

type Tab = 'command' | 'agents' | 'memory' | 'models' | 'guard' | 'events';

interface Props {
  health: Health | null;
  connected: boolean;
  onTabChange: (tab: Tab) => void;
  onAbout: () => void;
  onSafeCoreClick?: () => void;
}

export function StatusBar({ health, connected, onTabChange, onAbout, onSafeCoreClick }: Props) {
  const { config, setConfig } = useAppConfig();
  const [agentName, setAgentName]           = useState<string | null>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [agents, setAgents]                 = useState<{ id: string; name: string }[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [models, setModels]                 = useState<ModelInfo[]>([]);
  const [modelQuery, setModelQuery]         = useState('');
  const modelSearchRef                      = useRef<HTMLInputElement>(null);

  // Resolve active agent name
  useEffect(() => {
    if (!config.selectedAgentId) { setAgentName(null); return; }
    listAgents().then(list => {
      setAgents(list);
      const found = list.find(a => a.id === config.selectedAgentId);
      setAgentName(found?.name ?? null);
    }).catch(() => {});
  }, [config.selectedAgentId]);

  const [safecoreDash, setSafecoreDash] = useState<SafeCoreDashboard | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetch = () => getSafeCoreDashboard().then(d => { if (!cancelled) setSafecoreDash(d); }).catch(() => {});
    fetch();
    const id = setInterval(fetch, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const guardMode = health?.guard.defaultAction ?? 'allow';
  const noModel = health ? health.models.providerCount === 0 : false;

  const openModelPicker = () => {
    setShowAgentPicker(false);
    const opening = !showModelPicker;
    setShowModelPicker(opening);
    if (opening) {
      setModelQuery('');
      if (!models.length) listModels().then(setModels).catch(() => {});
      setTimeout(() => modelSearchRef.current?.focus(), 30);
    }
  };

  return (
    <div className="relative flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-xs select-none">
      {/* Brand */}
      <img src="/logo.png" alt="Krythor" className="h-14 w-14 shrink-0 object-contain" />
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
          <div className="absolute top-full left-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded shadow-xl min-w-36 max-h-80 overflow-y-auto">
            <div className="sticky top-0 px-2 py-1 text-zinc-600 border-b border-zinc-800 text-xs bg-zinc-900">Select agent</div>
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
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setShowModelPicker(false); setModelQuery(''); }} />
            <div className="absolute top-full left-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded shadow-xl min-w-[240px] max-h-[340px] flex flex-col">
              {noModel ? (
                <button
                  onClick={() => { setShowModelPicker(false); onTabChange('models'); }}
                  className="w-full text-left px-3 py-2 text-zinc-500 hover:bg-zinc-800 text-xs transition-colors"
                >No providers — add one →</button>
              ) : (
                <>
                  <div className="p-2 border-b border-zinc-800 shrink-0">
                    <input
                      ref={modelSearchRef}
                      type="text"
                      value={modelQuery}
                      onChange={e => setModelQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { setShowModelPicker(false); setModelQuery(''); } }}
                      placeholder="Search models…"
                      className="w-full bg-zinc-800 text-xs text-zinc-200 placeholder-zinc-600 px-2.5 py-1.5 rounded outline-none focus:ring-1 focus:ring-brand-600/40"
                    />
                  </div>
                  <div className="overflow-y-auto">
                    {/* Default option — only show when not searching */}
                    {!modelQuery && (
                      <button
                        onClick={() => { setConfig({ selectedModel: undefined }); setShowModelPicker(false); }}
                        className={`w-full text-left px-3 py-2 hover:bg-zinc-800 text-xs transition-colors ${!config.selectedModel ? 'text-brand-400' : 'text-zinc-400'}`}
                      >
                        default {!config.selectedModel && <span className="text-brand-500">✓</span>}
                      </button>
                    )}
                    {(() => {
                      const q = modelQuery.toLowerCase();
                      const filtered = q
                        ? models.filter(m => m.id.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q))
                        : models;
                      // Group by provider, default provider first, local last
                      const grouped = new Map<string, ModelInfo[]>();
                      for (const m of filtered) {
                        if (!grouped.has(m.provider)) grouped.set(m.provider, []);
                        grouped.get(m.provider)!.push(m);
                      }
                      const providerOrder = (m: ModelInfo) => {
                        if ((m as ModelInfo & { isDefault?: boolean }).isDefault) return 0;
                        if (m.badges.includes('local')) return 2;
                        return 1;
                      };
                      const groups = [...grouped.entries()]
                        .map(([provider, items]) => ({ provider, items }))
                        .sort((a, b) => providerOrder(a.items[0]!) - providerOrder(b.items[0]!));
                      if (groups.length === 0) return (
                        <p className="px-3 py-3 text-xs text-zinc-600 text-center">No models match "{modelQuery}"</p>
                      );
                      return groups.map(({ provider, items }) => (
                        <div key={provider}>
                          <div className="px-3 pt-2 pb-1 text-[10px] text-zinc-600 font-medium uppercase tracking-wider sticky top-0 bg-zinc-900">{provider}</div>
                          {items.map(m => (
                            <button
                              key={`${m.providerId}/${m.id}`}
                              onClick={() => { setConfig({ selectedModel: m.id }); setShowModelPicker(false); setModelQuery(''); }}
                              className={`w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-xs flex items-center gap-2 transition-colors ${config.selectedModel === m.id ? 'text-brand-400' : 'text-zinc-300'}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.badges.includes('local') ? 'bg-emerald-400' : 'bg-sky-400'}`} />
                              <span className="flex-1 truncate font-mono">{m.id}</span>
                              {config.selectedModel === m.id && <span className="text-brand-500 shrink-0">✓</span>}
                            </button>
                          ))}
                        </div>
                      ));
                    })()}
                  </div>
                </>
              )}
            </div>
          </>
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

      {/* SafeCore chip */}
      {(() => {
        const pending  = safecoreDash?.pendingApprovals ?? 0;
        const blocked  = safecoreDash?.blockedActions   ?? 0;
        const dotCls   = pending > 0
          ? 'bg-amber-400 animate-pulse'
          : blocked > 0
            ? 'bg-red-500'
            : 'bg-emerald-500';
        const label    = pending > 0
          ? `SafeCore\u2122 \u00B7 ${pending} pending`
          : blocked > 0
            ? 'SafeCore\u2122 \u00B7 blocked'
            : 'SafeCore\u2122';
        const textCls  = pending > 0 ? 'text-amber-300' : blocked > 0 ? 'text-red-400' : 'text-zinc-400';
        const borderCls = pending > 0 ? 'border-amber-800/60' : blocked > 0 ? 'border-red-800/60' : 'border-zinc-700';
        return (
          <button
            onClick={onSafeCoreClick}
            title="Krythor SafeCore\u2122 \u2014 Every action is evaluated"
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded border ${borderCls} bg-zinc-900 hover:opacity-80 transition-opacity focus:outline-none focus:ring-1 focus:ring-brand-600/50 shrink-0`}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotCls}`} />
            <span className={`text-[10px] font-medium ${textCls}`}>{label}</span>
          </button>
        );
      })()}

      {/* Right side */}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {/* Heartbeat warning indicator — shown only when there are active warnings */}
        {(health?.heartbeat?.warnings?.length ?? 0) > 0 && (
          <button
            onClick={() => onTabChange('events')}
            title={health!.heartbeat!.warnings.map(w => `[${w.checkId}] ${w.message}`).join('\n')}
            className="flex items-center gap-1 text-amber-400 hover:text-amber-300 transition-colors focus:outline-none"
            aria-label={`${health!.heartbeat!.warnings.length} heartbeat warning${health!.heartbeat!.warnings.length > 1 ? 's' : ''}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="text-[10px] font-mono">{health!.heartbeat!.warnings.length}w</span>
          </button>
        )}
        {health && (
          <span className="text-sm font-mono text-zinc-400 font-medium">v{health.version}</span>
        )}
        <kbd className="hidden sm:inline text-[10px] text-zinc-700 border border-zinc-800 rounded px-1.5 py-0.5 font-mono" title="Open command palette (Ctrl+K)">⌘K</kbd>
        <NotificationFeed />
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
