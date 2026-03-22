import React, { useState } from 'react';
import type { CommandCenterAgent } from '../types';
import { AgentGlyph } from './AgentGlyph';
import { AgentRings } from './AgentRings';
import { TaskBubble } from './TaskBubble';
import { AgentTooltip } from './AgentTooltip';

interface AgentEntityProps {
  agent: CommandCenterAgent;
  isFocused: boolean;
  isDimmed: boolean; // true when another agent is focused
  onFocus: () => void;
  memoryPulse?: boolean; // flash when memory recalled
}

const ENTITY_SIZE = 52;
const CORE_SIZE = 32;

const STATE_CORE_BG: Record<string, string> = {
  idle:      'rgba(255,255,255,0.04)',
  listening: 'rgba(30,174,255,0.12)',
  thinking:  'rgba(129,140,248,0.15)',
  working:   'rgba(30,174,255,0.2)',
  speaking:  'rgba(245,158,11,0.18)',
  handoff:   'rgba(167,139,250,0.2)',
  error:     'rgba(248,113,113,0.25)',
  offline:   'rgba(0,0,0,0.4)',
};

const BODY_ANIM: Record<string, string> = {
  idle:      'cc-float 3s ease-in-out infinite',
  listening: 'cc-float 2s ease-in-out infinite',
  thinking:  'cc-flicker 0.45s ease-in-out infinite',
  working:   'cc-float 1.5s ease-in-out infinite',
  speaking:  'cc-float 2.5s ease-in-out infinite',
  handoff:   '',
  error:     'cc-strobe 0.3s ease-in-out 6',
  offline:   '',
};

// Abbreviate model IDs for the scene badge
function shortModel(modelId: string): string {
  if (modelId.includes('opus')) return 'OPUS';
  if (modelId.includes('sonnet')) return 'SNT';
  if (modelId.includes('haiku')) return 'HAI';
  if (modelId.includes('gpt-4o')) return 'GPT4o';
  if (modelId.includes('gpt-4')) return 'GPT4';
  if (modelId.includes('gpt-3')) return 'GPT3';
  if (modelId.includes('gemini')) return 'GEM';
  if (modelId.includes('mistral')) return 'MST';
  // fallback: first 5 chars uppercased
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
        opacity: isDimmed ? 0.25 : 1,
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

      {/* Outer animated rings */}
      <AgentRings
        color={agent.themeColor}
        glowColor={agent.glowColor}
        state={agent.currentState}
        size={ENTITY_SIZE}
      />

      {/* Memory recall pulse overlay */}
      {memoryPulse && (
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background: 'transparent',
            boxShadow: `0 0 28px 10px rgba(147,197,253,0.55)`,
            animation: 'cc-ring 0.8s ease-out 2',
          }}
        />
      )}

      {/* Core body */}
      <div
        className="absolute rounded-xl flex items-center justify-center transition-all duration-300"
        style={{
          width: `${CORE_SIZE}px`,
          height: `${CORE_SIZE}px`,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: STATE_CORE_BG[agent.currentState] ?? STATE_CORE_BG.idle,
          border: `1.5px solid ${agent.currentState === 'error' ? '#f87171' : agent.themeColor}`,
          boxShadow: isOffline
            ? 'none'
            : `0 0 12px 2px ${agent.glowColor}, inset 0 0 8px ${agent.glowColor}`,
          animation: BODY_ANIM[agent.currentState] ?? '',
          opacity: isOffline ? 0.3 : 1,
        }}
      >
        <AgentGlyph
          role={agent.role}
          color={agent.currentState === 'error' ? '#f87171' : agent.themeColor}
          animState={agent.currentState}
        />
      </div>

      {/* Focus ring */}
      {(isFocused || hovered) && (
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            border: `1px solid ${agent.themeColor}`,
            boxShadow: `0 0 16px 4px ${agent.glowColor}`,
            opacity: 0.6,
          }}
        />
      )}

      {/* Name + state label */}
      <div
        className="absolute left-1/2 -translate-x-1/2 text-center pointer-events-none whitespace-nowrap"
        style={{ top: `${ENTITY_SIZE + 4}px` }}
      >
        <div
          className="text-[9px] font-mono font-bold tracking-widest uppercase"
          style={{ color: isOffline ? '#3f3f46' : agent.themeColor }}
        >
          {agent.displayName}
        </div>
        <div className="text-[8px] font-mono text-zinc-700 tracking-wide">
          {agent.currentState}
        </div>
      </div>

      {/* Local/remote badge — bottom-right of entity */}
      {!isOffline && agent.localOrRemote !== 'unknown' && (
        <div
          className="absolute pointer-events-none"
          style={{
            right: -2,
            bottom: -2,
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

      {/* Model badge — top-right when model is assigned and agent is active */}
      {agent.assignedModel && !isOffline && agent.currentState !== 'idle' && (
        <div
          className="absolute pointer-events-none"
          style={{
            right: -4,
            top: -2,
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
            maxWidth: '40px',
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
