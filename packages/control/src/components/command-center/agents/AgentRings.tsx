import React from 'react';
import type { AgentAnimationState } from '../types';

interface AgentRingsProps {
  color: string;
  glowColor: string;
  state: AgentAnimationState;
  size: number; // total diameter in px
}

export function AgentRings({ color, glowColor: _glowColor, state, size }: AgentRingsProps): React.ReactElement {
  const r = size / 2;
  const ring1R = r - 4;
  const ring2R = r - 1;

  // Outer ring config per state
  const configs: Record<AgentAnimationState, {
    ring1Opacity: number;
    ring2Opacity: number;
    ring1Dash: string;
    ring2Dash: string;
    ring1Anim: string;
    ring2Anim: string;
  }> = {
    idle: {
      ring1Opacity: 0.2, ring2Opacity: 0.08,
      ring1Dash: 'none', ring2Dash: 'none',
      ring1Anim: '', ring2Anim: '',
    },
    listening: {
      ring1Opacity: 0.5, ring2Opacity: 0.2,
      ring1Dash: '4 4', ring2Dash: 'none',
      ring1Anim: 'cc-scan 2s linear infinite', ring2Anim: 'cc-ring 3s linear infinite reverse',
    },
    thinking: {
      ring1Opacity: 0.4, ring2Opacity: 0.15,
      ring1Dash: '2 6', ring2Dash: '1 3',
      ring1Anim: 'cc-ring 1.8s linear infinite', ring2Anim: 'cc-ring 3s linear infinite reverse',
    },
    working: {
      ring1Opacity: 0.8, ring2Opacity: 0.4,
      ring1Dash: '3 3', ring2Dash: 'none',
      ring1Anim: 'cc-spin-fast 0.75s linear infinite', ring2Anim: 'cc-ring 2s linear infinite reverse',
    },
    speaking: {
      ring1Opacity: 0.9, ring2Opacity: 0.5,
      ring1Dash: 'none', ring2Dash: 'none',
      ring1Anim: 'cc-ring 2s linear infinite', ring2Anim: '',
    },
    handoff: {
      ring1Opacity: 1, ring2Opacity: 0.6,
      ring1Dash: '2 2', ring2Dash: '4 4',
      ring1Anim: 'cc-spin-fast 0.5s linear infinite', ring2Anim: 'cc-scan 1s linear infinite',
    },
    error: {
      ring1Opacity: 1, ring2Opacity: 0.8,
      ring1Dash: 'none', ring2Dash: 'none',
      ring1Anim: 'cc-strobe 0.3s ease-in-out 6', ring2Anim: '',
    },
    offline: {
      ring1Opacity: 0.08, ring2Opacity: 0.04,
      ring1Dash: 'none', ring2Dash: 'none',
      ring1Anim: '', ring2Anim: '',
    },
  };

  const cfg = configs[state];
  const errorColor = '#f87171';
  const activeColor = state === 'error' ? errorColor : color;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
    >
      {/* Glow filter */}
      <defs>
        <filter id={`glow-${color.replace('#', '')}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer ambient glow ring */}
      {state !== 'offline' && (
        <circle
          cx={r} cy={r} r={ring2R}
          fill="none"
          stroke={activeColor}
          strokeWidth="1"
          opacity={cfg.ring2Opacity}
          strokeDasharray={cfg.ring2Dash}
          style={cfg.ring2Anim ? { animation: cfg.ring2Anim, transformOrigin: `${r}px ${r}px` } : undefined}
        />
      )}

      {/* Main animated ring */}
      <circle
        cx={r} cy={r} r={ring1R}
        fill="none"
        stroke={activeColor}
        strokeWidth={state === 'working' || state === 'handoff' ? '1.5' : '1'}
        opacity={cfg.ring1Opacity}
        strokeDasharray={cfg.ring1Dash}
        filter={state !== 'offline' && state !== 'idle' ? `url(#glow-${color.replace('#', '')})` : undefined}
        style={cfg.ring1Anim ? { animation: cfg.ring1Anim, transformOrigin: `${r}px ${r}px` } : undefined}
      />

      {/* Speaking waves — extra expanding rings */}
      {state === 'speaking' && (
        <>
          <circle cx={r} cy={r} r={ring1R + 6} fill="none" stroke={activeColor} strokeWidth="0.8"
            opacity="0.5" style={{ animation: 'cc-wave 1.4s ease-out infinite', transformOrigin: `${r}px ${r}px` }} />
          <circle cx={r} cy={r} r={ring1R + 6} fill="none" stroke={activeColor} strokeWidth="0.8"
            opacity="0.3" style={{ animation: 'cc-wave 1.4s ease-out 0.7s infinite', transformOrigin: `${r}px ${r}px` }} />
        </>
      )}
    </svg>
  );
}
