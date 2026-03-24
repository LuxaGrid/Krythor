import React from 'react';
import type { SceneZone as SceneZoneType } from '../types';

interface SceneZoneProps {
  zone: SceneZoneType;
  isActive: boolean;
  agentState?: string;
}

/**
 * SceneZone — rectangular station card matching image-4 aesthetic.
 *
 * Each zone renders as a bordered card with:
 *   - A top banner with the zone label
 *   - Inner glow and corner accents when active
 *   - The agent body floats in the center (rendered by AgentLayer above)
 */
export function SceneZone({ zone, isActive, agentState }: SceneZoneProps): React.ReactElement {
  const isWorking = agentState === 'working';
  const isThinking = agentState === 'thinking';
  const isActive2 = isActive || isWorking || isThinking;

  const glowBlur = isWorking ? '28px' : isThinking ? '18px' : '12px';
  const glowOpacity = isWorking ? 0.55 : isThinking ? 0.35 : isActive ? 0.2 : 0;

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
      {/* Outer glow halo */}
      {isActive2 && (
        <div
          className="absolute inset-0 rounded-xl pointer-events-none"
          style={{
            boxShadow: `0 0 ${glowBlur} ${zone.accentColor}`,
            opacity: glowOpacity,
            transition: 'all 0.7s ease',
          }}
        />
      )}

      {/* Station card */}
      <div
        className="relative w-full h-full flex flex-col overflow-hidden transition-all duration-700"
        style={{
          borderRadius: '10px',
          border: `1px solid ${isActive2 ? zone.accentColor : 'rgba(255,255,255,0.07)'}`,
          background: isActive2
            ? `linear-gradient(160deg, ${zone.glowColor}, rgba(6,9,15,0.92))`
            : 'rgba(6,9,15,0.85)',
          boxShadow: isActive2
            ? `inset 0 0 20px ${zone.glowColor}`
            : 'none',
        }}
      >
        {/* Corner accents */}
        <div className="absolute top-0 left-0 w-4 h-4 pointer-events-none"
          style={{ borderTop: `1.5px solid ${isActive2 ? zone.accentColor : 'rgba(255,255,255,0.15)'}`, borderLeft: `1.5px solid ${isActive2 ? zone.accentColor : 'rgba(255,255,255,0.15)'}`, borderRadius: '10px 0 0 0', transition: 'border-color 0.7s' }} />
        <div className="absolute top-0 right-0 w-4 h-4 pointer-events-none"
          style={{ borderTop: `1.5px solid ${isActive2 ? zone.accentColor : 'rgba(255,255,255,0.15)'}`, borderRight: `1.5px solid ${isActive2 ? zone.accentColor : 'rgba(255,255,255,0.15)'}`, borderRadius: '0 10px 0 0', transition: 'border-color 0.7s' }} />
        <div className="absolute bottom-0 left-0 w-4 h-4 pointer-events-none"
          style={{ borderBottom: `1.5px solid ${isActive2 ? zone.accentColor : 'rgba(255,255,255,0.15)'}`, borderLeft: `1.5px solid ${isActive2 ? zone.accentColor : 'rgba(255,255,255,0.15)'}`, borderRadius: '0 0 0 10px', transition: 'border-color 0.7s' }} />
        <div className="absolute bottom-0 right-0 w-4 h-4 pointer-events-none"
          style={{ borderBottom: `1.5px solid ${isActive2 ? zone.accentColor : 'rgba(255,255,255,0.15)'}`, borderRight: `1.5px solid ${isActive2 ? zone.accentColor : 'rgba(255,255,255,0.15)'}`, borderRadius: '0 0 10px 0', transition: 'border-color 0.7s' }} />

        {/* Top label banner */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-2 py-1"
          style={{
            borderBottom: `1px solid ${isActive2 ? `${zone.accentColor}60` : 'rgba(255,255,255,0.05)'}`,
            background: isActive2 ? `${zone.glowColor}` : 'transparent',
            transition: 'all 0.7s ease',
          }}
        >
          <span
            className="text-[8px] font-mono tracking-[0.18em] uppercase font-semibold leading-none"
            style={{ color: isActive2 ? zone.accentColor : 'rgba(255,255,255,0.2)', transition: 'color 0.7s' }}
          >
            {zone.label}
          </span>
          {/* Active pulse indicator */}
          {isActive2 && (
            <span
              className="block w-1 h-1 rounded-full flex-shrink-0"
              style={{
                background: zone.accentColor,
                boxShadow: `0 0 4px ${zone.accentColor}`,
                animation: 'cc-float 1.5s ease-in-out infinite',
              }}
            />
          )}
        </div>

        {/* Inner content area — agent body floats here via AgentLayer */}
        <div className="flex-1 relative" />

        {/* Bottom scan bar — visible when active */}
        <div
          className="flex-shrink-0 h-px w-full overflow-hidden"
          style={{ opacity: isActive2 ? 1 : 0, transition: 'opacity 0.7s' }}
        >
          <div
            className="h-full"
            style={{
              background: `linear-gradient(90deg, transparent, ${zone.accentColor}, transparent)`,
              animation: isActive2 ? 'cc-flow-arc 2s linear infinite' : 'none',
              width: '200%',
              marginLeft: '-100%',
            }}
          />
        </div>
      </div>
    </div>
  );
}
