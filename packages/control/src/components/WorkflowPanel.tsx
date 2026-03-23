import { useState, useEffect, useCallback } from 'react';
import { listAgents, listRuns, runAgentsParallel, runAgentsSequential, stopAgentRun, type Agent, type AgentRun } from '../api.ts';
import { useGatewayContext } from '../GatewayContext.tsx';

// ─── WorkflowPanel ────────────────────────────────────────────────────────────
//
// Structured execution flow view for a selected agent run.
//
// Layout (per MASTER Prompt Phase 7):
//   left   → input (the task/prompt)
//   middle → processing agents (each with role, tags, model badge, state)
//   right  → output (result)
//   bottom → meta layer (run metadata, timing, history)
//
// Visual style: dark premium cards, gold for hierarchy, arc-blue for live action.
//

function modelShortName(modelUsed?: string): string {
  if (!modelUsed) return '';
  const part = modelUsed.split('/').pop() ?? modelUsed;
  return part.length > 18 ? part.slice(0, 16) + '…' : part;
}

function isLocalModel(modelUsed?: string): boolean {
  if (!modelUsed) return false;
  return /ollama|local|llama|mistral|phi|gemma|qwen/i.test(modelUsed);
}

function durationLabel(run: AgentRun): string {
  if (!run.completedAt) return '…';
  const ms = run.completedAt - run.startedAt;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Status helpers — Krythor palette ────────────────────────────────────────

const STATUS_BG: Record<string, string> = {
  completed: 'bg-emerald-900/20 border-emerald-800/40',
  running:   'bg-arc-950/60 border-arc-800/50',
  failed:    'bg-red-950/30 border-red-900/40',
  stopped:   'bg-amber-950/20 border-amber-900/30',
  idle:      'bg-zinc-900 border-zinc-800',
};

const STATUS_TEXT: Record<string, string> = {
  completed: 'text-emerald-400',
  running:   'text-arc-400',
  failed:    'text-red-400',
  stopped:   'text-amber-400',
  idle:      'text-zinc-500',
};

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-emerald-400',
  running:   'bg-arc-400',
  failed:    'bg-red-400',
  stopped:   'bg-amber-400',
  idle:      'bg-zinc-600',
};

// ─── FlowArrow ────────────────────────────────────────────────────────────────
// active → arc-blue electric signal; inactive → dim zinc

