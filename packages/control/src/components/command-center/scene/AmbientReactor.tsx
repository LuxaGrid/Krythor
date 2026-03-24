import React from 'react';
import type { CommandCenterAgent } from '../types';

interface AmbientReactorProps {
  agents: CommandCenterAgent[];
}

/**
 * AmbientReactor — central ambient orb at scene mid-point.
 *
 * In image-4 the large dark sphere sits between all agent stations,
 * acting as a visual anchor for the network topology.
 */
export function AmbientReactor({ agents }: AmbientReactorProps): React.ReactElement {
  const activeAgents = agents.filter(a =>
    a.currentState !== 'idle' && a.currentState !== 'offline'
  );
  const activeCount = activeAgents.length;
  const intensity = activeCount / Math.max(agents.length, 1);
  const isActive = activeCount > 0;

  const activeColors = activeAgents.map(a => a.glowColor);
  const coreColor = activeColors[0] ?? 'rgba(30,174,255,0.08)';

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: '50%',
        top: '58%',
        transform: 'translate(-50%, -50%)',
        zIndex: 2,
      }}
    >
      {/* Large dark atmosphere sphere — always visible */}
      <div
        style={{
          width: '160px',
          height: '160px',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 38% 35%, rgba(18,22,38,0.9) 0%, rgba(8,11,18,0.97) 60%, rgba(4,6,12,1) 100%)',
          boxShadow: isActive
            ? `0 0 ${40 + intensity * 60}px ${12 + intensity * 20}px ${coreColor}, inset 0 0 30px rgba(0,0,0,0.8)`
            : '0 0 24px 8px rgba(30,174,255,0.06), inset 0 0 30px rgba(0,0,0,0.8)',
          border: '1px solid rgba(30,174,255,0.08)',
          animation: 'cc-float 8s ease-in-out infinite',
          transition: 'box-shadow 1.2s ease',
        }}
      />

      {/* Outer ring — spins slowly */}
      <div
        className="absolute"
        style={{
          width: '190px',
          height: '190px',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          borderRadius: '50%',
          border: '1px solid rgba(30,174,255,0.06)',
          animation: 'cc-spin-fast 24s linear infinite',
        }}
      />

      {/* Activity ring — visible when 2+ agents active */}
      {activeCount >= 2 && (
        <div
          className="absolute"
          style={{
            width: '176px',
            height: '176px',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            border: `1px dashed ${activeColors[1] ?? 'rgba(30,174,255,0.2)'}`,
            opacity: 0.35,
            animation: 'cc-spin-fast 12s linear infinite reverse',
          }}
        />
      )}
    </div>
  );
}
