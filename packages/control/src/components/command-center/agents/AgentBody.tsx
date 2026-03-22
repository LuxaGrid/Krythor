/**
 * Krythor Command Center — Agent Body Renderer
 *
 * Each agent has a UNIQUE SVG silhouette that communicates their role at a glance.
 * All designs are original Krythor mythic-tech style.
 *
 * Atlas   (orchestrator) — crowned sentinel, hovering authority form
 * Voltaris (builder)      — angular forge construct with current spikes
 * Aethon  (researcher)   — archivist eye-form with orbiting data runes
 * Thyros  (archivist)    — layered memory pillar, calm and deep
 * Pyron   (monitor)      — watchful diamond-shard sentinel
 */

import React from 'react';
import type { AgentRole, AgentAnimationState } from '../types';

interface AgentBodyProps {
  role: AgentRole;
  color: string;
  glowColor: string;
  state: AgentAnimationState;
  size?: number; // rendered size in px, default 44
}

const VIEWBOX = 44;
const CX = 22;
const CY = 22;

// ─── Atlas — Orchestrator ────────────────────────────────────────────────────
// Form: a crowned hexagonal medallion with a radiant core
// Idle: slow float; Working: bright core pulse; Speaking: outer halo expands
function AtlasBody({ color, state }: { color: string; state: AgentAnimationState }) {
  const working = state === 'working';
  const speaking = state === 'speaking';
  const thinking = state === 'thinking';
  const offline  = state === 'offline';
  const err      = state === 'error';
  const activeColor = err ? '#f87171' : color;
  const coreOpacity = offline ? 0.15 : working ? 0.95 : 0.7;
  const bodyOpacity = offline ? 0.18 : 1;

  return (
    <g opacity={bodyOpacity}>
      {/* Outer crown arch — 3 upward points */}
      <polyline
        points="14,18 16,11 22,8 28,11 30,18"
        fill="none"
        stroke={activeColor}
        strokeWidth="1.2"
        strokeLinejoin="round"
        opacity={offline ? 0.2 : 0.55}
      />
      {/* Crown notches */}
      <line x1="16" y1="11" x2="18" y2="14" stroke={activeColor} strokeWidth="0.8" opacity="0.5" />
      <line x1="28" y1="11" x2="26" y2="14" stroke={activeColor} strokeWidth="0.8" opacity="0.5" />

      {/* Hexagonal body */}
      <polygon
        points="22,10 30,15 30,25 22,30 14,25 14,15"
        fill={`${activeColor}14`}
        stroke={activeColor}
        strokeWidth="1.3"
        strokeLinejoin="round"
        opacity={offline ? 0.15 : 0.8}
      />

      {/* Inner authority glyph — smaller hex */}
      <polygon
        points="22,16 26,18.5 26,23.5 22,26 18,23.5 18,18.5"
        fill={`${activeColor}22`}
        stroke={activeColor}
        strokeWidth="0.9"
        opacity={offline ? 0.1 : 0.5}
      />

      {/* Core — radiant orb */}
      <circle
        cx={CX} cy={CY} r={working ? 4.5 : thinking ? 3.8 : 3.2}
        fill={activeColor}
        opacity={coreOpacity}
        style={{ transition: 'r 0.4s ease, opacity 0.4s ease' }}
      />

      {/* Speaking halo */}
      {speaking && (
        <circle
          cx={CX} cy={CY} r="18"
          fill="none"
          stroke={activeColor}
          strokeWidth="0.8"
          opacity="0.35"
          style={{ animation: 'cc-wave 1.6s ease-out infinite', transformOrigin: `${CX}px ${CY}px` }}
        />
      )}

      {/* Thinking rune sparks */}
      {thinking && (
        <g style={{ animation: 'cc-ring 2.4s linear infinite', transformOrigin: `${CX}px ${CY}px` }}>
          <circle cx={CX} cy="12" r="1.2" fill={activeColor} opacity="0.7" />
          <circle cx="31" cy="27" r="1" fill={activeColor} opacity="0.5" />
          <circle cx="13" cy="27" r="1" fill={activeColor} opacity="0.5" />
        </g>
      )}

      {/* Error instability flicker */}
      {err && (
        <line x1="14" y1="14" x2="30" y2="30" stroke="#f87171" strokeWidth="0.8" opacity="0.5"
          style={{ animation: 'cc-strobe 0.25s ease-in-out 8' }} />
      )}
    </g>
  );
}

