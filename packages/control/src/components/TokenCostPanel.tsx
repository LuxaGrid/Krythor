import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getTokenHistory, listAgents, getAgentBudget, setAgentBudget, deleteAgentBudget,
  type InferenceRecord, type Agent, type TokenBudgetUsage,
} from '../api.ts';
import { PanelHeader } from './PanelHeader.tsx';

// ── Cost estimation ────────────────────────────────────────────────────────────
// Rough per-token costs in USD. These are estimates for display only.
// Real costs depend on the provider's pricing at runtime.
const COST_PER_TOKEN: Record<string, { in: number; out: number }> = {
  // OpenAI
  'gpt-4o':              { in: 0.0000025, out: 0.000010 },
  'gpt-4o-mini':         { in: 0.00000015, out: 0.0000006 },
  'gpt-4-turbo':         { in: 0.000010, out: 0.000030 },
  'gpt-4':               { in: 0.000030, out: 0.000060 },
  'gpt-3.5-turbo':       { in: 0.0000005, out: 0.0000015 },
  // Anthropic
  'claude-3-5-sonnet':   { in: 0.000003, out: 0.000015 },
  'claude-3-5-haiku':    { in: 0.0000008, out: 0.000004 },
  'claude-3-opus':       { in: 0.000015, out: 0.000075 },
  'claude-sonnet-4':     { in: 0.000003, out: 0.000015 },
  'claude-haiku-4':      { in: 0.0000008, out: 0.000004 },
  // Gemini
  'gemini-1.5-pro':      { in: 0.00000125, out: 0.000005 },
  'gemini-1.5-flash':    { in: 0.000000075, out: 0.0000003 },
  // Local / free
  'ollama':              { in: 0, out: 0 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(COST_PER_TOKEN).find(k => model.toLowerCase().includes(k.toLowerCase()));
  if (!key) return 0;
  const rates = COST_PER_TOKEN[key]!;
  return inputTokens * rates.in + outputTokens * rates.out;
}

function fmtCost(usd: number): string {
  if (usd === 0) return '$0.0000';
  if (usd < 0.0001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01)   return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ── Time window filtering ─────────────────────────────────────────────────────
type Window = '15m' | '1h' | '6h' | '24h' | 'all';
const WINDOWS: { id: Window; label: string }[] = [
  { id: '15m', label: 'Last 15m' },
  { id: '1h',  label: 'Last 1h'  },
  { id: '6h',  label: 'Last 6h'  },
  { id: '24h', label: 'Last 24h' },
  { id: 'all', label: 'All'      },
];

function windowCutoff(w: Window): number {
  const now = Date.now();
  switch (w) {
    case '15m': return now - 15 * 60_000;
    case '1h':  return now - 60 * 60_000;
    case '6h':  return now - 6 * 60 * 60_000;
    case '24h': return now - 24 * 60 * 60_000;
    case 'all': return 0;
  }
}

// ── Budget modal ──────────────────────────────────────────────────────────────

interface BudgetModalProps {
  agent: Agent;
  usage: TokenBudgetUsage | null;
  onClose: () => void;
  onSaved: () => void;
}

function BudgetModal({ agent, usage, onClose, onSaved }: BudgetModalProps) {
  const [daily,   setDaily]   = useState(usage?.budget?.dailyLimit   ? String(usage.budget.dailyLimit)   : '');
  const [session, setSession] = useState(usage?.budget?.sessionLimit ? String(usage.budget.sessionLimit) : '');
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const dailyLimit   = daily.trim()   ? parseInt(daily.trim(), 10)   : null;
      const sessionLimit = session.trim() ? parseInt(session.trim(), 10) : null;
      if ((dailyLimit !== null && isNaN(dailyLimit)) || (sessionLimit !== null && isNaN(sessionLimit))) {
        setErr('Limits must be whole numbers.');
        setSaving(false);
        return;
      }
      if (dailyLimit === null && sessionLimit === null) {
        await deleteAgentBudget(agent.id);
      } else {
        await setAgentBudget(agent.id, { dailyLimit, sessionLimit });
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const hasBudget = usage?.budget != null;

  const handleRemove = async () => {
    setSaving(true);
    try {
      await deleteAgentBudget(agent.id);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Token Budget</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{agent.name}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">×</button>
        </div>

        {usage && (
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div className="bg-zinc-800/60 rounded-lg px-3 py-2">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-0.5">Session used</p>
              <p className="text-sm font-mono text-zinc-200">{fmtTokens(usage.sessionUsed)}</p>
              {usage.budget?.sessionLimit && (
                <p className="text-[10px] text-zinc-500">of {fmtTokens(usage.budget.sessionLimit)}</p>
              )}
            </div>
            <div className="bg-zinc-800/60 rounded-lg px-3 py-2">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-0.5">Daily used</p>
              <p className="text-sm font-mono text-zinc-200">{fmtTokens(usage.dailyUsed)}</p>
              {usage.budget?.dailyLimit && (
                <p className="text-[10px] text-zinc-500">of {fmtTokens(usage.budget.dailyLimit)}</p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Daily limit <span className="text-zinc-600">(tokens/UTC day)</span></label>
            <input
              type="number"
              min="1"
              placeholder="e.g. 100000 — leave blank for unlimited"
              value={daily}
              onChange={e => setDaily(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Session limit <span className="text-zinc-600">(tokens, resets on restart)</span></label>
            <input
              type="number"
              min="1"
              placeholder="e.g. 50000 — leave blank for unlimited"
              value={session}
              onChange={e => setSession(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30"
            />
          </div>
        </div>

        {err && <p className="mt-3 text-xs text-red-400">{err}</p>}

        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg py-1.5 transition-colors"
          >
            {saving ? 'Saving…' : 'Save limits'}
          </button>
          {hasBudget && (
            <button
              onClick={handleRemove}
              disabled={saving}
              className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-900/40 hover:border-red-800/60 rounded-lg transition-colors"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function TokenCostPanel() {
  const [records,    setRecords]    = useState<InferenceRecord[]>([]);
  const [agents,     setAgents]     = useState<Agent[]>([]);
  const [window_,    setWindow_]    = useState<Window>('1h');
  const [loading,    setLoading]    = useState(false);
  const [err,        setErr]        = useState<string | null>(null);
  const [copied,     setCopied]     = useState<string | null>(null);
  const [budgetAgent, setBudgetAgent] = useState<Agent | null>(null);
  const [budgetUsage, setBudgetUsage] = useState<TokenBudgetUsage | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [hist, ags] = await Promise.all([getTokenHistory(), listAgents()]);
      setRecords(hist.history ?? []);
      setAgents(ags);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
    intervalRef.current = setInterval(() => { void load(); }, 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  const openBudget = async (agent: Agent) => {
    setBudgetAgent(agent);
    setBudgetUsage(null);
    try {
      const usage = await getAgentBudget(agent.id);
      setBudgetUsage(usage);
    } catch {
      setBudgetUsage({ sessionUsed: 0, dailyUsed: 0, budget: null });
    }
  };

  // Filter by time window
  const cutoff = windowCutoff(window_);
  const filtered = records.filter(r => r.timestamp >= cutoff);

  // Summary totals
  const totalIn  = filtered.reduce((s, r) => s + r.inputTokens,  0);
  const totalOut = filtered.reduce((s, r) => s + r.outputTokens, 0);
  const totalCost = filtered.reduce((s, r) => s + estimateCost(r.model, r.inputTokens, r.outputTokens), 0);

  // Per-model breakdown for summary row
  const modelTotals = new Map<string, { in: number; out: number; count: number }>();
  for (const r of filtered) {
    const key = r.model;
    const cur = modelTotals.get(key) ?? { in: 0, out: 0, count: 0 };
    cur.in    += r.inputTokens;
    cur.out   += r.outputTokens;
    cur.count += 1;
    modelTotals.set(key, cur);
  }

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(c => c === id ? null : c), 1500);
    }).catch(() => {});
  };

  // Sort newest first
  const rows = [...filtered].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PanelHeader
        title="Token Cost Feed"
        description="Live usage and cost across all active LLM sessions"
        actions={
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 mr-1">View:</span>
            {WINDOWS.map(w => (
              <button
                key={w.id}
                onClick={() => setWindow_(w.id)}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                  window_ === w.id
                    ? 'bg-brand-600 text-white'
                    : 'text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      {/* Summary strip */}
      <div className="flex-shrink-0 grid grid-cols-4 gap-px bg-zinc-800/50 border-b border-zinc-800">
        <div className="bg-zinc-900/80 px-4 py-2.5">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">Calls</p>
          <p className="text-base font-mono font-semibold text-zinc-100">{filtered.length}</p>
        </div>
        <div className="bg-zinc-900/80 px-4 py-2.5">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">Input tokens</p>
          <p className="text-base font-mono font-semibold text-sky-400">{fmtTokens(totalIn)}</p>
        </div>
        <div className="bg-zinc-900/80 px-4 py-2.5">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">Output tokens</p>
          <p className="text-base font-mono font-semibold text-violet-400">{fmtTokens(totalOut)}</p>
        </div>
        <div className="bg-zinc-900/80 px-4 py-2.5">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-0.5">Est. cost</p>
          <p className="text-base font-mono font-semibold text-emerald-400">{fmtCost(totalCost)}</p>
        </div>
      </div>

      {/* Column headers */}
      <div className="flex-shrink-0 grid grid-cols-[90px_140px_130px_160px_160px_90px_1fr] gap-0 px-4 py-1.5 border-b border-zinc-800 bg-zinc-900/60">
        {['TIME', 'AGENT', 'SESSION', 'MODEL', 'TOKENS', 'COST', 'ACTIVITY'].map(col => (
          <span key={col} className="text-[10px] font-semibold tracking-widest text-zinc-500 uppercase">{col}</span>
        ))}
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {loading && rows.length === 0 && (
          <div className="flex items-center justify-center h-32 text-xs text-zinc-500">Loading…</div>
        )}
        {err && (
          <div className="m-4 px-3 py-2 bg-red-950/40 border border-red-900/40 rounded-lg text-xs text-red-400">{err}</div>
        )}
        {!loading && !err && rows.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-zinc-600">
            <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-xs">No token usage in this window</p>
          </div>
        )}
        {rows.map((r, i) => {
          const cost    = estimateCost(r.model, r.inputTokens, r.outputTokens);
          const shortId = r.model.slice(0, 10);
          return (
            <div
              key={i}
              className="grid grid-cols-[90px_140px_130px_160px_160px_90px_1fr] gap-0 px-4 py-2 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors text-xs"
            >
              {/* TIME */}
              <span className="font-mono text-zinc-500 tabular-nums leading-5">
                {fmtTime(r.timestamp)}
              </span>

              {/* AGENT — match by model if possible, show provider as fallback */}
              <span className="flex items-center gap-1.5 min-w-0 leading-5">
                <AgentDot provider={r.provider} />
                <span className="text-zinc-300 truncate">{r.provider}</span>
              </span>

              {/* SESSION — short model id acts as session handle */}
              <span className="flex items-center gap-1 min-w-0 leading-5">
                <span className="font-mono text-zinc-400 truncate">{shortId}</span>
                <button
                  onClick={() => copyId(r.model)}
                  className="flex-shrink-0 text-zinc-600 hover:text-zinc-400 transition-colors"
                  title="Copy model id"
                >
                  {copied === r.model ? (
                    <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  ) : (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  )}
                </button>
              </span>

              {/* MODEL */}
              <span className="text-zinc-400 truncate leading-5" title={r.model}>{r.model}</span>

              {/* TOKENS */}
              <span className="flex items-center gap-2 tabular-nums leading-5">
                <span className="flex items-center gap-0.5 text-sky-400">
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                  {fmtTokens(r.inputTokens)}
                </span>
                <span className="flex items-center gap-0.5 text-violet-400">
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                  {fmtTokens(r.outputTokens)}
                </span>
              </span>

              {/* COST */}
              <span className={`font-mono tabular-nums leading-5 ${cost === 0 ? 'text-zinc-600' : 'text-emerald-400'}`}>
                {cost === 0 ? 'local' : fmtCost(cost)}
              </span>

              {/* ACTIVITY — model name serves as activity descriptor */}
              <span className="text-zinc-500 truncate leading-5">
                {r.inputTokens + r.outputTokens > 0
                  ? `${fmtTokens(r.inputTokens + r.outputTokens)} tokens via ${r.model}`
                  : '—'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Agent budget section */}
      <div className="flex-shrink-0 border-t border-zinc-800 bg-zinc-900/80">
        <div className="px-4 py-2 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">Agent token budgets</span>
          <span className="text-[10px] text-zinc-600">Set max token usage per automation</span>
        </div>
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {agents.length === 0 && (
            <span className="text-xs text-zinc-600">No agents configured</span>
          )}
          {agents.map(a => (
            <button
              key={a.id}
              onClick={() => { void openBudget(a); }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 transition-colors text-xs text-zinc-300 group"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 group-hover:bg-brand-400 transition-colors" />
              {a.name}
              <svg className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      {/* Budget edit modal */}
      {budgetAgent && (
        <BudgetModal
          agent={budgetAgent}
          usage={budgetUsage}
          onClose={() => { setBudgetAgent(null); setBudgetUsage(null); }}
          onSaved={() => { void load(); }}
        />
      )}
    </div>
  );
}

// ── Agent dot avatar ──────────────────────────────────────────────────────────
function AgentDot({ provider }: { provider: string }) {
  const colors: Record<string, string> = {
    openai:    'bg-emerald-500',
    anthropic: 'bg-violet-500',
    google:    'bg-sky-500',
    ollama:    'bg-amber-500',
    mistral:   'bg-orange-500',
    groq:      'bg-rose-500',
  };
  const key = Object.keys(colors).find(k => provider.toLowerCase().includes(k));
  const cls = key ? colors[key]! : 'bg-zinc-600';
  const letter = provider.charAt(0).toUpperCase();
  return (
    <span className={`flex-shrink-0 w-5 h-5 rounded-full ${cls} flex items-center justify-center text-[9px] font-bold text-white`}>
      {letter}
    </span>
  );
}
