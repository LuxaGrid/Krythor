import { useState, useEffect, useRef, useCallback } from 'react';
import { PanelHeader } from './PanelHeader.tsx';
import { getGatewayToken } from '../api.ts';

interface LogEntry {
  id: number;
  ts: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  event: string;
  raw: string;
}

type LevelFilter = 'all' | 'info' | 'warn' | 'error';

const LEVEL_COLOR: Record<string, string> = {
  info:  '#60a5fa',
  warn:  '#f59e0b',
  error: '#f87171',
  debug: '#52525b',
};

const LEVEL_BG: Record<string, string> = {
  info:  'rgba(96,165,250,0.08)',
  warn:  'rgba(245,158,11,0.08)',
  error: 'rgba(248,113,113,0.08)',
  debug: 'transparent',
};

let entryId = 0;

function parseLevel(raw: string): LogEntry['level'] {
  const lower = raw.toLowerCase();
  if (lower.includes('"level":"error"') || lower.includes('"level":50') || lower.includes(' error ') || lower.includes('[error]')) return 'error';
  if (lower.includes('"level":"warn"') || lower.includes('"level":40) ') || lower.includes(' warn ') || lower.includes('[warn]')) return 'warn';
  if (lower.includes('"level":"debug"') || lower.includes('"level":20') || lower.includes(' debug ')) return 'debug';
  return 'info';
}

function parseEvent(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    // Pino format
    if (obj.msg) return obj.msg;
    if (obj.event) return obj.event;
    if (obj.type) return obj.type;
    if (obj.data?.type) return obj.data.type;
    if (obj.data?.summary) return obj.data.summary;
  } catch { /* not JSON */ }
  // Plain text — trim and truncate
  return raw.replace(/^\d{4}-\d{2}-\d{2}T[\d:.Z]+\s*/, '').slice(0, 200);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const MAX_ENTRIES = 500;

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);

  // Try to pretty-print raw JSON
  const prettyRaw = (() => {
    try { return JSON.stringify(JSON.parse(entry.raw), null, 2); }
    catch { return entry.raw; }
  })();
  const isJson = prettyRaw !== entry.raw || entry.raw.trimStart().startsWith('{');

  return (
    <div
      className="border-b border-zinc-900/60 hover:bg-zinc-900/40 group transition-colors"
      style={{ background: LEVEL_BG[entry.level] }}
    >
      <div
        className="flex items-start gap-2 px-3 py-1 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-[10px] text-zinc-700 tabular-nums flex-shrink-0 pt-px w-16">
          {formatTime(entry.ts)}
        </span>
        <span className="text-[10px] font-bold flex-shrink-0 pt-px w-10 uppercase"
          style={{ color: LEVEL_COLOR[entry.level] }}>
          {entry.level}
        </span>
        <span className="text-[10px] text-zinc-400 flex-1 leading-relaxed group-hover:text-zinc-300 transition-colors break-all pt-px">
          {entry.event}
        </span>
        {isJson && (
          <span className="text-[10px] text-zinc-700 flex-shrink-0 pt-px">{expanded ? '▲' : '▼'}</span>
        )}
      </div>
      {expanded && (
        <pre className="px-3 pb-2 text-[10px] text-zinc-500 leading-relaxed whitespace-pre-wrap break-all bg-zinc-950/60 max-h-48 overflow-y-auto">
          {prettyRaw}
        </pre>
      )}
    </div>
  );
}

