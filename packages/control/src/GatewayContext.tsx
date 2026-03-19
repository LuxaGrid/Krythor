import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getGatewayToken } from './api.js';

export interface GatewayEvent {
  id: number;      // monotonic counter for stable, unique React keys
  type: string;
  payload?: unknown;
  timestamp?: number;
}

interface StreamChunkPayload {
  delta: string;
  done: boolean;
}

interface AgentEventPayload {
  type: string;
  runId: string;
  agentId: string;
  payload?: unknown;
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'degraded' | 'disconnected';

// Reconnection: exponential backoff 2s → 4s → 8s → … capped at 30s
const RECONNECT_BASE_MS  = 2_000;
const RECONNECT_MAX_MS   = 30_000;
const RECONNECT_MAX_TRIES = 10; // after this many failures → 'degraded'

interface GatewayCtx {
  connected: boolean;
  connectionState: ConnectionState;
  reconnectAttempts: number;
  events: GatewayEvent[];
  clearEvents: () => void;
  // Per-run streaming buffers: runId → accumulated text so far
  streamBuffers: Map<string, string>;
  // Completed run data keyed by runId
  completedRuns: Map<string, { output: string; modelUsed?: string }>;
}

const defaultCtx: GatewayCtx = {
  connected: false,
  connectionState: 'disconnected',
  reconnectAttempts: 0,
  events: [],
  clearEvents: () => {},
  streamBuffers: new Map(),
  completedRuns: new Map(),
};

export const GatewayContext = createContext<GatewayCtx>(defaultCtx);
export const useGatewayContext = () => useContext(GatewayContext);

// Module-level monotonic counter — survives re-renders and gives unique IDs
let eventCounter = 0;

export function GatewayProvider({ children, token }: { children: React.ReactNode; token?: string }) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [events, setEvents] = useState<GatewayEvent[]>([]);
  const [streamBuffers, setStreamBuffers] = useState<Map<string, string>>(new Map());
  const [completedRuns, setCompletedRuns] = useState<Map<string, { output: string; modelUsed?: string }>>(new Map());

  const connect = useCallback((resolvedToken?: string) => {
    // Don't attempt connection without a token — would immediately get 4001 and loop.
    const t = resolvedToken ?? getGatewayToken();
    if (!t) return;

    setConnectionState(attemptsRef.current === 0 ? 'connecting' : 'reconnecting');

    const wsUrl = `ws://${window.location.host}/ws/stream?token=${encodeURIComponent(t)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptsRef.current = 0;
      setReconnectAttempts(0);
      setConnected(true);
      setConnectionState('connected');
    };
    ws.onclose = () => {
      setConnected(false);
      // Only reconnect if we have a token — avoids tight loop on auth failure.
      if (getGatewayToken()) {
        attemptsRef.current++;
        setReconnectAttempts(attemptsRef.current);
        if (attemptsRef.current >= RECONNECT_MAX_TRIES) {
          setConnectionState('degraded');
          // Still keep retrying slowly — gateway may come back
        } else {
          setConnectionState('reconnecting');
        }
        const backoffMs = Math.min(RECONNECT_BASE_MS * 2 ** (attemptsRef.current - 1), RECONNECT_MAX_MS);
        reconnectTimer.current = setTimeout(() => connect(), backoffMs);
      } else {
        setConnectionState('disconnected');
      }
    };
    ws.onerror = () => ws.close();

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data as string) as GatewayEvent;

        // Handle agent streaming events specially
        if (event.type === 'agent:event') {
          const agentEvent = event.payload as AgentEventPayload;

          if (agentEvent?.type === 'run:stream:chunk') {
            const { runId, payload } = agentEvent as { runId: string; payload: StreamChunkPayload };
            setStreamBuffers(prev => {
              const next = new Map(prev);
              next.set(runId, (next.get(runId) ?? '') + (payload?.delta ?? ''));
              return next;
            });
            return; // Don't add individual chunks to the event log
          }

          if (agentEvent?.type === 'run:completed') {
            const { runId, payload } = agentEvent as {
              runId: string;
              payload: { output?: string; modelUsed?: string };
            };
            setCompletedRuns(prev => {
              const next = new Map(prev);
              next.set(runId, { output: payload?.output ?? '', modelUsed: payload?.modelUsed });
              // Keep only the 100 most recent entries
              if (next.size > 100) {
                const oldest = next.keys().next().value;
                if (oldest) next.delete(oldest);
              }
              return next;
            });
            setStreamBuffers(prev => {
              const next = new Map(prev);
              next.delete(runId);
              return next;
            });
          }

          if (agentEvent?.type === 'run:failed' || agentEvent?.type === 'run:stopped') {
            const { runId } = agentEvent as { runId: string };
            setStreamBuffers(prev => {
              const next = new Map(prev);
              next.delete(runId);
              return next;
            });
          }
        }

        const taggedEvent: GatewayEvent = { ...event, id: ++eventCounter };
        setEvents(prev => [taggedEvent, ...prev].slice(0, 200));
      } catch { /* ignore malformed */ }
    };
  }, []);

  // Connect once the token is available. If the token prop arrives after mount
  // (health poll returns), this effect re-runs and opens the WS connection.
  useEffect(() => {
    if (!token) return;
    connect(token);
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect, token]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return (
    <GatewayContext.Provider value={{ connected, connectionState, reconnectAttempts, events, clearEvents, streamBuffers, completedRuns }}>
      {children}
    </GatewayContext.Provider>
  );
}
