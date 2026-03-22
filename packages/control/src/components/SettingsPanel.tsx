import { useState, useEffect } from 'react';
import { health, getGatewayInfo, getHeartbeatHistory, getDiscordConfig, setDiscordConfig, stopDiscord, listPlugins, exportProviderConfig, importProviderConfig } from '../api.ts';
import type { Health, GatewayInfo, ProviderHealthEntry, DiscordConfig, Plugin } from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

// ── Theme helpers ─────────────────────────────────────────────────────────────

type Theme = 'dark' | 'light';

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem('krythor_theme');
    if (stored === 'light') return 'light';
  } catch { /* private browsing */ }
  return 'dark';
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('light-mode', theme === 'light');
  try { localStorage.setItem('krythor_theme', theme); } catch { /* private browsing */ }
}

// ── Provider health dot display ───────────────────────────────────────────────

function HealthDots({ entries }: { entries: ProviderHealthEntry[] }) {
  const recent = entries.slice(-10);
  return (
    <span className="font-mono text-sm tracking-wider">
      {recent.map((e, i) => (
        <span key={i} title={`${e.timestamp} — ${e.ok ? 'ok' : 'fail'}${e.latencyMs ? ` — ${e.latencyMs}ms` : ''}`}
          className={e.ok ? 'text-green-400' : 'text-red-500'}>●</span>
      ))}
      {recent.length === 0 && <span className="text-zinc-600 text-xs">no data yet</span>}
    </span>
  );
}

