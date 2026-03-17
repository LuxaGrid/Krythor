import type { FastifyInstance } from 'fastify';
import type { KrythorCore } from '@krythor/core';
import type { GuardEngine } from '@krythor/guard';
import { verifyToken } from '../auth.js';

// Heartbeat interval — ping every 30s, close if no pong within 10s.
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS  = 10_000;

export function registerStreamWs(app: FastifyInstance, core: KrythorCore, token: string, guard: GuardEngine): void {
  app.get('/ws/stream', { websocket: true }, (socket, request) => {
    // Auth check — token is passed as ?token= because browser WS APIs
    // cannot set arbitrary headers.
    const supplied = (request.query as Record<string, string>)['token'];
    if (!verifyToken(supplied, token)) {
      socket.send(JSON.stringify({ type: 'error', error: 'Unauthorized' }));
      socket.close(4001, 'Unauthorized');
      return;
    }

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

    socket.on('message', async (rawMessage: Buffer) => {
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
      clearInterval(pingInterval);
      if (pongTimer) clearTimeout(pongTimer);
    });

    socket.send(JSON.stringify({ type: 'connected', message: 'Krythor Gateway WebSocket ready' }));
  });
}
