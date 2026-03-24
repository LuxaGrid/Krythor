import React from 'react';
import type { SceneZoneId } from '../types';
import { ZONE_MAP, SCENE_ZONES } from '../agents';

interface EnergyPathsProps {
  activeZones: Set<SceneZoneId>;
  sceneAspect: { w: number; h: number };
}

/**
 * EnergyPaths — draws connection lines from Atlas (crown) to all other stations.
 *
 * Matches image-4 aesthetic:
 *   - Permanent ghost lines (always visible, very faint)
 *   - Animated energy flow on active connections
 *   - Curved paths with gentle arc toward center
 */
export function EnergyPaths({ activeZones, sceneAspect }: EnergyPathsProps): React.ReactElement {
  const crown = ZONE_MAP['crown'];
  const targets = SCENE_ZONES.filter(z => z.id !== 'crown');

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
        <filter id="energy-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="energy-glow-bright" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {targets.map(zone => {
        const isActive = activeZones.has(zone.id);
        const x1 = crown.position.x;
        const y1 = crown.position.y;
        const x2 = zone.position.x;
        const y2 = zone.position.y;

        // Control point — arc upward slightly for curves to side zones
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        // Bend the curve slightly inward toward center of scene
        const bx = midX + (50 - midX) * 0.15;
        const by = midY - 4;

        const path = `M ${x1} ${y1} Q ${bx} ${by} ${x2} ${y2}`;

        return (
          <g key={zone.id}>
            {/* Permanent ghost base line */}
            <path
              d={path}
              fill="none"
              stroke={zone.accentColor}
              strokeWidth="0.25"
              opacity="0.12"
            />

            {/* Active energy flow */}
            {isActive && (
              <>
                {/* Glow underlay */}
                <path
                  d={path}
                  fill="none"
                  stroke={zone.accentColor}
                  strokeWidth="0.8"
                  opacity="0.2"
                  filter="url(#energy-glow)"
                />
                {/* Animated dash */}
                <path
                  d={path}
                  fill="none"
                  stroke={zone.accentColor}
                  strokeWidth="0.55"
                  opacity="0.8"
                  strokeDasharray="2.5 8"
                  filter="url(#energy-glow-bright)"
                  style={{
                    animation: 'cc-flow-arc 1.6s linear infinite',
                    strokeDashoffset: 40,
                  }}
                />
              </>
            )}

            {/* Endpoint dot at target zone — always visible, brighter when active */}
            <circle
              cx={x2} cy={y2} r={isActive ? 1.4 : 0.8}
              fill={zone.accentColor}
              opacity={isActive ? 0.9 : 0.2}
              filter={isActive ? 'url(#energy-glow)' : undefined}
              style={isActive ? { animation: 'cc-float 2s ease-in-out infinite' } : undefined}
            />

            {/* Source dot at Atlas */}
            {isActive && (
              <circle
                cx={x1} cy={y1} r="0.8"
                fill={crown.accentColor}
                opacity="0.6"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
