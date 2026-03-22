import React, { useRef, useEffect, useState } from 'react';
import type { CCEvent, CCEventType } from '../types';
import { AGENT_MAP } from '../agents';

interface CommandLogProps {
  entries: CCEvent[];
}

// Color per event type — tailwind-compatible inline style colors
const EVENT_COLOR: Record<CCEventType, string> = {
  TASK_STARTED:      '#1eaeff',  // arc blue
  TASK_COMPLETED:    '#34d399',  // emerald
  TOOL_CALLED:       '#60a5fa',  // blue-400
  TOOL_COMPLETED:    '#93c5fd',  // blue-300
  MODEL_SELECTED:    '#f59e0b',  // gold
  AGENT_HANDOFF:     '#a78bfa',  // purple
  MEMORY_RETRIEVED:  '#67e8f9',  // cyan
  ERROR:             '#f87171',  // red
  RESPONSE_COMPLETE: '#6ee7b7',  // emerald-300
  AGENT_IDLE:        '#52525b',  // zinc-600
  AGENT_MOVED:       '#71717a',  // zinc-500
};

const EVENT_ICON: Record<CCEventType, string> = {
  TASK_STARTED:      '▶',
  TASK_COMPLETED:    '✓',
  TOOL_CALLED:       '⬡',
  TOOL_COMPLETED:    '◎',
  MODEL_SELECTED:    '◈',
  AGENT_HANDOFF:     '→',
  MEMORY_RETRIEVED:  '◉',
  ERROR:             '✕',
  RESPONSE_COMPLETE: '●',
  AGENT_IDLE:        '○',
  AGENT_MOVED:       '↝',
};

const EVENT_LABEL: Record<CCEventType, string> = {
  TASK_STARTED:      'task',
  TASK_COMPLETED:    'done',
  TOOL_CALLED:       'tool',
  TOOL_COMPLETED:    'tool:ok',
  MODEL_SELECTED:    'model',
  AGENT_HANDOFF:     'handoff',
  MEMORY_RETRIEVED:  'memory',
  ERROR:             'error',
  RESPONSE_COMPLETE: 'response',
  AGENT_IDLE:        'idle',
  AGENT_MOVED:       'moved',
};

// Filter types
type LogFilter = 'all' | 'errors' | 'tasks' | 'tools' | 'memory';

const FILTER_MATCH: Record<LogFilter, CCEventType[]> = {
  all:    [] as CCEventType[], // empty = show all
  errors: ['ERROR'],
  tasks:  ['TASK_STARTED', 'TASK_COMPLETED', 'RESPONSE_COMPLETE', 'AGENT_HANDOFF'],
  tools:  ['TOOL_CALLED', 'TOOL_COMPLETED', 'MODEL_SELECTED'],
  memory: ['MEMORY_RETRIEVED'],
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function CommandLog({ entries }: CommandLogProps): React.ReactElement {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);

  // Filter entries
  const filtered = paused
    ? entries // when paused, show what we have without new entries flowing in
    : filter === 'all'
      ? entries
      : entries.filter(e => FILTER_MATCH[filter].includes(e.type));

  // Auto-scroll to top (newest entries prepended)
  useEffect(() => {
    if (!autoScroll || paused) return;
    if (entries.length !== prevLengthRef.current) {
      prevLengthRef.current = entries.length;
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    }
  }, [entries, autoScroll, paused]);

  // Detect manual scroll — disable auto-scroll if user scrolls down
  const handleScroll = () => {
    if (!scrollRef.current) return;
    setAutoScroll(scrollRef.current.scrollTop < 20);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800/60">
        {/* Filter tabs */}
        <div className="flex items-center gap-1">
          {(['all', 'tasks', 'tools', 'memory', 'errors'] as LogFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-[9px] font-mono px-2 py-0.5 rounded transition-all duration-150 uppercase tracking-wide"
              style={{
                background: filter === f ? 'rgba(30,174,255,0.12)' : 'transparent',
                color: filter === f ? '#1eaeff' : '#52525b',
                border: filter === f ? '1px solid rgba(30,174,255,0.25)' : '1px solid transparent',
              }}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/* Entry count */}
          <span className="text-[9px] font-mono text-zinc-700 tabular-nums">
            {filtered.length}/{entries.length}
          </span>

          {/* Pause toggle */}
          <button
            onClick={() => setPaused(p => !p)}
            className="text-[9px] font-mono px-2 py-0.5 rounded transition-all duration-150"
            style={{
              background: paused ? 'rgba(245,158,11,0.1)' : 'transparent',
              color: paused ? '#f59e0b' : '#52525b',
              border: paused ? '1px solid rgba(245,158,11,0.25)' : '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {paused ? '▶ resume' : '⏸ pause'}
          </button>

          {/* Auto-scroll indicator */}
          <div
            className="w-1.5 h-1.5 rounded-full transition-colors duration-300"
            style={{ background: autoScroll && !paused ? '#34d399' : '#3f3f46' }}
            title={autoScroll ? 'auto-scroll on' : 'auto-scroll off'}
          />
        </div>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto scrollbar-thin"
        style={{ scrollbarColor: '#27272a #09090b' }}
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-[10px] font-mono text-zinc-800">
              {paused ? 'log paused' : 'awaiting events…'}
            </span>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-zinc-900/60">
            {filtered.map((entry, idx) => {
              const color = EVENT_COLOR[entry.type] ?? '#52525b';
              const icon = EVENT_ICON[entry.type] ?? '·';
              const label = EVENT_LABEL[entry.type] ?? entry.type;
              const agent = AGENT_MAP[entry.agentId];
              const agentColor = agent?.themeColor ?? '#71717a';
              const isNew = idx === 0 && !paused;

              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 px-3 py-1 transition-colors duration-150 hover:bg-zinc-900/40 group"
                  style={{
                    background: isNew ? 'rgba(30,174,255,0.03)' : 'transparent',
                  }}
                >
                  {/* Timestamp */}
                  <span className="text-[10px] font-mono text-zinc-700 tabular-nums flex-shrink-0 pt-px">
                    {formatTime(entry.ts)}
                  </span>

                  {/* Event type icon + label */}
                  <div className="flex items-center gap-1 flex-shrink-0 pt-px">
                    <span className="text-[10px] font-mono" style={{ color }}>
                      {icon}
                    </span>
                    <span
                      className="text-[9px] font-mono uppercase tracking-wide px-1 py-px rounded"
                      style={{
                        color,
                        background: `${color}12`,
                      }}
                    >
                      {label}
                    </span>
                  </div>

                  {/* Agent name */}
                  <span
                    className="text-[10px] font-mono font-semibold flex-shrink-0 pt-px"
                    style={{ color: agentColor }}
                  >
                    {agent?.displayName ?? entry.agentId}
                  </span>

                  {/* Summary */}
                  <span className="text-[10px] font-mono text-zinc-500 flex-1 truncate group-hover:text-zinc-400 transition-colors pt-px">
                    {entry.summary}
                  </span>

                  {/* Optional tags */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {entry.modelId && (
                      <span className="text-[9px] font-mono text-zinc-700 px-1 py-px rounded border border-zinc-800/60">
                        {entry.modelId.split('/').pop() ?? entry.modelId}
                      </span>
                    )}
                    {entry.toolName && (
                      <span className="text-[9px] font-mono text-blue-900 px-1 py-px rounded border border-blue-900/40">
                        {entry.toolName}
                      </span>
                    )}
                    {entry.error && (
                      <span className="text-[9px] font-mono text-red-900 px-1 py-px rounded border border-red-900/40 truncate max-w-[80px]">
                        {entry.error}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
