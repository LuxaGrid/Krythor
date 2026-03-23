import { useState } from 'react';
import type { GatewayEvent } from '../GatewayContext.tsx';

interface Props {
  events: GatewayEvent[];
  onClear: () => void;
}

const EVENT_COLOR: Record<string, string> = {
  'run:started':   'text-brand-400',
  'run:turn':      'text-zinc-300',
  'run:completed': 'text-emerald-400',
  'run:failed':    'text-red-400',
  'run:stopped':   'text-amber-400',
  'guard:denied':  'text-red-500',
  'guard:warned':  'text-amber-500',
  'memory:saved':  'text-violet-400',
  'memory:deleted': 'text-zinc-500',
};

const EVENT_ICON: Record<string, string> = {
  'run:started':    '▶',
  'run:turn':       '↻',
  'run:completed':  '✓',
  'run:failed':     '✗',
  'run:stopped':    '■',
  'guard:denied':   '⛔',
  'guard:warned':   '⚠',
  'memory:saved':   '💾',
  'memory:deleted': '🗑',
};

function getInnerType(e: GatewayEvent): string {
  if (e.type === 'agent:event') {
    return (e.payload as { type?: string } | undefined)?.type ?? e.type;
  }
  return e.type;
}

function fmt(event: GatewayEvent): string {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p) return '';
  if (event.type === 'agent:event') {
    const inner = p as { type?: string; payload?: Record<string, unknown>; runId?: string };
    const pl = inner.payload;
    if (pl && typeof pl === 'object') {
      const s = pl as Record<string, unknown>;
      if (s.output && typeof s.output === 'string') return s.output.slice(0, 100);
      if (s.content && typeof s.content === 'string') return s.content.slice(0, 100);
      if (s.errorMessage && typeof s.errorMessage === 'string') return s.errorMessage.slice(0, 100);
      if (s.model && typeof s.model === 'string') return `model: ${s.model}`;
    }
    return `run:${inner.runId?.slice(0, 8) ?? '?'}`;
  }
  const str = JSON.stringify(p);
  return str.length > 100 ? str.slice(0, 100) + '…' : str;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function EventStream({ events, onClear }: Props) {
  const [filter, setFilter] = useState('');

  const visible = filter
    ? events.filter(e => {
        const inner = getInnerType(e);
        return inner.toLowerCase().includes(filter.toLowerCase()) ||
          fmt(e).toLowerCase().includes(filter.toLowerCase());
      })
    : events;

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-800 flex items-center gap-2">
        <span className="text-xs text-zinc-500 shrink-0">{events.length} event{events.length !== 1 ? 's' : ''}</span>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter…"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-600 transition-colors font-mono"
        />
        <button
          onClick={onClear}
          className="text-xs text-zinc-600 hover:text-zinc-400 px-2 py-1 rounded transition-colors shrink-0"
        >clear</button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin font-mono text-xs">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-8">
            <div className="text-2xl opacity-30">⚡</div>
            <p className="text-zinc-500 text-xs">{events.length === 0 ? 'No events yet' : `No events match "${filter}"`}</p>
            <p className="text-zinc-700 text-xs">Events stream in real time as you use Krythor</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/40">
            {visible.map((e) => {
              const inner = getInnerType(e);
              const icon = EVENT_ICON[inner] ?? '·';
              const color = EVENT_COLOR[inner] ?? EVENT_COLOR[e.type] ?? 'text-zinc-500';
              const detail = fmt(e);
              return (
                <div key={e.id} className="flex items-start gap-2 px-3 py-1.5 hover:bg-zinc-900/40 transition-colors group">
                  <span className={`shrink-0 pt-0.5 w-4 text-center ${color}`} title={inner}>{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className={`shrink-0 font-semibold ${color}`}>{inner}</span>
                      {detail && (
                        <span className="text-zinc-600 truncate">{detail}</span>
                      )}
                    </div>
                  </div>
                  <span className="text-zinc-700 text-[10px] shrink-0 tabular-nums pt-0.5">
                    {formatTime(e.timestamp ?? Date.now())}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
