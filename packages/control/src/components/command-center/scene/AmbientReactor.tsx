import React from 'react';
import type { CommandCenterAgent } from '../types';

interface AmbientReactorProps {
  agents: CommandCenterAgent[];
}

export function AmbientReactor({ agents }: AmbientReactorProps): React.ReactElement {
  const activeAgents = agents.filter(a =>
    a.currentState !== 'idle' && a.currentState !== 'offline'
  );
  const activeCount = activeAgents.length;
  const intensity = activeCount / Math.max(agents.length, 1);
  const isActive = activeCount > 0;

  // Build a mixed gradient from active agent colors
  const activeColors = activeAgents.map(a => a.glowColor);
  const coreColor = activeColors[0] ?? 'rgba(30,174,255,0.06)';
  const secondaryColor = activeColors[1] ?? 'transparent';

  const coreSize = 60 + intensity * 50;
  const haloSize = 90 + intensity * 80;

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 2,
      }}
    >
      {/* Outer halo — slow pulse */}
      {isActive && (
        <div
          className="absolute"
          style={{
            width: `${haloSize}px`,
            height: `${haloSize}px`,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${secondaryColor} 0%, transparent 65%)`,
            opacity: 0.4 + intensity * 0.3,
            animation: 'cc-float 6s ease-in-out infinite',
            transition: 'width 1.2s ease, height 1.2s ease, opacity 1s ease',
          }}
        />
      )}

      {/* Core orb — tighter, brighter */}
      <div
        style={{
          width: `${coreSize}px`,
          height: `${coreSize}px`,
          borderRadius: '50%',
          background: isActive
            ? `radial-gradient(circle, ${coreColor} 0%, transparent 70%)`
            : 'transparent',
          boxShadow: isActive
            ? `0 0 ${50 + intensity * 70}px ${24 + intensity * 36}px ${coreColor}`
            : 'none',
          animation: isActive ? 'cc-float 4s ease-in-out infinite' : 'none',
          transition: 'width 1s ease, height 1s ease, box-shadow 1.2s ease, background 1s ease',
        }}
      />

      {/* Activity count ring — visible when 2+ agents active */}
      {activeCount >= 2 && (
        <div
          className="absolute"
          style={{
            width: `${coreSize + 18}px`,
            height: `${coreSize + 18}px`,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            border: `1px dashed ${activeColors[1] ?? 'rgba(30,174,255,0.3)'}`,
            opacity: 0.4,
            animation: 'cc-spin-fast 8s linear infinite',
          }}
        />
      )}
    </div>
  );
}
