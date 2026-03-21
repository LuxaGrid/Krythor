import { useState, useEffect, useCallback } from 'react';
import { getDashboard, type Dashboard } from '../api.ts';

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function StatCard({ label, value, sub, highlight }: {
  label: string;
  value: string | number;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 flex flex-col gap-1">
      <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium">{label}</p>
      <p className={`text-2xl font-bold font-mono ${highlight ? 'text-brand-400' : 'text-zinc-100'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-zinc-600">{sub}</p>}
    </div>
  );
}

export function DashboardPanel() {
  const [data, setData]     = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getDashboard();
      setData(d);
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Auto-refresh every 30 seconds
    const id = setInterval(() => { void load(); }, 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return (
      <div className="flex-1 p-6 grid grid-cols-2 md:grid-cols-4 gap-4 content-start">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 h-20 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => { setLoading(true); void load(); }}
          className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const warnings = data.activeWarnings as Array<{ message?: string; checkId?: string }>;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Dashboard</h2>
          <p className="text-xs text-zinc-600 mt-0.5">
            v{data.version}
            {lastRefresh && ` · refreshed ${lastRefresh.toLocaleTimeString()}`}
          </p>
        </div>
        <button
          onClick={() => { void load(); }}
          className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
        >
          ↺ refresh
        </button>
      </div>

      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Uptime" value={formatUptime(data.uptime)} />
        <StatCard label="Providers" value={data.providerCount} highlight={data.providerCount > 0} />
        <StatCard label="Models" value={data.modelCount} />
        <StatCard label="Agents" value={data.agentCount} />
        <StatCard label="Memory Entries" value={data.memoryEntries.toLocaleString()} />
        <StatCard label="Conversations" value={data.conversationCount} />
        <StatCard
          label="Tokens Used"
          value={data.totalTokensUsed > 999999
            ? `${(data.totalTokensUsed / 1_000_000).toFixed(1)}M`
            : data.totalTokensUsed > 999
              ? `${(data.totalTokensUsed / 1000).toFixed(1)}K`
              : String(data.totalTokensUsed)}
          sub="this session"
        />
        <StatCard
          label="Warnings"
          value={warnings.length}
          highlight={warnings.length > 0}
        />
      </div>

      {warnings.length > 0 && (
        <div className="px-4 pb-4 space-y-2">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium">Active Warnings</p>
          {warnings.map((w, i) => (
            <div key={i} className="bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2 flex gap-2">
              <span className="text-amber-400 shrink-0 text-xs font-mono">[{w.checkId ?? 'warn'}]</span>
              <p className="text-xs text-amber-300">{w.message ?? String(w)}</p>
            </div>
          ))}
        </div>
      )}

      {!!data.lastHeartbeat && (
        <div className="px-4 pb-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-2">Last Heartbeat</p>
          <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-zinc-400">
            <pre className="text-[10px] text-zinc-600 overflow-auto whitespace-pre-wrap">
              {JSON.stringify(data.lastHeartbeat, null, 2)}
            </pre>
          </div>
        </div>
      )}

      <div className="px-4 pb-4">
        <p className="text-xs text-zinc-700">Auto-refreshes every 30 seconds</p>
      </div>
    </div>
  );
}
