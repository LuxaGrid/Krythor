import React from 'react';
import type { SceneZoneId } from '../types';
import { ZONE_MAP } from '../agents';

interface EnergyPathsProps {
  activeZones: Set<SceneZoneId>;
  sceneAspect: { w: number; h: number }; // percentage-based: w=100, h=100
}

export function EnergyPaths({ activeZones, sceneAspect }: EnergyPathsProps): React.ReactElement {
  const crown = ZONE_MAP['crown'];
  // Only draw paths when non-crown zones are active
  const targets = Array.from(activeZones).filter(id => id !== 'crown');

  if (targets.length === 0) return <></>;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width="100%"
      height="100%"
      viewBox={`0 0 ${sceneAspect.w} ${sceneAspect.h}`}
      preserveAspectRatio="none"
      style={{ zIndex: 5 }}
    >
      <defs>
        <filter id="energy-glow">
          <feGaussianBlur stdDeviation="0.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {targets.map(zoneId => {
        const zone = ZONE_MAP[zoneId];
        if (!zone) return null;

        const x1 = crown.position.x;
        const y1 = crown.position.y;
        const x2 = zone.position.x;
        const y2 = zone.position.y;
        // Gentle curve
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2 - 8;

        return (
          <g key={zoneId}>
            {/* Ghost base line */}
            <path
              d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
              fill="none"
              stroke={zone.accentColor}
              strokeWidth="0.3"
              opacity="0.15"
            />
            {/* Animated energy dash */}
            <path
              d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
              fill="none"
              stroke={zone.accentColor}
              strokeWidth="0.6"
              opacity="0.6"
              strokeDasharray="3 12"
              filter="url(#energy-glow)"
              style={{
                animation: 'cc-flow-arc 1.8s linear infinite',
                strokeDashoffset: 60,
              }}
            />
            {/* Endpoint dot at target zone */}
            <circle
              cx={x2} cy={y2} r="1.2"
              fill={zone.accentColor}
              opacity="0.8"
              style={{ animation: 'cc-float 2s ease-in-out infinite' }}
            />
          </g>
        );
      })}
    </svg>
  );
}
