import React from 'react';
import { useCommandCenter } from './useCommandCenter';
import { CommandScene } from './scene/CommandScene';
import { LeftPanel } from './panels/LeftPanel';
import { BottomPanel } from './panels/BottomPanel';

export function CommandCenterPanel(): React.ReactElement {
  const {
    agents,
    zones,
    logEntries,
    activeZones,
    isDemo,
    focusedAgentId,
    setFocusedAgentId,
    activeRunCount,
    connectionState,
    memoryPulseAgentId,
  } = useCommandCenter();

  return (
    <div
      className="h-full w-full flex flex-col overflow-hidden p-3 gap-3"
      style={{ background: 'var(--kr-bg-primary)' }}
    >
      {/* Top row: left panel + main scene */}
      <div className="flex flex-1 gap-3 min-h-0">

        {/* Left panel — fixed width */}
        <div className="w-48 flex-shrink-0">
          <LeftPanel
            agents={agents}
            isDemo={isDemo}
            focusedAgentId={focusedAgentId}
            onFocusAgent={setFocusedAgentId}
            activeRunCount={activeRunCount}
            connectionState={connectionState}
          />
        </div>

        {/* Main scene — flex 1 */}
        <div className="flex-1 min-w-0">
          <CommandScene
            zones={zones}
            activeZones={activeZones}
            agents={agents}
            focusedAgentId={focusedAgentId}
            onFocusAgent={setFocusedAgentId}
            memoryPulseAgentId={memoryPulseAgentId}
          />
        </div>
      </div>

      {/* Bottom log — fixed height */}
      <div className="h-40 flex-shrink-0">
        <BottomPanel logEntries={logEntries} isDemo={isDemo} />
      </div>
    </div>
  );
}