// ─── Voltaris — Builder ───────────────────────────────────────────────────────
// Form: angular forge-forge construct — a diamond/arrowhead body with spike accents
// Idle: gentle current hum; Working: sparks at corners; Handoff: charged direction
function VoltarisBody({ color, state }: { color: string; state: AgentAnimationState }) {
  const working  = state === 'working';
  const handoff  = state === 'handoff';
  const thinking = state === 'thinking';
  const offline  = state === 'offline';
  const err      = state === 'error';
  const activeColor = err ? '#f87171' : color;
  const bodyOpacity = offline ? 0.18 : 1;

  return (
    <g opacity={bodyOpacity}>
      {/* Main angular body — tall diamond */}
      <polygon
        points="22,8 32,20 22,34 12,20"
        fill={`${activeColor}18`}
        stroke={activeColor}
        strokeWidth="1.4"
        strokeLinejoin="round"
        opacity={offline ? 0.15 : 0.85}
      />

      {/* Inner sharpened diamond */}
      <polygon
        points="22,13 28,20 22,28 16,20"
        fill={`${activeColor}28`}
        stroke={activeColor}
        strokeWidth="1"
        opacity={offline ? 0.1 : 0.6}
      />

      {/* Forge spike accents — left and right */}
      <line x1="12" y1="20" x2="6" y2="17" stroke={activeColor} strokeWidth="1.1"
        opacity={offline ? 0.1 : working ? 0.9 : 0.35} />
      <line x1="12" y1="20" x2="6" y2="23" stroke={activeColor} strokeWidth="1.1"
        opacity={offline ? 0.1 : working ? 0.9 : 0.35} />
      <line x1="32" y1="20" x2="38" y2="17" stroke={activeColor} strokeWidth="1.1"
        opacity={offline ? 0.1 : working ? 0.9 : 0.35} />
      <line x1="32" y1="20" x2="38" y2="23" stroke={activeColor} strokeWidth="1.1"
        opacity={offline ? 0.1 : working ? 0.9 : 0.35} />

      {/* Core energy cell */}
      <rect
        x={CX - 3} y={CY - 3} width="6" height="6"
        rx="1"
        fill={activeColor}
        opacity={offline ? 0.1 : working ? 0.95 : 0.6}
        transform={`rotate(45 ${CX} ${CY})`}
      />

      {/* Working sparks */}
      {working && (
        <g style={{ animation: 'cc-flicker 0.3s ease-in-out infinite' }}>
          <line x1="22" y1="8" x2="24" y2="4" stroke={activeColor} strokeWidth="1" opacity="0.8" />
          <line x1="22" y1="8" x2="20" y2="4" stroke={activeColor} strokeWidth="1" opacity="0.6" />
          <line x1="32" y1="20" x2="36" y2="18" stroke={activeColor} strokeWidth="1" opacity="0.7" />
        </g>
      )}

      {/* Thinking current flow — dashed horizontal */}
      {thinking && (
        <line x1="10" y1="20" x2="34" y2="20" stroke={activeColor} strokeWidth="0.8"
          strokeDasharray="2 3" opacity="0.5"
          style={{ animation: 'cc-flow-arc 1s linear infinite', strokeDashoffset: 0 }} />
      )}

      {/* Handoff — directed arrow up */}
      {handoff && (
        <polyline points="22,34 22,8 18,12 22,8 26,12"
          fill="none" stroke={activeColor} strokeWidth="1.2"
          opacity="0.8"
          style={{ animation: 'cc-float 0.6s ease-in-out infinite' }} />
      )}

      {/* Error */}
      {err && (
        <polygon points="22,8 32,20 22,34 12,20" fill="none" stroke="#f87171" strokeWidth="1.5"
          opacity="0.9" style={{ animation: 'cc-strobe 0.25s ease-in-out 8' }} />
      )}
    </g>
  );
}

