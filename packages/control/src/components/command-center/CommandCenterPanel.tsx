import React, { useRef, useState, useCallback } from 'react';
import { useCommandCenter } from './useCommandCenter';
import { CommandScene } from './scene/CommandScene';
import { LeftPanel } from './panels/LeftPanel';
import { BottomPanel } from './panels/BottomPanel';

// ── Drag-handle bar ────────────────────────────────────────────────────────────
function ResizeHandle({
  direction,
  onDrag,
}: {
  direction: 'horizontal' | 'vertical';
  onDrag: (delta: number) => void;
}) {
  const dragging = useRef(false);
  const last = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    last.current = direction === 'horizontal' ? e.clientX : e.clientY;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const cur = direction === 'horizontal' ? ev.clientX : ev.clientY;
      onDrag(cur - last.current);
      last.current = cur;
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [direction, onDrag]);

  const isH = direction === 'horizontal';
  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        flexShrink: 0,
        width:  isH ? 5 : '100%',
        height: isH ? '100%' : 5,
        cursor: isH ? 'col-resize' : 'row-resize',
        background: 'rgba(30,174,255,0.08)',
        transition: 'background 0.15s',
        position: 'relative',
        zIndex: 10,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(30,174,255,0.28)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'rgba(30,174,255,0.08)')}
    />
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
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

  // Left panel width (px). Clamped to [120, 400].
  const [leftW, setLeftW] = useState(200);
  // Log height (px). Clamped to [60, 600].
  const [logH, setLogH] = useState(180);

  const dragLeft = useCallback((delta: number) => {
    setLeftW(w => Math.min(400, Math.max(120, w + delta)));
  }, []);

  const dragLog = useCallback((delta: number) => {
    setLogH(h => Math.min(600, Math.max(60, h + delta)));
  }, []);

  return (
    <div
      className="h-full w-full flex overflow-hidden"
      style={{ background: '#090b12' }}
    >
      {/* Left panel */}
      <div
        className="flex-shrink-0 flex flex-col"
        style={{
          width: leftW,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(9,11,18,0.95)',
          minWidth: 0,
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

      {/* Horizontal resize handle */}
      <ResizeHandle direction="horizontal" onDrag={dragLeft} />

      {/* Right side — scene on top, log on bottom */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Command Center scene */}
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

        {/* Vertical resize handle */}
        <ResizeHandle direction="vertical" onDrag={dragLog} />

        {/* Command log */}
        <div
          className="flex-shrink-0"
          style={{ height: logH, minHeight: 0, overflow: 'hidden' }}
        >
          <BottomPanel logEntries={logEntries} isDemo={isDemo} />
        </div>
      </div>
    </div>
  );
}
