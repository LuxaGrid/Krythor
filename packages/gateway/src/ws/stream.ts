import type { FastifyInstance } from 'fastify';
import type { KrythorCore } from '@krythor/core';
import type { GuardEngine } from '@krythor/guard';
import { verifyToken } from '../auth.js';

// Heartbeat interval — ping every 30s, close if no pong within 10s.
const PING_INTERVAL_MS     = 30_000;
const PONG_TIMEOUT_MS      = 10_000;
// Max simultaneous WS connections — prevents resource exhaustion.
const MAX_WS_CONNECTIONS   = 10;
// Max connection lifetime — forces reconnect, re-validating the token.
const MAX_CONNECTION_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

// Module-level connection counter
let activeConnections = 0;

export function registerStreamWs(
  app: FastifyInstance,
  core: KrythorCore,
  // getToken is a function so token rotation is reflected without restart
  getToken: () => string,
  guard: GuardEngine,
): void {
  app.get('/ws/stream', { websocket: true }, (socket, request) => {
    // ── Connection cap ─────────────────────────────────────────────────────────
    if (activeConnections >= MAX_WS_CONNECTIONS) {
      socket.send(JSON.stringify({ type: 'error', error: 'Too many connections' }));
      socket.close(4029, 'Too many connections');
      return;
    }

    // ── Auth check — token is passed as ?token= because browser WS APIs
    // cannot set arbitrary headers.
    const supplied = (request.query as Record<string, string>)['token'];
    if (!verifyToken(supplied, getToken())) {
      socket.send(JSON.stringify({ type: 'error', error: 'Unauthorized' }));
      socket.close(4001, 'Unauthorized');
      return;
    }

    activeConnections++;

    // ── Max connection lifetime ────────────────────────────────────────────────
    // Force a reconnect after MAX_CONNECTION_AGE_MS. This ensures any token
    // rotation is picked up without waiting for the client to disconnect.
    const maxAgeTimer = setTimeout(() => {
      socket.send(JSON.stringify({ type: 'reconnect', reason: 'max_connection_age' }));
      socket.close(4000, 'Max connection age reached — please reconnect');
    }, MAX_CONNECTION_AGE_MS);

    // ── Keepalive heartbeat ────────────────────────────────────────────────────
    // Send a ping frame every PING_INTERVAL_MS. If the client does not respond
    // with a pong within PONG_TIMEOUT_MS the connection is assumed dead and
    // terminated. This prevents silent half-open connections from accumulating.
    let pongReceived = true; // treat as alive on first tick
    let pongTimer: ReturnType<typeof setTimeout> | null = null;

    const pingInterval = setInterval(() => {
      if (!pongReceived) {
        // Previous ping went unanswered — close the stale connection
        socket.terminate();
        return;
      }
      pongReceived = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
        return;
      }
      // Start a deadline timer — if pong does not arrive, terminate
      pongTimer = setTimeout(() => {
        if (!pongReceived) socket.terminate();
      }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);

    socket.on('pong', () => {
      pongReceived = true;
      if (pongTimer) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }
    });

    // ── Per-message token recheck ──────────────────────────────────────────────
    // Re-validate the token on every message. If the token was rotated after
    // connection was established, the next message will be rejected.
    socket.on('message', async (rawMessage: Buffer) => {
      if (!verifyToken(supplied, getToken())) {
        socket.send(JSON.stringify({ type: 'error', error: 'Token invalidated — please reconnect' }));
        socket.close(4001, 'Token invalidated');
        return;
      }
      if (rawMessage.length > 65_536) {
        socket.send(JSON.stringify({ error: 'Message too large (max 64 KB)' }));
        return;
      }

      let input: string;

      try {
        const parsed = JSON.parse(rawMessage.toString()) as unknown;
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          !('input' in parsed) ||
          typeof (parsed as Record<string, unknown>).input !== 'string'
        ) {
          socket.send(JSON.stringify({ error: 'Message must be JSON with an "input" string field' }));
          return;
        }
        input = (parsed as { input: string }).input;
      } catch {
        socket.send(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      // Guard check — same policy enforcement as the HTTP /api/command route
      const verdict = guard.check({ operation: 'command:execute', source: 'user', content: input });
      if (!verdict.allowed) {
        socket.send(JSON.stringify({ type: 'error', error: 'GUARD_DENIED', reason: verdict.reason }));
        return;
      }

      try {
        const result = await core.handleCommand(input);
        socket.send(JSON.stringify({ type: 'result', data: result }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        socket.send(JSON.stringify({ type: 'error', error: message }));
      }
    });

    socket.on('close', () => {
      activeConnections = Math.max(0, activeConnections - 1);
      clearInterval(pingInterval);
      clearTimeout(maxAgeTimer);
      if (pongTimer) clearTimeout(pongTimer);
    });

    socket.send(JSON.stringify({ type: 'connected', message: 'Krythor Gateway WebSocket ready' }));
  });
}
