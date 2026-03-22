import React from 'react';
import type { CommandCenterAgent } from '../types';

interface LeftPanelProps {
  agents: CommandCenterAgent[];
  isDemo: boolean;
  focusedAgentId: string | null;
  onFocusAgent: (id: string | null) => void;
  activeRunCount: number;
  connectionState: string;
}

const ROLE_LABEL: Record<string, string> = {
  orchestrator: 'Orchestrator',
  builder:      'Builder',
  researcher:   'Researcher',
  archivist:    'Archivist',
  monitor:      'Monitor',
};

const STATE_COLOR: Record<string, string> = {
  idle:      '#52525b',
  listening: '#1eaeff',
  thinking:  '#818cf8',
  working:   '#1eaeff',
  speaking:  '#f59e0b',
  handoff:   '#a78bfa',
  error:     '#f87171',
  offline:   '#3f3f46',
};

export function LeftPanel({ agents, isDemo, focusedAgentId, onFocusAgent, activeRunCount, connectionState }: LeftPanelProps): React.ReactElement {
  const orchestrator = agents.find(a => a.role === 'orchestrator');

  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden">

      {/* Crest */}
      <div className="flex-shrink-0 border border-zinc-800 rounded-xl p-3 text-center"
        style={{ background: 'rgba(245,158,11,0.04)' }}>

        {/* Connection status */}
        <div className="flex items-center justify-center gap-1.5 mb-2">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            connectionState === 'connected' ? 'bg-emerald-400 animate-pulse' :
            connectionState === 'degraded' ? 'bg-amber-400 animate-pulse' :
            connectionState === 'connecting' || connectionState === 'reconnecting' ? 'bg-arc-400 animate-pulse' :
            'bg-zinc-600'
          }`} />
          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wide">
            {connectionState === 'connected' ? 'online' :
             connectionState === 'degraded' ? 'degraded' :
             connectionState === 'connecting' ? 'connecting' :
             connectionState === 'reconnecting' ? 'reconnecting' :
             'offline'}
          </span>
        </div>

        <div className="text-[10px] font-mono tracking-[0.3em] uppercase text-gold-500 mb-0.5">⬡ Krythor</div>
        <div className="text-[9px] font-mono tracking-[0.15em] text-zinc-600 uppercase">Command Center</div>
      </div>

      {/* Orchestrator summary */}
      {orchestrator && (
        <div className="flex-shrink-0 border border-zinc-800 rounded-xl p-3"
          style={{ background: 'rgba(245,158,11,0.03)' }}>
          <div className="text-[9px] font-mono tracking-[0.2em] uppercase text-zinc-600 mb-2">Prime Agent</div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full animate-pulse flex-shrink-0"
              style={{ background: STATE_COLOR[orchestrator.currentState] ?? '#52525b' }} />
            <span className="text-xs font-mono font-bold text-gold-400">{orchestrator.displayName}</span>
          </div>
          {orchestrator.currentTask && (
            <div className="mt-1.5 text-[10px] font-mono text-zinc-500 truncate">
              {orchestrator.currentTask}
            </div>
          )}
          <div className="mt-1 text-[9px] font-mono tracking-wide uppercase"
            style={{ color: STATE_COLOR[orchestrator.currentState] ?? '#52525b' }}>
            {orchestrator.currentState}
          </div>
        </div>
      )}

      {/* Agent roster */}
      <div className="flex-1 min-h-0 border border-zinc-800 rounded-xl p-3 overflow-y-auto scrollbar-thin">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] font-mono tracking-[0.2em] uppercase text-zinc-600">Sentinels</div>
          {activeRunCount > 0 && (
            <div className="text-[9px] font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(30,174,255,0.1)', color: '#1eaeff', border: '1px solid rgba(30,174,255,0.2)' }}>
              {activeRunCount} active
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => onFocusAgent(focusedAgentId === agent.id ? null : agent.id)}
              className="w-full text-left rounded-lg p-2 transition-all duration-200 border"
              style={{
                borderColor: focusedAgentId === agent.id ? agent.themeColor : 'transparent',
                background: focusedAgentId === agent.id
                  ? `${agent.glowColor}`
                  : 'rgba(255,255,255,0.02)',
              }}
            >
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors duration-300"
                  style={{ background: STATE_COLOR[agent.currentState] ?? '#52525b' }} />
                <span className="text-[11px] font-mono font-semibold flex-1 truncate"
                  style={{ color: agent.themeColor }}>
                  {agent.displayName}
                </span>
                {agent.localOrRemote !== 'unknown' && (
                  <span
                    className="text-[7px] font-mono font-bold px-1 rounded"
                    style={{
                      color: agent.localOrRemote === 'local' ? '#4ade80' : '#facc15',
                      background: agent.localOrRemote === 'local' ? 'rgba(74,222,128,0.08)' : 'rgba(250,204,21,0.08)',
                    }}
                  >
                    {agent.localOrRemote === 'local' ? 'LC' : 'RM'}
                  </span>
                )}
              </div>
              <div className="text-[10px] font-mono text-zinc-500 mt-0.5 ml-3.5 flex items-center gap-2">
                <span>{ROLE_LABEL[agent.role]} · {agent.currentState}</span>
                {agent.assignedModel && (
                  <span
                    className="text-[8px] font-mono truncate"
                    style={{ color: agent.themeColor, opacity: 0.7, maxWidth: '64px' }}
                  >
                    {agent.assignedModel.split('/').pop()?.slice(0, 12) ?? agent.assignedModel.slice(0, 12)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Demo indicator */}
      {isDemo && (
        <div className="flex-shrink-0 border border-zinc-800 rounded-lg px-3 py-1.5 text-center">
          <span className="text-[9px] font-mono text-zinc-600 tracking-wide">
            ◉ DEMO MODE
          </span>
        </div>
      )}
    </div>
  );
}
