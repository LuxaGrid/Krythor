import { useState, useEffect } from 'react';
import { health, getGatewayInfo, getHeartbeatHistory } from '../api.ts';
import type { Health, GatewayInfo, ProviderHealthEntry } from '../api.ts';

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

export function SettingsPanel() {
  const [healthData, setHealthData]     = useState<Health | null>(null);
  const [gatewayInfo, setGatewayInfo]   = useState<GatewayInfo | null>(null);
  const [providerHistory, setProviderHistory] = useState<Record<string, ProviderHealthEntry[]>>({});
  const [theme, setTheme]               = useState<Theme>(getStoredTheme());
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    async function load() {
      try {
        const [h, info, hist] = await Promise.all([
          health(),
          getGatewayInfo().catch(() => null),
          getHeartbeatHistory().catch(() => ({})),
        ]);
        setHealthData(h);
        setGatewayInfo(info);
        setProviderHistory(hist);
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

  // Compute uptime from startTime in gateway info
  const uptimeMs = gatewayInfo?.startTime
    ? Date.now() - new Date(gatewayInfo.startTime).getTime()
    : null;

  return (
    <div className="h-full overflow-y-auto p-6 max-w-2xl mx-auto">
      <h2 className="text-sm font-semibold text-zinc-200 mb-6">Settings</h2>

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
  );
}
