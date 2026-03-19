import { useState, useEffect, useCallback } from 'react';
import { listAgents, listRuns, agentStats, type Agent, type AgentRun } from '../api.ts';
import { useGatewayContext } from '../GatewayContext.tsx';

// ─── MissionControlPanel ──────────────────────────────────────────────────────
//
// Krythor Mission Control — spatial agent workspace.
//
// Brand palette applied (from MASTER Prompt Phase 2):
//   - deep black / zinc-950 foundation
//   - gold (gold-500 #f59e0b) → orchestration layer, selected hierarchy, premium distinction
//   - arc-blue (arc-500 #1eaeff) → running state, live signal, activity pulse
//   - zinc neutrals → idle surfaces, structure
//   - restrained glow only on active states (not decoration)
//
// Spatial structure (Phase 5):
//   top    → orchestration / control agents (gold accent)
//   middle → active task agents (arc-blue when running)
//   bottom → support / background agents
//
// Animation (Phase 6):
//   running → arc-blue animate-ping dot + kr-glow-arc card shadow
//   all animation respects motion-safe: prefix
//

// ─── Status definitions ───────────────────────────────────────────────────────

type AgentStatus = 'idle' | 'running' | 'failed' | 'stopped';

interface LiveAgentState {
  status:     AgentStatus;
  runId?:     string;
  taskLabel?: string;
  modelUsed?: string;
}

// Dot color — mapped to Krythor palette tokens
const STATUS_DOT: Record<AgentStatus, string> = {
  idle:    'bg-zinc-600',
  running: 'bg-arc-500',
  failed:  'bg-red-400',
  stopped: 'bg-amber-500',
};

const STATUS_TEXT: Record<AgentStatus, string> = {
  idle:    'text-zinc-600',
  running: 'text-arc-400',
  failed:  'text-red-400',
  stopped: 'text-amber-500',
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle:    'idle',
  running: 'running',
  failed:  'error',
  stopped: 'stopped',
};

// ─── Spatial classification ───────────────────────────────────────────────────

function classifyRow(agent: Agent): 'top' | 'middle' | 'bottom' {
  const tags = agent.tags.map(t => t.toLowerCase());
  const name = agent.name.toLowerCase();
  const desc = agent.description.toLowerCase();
  if (tags.some(t => /orchestrat|control|router|coordinator|dispatch/.test(t)) ||
      /orchestrat|coordinator|dispatch/.test(name + ' ' + desc)) return 'top';
  if (tags.some(t => /support|monitor|memory|log|background|hygiene|cleanup/.test(t)) ||
      /support|monitor|background/.test(name + ' ' + desc)) return 'bottom';
  return 'middle';
}

function isOrchestrator(agent: Agent): boolean {
  return classifyRow(agent) === 'top';
}

// ─── Model helpers ────────────────────────────────────────────────────────────

function modelShortName(modelUsed?: string): string {
  if (!modelUsed) return '';
  const part = modelUsed.split('/').pop() ?? modelUsed;
  return part.length > 16 ? part.slice(0, 14) + '…' : part;
}

function isLocalModel(modelUsed?: string): boolean {
  if (!modelUsed) return false;
  return /ollama|local|llama|mistral|phi|gemma|qwen/i.test(modelUsed);
}

// ─── AgentNode ────────────────────────────────────────────────────────────────

