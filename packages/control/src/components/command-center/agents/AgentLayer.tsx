import React, { useRef, useState, useEffect } from 'react';
import type { CommandCenterAgent } from '../types';
import { AgentEntity } from './AgentEntity';
import { HandoffArc } from '../scene/HandoffArc';

interface AgentLayerProps {
  agents: CommandCenterAgent[];
  focusedAgentId: string | null;
  onFocusAgent: (id: string | null) => void;
  memoryPulseAgentId?: string | null; // agent to flash on memory recall
}

export function AgentLayer({ agents, focusedAgentId, onFocusAgent, memoryPulseAgentId }: AgentLayerProps): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 500 });

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setDims({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Find handoff pairs: agent in 'handoff' state with targetZone → find target agent
  const handoffPairs = agents
    .filter(a => a.currentState === 'handoff' && a.targetZone)
    .map(a => {
      const target = agents.find(t => t.homeZone === a.targetZone);
      return target ? { from: a, to: target } : null;
    })
    .filter((pair): pair is { from: CommandCenterAgent; to: CommandCenterAgent } => pair !== null);

  const hasFocus = focusedAgentId !== null;

  return (
    <div ref={containerRef} className="absolute inset-0">
      {/* Handoff arcs */}
      {handoffPairs.map(pair => (
        <HandoffArc
          key={`${pair.from.id}->${pair.to.id}`}
          from={pair.from}
          to={pair.to}
          color={pair.from.themeColor}
          sceneWidth={dims.w}
          sceneHeight={dims.h}
        />
      ))}

      {/* Agent entities */}
      {agents.map(agent => (
        <AgentEntity
          key={agent.id}
          agent={agent}
          isFocused={focusedAgentId === agent.id}
          isDimmed={hasFocus && focusedAgentId !== agent.id}
          onFocus={() => onFocusAgent(focusedAgentId === agent.id ? null : agent.id)}
          memoryPulse={memoryPulseAgentId === agent.id}
        />
      ))}
    </div>
  );
}