// ─── Aethon — Researcher ──────────────────────────────────────────────────────
// Form: arcane eye-form — a wide teardrop lens body with orbiting knowledge fragments
// Idle: gentle scan; Thinking: orbit speeds up; Working: runes appear
function AethonBody({ color, state }: { color: string; state: AgentAnimationState }) {
  const working  = state === 'working';
  const thinking = state === 'thinking';
  const speaking = state === 'speaking';
  const offline  = state === 'offline';
  const err      = state === 'error';
  const activeColor = err ? '#f87171' : color;
  const bodyOpacity = offline ? 0.18 : 1;

  return (
    <g opacity={bodyOpacity}>
      {/* Outer eye / lens shape */}
      <ellipse
        cx={CX} cy={CY}
        rx="16" ry="10"
        fill={`${activeColor}10`}
        stroke={activeColor}
        strokeWidth="1.3"
        opacity={offline ? 0.15 : 0.8}
      />

      {/* Inner lens */}
      <ellipse
        cx={CX} cy={CY}
        rx="10" ry="6"
        fill={`${activeColor}18`}
        stroke={activeColor}
        strokeWidth="0.8"
        opacity={offline ? 0.1 : 0.5}
      />

      {/* Pupil — glowing orb */}
      <circle
        cx={CX} cy={CY} r={working ? 4.5 : thinking ? 3.8 : 3}
        fill={activeColor}
        opacity={offline ? 0.1 : working ? 0.95 : 0.75}
        style={{ transition: 'r 0.4s ease' }}
      />

      {/* Iris ring */}
      <circle
        cx={CX} cy={CY} r="6"
        fill="none"
        stroke={activeColor}
        strokeWidth="0.8"
        opacity={offline ? 0.08 : 0.4}
        strokeDasharray={thinking || working ? '2 3' : 'none'}
        style={thinking || working
          ? { animation: 'cc-ring 1.5s linear infinite', transformOrigin: `${CX}px ${CY}px` }
          : undefined}
      />

      {/* Orbiting knowledge fragments */}
      {!offline && (
        <g style={{
          animation: `cc-ring ${thinking ? '1.2s' : working ? '0.9s' : '3s'} linear infinite`,
          transformOrigin: `${CX}px ${CY}px`,
        }}>
          <rect x={CX + 13} y={CY - 1.5} width="4" height="3" rx="0.5"
            fill={activeColor} opacity={working ? 0.8 : 0.35} />
          <rect x={CX - 17} y={CY - 1.5} width="4" height="3" rx="0.5"
            fill={activeColor} opacity={working ? 0.6 : 0.25} />
        </g>
      )}

      {/* Vertical knowledge fragments (counter-orbit) */}
      {(thinking || working) && (
        <g style={{
          animation: `cc-ring ${thinking ? '2s' : '1.4s'} linear infinite reverse`,
          transformOrigin: `${CX}px ${CY}px`,
        }}>
          <circle cx={CX} cy={CY - 14} r="1.5" fill={activeColor} opacity="0.6" />
          <circle cx={CX} cy={CY + 14} r="1.2" fill={activeColor} opacity="0.4" />
        </g>
      )}

      {/* Speaking outward wave */}
      {speaking && (
        <ellipse cx={CX} cy={CY} rx="20" ry="13" fill="none" stroke={activeColor} strokeWidth="0.8"
          opacity="0.4" style={{ animation: 'cc-wave 1.4s ease-out infinite', transformOrigin: `${CX}px ${CY}px` }} />
      )}

      {/* Error */}
      {err && (
        <ellipse cx={CX} cy={CY} rx="16" ry="10" fill="none" stroke="#f87171" strokeWidth="1.5"
          style={{ animation: 'cc-strobe 0.25s ease-in-out 8' }} />
      )}
    </g>
  );
}

// ─── Thyros — Archivist ───────────────────────────────────────────────────────
// Form: memory pillar — a vertical stack of layered glowing slabs, stable and deep
// Idle: slow faint pulse; Working: layers ripple in sequence; Memory: echo rings out
function ThyrosBody({ color, state }: { color: string; state: AgentAnimationState }) {
  const working  = state === 'working';
  const thinking = state === 'thinking';
  const offline  = state === 'offline';
  const err      = state === 'error';
  const activeColor = err ? '#f87171' : color;
  const bodyOpacity = offline ? 0.18 : 1;

  // 4 memory slabs stacked vertically
  const slabs = [
    { y: 10, w: 24, h: 5, opacity: offline ? 0.08 : working ? 0.9 : 0.7, delay: '0s' },
    { y: 18, w: 20, h: 5, opacity: offline ? 0.08 : working ? 0.8 : 0.55, delay: '0.15s' },
    { y: 26, w: 16, h: 5, opacity: offline ? 0.08 : working ? 0.7 : 0.4, delay: '0.3s' },
    { y: 34, w: 12, h: 3, opacity: offline ? 0.05 : working ? 0.5 : 0.25, delay: '0.45s' },
  ];

  return (
    <g opacity={bodyOpacity}>
      {/* Slabs */}
      {slabs.map((slab, i) => (
        <rect
          key={i}
          x={CX - slab.w / 2}
          y={slab.y}
          width={slab.w}
          height={slab.h}
          rx="2"
          fill={`${activeColor}22`}
          stroke={activeColor}
          strokeWidth="1"
          opacity={slab.opacity}
          style={(working || thinking)
            ? { animation: `cc-flicker 1.2s ease-in-out infinite`, animationDelay: slab.delay }
            : undefined}
        />
      ))}

      {/* Vertical connector spine */}
      <line x1={CX} y1="10" x2={CX} y2="37" stroke={activeColor} strokeWidth="0.7"
        opacity={offline ? 0.08 : 0.35} strokeDasharray="1 4" />

      {/* Core memory bead — top */}
      <circle cx={CX} cy="12.5" r={working ? 4 : thinking ? 3.5 : 2.8}
        fill={activeColor}
        opacity={offline ? 0.1 : working ? 0.95 : 0.7}
        style={{ transition: 'r 0.4s ease' }}
      />

      {/* Echo rings when working/memory */}
      {working && (
        <>
          <circle cx={CX} cy="12.5" r="8" fill="none" stroke={activeColor} strokeWidth="0.7"
            opacity="0.4" style={{ animation: 'cc-wave 1.2s ease-out infinite', transformOrigin: `${CX}px 12.5px` }} />
          <circle cx={CX} cy="12.5" r="8" fill="none" stroke={activeColor} strokeWidth="0.7"
            opacity="0.25" style={{ animation: 'cc-wave 1.2s ease-out 0.6s infinite', transformOrigin: `${CX}px 12.5px` }} />
        </>
      )}

      {/* Error */}
      {err && (
        <rect x={CX - 12} y="10" width="24" height="5" rx="2" fill="none" stroke="#f87171" strokeWidth="1.5"
          style={{ animation: 'cc-strobe 0.25s ease-in-out 8' }} />
      )}
    </g>
  );
}

