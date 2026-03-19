import { useGatewayContext } from '../GatewayContext.tsx';

/**
 * DegradedBanner — shown above the main content when the WebSocket connection
 * to the gateway is lost or in a degraded state.
 *
 * States:
 *   reconnecting  — transient, shown after first disconnect (yellow)
 *   degraded      — shown after RECONNECT_MAX_TRIES failures (red, prominent)
 *   connected     — banner hidden
 */
export function DegradedBanner() {
  const { connectionState, reconnectAttempts } = useGatewayContext();

  if (connectionState === 'connected' || connectionState === 'connecting' || connectionState === 'disconnected') {
    return null;
  }

  if (connectionState === 'degraded') {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex items-center justify-between gap-3 px-4 py-2.5 bg-red-950 border-b border-red-800 text-xs text-red-200"
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
          <span>
            <span className="font-semibold text-red-300">Gateway unreachable</span>
            {' — '}
            The Krythor gateway has not responded after {reconnectAttempts} attempts.
            Commands and live events are unavailable. Check that the gateway process is running.
          </span>
        </div>
        <span className="text-red-600 shrink-0">retrying…</span>
      </div>
    );
  }

  // reconnecting
  if (reconnectAttempts <= 1) return null; // suppress banner on first transient drop

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-1.5 bg-yellow-950/80 border-b border-yellow-800/60 text-xs text-yellow-300"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse shrink-0" />
      <span>
        Reconnecting to gateway
        <span className="text-yellow-600 ml-1">(attempt {reconnectAttempts})</span>
        {' — '}
        live events paused.
      </span>
    </div>
  );
}