// ── Uptime formatter ──────────────────────────────────────────────────────────

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ── Row components ────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-zinc-800 last:border-0">
      <span className="text-zinc-500 text-xs w-36 shrink-0 pt-0.5">{label}</span>
      <span className="text-zinc-200 text-xs font-mono break-all">{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">{title}</h3>
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2">
        {children}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const INPUT_CLS = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-brand-500';

export function SettingsPanel() {
  const [healthData, setHealthData]     = useState<Health | null>(null);
  const [gatewayInfo, setGatewayInfo]   = useState<GatewayInfo | null>(null);
  const [providerHistory, setProviderHistory] = useState<Record<string, ProviderHealthEntry[]>>({});
  const [theme, setTheme]               = useState<Theme>(getStoredTheme());
  const [loading, setLoading]           = useState(true);

  // Plugin state
  const [plugins, setPlugins]           = useState<Plugin[]>([]);

  // Config portability state
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError]   = useState<string | null>(null);

  // Discord state
  const [discord, setDiscord]           = useState<DiscordConfig | null>(null);
  const [discordForm, setDiscordForm]   = useState({ token: '', channelId: '', agentId: '' });
  const [discordSaving, setDiscordSaving] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [discordStatus, setDiscordStatus] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    async function load() {
      try {
        const [h, info, hist, disc, plugs] = await Promise.all([
          health(),
          getGatewayInfo().catch(() => null),
          getHeartbeatHistory().catch(() => ({})),
          getDiscordConfig().catch(() => null),
          listPlugins().catch(() => []),
        ]);
        setHealthData(h);
        setGatewayInfo(info);
        setProviderHistory(hist);
        setPlugins(plugs);
        if (disc) {
          setDiscord(disc);
          setDiscordForm({ token: '', channelId: disc.channelId, agentId: disc.agentId });
        }
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading settings…
      </div>
    );
  }

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  async function handleDiscordSave() {
    setDiscordError(null);
    setDiscordStatus(null);
    if (!discordForm.channelId || !discordForm.agentId) {
      setDiscordError('Channel ID and Agent ID are required.');
      return;
    }
    setDiscordSaving(true);
    try {
      await setDiscordConfig({
        token: discordForm.token || '***', // keep existing token if blank
        channelId: discordForm.channelId,
        agentId: discordForm.agentId,
      });
      const updated = await getDiscordConfig();
      setDiscord(updated);
      setDiscordForm(f => ({ ...f, token: '' }));
      setDiscordStatus(updated.running ? 'Bot started.' : 'Config saved.');
    } catch (e: unknown) {
      setDiscordError(e instanceof Error ? e.message : 'Failed to save Discord config.');
    } finally {
      setDiscordSaving(false);
    }
  }

  async function handleExportConfig() {
    setExportStatus(null);
    try {
      const data = await exportProviderConfig();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'krythor-providers.json'; a.click();
      URL.revokeObjectURL(url);
      setExportStatus('Exported successfully.');
    } catch { setExportStatus('Export failed.'); }
  }

  function handleImportConfig(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportStatus(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const list = json.providers ?? (Array.isArray(json) ? json : null);
        if (!list) { setImportError('Invalid format — expected { providers: [...] } or an array.'); return; }
        const result = await importProviderConfig(list);
        setImportStatus(`Imported ${result.imported}, updated ${result.updated}, skipped ${result.skipped}.`);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : 'Import failed.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function handleDiscordStop() {
    setDiscordError(null);
    setDiscordStatus(null);
    try {
      await stopDiscord();
      setDiscordStatus('Bot stopped.');
      setDiscord(d => d ? { ...d, running: false } : d);
    } catch (e: unknown) {
      setDiscordError(e instanceof Error ? e.message : 'Failed to stop bot.');
    }
  }

  // Compute uptime from startTime in gateway info
  const uptimeMs = gatewayInfo?.startTime
    ? Date.now() - new Date(gatewayInfo.startTime).getTime()
    : null;

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Settings"
        description="Gateway configuration, provider health history, theme, and system information."
        tip="Change your theme between dark and light mode. Provider health dots show the last 10 ping results — green is healthy, red is failed. Heartbeat runs periodic background checks on your providers."
      />
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full">

      {/* Gateway */}
      <Section title="Gateway">
        <Row label="Port" value="47200 (fixed)" />
        <Row label="Data dir" value={healthData?.dataDir ?? '—'} />
        <Row label="Config dir" value={healthData?.configDir ?? '—'} />
        {process.env['KRYTHOR_DATA_DIR'] && (
          <Row label="KRYTHOR_DATA_DIR" value={process.env['KRYTHOR_DATA_DIR']} />
        )}
      </Section>

      {/* Auth */}
      <Section title="Auth">
        <Row label="Status" value={
          <span className="text-green-400">Enabled (Bearer token)</span>
        } />
        <Row
          label="Token"
          value={
            <span className="text-zinc-500 italic text-xs">
              Stored in config/app-config.json — not displayed here for security
            </span>
          }
        />
      </Section>

      {/* Appearance */}
      <Section title="Appearance">
        <div className="flex items-center gap-3 py-1.5">
          <span className="text-zinc-500 text-xs w-36 shrink-0">Theme</span>
          <button
            onClick={toggleTheme}
            className="text-xs px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
          >
            {theme === 'dark' ? 'Dark (active) — switch to Light' : 'Light (active) — switch to Dark'}
          </button>
        </div>
      </Section>

      {/* About */}
      <Section title="About">
        <Row label="Version" value={healthData?.version ?? '—'} />
        <Row label="Platform" value={gatewayInfo?.platform ?? process.platform} />
        <Row label="Architecture" value={gatewayInfo?.arch ?? '—'} />
        <Row label="Node.js" value={healthData?.nodeVersion ?? '—'} />
        <Row label="Gateway ID" value={gatewayInfo?.gatewayId ?? '—'} />
        {uptimeMs !== null && (
          <Row label="Uptime" value={formatUptime(uptimeMs)} />
        )}
        {gatewayInfo?.capabilities && (
          <Row label="Capabilities" value={gatewayInfo.capabilities.join(', ')} />
        )}
      </Section>

      {/* Plugins */}
      {plugins.length > 0 && (
        <Section title="Plugins">
          {plugins.map(p => (
            <div key={p.file} className="flex items-start gap-3 py-1.5 border-b border-zinc-800 last:border-0">
              <span className="text-zinc-300 text-xs font-mono w-36 shrink-0 truncate" title={p.name}>{p.name}</span>
              <span className="text-zinc-500 text-xs">{p.description || p.file}</span>
            </div>
          ))}
        </Section>
      )}

      {/* Config portability */}
      <Section title="Config Portability">
        <div className="py-2 space-y-3">
          <p className="text-zinc-600 text-xs">Export and import your provider configuration (API keys are not exported).</p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleExportConfig}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
            >
              Export providers
            </button>
            <label className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors cursor-pointer">
              Import providers
              <input type="file" accept=".json" onChange={handleImportConfig} className="hidden" />
            </label>
          </div>
          {exportStatus && <p className="text-green-400 text-xs">{exportStatus}</p>}
          {importStatus && <p className="text-green-400 text-xs">{importStatus}</p>}
          {importError  && <p className="text-red-400  text-xs">{importError}</p>}
        </div>
      </Section>

      {/* Discord bot */}
      <Section title="Discord Bot">
        <div className="py-2 space-y-3">
          <p className="text-zinc-600 text-xs">
            Connect a Discord bot to route messages from a channel to an agent.
            {discord?.running && <span className="ml-2 text-green-400 font-medium">● Running</span>}
            {discord && !discord.running && <span className="ml-2 text-zinc-500">● Stopped</span>}
          </p>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Bot token <span className="text-zinc-700">(leave blank to keep existing)</span></label>
            <input
              type="password"
              value={discordForm.token}
              onChange={e => setDiscordForm(f => ({ ...f, token: e.target.value }))}
              placeholder={discord?.token === '***' ? '(token saved)' : 'Bot token…'}
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Channel ID</label>
            <input
              value={discordForm.channelId}
              onChange={e => setDiscordForm(f => ({ ...f, channelId: e.target.value }))}
              placeholder="1234567890123456789"
              className={INPUT_CLS}
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Agent ID</label>
            <input
              value={discordForm.agentId}
              onChange={e => setDiscordForm(f => ({ ...f, agentId: e.target.value }))}
              placeholder="agent UUID"
              className={INPUT_CLS}
            />
          </div>
          {discordError && <p className="text-red-400 text-xs bg-red-950/30 rounded-lg p-2">{discordError}</p>}
          {discordStatus && <p className="text-green-400 text-xs">{discordStatus}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleDiscordSave}
              disabled={discordSaving}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors"
            >
              {discordSaving ? 'Saving…' : discord?.running ? 'Update & Restart' : 'Save & Start'}
            </button>
            {discord?.running && (
              <button
                onClick={handleDiscordStop}
                className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
              >
                Stop bot
              </button>
            )}
          </div>
        </div>
      </Section>

      {/* Provider health history */}
      {Object.keys(providerHistory).length > 0 && (
        <Section title="Provider Health History">
          {Object.entries(providerHistory).map(([id, entries]) => (
            <div key={id} className="flex items-center gap-3 py-1.5 border-b border-zinc-800 last:border-0">
              <span className="text-zinc-500 text-xs w-36 shrink-0 truncate" title={id}>{id}</span>
              <HealthDots entries={entries} />
              <span className="text-zinc-600 text-xs ml-1">
                ({entries.length} check{entries.length !== 1 ? 's' : ''})
              </span>
            </div>
          ))}
          <p className="text-zinc-600 text-xs mt-2 pt-1">
            Colored dots show last 10 health checks. Green (●) = ok, Red (●) = fail.
            Updated every heartbeat cycle (50–70s).
          </p>
        </Section>
      )}
      </div>
    </div>
  );
}