// ─── Pyron — Monitor ──────────────────────────────────────────────────────────
// Form: watchful sentinel shard — a sharp diamond with a sweeping scan arc
// Idle: slow scan sweep; Working: signal spikes; Error: intense flash with warning lines
function PyronBody({ color, state }: { color: string; state: AgentAnimationState }) {
  const working  = state === 'working';
  const thinking = state === 'thinking';
  const offline  = state === 'offline';
  const err      = state === 'error';
  const activeColor = err ? '#f87171' : color;
  const bodyOpacity = offline ? 0.18 : 1;

  return (
    <g opacity={bodyOpacity}>
      {/* Outer warning diamond */}
      <polygon
        points={`${CX},7 ${CX + 15},${CY} ${CX},${CY + 15} ${CX - 15},${CY}`}
        fill={`${activeColor}12`}
        stroke={activeColor}
        strokeWidth="1.4"
        strokeLinejoin="round"
        opacity={offline ? 0.15 : 0.85}
      />

      {/* Inner shard */}
      <polygon
        points={`${CX},13 ${CX + 9},${CY} ${CX},${CY + 9} ${CX - 9},${CY}`}
        fill={`${activeColor}25`}
        stroke={activeColor}
        strokeWidth="1"
        opacity={offline ? 0.1 : 0.6}
      />

      {/* Scan arc — sweeping line */}
      {!offline && (
        <line
          x1={CX} y1={CY} x2={CX + 13} y2={CY - 6}
          stroke={activeColor}
          strokeWidth={working ? 1.5 : 0.9}
          opacity={working ? 0.9 : thinking ? 0.6 : 0.4}
          style={{ animation: `cc-scan ${working ? '0.8s' : '2s'} linear infinite`, transformOrigin: `${CX}px ${CY}px` }}
        />
      )}

      {/* Alert core */}
      <circle
        cx={CX} cy={CY} r={err ? 5 : working ? 4.5 : thinking ? 3.8 : 3}
        fill={activeColor}
        opacity={offline ? 0.1 : err ? 1 : working ? 0.95 : 0.7}
        style={{ transition: 'r 0.3s ease' }}
      />

      {/* Signal spikes when working */}
      {working && (
        <>
          <line x1={CX} y1="7" x2={CX} y2="3" stroke={activeColor} strokeWidth="1.2" opacity="0.8"
            style={{ animation: 'cc-flicker 0.4s ease-in-out infinite' }} />
          <line x1={CX + 15} y1={CY} x2={CX + 19} y2={CY} stroke={activeColor} strokeWidth="1.2" opacity="0.6"
            style={{ animation: 'cc-flicker 0.4s ease-in-out 0.2s infinite' }} />
        </>
      )}

      {/* Error — crossed warning lines */}
      {err && (
        <>
          <line x1={CX - 12} y1={CY - 5} x2={CX + 12} y2={CY + 5} stroke="#f87171" strokeWidth="1.2"
            opacity="0.8" style={{ animation: 'cc-strobe 0.2s ease-in-out 10' }} />
          <line x1={CX + 12} y1={CY - 5} x2={CX - 12} y2={CY + 5} stroke="#f87171" strokeWidth="1.2"
            opacity="0.8" style={{ animation: 'cc-strobe 0.2s ease-in-out 10' }} />
        </>
      )}
    </g>
  );
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

const BODY_MAP: Record<AgentRole, React.ComponentType<{ color: string; state: AgentAnimationState }>> = {
  orchestrator: AtlasBody,
  builder:      VoltarisBody,
  researcher:   AethonBody,
  archivist:    ThyrosBody,
  monitor:      PyronBody,
};

export function AgentBody({ role, color, glowColor: _glowColor, state, size = 44 }: AgentBodyProps): React.ReactElement {
  const BodyComponent = BODY_MAP[role];

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: 'visible', display: 'block' }}
    >
      <BodyComponent color={color} state={state} />
    </svg>
  );
}
