import { useState, useEffect, createContext, useContext, useCallback, useRef, useMemo } from 'react';
import { health, getAppConfig, patchAppConfig, getGatewayToken, getGatewayInfo, type Health, type AppConfig, type GatewayInfo } from './api.ts';
import { GatewayProvider, useGatewayContext } from './GatewayContext.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { CommandPanel } from './components/CommandPanel.tsx';
import { MemoryPanel } from './components/MemoryPanel.tsx';
import { AgentsPanel } from './components/AgentsPanel.tsx';
import { ModelsPanel } from './components/ModelsPanel.tsx';
import { GuardPanel } from './components/GuardPanel.tsx';
import { SkillsPanel } from './components/SkillsPanel.tsx';
import { EventStream } from './components/EventStream.tsx';
import { MissionControlPanel } from './components/MissionControlPanel.tsx';
import { CommandCenterPanel } from './components/command-center';
import { WorkflowPanel } from './components/WorkflowPanel.tsx';
import { DashboardPanel } from './components/DashboardPanel.tsx';
import { OnboardingWizard } from './components/OnboardingWizard.tsx';
import { DegradedBanner } from './components/DegradedBanner.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { WalkthroughTour, shouldShowTour } from './components/WalkthroughTour.tsx';
import { LogsPanel } from './components/LogsPanel.tsx';
import { ConfigEditorPanel } from './components/ConfigEditorPanel.tsx';
import { CustomToolsPanel } from './components/CustomToolsPanel.tsx';
import { ChannelsPanel } from './components/ChannelsPanel.tsx';
import { ChatChannelsPanel } from './components/ChatChannelsPanel.tsx';
import { FileBrowserPanel } from './components/FileBrowserPanel.tsx';

// ── App Config Context ─────────────────────────────────────────────────────
interface AppConfigCtx {
  config: AppConfig;
  setConfig: (patch: Partial<AppConfig>) => Promise<void>;
}
export const AppConfigContext = createContext<AppConfigCtx>({
  config: {},
  setConfig: async () => {},
});
export const useAppConfig = () => useContext(AppConfigContext);

// ── Tabs ──────────────────────────────────────────────────────────────────
type Tab = 'command' | 'agents' | 'skills' | 'memory' | 'models' | 'guard' | 'events' | 'mission' | 'command-center' | 'workflow' | 'dashboard' | 'settings' | 'logs' | 'config-editor' | 'custom-tools' | 'channels' | 'chat-channels' | 'file-browser';

// Primary tabs — always visible
const PRIMARY_TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'command',        label: 'Chat',           hint: 'Send messages to your AI agents' },
  { id: 'agents',         label: 'Agents',         hint: 'Create and manage AI agents' },
  { id: 'memory',         label: 'Memory',         hint: 'View and search persistent memory' },
  { id: 'models',         label: 'Models',         hint: 'Connect AI providers' },
  { id: 'command-center', label: 'Command Center', hint: 'Live animated agent operations view' },
  { id: 'dashboard',      label: 'Dashboard',      hint: 'System stats and health' },
  { id: 'settings',       label: 'Settings',       hint: 'Configuration and info' },
];

// Advanced tabs — shown in overflow menu
const ADVANCED_TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'skills',        label: 'Skills',          hint: 'Reusable task templates' },
  { id: 'guard',         label: 'Guard',           hint: 'Safety rules and policy engine' },
  { id: 'logs',          label: 'Logs',            hint: 'Live gateway log stream' },
  { id: 'config-editor', label: 'Config Editor',   hint: 'Edit agents.json, providers.json, guard.json' },
  { id: 'events',        label: 'Events',          hint: 'Real-time event stream' },
  { id: 'mission',       label: 'Mission Control', hint: 'Agent orchestration workspace' },
  { id: 'workflow',      label: 'Workflow',        hint: 'Workflow management' },
  { id: 'custom-tools', label: 'Custom Tools',    hint: 'Register webhook-backed tools for agents' },
  { id: 'channels',      label: 'Channels',       hint: 'Outbound webhooks that fire on Krythor events' },
  { id: 'chat-channels', label: 'Chat Channels',  hint: 'Inbound Telegram, Discord, WhatsApp bot channels' },
  { id: 'file-browser',  label: 'File Browser',   hint: 'Browse and edit files on the gateway host' },
];

