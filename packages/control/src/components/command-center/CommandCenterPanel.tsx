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
      className="h-full w-full flex overflow-hidden"
      style={{ background: '#090b12' }}
    >
      {/* Left panel — fixed width, full height */}
      <div
        className="flex-shrink-0 flex flex-col border-r"
        style={{
          width: 'clamp(160px, 20%, 220px)',
          borderColor: 'rgba(255,255,255,0.06)',
          background: 'rgba(9,11,18,0.95)',
        }}
      >
        <LeftPanel
          agents={agents}
          isDemo={isDemo}
          focusedAgentId={focusedAgentId}
          onFocusAgent={setFocusedAgentId}
          activeRunCount={activeRunCount}
          connectionState={connectionState}
        />
      </div>

      {/* Right side — scene on top, log on bottom */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Main scene — takes most of the height */}
        <div className="flex-1 min-h-0">
          <CommandScene
            zones={zones}
            activeZones={activeZones}
            agents={agents}
            focusedAgentId={focusedAgentId}
            onFocusAgent={setFocusedAgentId}
            memoryPulseAgentId={memoryPulseAgentId}
            isDemo={isDemo}
          />
        </div>

        {/* Activity log — adaptive height, min 100px max 30% */}
        <div
          className="flex-shrink-0 border-t"
          style={{
            height: 'clamp(100px, 22%, 200px)',
            borderColor: 'rgba(255,255,255,0.06)',
          }}
        >
          <BottomPanel logEntries={logEntries} isDemo={isDemo} />
        </div>
      </div>
    </div>
  );
}
