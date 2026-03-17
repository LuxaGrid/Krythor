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
};

interface EmptyStateProps {
  icon: string;
  title: string;
  hint?: string;
}
const EmptyState = ({ icon, title, hint }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center h-full gap-2 text-center p-8">
    <div className="text-2xl opacity-30">{icon}</div>
    <p className="text-zinc-500 text-xs">{title}</p>
    {hint && <p className="text-zinc-700 text-xs">{hint}</p>}
  </div>
);

function fmt(event: GatewayEvent): string {
  const p = event.payload as Record<string, unknown> | undefined;
  if (!p) return '';
  if (event.type === 'agent:event') {
    const inner = p as { type?: string; payload?: unknown; runId?: string };
    return `[${inner.runId?.slice(0,8) ?? '?'}] ${JSON.stringify(inner.payload ?? '').slice(0, 80)}`;
  }
  return JSON.stringify(p).slice(0, 100);
}

export function EventStream({ events, onClear }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-xs text-zinc-500">{events.length} events</span>
        <button
          onClick={onClear}
          className="text-xs text-zinc-600 hover:text-zinc-400 px-2 py-1 rounded transition-colors"
        >clear</button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin font-mono text-xs p-3 space-y-0.5">
        {events.length === 0 ? (
          <EmptyState
            icon="⚡"
            title="No events yet"
            hint="Events will appear here as you use Krythor"
          />
        ) : (
          events.map((e) => {
            const inner = e.type === 'agent:event'
              ? (e.payload as { type?: string } | undefined)?.type ?? e.type
              : e.type;
            return (
              <div key={e.id} className="flex items-start gap-2">
                <span className={`shrink-0 ${EVENT_COLOR[inner] ?? EVENT_COLOR[e.type] ?? 'text-zinc-500'}`}>
                  {inner}
                </span>
                <span className="text-zinc-600 truncate">{fmt(e)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