const ALL_TABS = [...PRIMARY_TABS, ...ADVANCED_TABS];

// ── About Dialog ──────────────────────────────────────────────────────────

interface AboutDialogProps {
  health: Health | null;
  onClose: () => void;
}

function AboutDialog({ health, onClose }: AboutDialogProps) {
  const [tokenCopied, setTokenCopied] = useState(false);
  const [gatewayInfo, setGatewayInfo] = useState<GatewayInfo | null>(null);

  useEffect(() => {
    getGatewayInfo().then(setGatewayInfo).catch(() => {});
  }, []);

  const copyToken = () => {
    const token = getGatewayToken();
    if (!token) return;
    navigator.clipboard.writeText(token).then(() => {
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    }).catch(() => {});
  };

  // Close on backdrop click
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-[480px] max-w-[95vw] overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-zinc-800">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <img src="/logo.png" alt="Krythor" className="h-14 w-14 object-contain drop-shadow-lg shrink-0" />
              <div>
                <h2 className="text-2xl font-bold tracking-widest text-zinc-100 font-mono">KRYTHOR</h2>
                <p className="text-zinc-500 text-sm mt-1">Local-first AI command platform</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-zinc-600 hover:text-zinc-300 text-lg leading-none p-1 -mt-1 -mr-1 transition-colors"
              title="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 text-sm">
          {/* Version info */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-zinc-600 w-28 shrink-0">Version</span>
              <span className="text-zinc-300 font-mono">{health?.version ?? '0.1.0'}</span>
            </div>
            {health?.nodeVersion && (
              <div className="flex items-center gap-2">
                <span className="text-zinc-600 w-28 shrink-0">Node.js</span>
                <span className="text-zinc-300 font-mono">{health.nodeVersion}</span>
              </div>
            )}
            {gatewayInfo && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-600 w-28 shrink-0">Platform</span>
                  <span className="text-zinc-300 font-mono">{gatewayInfo.platform} / {gatewayInfo.arch}</span>
                </div>
                {gatewayInfo.capabilities.length > 0 && (
                  <div className="flex items-start gap-2">
                    <span className="text-zinc-600 w-28 shrink-0 mt-0.5">Capabilities</span>
                    <div className="flex flex-wrap gap-1">
                      {gatewayInfo.capabilities.map(cap => (
                        <span key={cap} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">{cap}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Heartbeat last-run summary */}
          {health?.heartbeat && (
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-wider font-medium mb-2">System Health</p>
              <div className="bg-zinc-950 rounded-lg px-3 py-2.5 text-xs space-y-1.5">
                {health.heartbeat.lastRun ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-600 w-28 shrink-0">Last check</span>
                      <span className="text-zinc-400 font-mono">
                        {new Date(health.heartbeat.lastRun.completedAt ?? health.heartbeat.lastRun.startedAt).toLocaleTimeString()}
                        {health.heartbeat.lastRun.durationMs !== undefined && (
                          <span className="text-zinc-700 ml-1">({health.heartbeat.lastRun.durationMs}ms)</span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-zinc-600 w-28 shrink-0">Checks ran</span>
                      <span className="text-zinc-400 font-mono">{health.heartbeat.lastRun.checksRan.length}</span>
                    </div>
                    {health.heartbeat.lastRun.timedOut && (
                      <div className="text-amber-500">⚠ Last run timed out</div>
                    )}
                    {health.heartbeat.lastRun.error && (
                      <div className="text-red-400">✗ {health.heartbeat.lastRun.error}</div>
                    )}
                    {health.heartbeat.warnings.length > 0 ? (
                      <div className="space-y-1 pt-1 border-t border-zinc-800">
                        {health.heartbeat.warnings.map((w, i) => (
                          <div key={i} className="flex gap-2">
                            <span className="text-amber-400 shrink-0">[{w.checkId}]</span>
                            <span className="text-zinc-400">{w.message}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-emerald-600">✓ No warnings</div>
                    )}
                  </>
                ) : (
                  <span className="text-zinc-600">No heartbeat run yet — checks begin after 60s startup delay.</span>
                )}
              </div>
            </div>
          )}

          {/* Keyboard shortcuts */}
          <div>
            <p className="text-zinc-500 text-xs uppercase tracking-wider font-medium mb-2">Keyboard Shortcuts</p>
            <div className="bg-zinc-950 rounded-lg px-3 py-2.5 space-y-1.5 font-mono text-xs">
              {[
                ['Ctrl+N',       'New conversation'],
                ['Ctrl+1 – 9',  'Switch tabs'],
                ['Ctrl+/',       'Show this dialog'],
                ['Escape',       'Close dialog'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="text-brand-400 w-24 shrink-0">{key}</span>
                  <span className="text-zinc-400">{desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* API token — for curl/scripting use */}
          {getGatewayToken() && (
            <div>
              <p className="text-zinc-500 text-xs uppercase tracking-wider font-medium mb-2">API Access</p>
              <div className="bg-zinc-950 rounded-lg px-3 py-2.5 flex items-center justify-between gap-2">
                <span className="text-zinc-600 font-mono text-xs truncate flex-1">
                  Bearer ••••••••••••••••
                </span>
                <button
                  onClick={copyToken}
                  className="shrink-0 text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
                  title="Copy auth token for use with curl or scripts"
                >
                  {tokenCopied ? 'copied!' : 'copy token'}
                </button>
              </div>
              <p className="text-zinc-700 text-xs mt-1">
                Use as <span className="font-mono text-zinc-600">Authorization: Bearer &lt;token&gt;</span> when calling the API directly.
              </p>
            </div>
          )}

          {/* Description */}
          <p className="text-zinc-600 text-xs leading-relaxed">
            Krythor runs entirely on your computer. No telemetry, no cloud storage, no accounts required.
            All data is stored locally in{' '}
            <span className="text-zinc-500 font-mono">%LOCALAPPDATA%\Krythor\</span> (Windows) or{' '}
            <span className="text-zinc-500 font-mono">~/.local/share/krythor/</span> (Linux/Mac).
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-zinc-950/50 border-t border-zinc-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab Bar ───────────────────────────────────────────────────────────────

const TAB_PINNED_KEY  = 'krythor_tab_pinned_v2';
const TAB_ORDER_KEY   = 'krythor_tab_order_v2';

// Default pinned tab ids (shown in bar on first run)
const DEFAULT_PINNED: Tab[] = ['command', 'agents', 'memory', 'models', 'command-center', 'dashboard', 'settings'];

function loadPinned(): Tab[] {
  try {
    const stored = localStorage.getItem(TAB_PINNED_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Tab[];
      const allIds = ALL_TABS.map(t => t.id);
      const valid = parsed.filter(id => allIds.includes(id));
      if (valid.length > 0) return valid;
    }
  } catch { /* ignore */ }
  return DEFAULT_PINNED;
}

function savePinned(pinned: Tab[]) {
  try { localStorage.setItem(TAB_PINNED_KEY, JSON.stringify(pinned)); } catch { /* ignore */ }
}

function loadTabOrder(pinned: Tab[]): Tab[] {
  try {
    const stored = localStorage.getItem(TAB_ORDER_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Tab[];
      const allIds = ALL_TABS.map(t => t.id);
      // Only keep ids that are both in pinned AND valid tab ids
      const filtered = parsed.filter(id => pinned.includes(id) && allIds.includes(id));
      // Append any pinned ids not in stored order
      const missing = pinned.filter(id => !filtered.includes(id));
      return [...filtered, ...missing];
    }
  } catch { /* ignore */ }
  return pinned;
}

function saveTabOrder(order: Tab[]) {
  try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(order)); } catch { /* ignore */ }
}

function TabBar({ tab, setTab, eventCount }: { tab: Tab; setTab: (t: Tab) => void; eventCount: number }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [pinned, setPinned]         = useState<Tab[]>(loadPinned);
  const [tabOrder, setTabOrder]     = useState<Tab[]>(() => { const p = loadPinned(); return loadTabOrder(p); });
  const [dragOver, setDragOver]     = useState<Tab | null>(null);
  const dragSrc = useRef<Tab | null>(null);

  // Sync tabOrder whenever pinned changes
  const syncOrder = useCallback((nextPinned: Tab[]) => {
    // Keep existing order for tabs that remain, append new ones at end
    const existing = tabOrder.filter(id => nextPinned.includes(id));
    const added    = nextPinned.filter(id => !existing.includes(id));
    return [...existing, ...added];
  }, [tabOrder]);

  const pinTab = useCallback((id: Tab) => {
    const nextPinned = [...pinned, id];
    const nextOrder  = syncOrder(nextPinned);
    setPinned(nextPinned);
    setTabOrder(nextOrder);
    savePinned(nextPinned);
    saveTabOrder(nextOrder);
    setTab(id);
    setCustomOpen(false);
  }, [pinned, syncOrder, setTab]);

  const unpinTab = useCallback((id: Tab, e: React.MouseEvent) => {
    e.stopPropagation();
    if (pinned.length <= 1) return; // always keep at least one
    const nextPinned = pinned.filter(p => p !== id);
    const nextOrder  = tabOrder.filter(o => o !== id);
    setPinned(nextPinned);
    setTabOrder(nextOrder);
    savePinned(nextPinned);
    saveTabOrder(nextOrder);
    // If we removed the active tab, switch to first pinned
    if (tab === id) setTab(nextPinned[0]);
  }, [pinned, tabOrder, tab, setTab]);

  // Tabs currently shown in bar (ordered)
  const pinnedTabs = useMemo(() =>
    tabOrder.map(id => ALL_TABS.find(t => t.id === id)!).filter(Boolean),
    [tabOrder]
  );

  // ── Drag to reorder ──────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, id: Tab) => {
    dragSrc.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent, id: Tab) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragSrc.current && dragSrc.current !== id) setDragOver(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: Tab) => {
    e.preventDefault();
    const srcId = dragSrc.current;
    if (!srcId || srcId === targetId) return;
    const next = [...tabOrder];
    const fromIdx = next.indexOf(srcId);
    const toIdx   = next.indexOf(targetId);
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, srcId);
    setTabOrder(next);
    saveTabOrder(next);
    setDragOver(null);
    dragSrc.current = null;
  };

  const handleDragEnd = () => { setDragOver(null); dragSrc.current = null; };

  return (
    <div className="flex items-stretch border-b border-zinc-800 bg-zinc-950 select-none">
      {/* Scrollable pinned tabs — overflow clipped here, dropdown lives outside */}
      <div className="flex items-stretch overflow-x-auto flex-1 min-w-0">
      {pinnedTabs.map(t => {
        const isActive      = tab === t.id;
        const isCC          = t.id === 'command-center';
        const isDragTarget  = dragOver === t.id;
        return (
          <button
            key={t.id}
            draggable
            onDragStart={e => handleDragStart(e, t.id)}
            onDragOver={e => handleDragOver(e, t.id)}
            onDrop={e => handleDrop(e, t.id)}
            onDragEnd={handleDragEnd}
            onClick={() => setTab(t.id)}
            title={`${t.hint}\n(drag to reorder)`}
            className={`group px-3 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap cursor-grab active:cursor-grabbing flex items-center gap-1
              ${isDragTarget ? 'bg-zinc-800/60' : ''}
              ${isActive
                ? isCC
                  ? 'text-gold-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-gold-500'
                  : 'text-zinc-100 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-500'
                : isCC
                  ? 'text-gold-600 hover:text-gold-400'
                  : 'text-zinc-500 hover:text-zinc-300'}`}
          >
            <span className="text-[8px] leading-none opacity-0 group-hover:opacity-40 transition-opacity flex-shrink-0 select-none" aria-hidden>⠿</span>
            {t.label}
            {t.id === 'events' && eventCount > 0 && (
              <span className="bg-brand-600 text-white text-[10px] rounded-full px-1.5 py-px leading-none">{eventCount}</span>
            )}
            {isDragTarget && <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-brand-500 rounded-full" />}
            {/* Unpin ✕ — only shown on hover, not on last tab */}
            {pinned.length > 1 && (
              <span
                onClick={e => unpinTab(t.id, e)}
                title="Remove from bar"
                className="ml-0.5 text-[10px] leading-none opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity cursor-pointer select-none"
                aria-label="Remove tab"
              >✕</span>
            )}
          </button>
        );
      })}

      </div>{/* end scrollable tabs */}

      {/* Divider */}
      <div className="w-px bg-zinc-800 my-2 mx-1 flex-shrink-0" />

      {/* Customize / add tabs — outside scroll container so dropdown isn't clipped */}
      <div className="relative flex items-stretch flex-shrink-0">
        <button
          onClick={() => setCustomOpen(o => !o)}
          title="Add or remove tabs"
          className={`px-3 py-2.5 text-sm font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap
            ${customOpen ? 'text-zinc-300' : 'text-zinc-600 hover:text-zinc-400'}`}
        >
          <span className="text-base leading-none">＋</span>
          <span className="text-xs">Tabs</span>
          <span className={`text-[10px] transition-transform ${customOpen ? 'rotate-180' : ''}`}>▾</span>
        </button>

        {customOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setCustomOpen(false)} />
            <div className="absolute top-full right-0 z-50 mt-0 w-72 bg-zinc-900 border border-zinc-700 rounded-b-xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="px-4 py-2.5 border-b border-zinc-800">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Customize Tabs</span>
                <p className="text-[10px] text-zinc-600 mt-0.5">Toggle which tabs appear in the bar</p>
              </div>

              <div className="max-h-96 overflow-y-auto py-1">
                {ALL_TABS.map(t => {
                  const isPinned = pinned.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      onClick={() => isPinned ? (() => { if (pinned.length > 1) { const np = pinned.filter(p => p !== t.id); const no = tabOrder.filter(o => o !== t.id); setPinned(np); setTabOrder(no); savePinned(np); saveTabOrder(no); if (tab === t.id) setTab(np[0]); } })() : pinTab(t.id)}
                      className={`w-full text-left px-4 py-2.5 transition-colors flex items-center gap-3 hover:bg-zinc-800/60 group ${isPinned ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
                    >
                      {/* Toggle indicator */}
                      <span className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center text-[10px] border transition-colors
                        ${isPinned
                          ? 'bg-brand-600 border-brand-500 text-white'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-600 group-hover:border-zinc-500'}`}>
                        {isPinned ? '✓' : ''}
                      </span>
                      <span className="flex flex-col gap-0.5 min-w-0">
                        <span className={`text-sm font-medium ${isPinned ? 'text-zinc-100' : 'text-zinc-400 group-hover:text-zinc-200'}`}>{t.label}</span>
                        <span className="text-[11px] text-zinc-600 truncate">{t.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Footer hint */}
              <div className="px-4 py-2 border-t border-zinc-800 text-[10px] text-zinc-700">
                Checked = visible in bar · drag tabs to reorder
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main inner component ───────────────────────────────────────────────────

// ── Command Palette ─────────────────────────────────────────────────────────

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
  action: () => void;
}

interface CommandPaletteProps {
  onClose: () => void;
  actions: PaletteAction[];
}

function CommandPalette({ onClose, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = query.trim()
    ? actions.filter(a =>
        a.label.toLowerCase().includes(query.toLowerCase()) ||
        (a.hint ?? '').toLowerCase().includes(query.toLowerCase())
      )
    : actions;

  useEffect(() => { setIdx(0); }, [query]);

  const run = (a: PaletteAction) => {
    a.action();
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); if (filtered[idx]) run(filtered[idx]!); }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <span className="text-zinc-500 shrink-0">⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type to search actions…"
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none"
          />
          <kbd className="text-zinc-700 text-[10px] border border-zinc-800 rounded px-1">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-3 text-xs text-zinc-600">No actions match "{query}"</div>
          )}
          {filtered.map((a, i) => (
            <button
              key={a.id}
              onClick={() => run(a)}
              onMouseEnter={() => setIdx(i)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                i === idx ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-800/50'
              }`}
            >
              {a.icon && <span className="text-zinc-500 shrink-0 text-sm">{a.icon}</span>}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{a.label}</p>
                {a.hint && <p className="text-[10px] text-zinc-600 truncate">{a.hint}</p>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main inner component ───────────────────────────────────────────────────

function AppInner({ onTokenReady }: { onTokenReady: (token: string) => void }) {
  const [tab, setTab]               = useState<Tab>('command');
  const [healthData, setHealthData] = useState<Health | null>(null);
  const [appConfig, setAppConfigState] = useState<AppConfig>({});
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showTour, setShowTour]     = useState(false);
  const [showAbout, setShowAbout]   = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const { connected, events, clearEvents } = useGatewayContext();

  // Ref to trigger "new chat" from CommandPanel via global shortcut
  const newChatRef = useRef<(() => void) | null>(null);

  const refreshHealth = useCallback(() => {
    health().then(data => {
      setHealthData(data);
    }).catch(() => {});
  }, []);

  // Notify GatewayProvider of the token once on mount so WS can connect.
  // The token is injected into index.html by the gateway at serve time and
  // read from window.__KRYTHOR_TOKEN__ (or localStorage fallback) by api.ts.
  useEffect(() => {
    const token = getGatewayToken();
    if (token) onTokenReady(token);
  }, [onTokenReady]);

  useEffect(() => {
    refreshHealth();
    const id = setInterval(refreshHealth, 10_000);
    return () => clearInterval(id);
  }, [refreshHealth]);

  useEffect(() => {
    getAppConfig().then(cfg => {
      setAppConfigState(cfg);
      if (!cfg.onboardingComplete) {
        setShowOnboarding(true);
      } else if (shouldShowTour()) {
        setShowTour(true);
      }
    }).catch(() => {});
  }, []);

  const setConfig = useCallback(async (patch: Partial<AppConfig>) => {
    const updated = await patchAppConfig(patch);
    setAppConfigState(updated);
  }, []);

  // handleOnboardingComplete is passed as `onComplete` to OnboardingWizard.
  // Both "Add provider" and "Skip" paths in OnboardingWizard call onComplete(),
  // which triggers refreshHealth() here — so the status bar updates immediately
  // rather than waiting for the 10-second polling interval.
  const handleOnboardingComplete = useCallback(() => {
    setShowOnboarding(false);
    refreshHealth(); // intentional: ensures status bar reflects new provider immediately
    getAppConfig().then(setAppConfigState).catch(() => {});
    // Show tour after onboarding if not yet seen
    if (shouldShowTour()) setShowTour(true);
  }, [refreshHealth]);

  // ── Global keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const tabOrder: Tab[] = ALL_TABS.map(t => t.id);

    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea (except for modal-close)
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Escape — close modals
      if (e.key === 'Escape') {
        if (showPalette) { setShowPalette(false); return; }
        if (showAbout) { setShowAbout(false); return; }
        if (showOnboarding) return; // let OnboardingWizard handle it
        return;
      }

      if (inInput) return;

      // Ctrl+K — command palette
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        setShowPalette(s => !s);
        return;
      }

      // Ctrl+/ — open About
      if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        setShowAbout(s => !s);
        return;
      }

      // Ctrl+N — new chat
      if (e.ctrlKey && e.key === 'n') {
        e.preventDefault();
        setTab('command');
        // Slight delay so the command tab mounts/shows before calling handleNew
        setTimeout(() => { newChatRef.current?.(); }, 20);
        return;
      }

      // Ctrl+1 through Ctrl+9 — switch tabs
      if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key, 10) - 1;
        if (tabOrder[idx]) setTab(tabOrder[idx]!);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showAbout, showOnboarding, showPalette]);

  const paletteActions = useMemo<PaletteAction[]>(() => [
    // Navigation — all tabs
    ...ALL_TABS.map(t => ({
      id: `tab:${t.id}`,
      label: t.label,
      hint: t.hint,
      icon: '→',
      action: () => setTab(t.id),
    })),
    // Common actions
    {
      id: 'action:new-chat',
      label: 'New Chat',
      hint: 'Start a fresh conversation',
      icon: '+',
      action: () => {
        setTab('command');
        setTimeout(() => { newChatRef.current?.(); }, 20);
      },
    },
    {
      id: 'action:about',
      label: 'About Krythor',
      hint: 'Version info and gateway details',
      icon: '?',
      action: () => setShowAbout(true),
    },
  ], []);

  return (
    <AppConfigContext.Provider value={{ config: appConfig, setConfig }}>
      <div className="flex flex-col h-screen overflow-hidden">
        {showOnboarding && <OnboardingWizard onComplete={handleOnboardingComplete} />}
        {showTour && !showOnboarding && <WalkthroughTour onClose={() => setShowTour(false)} />}
        {showAbout && <AboutDialog health={healthData} onClose={() => setShowAbout(false)} />}
        {showPalette && <CommandPalette onClose={() => setShowPalette(false)} actions={paletteActions} />}

        <StatusBar
          health={healthData}
          connected={connected}
          onTabChange={setTab}
          onAbout={() => setShowAbout(s => !s)}
        />
        <DegradedBanner />

        {/* Tab bar */}
        <TabBar
          tab={tab}
          setTab={setTab}
          eventCount={events.length}
        />

        {/* Panel area */}
        <div className="flex-1 overflow-hidden">
          <div className={`h-full ${tab === 'command' ? 'block' : 'hidden'}`}>
            <CommandPanel health={healthData} onTabChange={setTab} newChatRef={newChatRef} />
          </div>
          <div className={`h-full ${tab === 'agents'  ? 'block' : 'hidden'}`}><AgentsPanel /></div>
          <div className={`h-full ${tab === 'skills'  ? 'block' : 'hidden'}`}><SkillsPanel /></div>
          <div className={`h-full ${tab === 'memory'  ? 'block' : 'hidden'}`}><MemoryPanel health={healthData} /></div>
          <div className={`h-full ${tab === 'models'  ? 'block' : 'hidden'}`}><ModelsPanel health={healthData} /></div>
          <div className={`h-full ${tab === 'guard'   ? 'block' : 'hidden'}`}><GuardPanel /></div>
          <div className={`h-full ${tab === 'logs'     ? 'block' : 'hidden'}`}><LogsPanel /></div>
          <div className={`h-full ${tab === 'events'   ? 'block' : 'hidden'}`}>
            <EventStream events={events} onClear={clearEvents} />
          </div>
          <div className={`h-full ${tab === 'mission'   ? 'block' : 'hidden'}`}><MissionControlPanel /></div>
          <div className={`h-full ${tab === 'command-center' ? 'block' : 'hidden'}`}>
            <CommandCenterPanel />
          </div>
          <div className={`h-full ${tab === 'workflow'  ? 'block' : 'hidden'}`}><WorkflowPanel /></div>
          <div className={`h-full ${tab === 'dashboard' ? 'block' : 'hidden'}`}><DashboardPanel /></div>
          <div className={`h-full ${tab === 'settings'     ? 'block' : 'hidden'}`}><SettingsPanel /></div>
          <div className={`h-full ${tab === 'config-editor' ? 'block' : 'hidden'}`}><ConfigEditorPanel /></div>
          <div className={`h-full ${tab === 'custom-tools' ? 'block' : 'hidden'}`}><CustomToolsPanel /></div>
          <div className={`h-full ${tab === 'channels'      ? 'block' : 'hidden'}`}><ChannelsPanel /></div>
          <div className={`h-full ${tab === 'chat-channels' ? 'block' : 'hidden'}`}><ChatChannelsPanel /></div>
          <div className={`h-full ${tab === 'file-browser'  ? 'block' : 'hidden'}`}><FileBrowserPanel /></div>
        </div>
      </div>
    </AppConfigContext.Provider>
  );
}

export default function App() {
  // Lift token state here so GatewayProvider can gate WS connection on it.
  const [wsToken, setWsToken] = useState<string | undefined>(undefined);

  return (
    <GatewayProvider token={wsToken}>
      <AppInner onTokenReady={setWsToken} />
    </GatewayProvider>
  );
}
