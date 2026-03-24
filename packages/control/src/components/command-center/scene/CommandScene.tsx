import React from 'react';
import type { SceneZone, SceneZoneId, CommandCenterAgent } from '../types';
import { MythicCanvas } from './MythicCanvas';

interface CommandSceneProps {
  zones: SceneZone[];
  activeZones: Set<SceneZoneId>;
  agents: CommandCenterAgent[];
  focusedAgentId: string | null;
  onFocusAgent: (id: string | null) => void;
  memoryPulseAgentId?: string | null;
  isDemo: boolean;
}

export function CommandScene({
  zones, activeZones, agents, focusedAgentId, onFocusAgent, memoryPulseAgentId, isDemo,
}: CommandSceneProps): React.ReactElement {
  return (
    <div className="relative w-full h-full overflow-hidden rounded-xl" style={{ minHeight: 0 }}>
      <MythicCanvas
        agents={agents}
        zones={zones}
        activeZones={activeZones}
        focusedAgentId={focusedAgentId}
        onFocusAgent={onFocusAgent}
        memoryPulseAgentId={memoryPulseAgentId}
        isDemo={isDemo}
      />
    </div>
  );
}
