import React, { useState } from 'react';
import type { CommandCenterAgent } from '../types';
import { AgentBody } from './AgentBody';
import { AgentRings } from './AgentRings';
import { TaskBubble } from './TaskBubble';
import { AgentTooltip } from './AgentTooltip';

interface AgentEntityProps {
  agent: CommandCenterAgent;
  isFocused: boolean;
  isDimmed: boolean;
  onFocus: () => void;
  memoryPulse?: boolean;
}

// Total hit-area / ring container size
const ENTITY_SIZE = 56;
// Body SVG size — slightly smaller than entity to leave room for rings
const BODY_SIZE = 44;

// Abbreviate model IDs for the scene badge
function shortModel(modelId: string): string {
  if (modelId.includes('opus'))    return 'OPUS';
  if (modelId.includes('sonnet'))  return 'SNT';
  if (modelId.includes('haiku'))   return 'HAI';
  if (modelId.includes('gpt-4o')) return 'GPT4o';
  if (modelId.includes('gpt-4'))   return 'GPT4';
  if (modelId.includes('gpt-3'))   return 'GPT3';
  if (modelId.includes('gemini'))  return 'GEM';
  if (modelId.includes('mistral')) return 'MST';
  return modelId.slice(0, 5).toUpperCase();
}

export function AgentEntity({ agent, isFocused, isDimmed, onFocus, memoryPulse }: AgentEntityProps): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const showTaskActive = agent.currentState === 'working' || agent.currentState === 'thinking';
  const isOffline = agent.currentState === 'offline';

  return (
    <div
      className="absolute"
      style={{
        left: `${agent.position.x}%`,
        top: `${agent.position.y}%`,
        transform: 'translate(-50%, -50%)',
        width: `${ENTITY_SIZE}px`,
        height: `${ENTITY_SIZE}px`,
        transition: 'left 700ms cubic-bezier(0.4,0,0.2,1), top 700ms cubic-bezier(0.4,0,0.2,1), opacity 400ms ease',
        zIndex: isFocused ? 20 : 10,
        opacity: isDimmed ? 0.2 : 1,
        pointerEvents: 'auto',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onFocus}
    >
      {/* Tooltip */}
      <AgentTooltip agent={agent} visible={hovered} />

      {/* Task bubble */}
      {showTaskActive && agent.currentTask && (
        <TaskBubble
          text={agent.currentTask}
          color={agent.themeColor}
          visible={true}
        />
      )}

      {/* Orbital rings — sits behind the body */}
      <AgentRings
        color={agent.themeColor}
        glowColor={agent.glowColor}
        state={agent.currentState}
        size={ENTITY_SIZE}
      />

      {/* Agent body — full custom SVG silhouette, centered */}
      <div
        className="absolute"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: `${BODY_SIZE}px`,
          height: `${BODY_SIZE}px`,
          // Float animation wraps the whole body for idle/working states
          animation: isOffline ? 'none'
            : agent.currentState === 'idle' ? 'cc-float 3.5s ease-in-out infinite'
            : agent.currentState === 'working' ? 'cc-float 1.8s ease-in-out infinite'
            : agent.currentState === 'listening' ? 'cc-float 2.2s ease-in-out infinite'
            : '',
          filter: isOffline ? 'grayscale(1) brightness(0.3)'
            : isFocused ? `drop-shadow(0 0 6px ${agent.themeColor})`
            : undefined,
          transition: 'filter 300ms ease',
        }}
      >
        <AgentBody
          role={agent.role}
          color={agent.currentState === 'error' ? '#f87171' : agent.themeColor}
          glowColor={agent.glowColor}
          state={agent.currentState}
          size={BODY_SIZE}
        />
      </div>

      {/* Memory recall pulse overlay */}
      {memoryPulse && (
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            boxShadow: `0 0 32px 12px rgba(147,197,253,0.6)`,
            animation: 'cc-ring 0.9s ease-out 2',
          }}
        />
      )}

      {/* Focus ring */}
      {(isFocused || hovered) && (
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            border: `1px solid ${agent.themeColor}`,
            boxShadow: `0 0 18px 5px ${agent.glowColor}`,
            opacity: 0.55,
          }}
        />
      )}

      {/* Name label */}
      <div
        className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none whitespace-nowrap"
        style={{ top: `${ENTITY_SIZE + 6}px` }}
      >
        <div
          className="text-[11px] font-mono font-bold tracking-widest uppercase"
          style={{ color: isOffline ? '#3f3f46' : agent.themeColor }}
        >
          {agent.displayName}
        </div>
        <div className="text-[10px] font-mono tracking-wide" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {agent.currentState}
        </div>
      </div>

      {/* Local/remote badge — bottom-right */}
      {!isOffline && agent.localOrRemote !== 'unknown' && (
        <div
          className="absolute pointer-events-none"
          style={{
            right: -1,
            bottom: -1,
            fontSize: '7px',
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            lineHeight: 1,
            color: agent.localOrRemote === 'local' ? '#4ade80' : '#facc15',
            background: 'rgba(10,10,18,0.85)',
            border: `1px solid ${agent.localOrRemote === 'local' ? 'rgba(74,222,128,0.3)' : 'rgba(250,204,21,0.3)'}`,
            borderRadius: '3px',
            padding: '1px 3px',
          }}
        >
          {agent.localOrRemote === 'local' ? 'LC' : 'RM'}
        </div>
      )}

      {/* Model badge — top-right when active */}
      {agent.assignedModel && !isOffline && agent.currentState !== 'idle' && (
        <div
          className="absolute pointer-events-none"
          style={{
            right: -3,
            top: -1,
            fontSize: '7px',
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: '0.04em',
            lineHeight: 1,
            color: agent.themeColor,
            background: 'rgba(10,10,18,0.9)',
            border: `1px solid ${agent.glowColor}`,
            borderRadius: '3px',
            padding: '1px 3px',
            maxWidth: '42px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {shortModel(agent.assignedModel)}
        </div>
      )}
    </div>
  );
}
