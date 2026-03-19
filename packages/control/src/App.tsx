import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { health, getAppConfig, patchAppConfig, getGatewayToken, type Health, type AppConfig } from './api.ts';
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
import { WorkflowPanel } from './components/WorkflowPanel.tsx';
import { OnboardingWizard } from './components/OnboardingWizard.tsx';
import { DegradedBanner } from './components/DegradedBanner.tsx';

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
type Tab = 'command' | 'agents' | 'skills' | 'memory' | 'models' | 'guard' | 'events' | 'mission' | 'workflow';

const TABS: { id: Tab; label: string }[] = [
  { id: 'command',  label: 'Command'         },
  { id: 'agents',   label: 'Agents'          },
  { id: 'skills',   label: 'Skills'          },
  { id: 'memory',   label: 'Memory'          },
  { id: 'models',   label: 'Models'          },
  { id: 'guard',    label: 'Guard'           },
  { id: 'events',   label: 'Events'          },
  { id: 'mission',  label: 'Mission Control' },
  { id: 'workflow', label: 'Workflow'        },
];

// ── About Dialog ──────────────────────────────────────────────────────────

interface AboutDialogProps {
  health: Health | null;
  onClose: () => void;
}

function AboutDialog({ health, onClose }: AboutDialogProps) {
  const [tokenCopied, setTokenCopied] = useState(false);

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

// ── Main inner component ───────────────────────────────────────────────────

function AppInner({ onTokenReady }: { onTokenReady: (token: string) => void }) {
  const [tab, setTab]               = useState<Tab>('command');
  const [healthData, setHealthData] = useState<Health | null>(null);
  const [appConfig, setAppConfigState] = useState<AppConfig>({});
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showAbout, setShowAbout]   = useState(false);
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
      if (!cfg.onboardingComplete) setShowOnboarding(true);
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
  }, [refreshHealth]);

  // ── Global keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const tabOrder: Tab[] = ['command', 'agents', 'skills', 'memory', 'models', 'guard', 'events', 'mission', 'workflow'];

    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea (except for modal-close)
      const target = e.target as HTMLElement;
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Escape — close modals
      if (e.key === 'Escape') {
        if (showAbout) { setShowAbout(false); return; }
        if (showOnboarding) return; // let OnboardingWizard handle it
        return;
      }

      if (inInput) return;

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
  }, [showAbout, showOnboarding]);

  return (
    <AppConfigContext.Provider value={{ config: appConfig, setConfig }}>
      <div className="flex flex-col h-screen overflow-hidden">
        {showOnboarding && <OnboardingWizard onComplete={handleOnboardingComplete} />}
        {showAbout && <AboutDialog health={healthData} onClose={() => setShowAbout(false)} />}

        <StatusBar
          health={healthData}
          connected={connected}
          onTabChange={setTab}
          onAbout={() => setShowAbout(s => !s)}
        />
        <DegradedBanner />

        {/* Tab bar */}
        <div className="flex border-b border-zinc-800 bg-zinc-950">
          {TABS.map(t => {
            const isMC = t.id === 'mission' || t.id === 'workflow';
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-xs font-medium transition-colors relative
                  ${isActive
                    ? isMC
                      ? 'text-gold-400 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-gold-500'
                      : 'text-zinc-100 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-brand-500'
                    : isMC
                      ? 'text-gold-600 hover:text-gold-400'
                      : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {t.label}
                {t.id === 'events' && events.length > 0 && (
                  <span className="ml-1.5 bg-brand-600 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                    {events.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

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
          <div className={`h-full ${tab === 'events'   ? 'block' : 'hidden'}`}>
            <EventStream events={events} onClear={clearEvents} />
          </div>
          <div className={`h-full ${tab === 'mission'  ? 'block' : 'hidden'}`}><MissionControlPanel /></div>
          <div className={`h-full ${tab === 'workflow' ? 'block' : 'hidden'}`}><WorkflowPanel /></div>
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
