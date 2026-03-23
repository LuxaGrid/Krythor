import React from 'react';
import type { CCEvent } from '../types';
import { CommandLog } from './CommandLog';

interface BottomPanelProps {
  logEntries: CCEvent[];
  isDemo: boolean;
}

export function BottomPanel({ logEntries, isDemo }: BottomPanelProps): React.ReactElement {
  return (
    <div
      className="h-full overflow-hidden flex flex-col"
      style={{ background: 'rgba(9,11,18,0.97)' }}
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-zinc-800/60">
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{
            background: isDemo ? '#f59e0b' : '#1eaeff',
            animation: 'cc-float 2s ease-in-out infinite',
            boxShadow: isDemo ? '0 0 6px #f59e0b' : '0 0 6px #1eaeff',
          }}
        />
        <span className="text-[9px] font-mono tracking-[0.22em] uppercase text-zinc-500">
          Command Log
        </span>
        {isDemo && (
          <span className="text-[9px] font-mono text-amber-700 tracking-wide ml-1">
            · demo
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[9px] font-mono text-zinc-700">
            {logEntries.length} entries
          </span>
        </div>
      </div>

      {/* Log — takes remaining height */}
      <div className="flex-1 min-h-0">
        <CommandLog entries={logEntries} />
      </div>
    </div>
  );
}