export function LogsPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [search, setSearch] = useState('');
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [wsState, setWsState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const addEntry = useCallback((raw: string) => {
    if (pausedRef.current) return;
    const entry: LogEntry = {
      id: ++entryId,
      ts: Date.now(),
      level: parseLevel(raw),
      event: parseEvent(raw),
      raw,
    };
    setEntries(prev => {
      const next = [entry, ...prev];
      return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
    });
  }, []);

  useEffect(() => {
    const token = getGatewayToken();
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host  = window.location.host || '127.0.0.1:47200';
    const url   = `${proto}://${host}/ws/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    let ws: WebSocket;
    let dead = false;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(url);
      wsRef.current = ws;
      setWsState('connecting');

      ws.onopen = () => { if (!dead) setWsState('connected'); };

      ws.onmessage = (e) => {
        if (dead) return;
        addEntry(typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
      };

      ws.onerror = () => { /* onclose fires next */ };

      ws.onclose = () => {
        if (dead) return;
        setWsState('disconnected');
        retryTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      dead = true;
      clearTimeout(retryTimer);
      ws?.close();
    };
  }, [addEntry]);

  // Auto-scroll
  useEffect(() => {
    if (!autoScroll || paused) return;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [entries, autoScroll, paused]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    setAutoScroll(scrollRef.current.scrollTop < 30);
  };

  const visible = entries.filter(e => {
    if (filter !== 'all' && e.level !== filter) return false;
    if (search && !e.event.toLowerCase().includes(search.toLowerCase()) && !e.raw.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const clear = () => setEntries([]);

  const copyVisible = () => {
    const text = visible.map(e => `[${formatTime(e.ts)}] ${e.level.toUpperCase()} ${e.event}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Logs"
        description="Live gateway event stream. All agent runs, tool calls, memory events, and errors in real time."
        tip="Events stream via WebSocket from /ws/stream. Filter by level or search by keyword. Pause to freeze the view. Clear removes all displayed entries (does not affect the gateway log file)."
      />

      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60 flex-wrap">
        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            wsState === 'connected'    ? 'bg-emerald-400 animate-pulse' :
            wsState === 'connecting'   ? 'bg-amber-400 animate-pulse' :
            'bg-zinc-600'
          }`} />
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-wide">{wsState}</span>
        </div>

        <div className="w-px h-3 bg-zinc-800 mx-0.5" />

        {/* Level filter */}
        <div className="flex items-center gap-1">
          {(['all', 'info', 'warn', 'error'] as LevelFilter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className="text-[10px] font-mono px-2 py-0.5 rounded transition-all uppercase tracking-wide"
              style={{
                background: filter === f ? `${LEVEL_COLOR[f] ?? '#1eaeff'}18` : 'transparent',
                color:      filter === f ? (LEVEL_COLOR[f] ?? '#1eaeff') : '#52525b',
                border:     filter === f ? `1px solid ${LEVEL_COLOR[f] ?? '#1eaeff'}30` : '1px solid transparent',
              }}>
              {f}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter…"
          className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-[10px] font-mono text-zinc-300 placeholder-zinc-700 outline-none focus:border-zinc-600 transition-colors"
        />

        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          <span className="text-[10px] font-mono text-zinc-700 tabular-nums">{visible.length}/{entries.length}</span>

          <button onClick={() => setPaused(p => !p)}
            className="text-[10px] font-mono px-2 py-0.5 rounded transition-all"
            style={{
              background: paused ? 'rgba(245,158,11,0.1)' : 'transparent',
              color:      paused ? '#f59e0b' : '#52525b',
              border:     paused ? '1px solid rgba(245,158,11,0.25)' : '1px solid rgba(255,255,255,0.06)',
            }}>
            {paused ? '▶ resume' : '⏸ pause'}
          </button>

          <button onClick={copyVisible}
            disabled={visible.length === 0}
            className="text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-600 transition-colors disabled:opacity-30">
            {copied ? 'copied!' : 'copy'}
          </button>

          <button onClick={clear}
            className="text-[10px] font-mono px-2 py-0.5 rounded border border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-600 transition-colors">
            clear
          </button>

          <div className="w-1.5 h-1.5 rounded-full transition-colors duration-300"
            style={{ background: autoScroll && !paused ? '#34d399' : '#3f3f46' }}
            title={autoScroll ? 'auto-scroll on' : 'auto-scroll off'} />
        </div>
      </div>

      {/* Log entries */}
      <div ref={scrollRef} onScroll={handleScroll}
        className="flex-1 overflow-y-auto scrollbar-thin font-mono"
        style={{ scrollbarColor: '#27272a #09090b' }}>
        {visible.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-[10px] font-mono text-zinc-800">
              {paused ? 'log paused' : wsState === 'connected' ? 'awaiting events…' : `${wsState}…`}
            </span>
          </div>
        ) : (
          <div className="flex flex-col">
            {visible.map(entry => (
              <LogRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