function AgentNode({ agent, live }: { agent: Agent; live: LiveAgentState }) {
  const [hovered, setHovered] = useState(false);
  const isRunning = live.status === 'running';
  const isOrch = isOrchestrator(agent);
  const model = live.modelUsed ?? agent.modelId;
  const modelLabel = modelShortName(model);
  const local = isLocalModel(model);

  // Card border + shadow — gold for orchestrators, arc-blue for running, subtle for idle
  const cardBorder = isRunning
    ? 'border-arc-700/60 kr-card-active'
    : isOrch
      ? 'border-gold-800/50 kr-card-gold'
      : 'border-zinc-800';

  return (
    <div
      className={`relative flex flex-col gap-2 p-3 rounded-xl border transition-all duration-300 cursor-default select-none
        bg-zinc-900 ${cardBorder}
        ${hovered ? 'bg-zinc-800/80' : ''}
      `}
      style={{ minWidth: 148, maxWidth: 186 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Arc-blue ping on running — respects reduced-motion */}
      {isRunning && (
        <span
          className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-arc-400 motion-safe:animate-ping opacity-80"
          aria-hidden="true"
        />
      )}

      {/* Orchestrator gold top-bar accent */}
      {isOrch && (
        <span
          className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-gold-600/60 to-transparent rounded-full"
          aria-hidden="true"
        />
      )}

      {/* Status dot + name */}
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[live.status]}`} />
        <span className={`text-xs font-semibold truncate flex-1 ${isOrch ? 'text-gold-300' : 'text-zinc-200'}`}>
          {agent.name}
        </span>
      </div>

      {/* Status label */}
      <span className={`text-[10px] font-mono ${STATUS_TEXT[live.status]}`}>
        {STATUS_LABEL[live.status]}
      </span>

      {/* Current task — visible when running or hovered */}
      {live.taskLabel && (isRunning || hovered) && (
        <p className="text-zinc-500 text-[10px] leading-snug truncate" title={live.taskLabel}>
          {live.taskLabel}
        </p>
      )}

      {/* Model badge */}
      {modelLabel && (
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`h-1 w-1 rounded-full shrink-0 ${local ? 'bg-emerald-400' : 'bg-arc-400'}`} />
          <span className="text-[10px] text-zinc-500 font-mono truncate">{modelLabel}</span>
          <span className={`ml-auto text-[9px] px-1 py-0.5 rounded font-medium
            ${local
              ? 'text-emerald-600 bg-emerald-950/60'
              : 'text-arc-500 bg-arc-950/60'
            }`}>
            {local ? 'local' : 'cloud'}
          </span>
        </div>
      )}

      {/* Description — hover only */}
      {hovered && agent.description && (
        <p className="text-[10px] text-zinc-600 leading-snug border-t border-zinc-800 pt-1.5 mt-0.5">
          {agent.description.slice(0, 80)}{agent.description.length > 80 ? '…' : ''}
        </p>
      )}
    </div>
  );
}

// ─── Zone row ─────────────────────────────────────────────────────────────────

function ZoneRow({
  zone,
  label,
  sublabel,
  agents,
  liveStates,
}: {
  zone: 'top' | 'middle' | 'bottom';
  label: string;
  sublabel: string;
  agents: Agent[];
  liveStates: Map<string, LiveAgentState>;
}) {
  if (agents.length === 0) return null;

  const labelColor = zone === 'top'
    ? 'text-gold-600'
    : zone === 'middle'
      ? 'text-arc-700'
      : 'text-zinc-600';

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span className={`text-[10px] uppercase tracking-widest font-semibold ${labelColor}`}>{label}</span>
        <span className="text-[10px] text-zinc-700">{sublabel}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {agents.map(a => (
          <AgentNode
            key={a.id}
            agent={a}
            live={liveStates.get(a.id) ?? { status: 'idle' }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({
  stats,
  activeCount,
}: {
  stats: { agentCount: number; totalRuns: number } | null;
  activeCount: number;
}) {
  return (
    <div className="flex items-center gap-5 text-xs">
      <span className="text-zinc-600">
        <span className="text-zinc-300 font-semibold">{stats?.agentCount ?? 0}</span> agents
      </span>
      <span className="text-zinc-600">
        <span className={activeCount > 0 ? 'text-arc-400 font-semibold' : 'text-zinc-300 font-semibold'}>
          {activeCount}
        </span> active
      </span>
      <span className="text-zinc-600">
        <span className="text-zinc-300 font-semibold">{stats?.totalRuns ?? 0}</span> runs
      </span>
    </div>
  );
}

// ─── Recent run entry ─────────────────────────────────────────────────────────

function RunEntry({ run }: { run: AgentRun }) {
  const statusColor: Record<string, string> = {
    completed: 'text-emerald-400',
    running:   'text-arc-400',
    failed:    'text-red-400',
    stopped:   'text-amber-400',
  };
  const dur = run.completedAt
    ? `${((run.completedAt - run.startedAt) / 1000).toFixed(1)}s`
    : '…';

  return (
    <div className="flex items-start gap-2 py-2 border-b border-zinc-800/50 last:border-0">
      <span className={`text-[10px] font-mono mt-0.5 w-16 shrink-0 ${statusColor[run.status] ?? 'text-zinc-600'}`}>
        {run.status}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-zinc-300 truncate">{run.input}</p>
        {run.modelUsed && (
          <p className="text-[10px] text-zinc-600 font-mono mt-0.5">
            {modelShortName(run.modelUsed)} · {dur}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex items-center gap-5 px-6 py-2.5 border-t border-zinc-800/60">
      <div className="flex items-center gap-4 text-[10px] text-zinc-600">
        {[
          { dot: 'bg-zinc-600',  label: 'idle'    },
          { dot: 'bg-arc-500',   label: 'running' },
          { dot: 'bg-red-400',   label: 'error'   },
          { dot: 'bg-amber-500', label: 'stopped' },
        ].map(({ dot, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-4 text-[10px] text-zinc-600">
        <div className="flex items-center gap-1.5">
          <span className="h-px w-5 bg-gold-700" />
          <span className="text-gold-600">orchestration</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-1 w-1 rounded-full bg-emerald-400" />
          <span>local</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-1 w-1 rounded-full bg-arc-400" />
          <span>cloud</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const POLL_MS = 8_000;

export function MissionControlPanel() {
  const { events } = useGatewayContext();
  const [agents, setAgents]         = useState<Agent[]>([]);
  const [runs, setRuns]             = useState<AgentRun[]>([]);
  const [stats, setStats]           = useState<{ agentCount: number; totalRuns: number } | null>(null);
  const [loading, setLoading]       = useState(true);
  const [liveStates, setLiveStates] = useState<Map<string, LiveAgentState>>(new Map());

  const loadData = useCallback(async () => {
    try {
      const [agentList, runList, s] = await Promise.all([
        listAgents(),
        listRuns(),
        agentStats(),
      ]);
      setAgents(agentList);
      setRuns(runList.slice(0, 30));
      setStats(s);
      setLoading(false);
    } catch { setLoading(false); }
  }, []);

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, POLL_MS);
    return () => clearInterval(id);
  }, [loadData]);

  // Derive live states from WebSocket events
  useEffect(() => {
    setLiveStates(prev => {
      const next = new Map(prev);
      for (const ev of events) {
        if (ev.type !== 'agent:event') continue;
        const ae = ev.payload as { type: string; agentId: string; runId: string; payload?: unknown };
        if (!ae?.agentId) continue;
        if (ae.type === 'run:started') {
          next.set(ae.agentId, { status: 'running', runId: ae.runId });
        } else if (ae.type === 'run:completed') {
          const p = ae.payload as { modelUsed?: string } | undefined;
          next.set(ae.agentId, { status: 'idle', modelUsed: p?.modelUsed });
        } else if (ae.type === 'run:failed') {
          next.set(ae.agentId, { status: 'failed', runId: ae.runId });
        } else if (ae.type === 'run:stopped') {
          next.set(ae.agentId, { status: 'stopped', runId: ae.runId });
        } else if (ae.type === 'run:turn') {
          const p = ae.payload as { message?: { content?: string } } | undefined;
          next.set(ae.agentId, {
            ...next.get(ae.agentId),
            status: 'running',
            taskLabel: p?.message?.content?.slice(0, 60),
          });
        }
      }
      return next;
    });
  }, [events]);

  // Seed from polling data (catches runs before WS connected)
  useEffect(() => {
    setLiveStates(prev => {
      const next = new Map(prev);
      const byAgent = new Map<string, AgentRun>();
      for (const r of runs) {
        const ex = byAgent.get(r.agentId);
        if (!ex || r.startedAt > ex.startedAt) byAgent.set(r.agentId, r);
      }
      for (const [agentId, run] of byAgent) {
        if (next.get(agentId)?.status === 'running') continue;
        const status: AgentStatus =
          run.status === 'completed' ? 'idle'    :
          run.status === 'running'   ? 'running' :
          run.status === 'failed'    ? 'failed'  : 'stopped';
        next.set(agentId, { status, modelUsed: run.modelUsed });
      }
      return next;
    });
  }, [runs]);

  const topAgents    = agents.filter(a => classifyRow(a) === 'top');
  const middleAgents = agents.filter(a => classifyRow(a) === 'middle');
  const bottomAgents = agents.filter(a => classifyRow(a) === 'bottom');
  const activeCount  = Array.from(liveStates.values()).filter(s => s.status === 'running').length;
  const recentRuns   = runs.slice(0, 14);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950">
        <span className="text-zinc-700 text-xs font-mono">initializing…</span>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden" style={{ background: 'var(--kr-bg-primary)' }}>

      {/* ── Main canvas ───────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800/60">
          <div>
            <h2 className="text-sm font-semibold tracking-widest text-zinc-100 font-mono uppercase">
              Mission Control
            </h2>
            <p className="text-[10px] text-zinc-600 mt-0.5 tracking-wide">
              Agent workspace — live system state
            </p>
          </div>
          <StatsBar stats={stats} activeCount={activeCount} />
        </div>

        {/* Canvas — subtle crosshair dot grid */}
        <div
          className="flex-1 overflow-y-auto px-8 py-7 space-y-10 scrollbar-thin"
          style={{
            backgroundImage: 'radial-gradient(circle, #27272a 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        >
          {agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <div className="text-3xl opacity-10 text-gold-500">⬡</div>
              <p className="text-zinc-600 text-xs">No agents configured.</p>
              <p className="text-zinc-700 text-[10px]">Create agents in the Agents tab to see them here.</p>
            </div>
          ) : (
            <>
              {/* ── Orchestration zone (gold) ── */}
              {topAgents.length > 0 && (
                <div className="pb-6 border-b border-gold-900/30">
                  <ZoneRow
                    zone="top"
                    label="Orchestration"
                    sublabel="control · routing · coordination"
                    agents={topAgents}
                    liveStates={liveStates}
                  />
                </div>
              )}

              {/* ── Active tasks zone (arc-blue when running) ── */}
              <ZoneRow
                zone="middle"
                label="Active Tasks"
                sublabel="processing · generation · analysis"
                agents={middleAgents.length > 0 ? middleAgents : (topAgents.length === 0 ? agents : [])}
                liveStates={liveStates}
              />

              {/* ── Support zone ── */}
              {bottomAgents.length > 0 && (
                <div className="pt-6 border-t border-zinc-800/40">
                  <ZoneRow
                    zone="bottom"
                    label="Support"
                    sublabel="memory · monitoring · background"
                    agents={bottomAgents}
                    liveStates={liveStates}
                  />
                </div>
              )}
            </>
          )}
        </div>

        <Legend />
      </div>

      {/* ── Activity sidebar ──────────────────────────────────────────────── */}
      <div
        className="w-60 border-l border-zinc-800/60 flex flex-col shrink-0"
        style={{ background: 'var(--kr-bg-panel)' }}
      >
        <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center gap-2">
          {activeCount > 0 && (
            <span className="h-1.5 w-1.5 rounded-full bg-arc-400 motion-safe:animate-pulse" />
          )}
          <span className="text-[10px] uppercase tracking-widest text-zinc-600 font-semibold">
            Recent Runs
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2 scrollbar-thin">
          {recentRuns.length === 0 ? (
            <p className="text-zinc-700 text-[10px] pt-6 text-center">No runs yet.</p>
          ) : (
            recentRuns.map(r => <RunEntry key={r.id} run={r} />)
          )}
        </div>
      </div>
    </div>
  );
}
