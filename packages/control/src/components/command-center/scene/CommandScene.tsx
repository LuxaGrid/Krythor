import React from 'react';
import type { SceneZone, SceneZoneId, CommandCenterAgent } from '../types';
import { SceneGrid } from './SceneGrid';
import { SceneZone as SceneZoneComponent } from './SceneZone';
import { AgentLayer } from '../agents/AgentLayer';
import { EnergyPaths } from './EnergyPaths';
import { AmbientReactor } from './AmbientReactor';

interface CommandSceneProps {
  zones: SceneZone[];
  activeZones: Set<SceneZoneId>;
  agents: CommandCenterAgent[];
  focusedAgentId: string | null;
  onFocusAgent: (id: string | null) => void;
  memoryPulseAgentId?: string | null;
}

export function CommandScene({ zones, activeZones, agents, focusedAgentId, onFocusAgent, memoryPulseAgentId }: CommandSceneProps): React.ReactElement {
  // When an agent is focused, dim the scene background and zone platforms slightly
  const hasFocus = focusedAgentId !== null;

  return (
    <div
      className="relative w-full h-full overflow-hidden rounded-xl transition-all duration-500"
      style={{
        minHeight: 0,
        background: hasFocus ? 'rgba(10,10,18,0.97)' : undefined,
      }}
    >
      {/* Layer 0: background grid */}
      <SceneGrid />

      {/* Layer 1: ambient reactor */}
      <AmbientReactor agents={agents} />

      {/* Layer 2: energy paths */}
      <EnergyPaths activeZones={activeZones} sceneAspect={{ w: 100, h: 100 }} />

      {/* Layer 3: zone platforms — dim unfocused zones when an agent is focused */}
      {zones.map(zone => {
        const zoneAgent = agents.find(a => a.homeZone === zone.id);
        const zoneFocused = focusedAgentId !== null && zoneAgent?.id === focusedAgentId;
        const zoneDimmed = hasFocus && !zoneFocused;
        return (
          <div
            key={zone.id}
            className="transition-opacity duration-400"
            style={{ opacity: zoneDimmed ? 0.2 : 1 }}
          >
            <SceneZoneComponent
              zone={zone}
              isActive={activeZones.has(zone.id)}
              agentState={zoneAgent?.currentState}
            />
          </div>
        );
      })}

      {/* Layer 4: agent entities */}
      <AgentLayer
        agents={agents}
        focusedAgentId={focusedAgentId}
        onFocusAgent={onFocusAgent}
        memoryPulseAgentId={memoryPulseAgentId}
      />

      {/* Layer 5: scene header label */}
      <div className="absolute top-2 left-3 pointer-events-none flex items-center gap-1.5">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-500/60" style={{ boxShadow: '0 0 5px rgba(245,158,11,0.5)' }} />
        <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-zinc-600">
          Krythor Command Chamber
        </span>
      </div>

      {/* Focus mode indicator */}
      {hasFocus && (() => {
        const fa = agents.find(a => a.id === focusedAgentId);
        return fa ? (
          <div
            className="absolute top-3 right-4 pointer-events-none flex items-center gap-1.5"
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: fa.themeColor, boxShadow: `0 0 6px 2px ${fa.glowColor}` }}
            />
            <span
              className="text-[9px] font-mono tracking-widest uppercase"
              style={{ color: fa.themeColor }}
            >
              Focus: {fa.displayName}
            </span>
          </div>
        ) : null;
      })()}
    </div>
  );
}