function FlowArrow({ active }: { active: boolean }) {
  return (
    <div className={`flex items-center shrink-0 ${active ? 'text-arc-500' : 'text-zinc-700'}`}>
      <div className={`h-px w-8 transition-colors duration-500 ${active ? 'bg-arc-600' : 'bg-zinc-700'}`} />
      <span className="text-[10px]">▶</span>
      {active && (
        <span
          className="absolute h-px w-6 bg-arc-400/40 motion-safe:animate-flow-line"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

// ─── AgentCard ────────────────────────────────────────────────────────────────
// Running → arc-blue border + pulse; completed → dimmed; orchestrator hint → gold

function AgentCard({
  agent,
  run,
  isActive,
  isCompleted,
}: {
  agent: Agent;
  run?: AgentRun;
  isActive: boolean;
  isCompleted: boolean;
}) {
  const status = run?.status ?? 'idle';
  const model = run?.modelUsed ?? agent.modelId;
  const modelLabel = modelShortName(model);
  const local = isLocalModel(model);

  // Orchestrator hint — gold treatment
  const isOrchestrator = agent.tags.some(t =>
    /orchestrat|coordinator|master|dispatch/i.test(t)
  ) || /orchestrat|coordinator|master|dispatch/i.test(agent.description ?? '');

  const borderClass = isActive
    ? 'border-arc-700/70 shadow-lg shadow-arc-950/40 kr-card-active'
    : isOrchestrator
      ? 'border-gold-700/40 kr-card-gold'
      : STATUS_BG[status]?.split(' ')[1] ?? 'border-zinc-800';

  const bgClass = isActive
    ? 'bg-arc-950/50'
    : STATUS_BG[status]?.split(' ')[0] ?? 'bg-zinc-900';

  return (
    <div
      className={`relative flex flex-col gap-2 p-4 rounded-xl border transition-all duration-300
        ${bgClass} ${borderClass}
        ${isCompleted ? 'opacity-50' : ''}
      `}
      style={{ minWidth: 160, maxWidth: 220 }}
    >
      {/* Gold top accent for orchestrators */}
      {isOrchestrator && !isActive && (
        <div className="absolute top-0 left-4 right-4 h-px bg-gold-600/40 rounded-t-xl" />
      )}

      {/* Arc-blue pulse for running */}
      {isActive && (
        <span
          className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-arc-400 motion-safe:animate-ping opacity-75"
          aria-hidden="true"
        />
      )}

      {/* Role / name */}
      <div>
        <p className={`text-xs font-semibold ${isOrchestrator ? 'text-gold-300' : 'text-zinc-100'}`}>
          {agent.name}
        </p>
        {agent.description && (
          <p className="text-[10px] text-zinc-500 mt-0.5 leading-snug">
            {agent.description.slice(0, 60)}{agent.description.length > 60 ? '…' : ''}
          </p>
        )}
      </div>

      {/* Capability tags */}
      {agent.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {agent.tags.slice(0, 3).map(tag => (
            <span
              key={tag}
              className={`text-[9px] px-1.5 py-0.5 rounded font-medium
                ${isOrchestrator
                  ? 'bg-gold-950/60 text-gold-700 border border-gold-900/40'
                  : 'bg-zinc-800 text-zinc-500'
                }`}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Status indicator */}
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[status] ?? 'bg-zinc-600'}
          ${isActive ? 'motion-safe:animate-ping' : ''}`}
        />
        <span className={`text-[10px] font-mono ${STATUS_TEXT[status] ?? STATUS_TEXT.idle}`}>
          {status}
        </span>
        {run && (
          <span className="text-[10px] text-zinc-600">· {durationLabel(run)}</span>
        )}
      </div>

      {/* Model badge */}
      {modelLabel && (
        <div className="flex items-center gap-1 border-t border-zinc-800/60 pt-1.5">
          <span className={`h-1 w-1 rounded-full shrink-0 ${local ? 'bg-emerald-400' : 'bg-arc-400'}`} />
          <span className="text-[10px] text-zinc-500 font-mono">{modelLabel}</span>
          <span className={`ml-auto text-[9px] px-1 py-0.5 rounded ${
            local
              ? 'text-emerald-600 bg-emerald-900/20 border border-emerald-900/30'
              : 'text-arc-600 bg-arc-950/60 border border-arc-900/30'
          }`}>
            {local ? 'local' : 'cloud'}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── InputBlock ───────────────────────────────────────────────────────────────
// Left column — neutral dark, gold label for structure

function InputBlock({ text, timestamp }: { text: string; timestamp?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-xl border border-zinc-800 bg-zinc-900/80 max-w-[200px]">
      <span className="text-[10px] uppercase tracking-widest text-gold-700 font-medium">Input</span>
      <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">
        {text.slice(0, 200)}{text.length > 200 ? '…' : ''}
      </p>
      {timestamp && (
        <span className="text-[10px] text-zinc-700">{timeLabel(timestamp)}</span>
      )}
    </div>
  );
}

// ─── OutputBlock ──────────────────────────────────────────────────────────────
// Right column — arc-blue when processing, emerald when done

function OutputBlock({ text, status }: { text?: string; status: string }) {
  if (status === 'running') {
    return (
      <div className="flex flex-col gap-2 p-4 rounded-xl border border-arc-800/50 bg-arc-950/40 max-w-[200px]">
        <span className="text-[10px] uppercase tracking-widest text-arc-600 font-medium">Output</span>
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-arc-400 motion-safe:animate-ping" />
          <span className="text-xs text-zinc-500">Processing…</span>
        </div>
      </div>
    );
  }
  if (!text) {
    return (
      <div className="flex flex-col gap-2 p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 max-w-[200px]">
        <span className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium">Output</span>
        <span className="text-xs text-zinc-600">—</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-4 rounded-xl border border-emerald-800/40 bg-emerald-950/20 max-w-[200px]">
      <span className="text-[10px] uppercase tracking-widest text-emerald-600 font-medium">Output</span>
      <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap break-words">
        {text.slice(0, 300)}{(text?.length ?? 0) > 300 ? '…' : ''}
      </p>
    </div>
  );
}

// ─── MetaRow ─────────────────────────────────────────────────────────────────

function MetaRow({ run }: { run: AgentRun }) {
  return (
    <div className="flex items-center gap-6 text-[10px] text-zinc-600 font-mono flex-wrap">
      <span>run <span className="text-zinc-500">{run.id.slice(0, 8)}</span></span>
      <span>started <span className="text-zinc-500">{timeLabel(run.startedAt)}</span></span>
      {run.completedAt && (
        <span>duration <span className="text-zinc-500">{durationLabel(run)}</span></span>
      )}
      {run.modelUsed && (
        <span>model <span className="text-zinc-500">{modelShortName(run.modelUsed)}</span></span>
      )}
      <span className={STATUS_TEXT[run.status] ?? 'text-zinc-500'}>{run.status}</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const INPUT_CLS = 'w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-arc-600 transition-colors';

export function WorkflowPanel() {
  const { events } = useGatewayContext();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [runs, setRuns]     = useState<AgentRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Multi-agent dispatch
  const [showDispatch, setShowDispatch]     = useState(false);
  const [dispatchInput, setDispatchInput]   = useState('');
  const [dispatchMode, setDispatchMode]     = useState<'parallel' | 'sequential'>('parallel');
  const [dispatchAgents, setDispatchAgents] = useState<string[]>([]);
  const [dispatching, setDispatching]       = useState(false);
  const [dispatchError, setDispatchError]   = useState<string | null>(null);
  const [dispatchResult, setDispatchResult] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [agentList, runList] = await Promise.all([listAgents(), listRuns()]);
      setAgents(agentList);
      setRuns(runList.slice(0, 50));
      setSelectedRunId(prev => prev ?? runList[0]?.id ?? null);
      setLoading(false);
    } catch { setLoading(false); }
  }, []);

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 6_000);
    return () => clearInterval(id);
  }, [loadData]);

  // Auto-select new runs arriving via WebSocket
  useEffect(() => {
    for (const ev of events) {
      if (ev.type !== 'agent:event') continue;
      const ae = ev.payload as { type: string; runId: string };
      if (ae?.type === 'run:started' && ae.runId) {
        setSelectedRunId(ae.runId);
        break;
      }
    }
  }, [events]);

  async function handleStop(runId: string) {
    try {
      await stopAgentRun(runId);
      await loadData();
    } catch { /* ignore */ }
  }

  async function handleDispatch() {
    setDispatchError(null);
    setDispatchResult(null);
    if (!dispatchInput.trim()) { setDispatchError('Input is required.'); return; }
    if (dispatchAgents.length < 2) { setDispatchError('Select at least 2 agents.'); return; }
    setDispatching(true);
    try {
      if (dispatchMode === 'parallel') {
        const results = await runAgentsParallel(dispatchAgents, dispatchInput.trim());
        setDispatchResult(`Dispatched to ${results.length} agents in parallel.`);
      } else {
        const results = await runAgentsSequential(dispatchAgents, dispatchInput.trim());
        setDispatchResult(`Sequential pipeline complete — ${results.length} runs.`);
      }
      await loadData();
    } catch (e: unknown) {
      setDispatchError(e instanceof Error ? e.message : 'Dispatch failed.');
    } finally {
      setDispatching(false);
    }
  }

  function toggleDispatchAgent(id: string) {
    setDispatchAgents(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  }

  const selectedRun = runs.find(r => r.id === selectedRunId) ?? runs[0] ?? null;
  const runAgent = selectedRun ? agents.find(a => a.id === selectedRun.agentId) : null;

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--kr-bg-primary)' }}>
        <span className="text-zinc-600 text-xs">Loading…</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--kr-bg-primary)' }}>

      {/* Header — gold accent line on top */}
      <div className="flex items-center gap-4 px-6 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--kr-border-subtle)', background: 'var(--kr-bg-panel)' }}>
        <div className="flex items-center gap-3">
          {/* Gold hierarchy marker */}
          <div className="w-0.5 h-6 rounded-full bg-gold-600/60" />
          <div>
            <h2 className="text-sm font-semibold text-zinc-100 tracking-wide">Workflow</h2>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--kr-text-muted)' }}>
              Execution flow — input → process → output
            </p>
          </div>
        </div>

        {/* Run selector + multi-agent dispatch button */}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className="text-[10px]" style={{ color: 'var(--kr-text-muted)' }}>Run:</span>
          <select
            value={selectedRunId ?? ''}
            onChange={e => setSelectedRunId(e.target.value || null)}
            className="border rounded-lg px-2 py-1 text-[11px] text-zinc-300 outline-none transition-colors focus:border-arc-600"
            style={{
              background: 'var(--kr-bg-card)',
              borderColor: 'var(--kr-border-subtle)',
            }}
          >
            {runs.map(r => {
              const label = `${r.status} · ${r.input.slice(0, 40)}${r.input.length > 40 ? '…' : ''}`;
              return <option key={r.id} value={r.id}>{label}</option>;
            })}
          </select>
          <button
            onClick={() => setShowDispatch(d => !d)}
            className="px-2.5 py-1 text-[10px] rounded-lg border transition-colors"
            style={{
              borderColor: showDispatch ? 'var(--kr-border-active)' : 'var(--kr-border-subtle)',
              background: showDispatch ? 'rgba(245,158,11,0.08)' : 'var(--kr-bg-card)',
              color: showDispatch ? 'var(--kr-gold)' : 'var(--kr-text-muted)',
            }}
          >
            ⇢ Multi-agent
          </button>
        </div>
      </div>

      {/* Multi-agent dispatch panel */}
      {showDispatch && (
        <div className="shrink-0 px-6 py-4 border-b space-y-3"
          style={{ borderColor: 'var(--kr-border-subtle)', background: 'var(--kr-bg-panel)' }}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] uppercase tracking-widest font-semibold text-gold-600">Multi-agent dispatch</span>
            <div className="flex gap-1">
              {(['parallel', 'sequential'] as const).map(m => (
                <button key={m} onClick={() => setDispatchMode(m)}
                  className={`px-2.5 py-0.5 text-[10px] rounded border transition-colors ${
                    dispatchMode === m
                      ? 'border-arc-700 bg-arc-950/50 text-arc-300'
                      : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <textarea
            rows={2}
            value={dispatchInput}
            onChange={e => setDispatchInput(e.target.value)}
            placeholder="Input to dispatch to all selected agents…"
            className={INPUT_CLS}
          />
          <div className="flex flex-wrap gap-1.5">
            {agents.map(a => (
              <button key={a.id} onClick={() => toggleDispatchAgent(a.id)}
                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                  dispatchAgents.includes(a.id)
                    ? 'border-arc-600 bg-arc-950/40 text-arc-300'
                    : 'border-zinc-700 text-zinc-500 hover:border-zinc-500'
                }`}>
                {a.name}
              </button>
            ))}
          </div>
          {dispatchError  && <p className="text-red-400 text-[10px]">{dispatchError}</p>}
          {dispatchResult && <p className="text-emerald-400 text-[10px]">{dispatchResult}</p>}
          <button
            onClick={handleDispatch}
            disabled={dispatching}
            className="px-3 py-1.5 text-xs rounded-lg bg-arc-800/40 hover:bg-arc-700/40 border border-arc-700/50 text-arc-300 disabled:opacity-40 transition-colors"
          >
            {dispatching ? 'Dispatching…' : `Run ${dispatchMode}`}
          </button>
        </div>
      )}

      {/* Flow canvas */}
      <div className="flex-1 overflow-auto p-8">
        {!selectedRun || !runAgent ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="text-3xl opacity-10 text-arc-400">⇢</div>
            <p className="text-xs" style={{ color: 'var(--kr-text-muted)' }}>
              No runs yet. Run an agent to see the workflow here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">

            {/* Main flow row: input → agent → output */}
            <div className="flex items-center gap-3 flex-wrap">
              <InputBlock text={selectedRun.input} timestamp={selectedRun.startedAt} />
              <FlowArrow active={selectedRun.status === 'running'} />
              <AgentCard
                agent={runAgent}
                run={selectedRun}
                isActive={selectedRun.status === 'running'}
                isCompleted={selectedRun.status === 'completed'}
              />
              <FlowArrow active={selectedRun.status === 'completed'} />
              <OutputBlock text={selectedRun.output} status={selectedRun.status} />
            </div>

            {/* Stop button for running runs */}
            {selectedRun.status === 'running' && (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleStop(selectedRun.id)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-red-800/50 bg-red-950/30 hover:bg-red-900/40 text-red-400 transition-colors"
                >
                  ■ Stop run
                </button>
                <span className="text-[10px] text-zinc-600">Run {selectedRun.id.slice(0, 8)}</span>
              </div>
            )}

            {/* Error display */}
            {selectedRun.errorMessage && (
              <div className="p-3 rounded-lg border text-xs text-red-400"
                style={{ background: 'rgba(127,29,29,0.15)', borderColor: 'rgba(127,29,29,0.35)' }}>
                Error: {selectedRun.errorMessage}
              </div>
            )}

            {/* Meta row */}
            <div className="pt-4" style={{ borderTop: '1px solid var(--kr-border-subtle)' }}>
              <span className="text-[10px] uppercase tracking-widest font-medium block mb-2"
                style={{ color: 'var(--kr-text-dim)' }}>
                Run metadata
              </span>
              <MetaRow run={selectedRun} />
            </div>
          </div>
        )}
      </div>

      {/* Run history — bottom meta layer */}
      <div className="border-t shrink-0"
        style={{ borderColor: 'var(--kr-border-subtle)', background: 'var(--kr-bg-panel)', maxHeight: 180 }}>
        <div className="px-6 py-2 border-b" style={{ borderColor: 'var(--kr-border-subtle)' }}>
          <span className="text-[10px] uppercase tracking-widest font-medium"
            style={{ color: 'var(--kr-text-dim)' }}>
            Run History
          </span>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <div className="flex gap-2 px-4 py-3" style={{ minWidth: 'max-content' }}>
            {runs.slice(0, 20).map(r => {
              const isSelected = r.id === selectedRunId;
              const agent = agents.find(a => a.id === r.agentId);
              return (
                <button
                  key={r.id}
                  onClick={() => setSelectedRunId(r.id)}
                  className={`flex flex-col gap-1 px-3 py-2 rounded-lg border text-left transition-colors shrink-0
                    ${r.status === 'running' ? 'motion-safe:animate-arc-pulse' : ''}`}
                  style={{
                    minWidth: 140,
                    borderColor: isSelected
                      ? r.status === 'running'
                        ? 'var(--kr-border-signal)'
                        : 'var(--kr-border-active)'
                      : 'var(--kr-border-subtle)',
                    background: isSelected
                      ? r.status === 'running'
                        ? 'var(--kr-arc-dim)'
                        : 'rgba(245,158,11,0.06)'
                      : 'var(--kr-bg-card)',
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[r.status] ?? 'bg-zinc-600'}
                      ${r.status === 'running' ? 'motion-safe:animate-ping' : ''}`} />
                    <span className={`text-[10px] font-mono ${STATUS_TEXT[r.status] ?? 'text-zinc-500'}`}>
                      {r.status}
                    </span>
                    <span className="text-[10px] text-zinc-600">{durationLabel(r)}</span>
                  </div>
                  <span className="text-[10px] text-zinc-400 truncate max-w-[128px]">
                    {agent?.name ?? 'unknown'}
                  </span>
                  <span className="text-[9px] text-zinc-600 truncate max-w-[128px]">
                    {r.input.slice(0, 40)}
                  </span>
                </button>
              );
            })}
            {runs.length === 0 && (
              <span className="text-[10px] py-2" style={{ color: 'var(--kr-text-dim)' }}>
                No runs yet.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
