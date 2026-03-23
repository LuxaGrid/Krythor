import React from 'react';
import type { SceneZone as SceneZoneType } from '../types';

interface SceneZoneProps {
  zone: SceneZoneType;
  isActive: boolean;
  agentState?: string;
}

export function SceneZone({ zone, isActive, agentState }: SceneZoneProps): React.ReactElement {
  const glowIntensity = agentState === 'working'
    ? '32px 6px'
    : agentState === 'thinking'
    ? '20px 3px'
    : '12px 2px';

  const innerGlow = agentState === 'working' ? '16px' : '8px';

  return (
    <div
      className="absolute transition-all duration-700"
      style={{
        left: `${zone.position.x}%`,
        top: `${zone.position.y}%`,
        width: `${zone.width}%`,
        height: `${zone.height}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      {/* Zone platform base */}
      <div
        className="relative w-full h-full rounded-xl border transition-all duration-700"
        style={{
          borderColor: isActive ? zone.accentColor : 'rgba(255,255,255,0.06)',
          background: isActive
            ? `linear-gradient(135deg, ${zone.glowColor}, rgba(255,255,255,0.02))`
            : 'rgba(255,255,255,0.02)',
          boxShadow: isActive
            ? `0 0 ${glowIntensity} ${zone.glowColor}, inset 0 0 ${innerGlow} ${zone.glowColor}`
            : 'none',
        }}
      >
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-3 h-3 border-t border-l rounded-tl-xl transition-colors duration-700"
          style={{ borderColor: isActive ? zone.accentColor : 'rgba(255,255,255,0.12)' }} />
        <div className="absolute top-0 right-0 w-3 h-3 border-t border-r rounded-tr-xl transition-colors duration-700"
          style={{ borderColor: isActive ? zone.accentColor : 'rgba(255,255,255,0.12)' }} />
        <div className="absolute bottom-0 left-0 w-3 h-3 border-b border-l rounded-bl-xl transition-colors duration-700"
          style={{ borderColor: isActive ? zone.accentColor : 'rgba(255,255,255,0.12)' }} />
        <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r rounded-br-xl transition-colors duration-700"
          style={{ borderColor: isActive ? zone.accentColor : 'rgba(255,255,255,0.12)' }} />

        {/* Zone label — bottom center, below agent body */}
        <div className="absolute bottom-2 left-0 right-0 text-center px-1">
          <span
            className="text-[9px] font-mono tracking-[0.1em] uppercase transition-colors duration-700 leading-none"
            style={{ color: isActive ? zone.accentColor : 'rgba(255,255,255,0.18)' }}
          >
            {zone.label}
          </span>
        </div>

        {/* Active pulse dot — top right corner */}
        {isActive && (
          <div className="absolute top-1.5 right-1.5">
            <span
              className="block w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: zone.accentColor }}
            />
          </div>
        )}

        {/* Activity bar */}
        <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: isActive ? '100%' : '0%',
              background: `linear-gradient(90deg, transparent, ${zone.accentColor}, transparent)`,
              opacity: isActive ? 1 : 0,
              animation: isActive ? 'cc-float 2s ease-in-out infinite' : 'none',
            }}
          />
        </div>
      </div>
    </div>
  );
}
