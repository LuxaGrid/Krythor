import { useState, useEffect, useCallback } from 'react';
import { getDashboard, getTokenHistory, getMetricsSeries, health, type Dashboard, type InferenceRecord, type MetricsSeries, type Health } from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

const SPARK_CHARS = '▁▂▃▄▅▆▇█';

/** Generate a unicode sparkline string from an array of numeric values. */
function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values);
  if (max === 0) return values.map(() => SPARK_CHARS[0]).join('');
  return values.map(v => {
    const idx = Math.round((v / max) * (SPARK_CHARS.length - 1));
    return SPARK_CHARS[Math.min(idx, SPARK_CHARS.length - 1)];
  }).join('');
}

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
  const [healthData, setHealthData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [tokenHistory, setTokenHistory] = useState<InferenceRecord[]>([]);
  const [metricsSeries, setMetricsSeries] = useState<MetricsSeries | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, hist, h, series] = await Promise.all([
        getDashboard(),
        getTokenHistory().catch(() => ({ history: [] as InferenceRecord[], windowSize: 1000 })),
        health().catch(() => null),
        getMetricsSeries().catch(() => null),
      ]);
      setData(d);
      setTokenHistory(hist.history);
      setHealthData(h);
      setMetricsSeries(series);
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
      <PanelHeader
        title="Dashboard"
        description={`System stats and health overview. v${data.version}${lastRefresh ? ` · refreshed ${lastRefresh.toLocaleTimeString()}` : ''}`}
        tip="Live view of token usage, inference history, provider health, and agent activity. Click Refresh to pull the latest data."
        actions={
          <button
            onClick={() => { void load(); }}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >↺ refresh</button>
        }
      />

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

      {/* Real-time request metrics trend lines */}
      {metricsSeries && (
        <div className="px-4 pb-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-2">
            Request metrics (last {metricsSeries.windowMinutes} min)
          </p>
          <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-lg px-3 py-3 space-y-3">
            {/* Totals row */}
            <div className="grid grid-cols-4 gap-3 text-center">
              <div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-wide">Requests</p>
                <p className="text-sm font-mono text-zinc-200">{metricsSeries.totals.requests}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-wide">Errors</p>
                <p className={`text-sm font-mono ${metricsSeries.totals.errors > 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                  {metricsSeries.totals.errors}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-wide">Avg latency</p>
                <p className="text-sm font-mono text-zinc-200">{metricsSeries.totals.avgLatencyMs}ms</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-600 uppercase tracking-wide">Error rate</p>
                <p className={`text-sm font-mono ${metricsSeries.totals.errorRate > 0.05 ? 'text-amber-400' : 'text-zinc-500'}`}>
                  {(metricsSeries.totals.errorRate * 100).toFixed(1)}%
                </p>
              </div>
            </div>

            {/* Sparklines */}
            {metricsSeries.samples.length > 1 && (() => {
              const reqLine  = sparkline(metricsSeries.samples.map(s => s.requests));
              const errLine  = sparkline(metricsSeries.samples.map(s => s.errors));
              const latLine  = sparkline(metricsSeries.samples.map(s =>
                s.requests > 0 ? Math.round(s.latencySum / s.requests) : 0,
              ));
              return (
                <div className="border-t border-zinc-700/40 pt-2 space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-zinc-600 w-14 shrink-0">req/min</span>
                    <span className="font-mono text-xs text-brand-400 tracking-widest leading-none">{reqLine}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-zinc-600 w-14 shrink-0">errors</span>
                    <span className={`font-mono text-xs tracking-widest leading-none ${
                      metricsSeries.totals.errors > 0 ? 'text-red-400' : 'text-zinc-700'
                    }`}>{errLine}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] text-zinc-600 w-14 shrink-0">latency</span>
                    <span className="font-mono text-xs text-amber-500/80 tracking-widest leading-none">{latLine}</span>
                  </div>
                </div>
              );
            })()}

            {metricsSeries.samples.length === 0 && (
              <p className="text-xs text-zinc-700">No API requests recorded yet — make a request to populate trends.</p>
            )}
          </div>
        </div>
      )}

      {/* Token usage sparkline — last 20 requests */}
      <div className="px-4 pb-4">
        <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-2">
          Token usage (last 20 requests)
        </p>
        {tokenHistory.length === 0 ? (
          <p className="text-xs text-zinc-700">No inference history yet — make a request to see data.</p>
        ) : (
          <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-lg px-3 py-2 space-y-2">
            <p className="font-mono text-sm text-brand-400 tracking-widest leading-none">
              {sparkline(tokenHistory.slice(-20).map(r => r.inputTokens + r.outputTokens))}
            </p>
            <p className="text-xs text-zinc-600">
              {Math.min(tokenHistory.length, 20)} of {tokenHistory.length} recorded inference{tokenHistory.length !== 1 ? 's' : ''}
            </p>
            {/* Per-model breakdown */}
            {(() => {
              const byModel: Record<string, { input: number; output: number; count: number }> = {};
              for (const r of tokenHistory) {
                const key = `${r.provider}/${r.model}`;
                if (!byModel[key]) byModel[key] = { input: 0, output: 0, count: 0 };
                byModel[key]!.input  += r.inputTokens;
                byModel[key]!.output += r.outputTokens;
                byModel[key]!.count  += 1;
              }
              const rows = Object.entries(byModel).sort((a, b) => (b[1].input + b[1].output) - (a[1].input + a[1].output));
              if (rows.length === 0) return null;
              return (
                <div className="border-t border-zinc-700/40 pt-2 space-y-1">
                  {rows.map(([key, stats]) => (
                    <div key={key} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className="text-zinc-500 truncate flex-1" title={key}>{key.split('/').pop() ?? key}</span>
                      <span className="text-zinc-600">{stats.count}×</span>
                      <span className="text-zinc-500">{(stats.input + stats.output).toLocaleString()} tok</span>
                      <span className="text-zinc-700">({stats.input.toLocaleString()}↑ {stats.output.toLocaleString()}↓)</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Heartbeat status */}
      {healthData?.heartbeat && (
        <div className="px-4 pb-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-2">Heartbeat</p>
          <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-lg px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-3 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${healthData.heartbeat.enabled ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
              <span className="text-zinc-400">{healthData.heartbeat.enabled ? 'enabled' : 'disabled'}</span>
              <span className="text-zinc-600">{healthData.heartbeat.recentRuns} run{healthData.heartbeat.recentRuns !== 1 ? 's' : ''} recorded</span>
              {healthData.heartbeat.lastRun && (
                <span className="text-zinc-700 ml-auto">
                  last: {healthData.heartbeat.lastRun.durationMs != null
                    ? `${(healthData.heartbeat.lastRun.durationMs / 1000).toFixed(1)}s`
                    : '…'}
                </span>
              )}
            </div>
            {healthData.heartbeat.lastRun && healthData.heartbeat.lastRun.checksRan.length > 0 && (
              <p className="text-[10px] text-zinc-700 font-mono leading-snug">
                checks: {healthData.heartbeat.lastRun.checksRan.join(', ')}
              </p>
            )}
            {healthData.heartbeat.lastRun?.timedOut && (
              <p className="text-xs text-amber-400">Last heartbeat run timed out</p>
            )}
            {healthData.heartbeat.lastRun?.error && (
              <p className="text-xs text-red-400">{healthData.heartbeat.lastRun.error}</p>
            )}
            {healthData.heartbeat.lastRun?.insights && healthData.heartbeat.lastRun.insights.length > 0 && (
              <div className="border-t border-zinc-700/40 pt-1.5 space-y-1">
                {healthData.heartbeat.lastRun.insights.map((insight, i) => (
                  <div key={i} className="flex gap-2 text-[10px]">
                    <span className={insight.severity === 'warning' ? 'text-amber-400 shrink-0' : 'text-zinc-500 shrink-0'}>
                      {insight.severity === 'warning' ? '⚠' : 'ℹ'}
                    </span>
                    <span className={insight.severity === 'warning' ? 'text-amber-300' : 'text-zinc-500'}>
                      {insight.message}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Circuit breaker summary */}
      {healthData?.circuits && Object.keys(healthData.circuits).length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-2">Circuit Breakers</p>
          <div className="space-y-1">
            {Object.entries(healthData.circuits).map(([id, c]) => (
              <div key={id} className="flex items-center gap-2 text-[10px] font-mono bg-zinc-800/30 border border-zinc-700/40 rounded px-2.5 py-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  c.state === 'closed' ? 'bg-emerald-400' :
                  c.state === 'open'   ? 'bg-red-400' :
                  'bg-amber-400'
                }`} />
                <span className="text-zinc-400 flex-1 truncate" title={id}>{id.slice(0, 20)}</span>
                <span className={
                  c.state === 'closed' ? 'text-zinc-600' :
                  c.state === 'open'   ? 'text-red-400' :
                  'text-amber-400'
                }>{c.state}</span>
                {c.avgLatencyMs > 0 && <span className="text-zinc-700">{c.avgLatencyMs}ms avg</span>}
                <span className="text-zinc-700">{c.totalRequests} req</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 pb-4">
        <p className="text-xs text-zinc-700">Auto-refreshes every 30 seconds</p>
      </div>
    </div>
  );
}
