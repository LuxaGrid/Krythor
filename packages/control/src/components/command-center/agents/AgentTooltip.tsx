import React from 'react';
import type { CommandCenterAgent } from '../types';

interface AgentTooltipProps {
  agent: CommandCenterAgent;
  visible: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  orchestrator: 'Orchestrator',
  builder: 'Builder',
  researcher: 'Researcher',
  archivist: 'Archivist',
  monitor: 'Monitor',
};

const STATE_LABELS: Record<string, string> = {
  idle: '● Idle',
  listening: '◎ Listening',
  thinking: '◈ Thinking',
  working: '⬡ Working',
  speaking: '◉ Speaking',
  handoff: '→ Handoff',
  error: '✕ Error',
  offline: '○ Offline',
};

export function AgentTooltip({ agent, visible }: AgentTooltipProps): React.ReactElement {
  return (
    <div
      className="absolute pointer-events-none transition-all duration-200 z-50"
      style={{
        bottom: '110%',
        left: '50%',
        transform: 'translateX(-50%)',
        opacity: visible ? 1 : 0,
        minWidth: '140px',
      }}
    >
      <div
        className="rounded-lg p-2.5 text-left"
        style={{
          background: 'rgba(9,9,11,0.96)',
          border: `1px solid ${agent.themeColor}`,
          boxShadow: `0 0 16px ${agent.glowColor}`,
        }}
      >
        {/* Name + role */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: agent.themeColor }} />
          <span className="text-[11px] font-mono font-bold" style={{ color: agent.themeColor }}>
            {agent.displayName}
          </span>
        </div>
        <div className="text-[9px] font-mono text-zinc-500 mb-1">
          {ROLE_LABELS[agent.role]}
        </div>

        {/* State */}
        <div className="text-[10px] font-mono mb-1" style={{
          color: agent.currentState === 'error' ? '#f87171'
            : agent.currentState === 'offline' ? '#52525b'
            : agent.themeColor
        }}>
          {STATE_LABELS[agent.currentState]}
        </div>

        {/* Task */}
        {agent.currentTask && (
          <div className="text-[9px] font-mono text-zinc-500 truncate max-w-[130px] mb-1">
            {agent.currentTask}
          </div>
        )}

        {/* Model */}
        {agent.assignedModel && (
          <div className="text-[9px] font-mono text-zinc-600">
            ⬡ {agent.assignedModel}
          </div>
        )}

        {/* Zone */}
        <div className="text-[9px] font-mono text-zinc-700 mt-1 border-t border-zinc-800 pt-1">
          Zone: {agent.currentZone}
        </div>

        {/* Local/remote */}
        <div className="text-[9px] font-mono text-zinc-700">
          {agent.localOrRemote === 'local' ? '◎ local' : agent.localOrRemote === 'remote' ? '◉ remote' : '○ unknown'}
        </div>
      </div>
    </div>
  );
}
