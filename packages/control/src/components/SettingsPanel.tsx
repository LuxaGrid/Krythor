import { useState, useEffect, useCallback } from 'react';
import { health, getGatewayInfo, getHeartbeatHistory, getDiscordConfig, setDiscordConfig, stopDiscord, listPlugins, exportProviderConfig, importProviderConfig, exportFullConfig, importFullConfig, listWebChatPairings, createWebChatPairing, revokeWebChatPairing, listApiKeys, createApiKey, revokeApiKey, getAppConfig, patchAppConfig } from '../api.ts';
import type { Health, GatewayInfo, ProviderHealthEntry, DiscordConfig, Plugin, WebChatPairingEntry, WebChatPairingCreated, ApiKeySafe, ApiKeyPermission } from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';
import { useLocale } from '../i18n/index.js';

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
  const { locale, localeCode, setLocale, localeNames, localeCodes } = useLocale();
  const [loading, setLoading]           = useState(true);

  // Plugin state
  const [plugins, setPlugins]           = useState<Plugin[]>([]);

  // Config portability state
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError]   = useState<string | null>(null);
  const [fullExportStatus, setFullExportStatus] = useState<string | null>(null);
  const [fullImportStatus, setFullImportStatus] = useState<string | null>(null);
  const [fullImportError, setFullImportError]   = useState<string | null>(null);

  // Web Chat Pairing state
  const [chatPairings, setChatPairings] = useState<WebChatPairingEntry[]>([]);
  const [chatPairNew, setChatPairNew]   = useState<WebChatPairingCreated | null>(null);
  const [chatPairLabel, setChatPairLabel] = useState('');
  const [chatPairTtl, setChatPairTtl]   = useState('24');
  const [chatPairOnce, setChatPairOnce] = useState(true);
  const [chatPairBusy, setChatPairBusy] = useState(false);
  const [chatPairErr, setChatPairErr]   = useState<string | null>(null);

  // TLS state
  const [tlsEnabled, setTlsEnabled]           = useState(false);
  const [tlsCertPath, setTlsCertPath]         = useState('');
  const [tlsKeyPath, setTlsKeyPath]           = useState('');
  const [tlsSelfSigned, setTlsSelfSigned]     = useState(true);
  const [tlsSaving, setTlsSaving]             = useState(false);
  const [tlsMsg, setTlsMsg]                   = useState<string | null>(null);

  // API Key management state
  const [apiKeys, setApiKeys]                 = useState<ApiKeySafe[]>([]);
  const [newKeyName, setNewKeyName]           = useState('');
  const [newKeyPerms, setNewKeyPerms]         = useState<ApiKeyPermission[]>(['chat']);
  const [createdKey, setCreatedKey]           = useState<string | null>(null);
  const [apiKeyBusy, setApiKeyBusy]           = useState(false);
  const [apiKeyErr, setApiKeyErr]             = useState<string | null>(null);

  // Discord state
  const [discord, setDiscord]           = useState<DiscordConfig | null>(null);
  const [discordForm, setDiscordForm]   = useState({ token: '', channelId: '', agentId: '' });
  const [discordSaving, setDiscordSaving] = useState(false);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [discordStatus, setDiscordStatus] = useState<string | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const loadChatPairings = useCallback(async () => {
    try {
      const { tokens } = await listWebChatPairings();
      setChatPairings(tokens);
    } catch { /* non-fatal */ }
  }, []);

  const loadApiKeys = useCallback(async () => {
    try {
      const { keys } = await listApiKeys();
      setApiKeys(keys);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [h, info, hist, disc, plugs, appCfg] = await Promise.all([
          health(),
          getGatewayInfo().catch(() => null),
          getHeartbeatHistory().catch(() => ({})),
          getDiscordConfig().catch(() => null),
          listPlugins().catch(() => []),
          getAppConfig().catch(() => null),
        ]);
        setHealthData(h);
        if (appCfg) {
          setTlsEnabled(appCfg.httpsEnabled ?? false);
          setTlsCertPath(appCfg.httpsCertPath ?? '');
          setTlsKeyPath(appCfg.httpsKeyPath ?? '');
          setTlsSelfSigned(appCfg.httpsSelfSigned ?? true);
        }
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
    void loadChatPairings();
    void loadApiKeys();
  }, [loadChatPairings, loadApiKeys]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading settings…
      </div>
    );
  }

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  async function handleTlsSave() {
    setTlsSaving(true);
    setTlsMsg(null);
    try {
      await patchAppConfig({
        httpsEnabled: tlsEnabled,
        httpsSelfSigned: tlsSelfSigned,
        httpsCertPath: tlsCertPath || undefined,
        httpsKeyPath: tlsKeyPath || undefined,
      });
      setTlsMsg('TLS settings saved. Restart the gateway to apply.');
    } catch (e: unknown) {
      setTlsMsg(e instanceof Error ? e.message : 'Failed to save TLS settings');
    } finally {
      setTlsSaving(false);
    }
  }

  const ALL_PERMISSIONS: ApiKeyPermission[] = [
    'chat', 'agents:read', 'agents:write', 'agents:run',
    'memory:read', 'memory:write', 'models:read', 'models:infer',
    'tools:file', 'tools:shell', 'admin',
  ];

  async function handleCreateApiKey() {
    if (!newKeyName.trim() || newKeyPerms.length === 0) {
      setApiKeyErr('Name and at least one permission are required.');
      return;
    }
    setApiKeyBusy(true);
    setApiKeyErr(null);
    setCreatedKey(null);
    try {
      const { key } = await createApiKey(newKeyName.trim(), newKeyPerms);
      setCreatedKey(key);
      setNewKeyName('');
      setNewKeyPerms(['chat']);
      await loadApiKeys();
    } catch (e: unknown) {
      setApiKeyErr(e instanceof Error ? e.message : 'Failed to create key');
    } finally {
      setApiKeyBusy(false);
    }
  }

  async function handleRevokeApiKey(id: string) {
    try {
      await revokeApiKey(id);
      await loadApiKeys();
    } catch { /* non-fatal */ }
  }

  function togglePerm(p: ApiKeyPermission) {
    setNewKeyPerms(prev =>
      prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
    );
  }

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

  async function handleFullExportConfig() {
    setFullExportStatus(null);
    try {
      const data = await exportFullConfig();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'krythor-full-config.json'; a.click();
      URL.revokeObjectURL(url);
      setFullExportStatus('Full config exported.');
    } catch { setFullExportStatus('Export failed.'); }
  }

  function handleFullImportConfig(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFullImportError(null);
    setFullImportStatus(null);
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string) as Record<string, unknown>;
        if (json['krythorFullExport'] !== '1') {
          setFullImportError('Not a full Krythor config export file.');
          return;
        }
        const result = await importFullConfig(json, false);
        const counts = Object.entries(result.imported).map(([k, v]) => `${k}: ${v}`).join(', ');
        setFullImportStatus(`Imported — ${counts || 'nothing'}.${result.errors.length ? ` Errors: ${result.errors.length}` : ''}`);
      } catch (err) {
        setFullImportError(err instanceof Error ? err.message : 'Import failed.');
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

  async function handleCreateChatPairing() {
    setChatPairErr(null);
    setChatPairNew(null);
    setChatPairBusy(true);
    try {
      const ttlHours = parseFloat(chatPairTtl);
      const result = await createWebChatPairing({
        label:      chatPairLabel.trim() || undefined,
        ttlHours:   isNaN(ttlHours) ? 24 : ttlHours,
        oneTimeUse: chatPairOnce,
      });
      setChatPairNew(result);
      setChatPairLabel('');
      await loadChatPairings();
    } catch (e) {
      setChatPairErr(e instanceof Error ? e.message : 'Failed to create link.');
    } finally {
      setChatPairBusy(false);
    }
  }

  async function handleRevokeChatPairing(id: string) {
    try {
      await revokeWebChatPairing(id);
      setChatPairNew(prev => prev?.id === id ? null : prev);
      await loadChatPairings();
    } catch { /* non-fatal */ }
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
        <div className="flex items-center gap-3 py-1.5 border-b border-zinc-800">
          <span className="text-zinc-500 text-xs w-36 shrink-0">{locale.settings_theme}</span>
          <button
            onClick={toggleTheme}
            className="text-xs px-3 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100 transition-colors"
          >
            {theme === 'dark' ? 'Dark (active) — switch to Light' : 'Light (active) — switch to Dark'}
          </button>
        </div>
        <div className="flex items-center gap-3 py-1.5">
          <span className="text-zinc-500 text-xs w-36 shrink-0">{locale.settings_language}</span>
          <select
            value={localeCode}
            onChange={e => setLocale(e.target.value as typeof localeCode)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            {localeCodes.map(code => (
              <option key={code} value={code}>{localeNames[code]}</option>
            ))}
          </select>
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

          <hr className="border-zinc-800 my-1" />
          <p className="text-zinc-600 text-xs">Full system export includes agents, guard policies, cron jobs, channels, skills, and providers.</p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleFullExportConfig}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors"
            >
              Export full config
            </button>
            <label className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors cursor-pointer">
              Import full config
              <input type="file" accept=".json" onChange={handleFullImportConfig} className="hidden" />
            </label>
          </div>
          {fullExportStatus && <p className="text-green-400 text-xs">{fullExportStatus}</p>}
          {fullImportStatus && <p className="text-green-400 text-xs">{fullImportStatus}</p>}
          {fullImportError  && <p className="text-red-400  text-xs">{fullImportError}</p>}
        </div>
      </Section>

      {/* Web Chat Pairing */}
      <Section title="Web Chat Pairing">
        <div className="py-2 space-y-3">
          <p className="text-zinc-600 text-xs">
            Create a shareable link that grants access to the chat interface without exposing your main gateway token.
          </p>

          {/* Create form */}
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[140px]">
              <label className="text-xs text-zinc-500 block mb-1">Label <span className="text-zinc-700">(optional)</span></label>
              <input
                value={chatPairLabel}
                onChange={e => setChatPairLabel(e.target.value)}
                placeholder="e.g. Alice's phone"
                className={INPUT_CLS}
              />
            </div>
            <div className="w-24">
              <label className="text-xs text-zinc-500 block mb-1">TTL (hours)</label>
              <input
                type="number"
                min="0.1"
                max="168"
                step="0.5"
                value={chatPairTtl}
                onChange={e => setChatPairTtl(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div className="flex items-center gap-1.5 pb-0.5">
              <input
                type="checkbox"
                id="chat-pair-once"
                checked={chatPairOnce}
                onChange={e => setChatPairOnce(e.target.checked)}
                className="accent-brand-500"
              />
              <label htmlFor="chat-pair-once" className="text-xs text-zinc-400 select-none cursor-pointer">One-time use</label>
            </div>
            <button
              onClick={handleCreateChatPairing}
              disabled={chatPairBusy}
              className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs rounded-lg transition-colors shrink-0"
            >
              {chatPairBusy ? 'Creating…' : 'Create link'}
            </button>
          </div>

          {chatPairErr && <p className="text-red-400 text-xs">{chatPairErr}</p>}

          {/* Newly created link */}
          {chatPairNew && (
            <div className="bg-emerald-950/20 border border-emerald-800/30 rounded-lg p-3 space-y-1.5">
              <p className="text-emerald-400 text-xs font-semibold">Link created — copy it now, it won't be shown again.</p>
              {chatPairNew.label && <p className="text-zinc-400 text-xs">Label: {chatPairNew.label}</p>}
              <div className="flex items-center gap-2">
                <code className="text-xs text-zinc-300 bg-zinc-800 rounded px-2 py-1 break-all flex-1">
                  {window.location.origin}{chatPairNew.chatUrl}
                </code>
                <button
                  onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${chatPairNew.chatUrl}`)}
                  className="text-[10px] px-2 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 shrink-0"
                >Copy</button>
              </div>
              <p className="text-zinc-500 text-[10px]">
                Expires: {new Date(chatPairNew.expiresAt).toLocaleString()} · {chatPairNew.oneTimeUse ? 'One-time use' : 'Reusable'}
              </p>
            </div>
          )}

          {/* Active tokens list */}
          {chatPairings.length > 0 && (
            <div className="space-y-1">
              <p className="text-zinc-500 text-xs font-medium">Active links ({chatPairings.length})</p>
              {chatPairings.map(t => (
                <div key={t.id} className="flex items-center justify-between gap-2 py-1.5 border-b border-zinc-800 last:border-0">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-zinc-300 text-xs truncate">{t.label ?? <span className="text-zinc-600 italic">no label</span>}</span>
                    <span className="text-zinc-600 text-[10px]">
                      Expires {new Date(t.expiresAt).toLocaleString()} · {t.oneTimeUse ? 'one-time' : 'reusable'} · id: {t.id}
                    </span>
                  </div>
                  <button
                    onClick={() => void handleRevokeChatPairing(t.id)}
                    className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-500 hover:bg-red-900/40 hover:text-red-400 shrink-0"
                  >revoke</button>
                </div>
              ))}
            </div>
          )}
          {chatPairings.length === 0 && !chatPairNew && (
            <p className="text-zinc-600 text-xs">No active pairing links.</p>
          )}
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

      {/* TLS / HTTPS */}
      <Section title="TLS / HTTPS">
        <p className="text-zinc-500 text-xs mb-3">
          Enable HTTPS for the gateway. Changes require a gateway restart to take effect.
          Self-signed generates a certificate automatically — add it to your browser trust store for local use.
        </p>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={tlsEnabled} onChange={e => setTlsEnabled(e.target.checked)} className="accent-sky-500" />
            Enable HTTPS
          </label>
          {tlsEnabled && (
            <>
              <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={tlsSelfSigned} onChange={e => setTlsSelfSigned(e.target.checked)} className="accent-sky-500" />
                Auto-generate self-signed certificate
              </label>
              {!tlsSelfSigned && (
                <>
                  <input type="text" placeholder="Certificate path (.pem)" value={tlsCertPath} onChange={e => setTlsCertPath(e.target.value)}
                    className="w-full text-sm bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                  <input type="text" placeholder="Private key path (.pem)" value={tlsKeyPath} onChange={e => setTlsKeyPath(e.target.value)}
                    className="w-full text-sm bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                </>
              )}
            </>
          )}
          {tlsMsg && <p className={`text-xs ${tlsMsg.includes('Failed') ? 'text-red-400' : 'text-green-400'}`}>{tlsMsg}</p>}
          <button onClick={() => void handleTlsSave()} disabled={tlsSaving}
            className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white rounded transition-colors">
            {tlsSaving ? 'Saving…' : 'Save TLS Settings'}
          </button>
        </div>
      </Section>

      {/* API Keys */}
      <Section title="API Keys">
        <p className="text-zinc-500 text-xs mb-3">
          Named keys with scoped permissions. The master gateway token always works regardless of keys here.
          Key plaintext is shown only once at creation.
        </p>

        {/* Existing keys */}
        {apiKeys.length > 0 && (
          <div className="mb-3 space-y-1">
            {apiKeys.map(k => (
              <div key={k.id} className="flex items-center gap-2 py-1.5 border-b border-zinc-800 last:border-0">
                <span className={`w-2 h-2 rounded-full shrink-0 ${k.active ? 'bg-green-500' : 'bg-zinc-600'}`} title={k.active ? 'active' : 'revoked'} />
                <span className="text-zinc-200 text-sm font-medium flex-1 truncate" title={k.name}>{k.name}</span>
                <span className="text-zinc-500 text-xs font-mono">{k.prefix}…</span>
                <span className="text-zinc-600 text-xs truncate max-w-[180px]" title={k.permissions.join(', ')}>{k.permissions.join(', ')}</span>
                {k.lastUsedAt && (
                  <span className="text-zinc-600 text-xs">used {new Date(k.lastUsedAt).toLocaleDateString()}</span>
                )}
                {k.active && (
                  <button onClick={() => void handleRevokeApiKey(k.id)}
                    className="text-xs text-red-500 hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-950/40 transition-colors">
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {apiKeys.length === 0 && (
          <p className="text-zinc-600 text-xs mb-3">No API keys yet.</p>
        )}

        {/* Created key display */}
        {createdKey && (
          <div className="mb-3 p-2 bg-green-950/40 border border-green-800/50 rounded text-xs">
            <p className="text-green-400 font-medium mb-1">Key created — copy now, it will not be shown again:</p>
            <code className="text-green-300 break-all select-all">{createdKey}</code>
            <button onClick={() => { void navigator.clipboard.writeText(createdKey); }}
              className="ml-2 text-green-400 hover:text-green-300 underline">Copy</button>
            <button onClick={() => setCreatedKey(null)}
              className="ml-3 text-zinc-500 hover:text-zinc-400">Dismiss</button>
          </div>
        )}

        {/* Create form */}
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Key name (e.g. My Script)"
            value={newKeyName}
            onChange={e => setNewKeyName(e.target.value)}
            className="w-full text-sm bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <div className="flex flex-wrap gap-1.5">
            {ALL_PERMISSIONS.map(p => (
              <label key={p} className="flex items-center gap-1 text-xs text-zinc-400 cursor-pointer select-none">
                <input type="checkbox" checked={newKeyPerms.includes(p)} onChange={() => togglePerm(p)}
                  className="accent-sky-500" />
                {p}
              </label>
            ))}
          </div>
          {apiKeyErr && <p className="text-red-400 text-xs">{apiKeyErr}</p>}
          <button onClick={() => void handleCreateApiKey()} disabled={apiKeyBusy}
            className="text-xs px-3 py-1.5 bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white rounded transition-colors">
            {apiKeyBusy ? 'Creating…' : 'Create API Key'}
          </button>
        </div>
      </Section>

      </div>
    </div>
  );
}
