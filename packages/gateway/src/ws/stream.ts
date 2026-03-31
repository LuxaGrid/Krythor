// ─── Gateway WebSocket stream ─────────────────────────────────────────────────
//
// Implements the typed Gateway WS protocol:
//
//   1. First frame MUST be req:connect (mandatory handshake)
//   2. Auth is validated inside the connect frame (not URL params)
//   3. Device pairing: loopback auto-approved; remote requires approval
//   4. After handshake: typed req/res + server-push events
//
// Supported request methods (post-connect):
//   health        — GET /api/health equivalent
//   agent.run     — run an agent by id
//   command       — run a text command via KrythorCore
//
// Events pushed by the server:
//   agent:event   — lifecycle + stream chunks from agent runs
//   heartbeat     — periodic health snapshot
//
// Node roles:
//   Clients that connect with device.role:'node' are registered in nodeRegistry
//   so their capabilities can be invoked via POST /api/nodes/:deviceId/invoke.
//

import type { FastifyInstance } from 'fastify';
import type { KrythorCore } from '@krythor/core';
import type { GuardEngine } from '@krythor/guard';
import { verifyToken } from '../auth.js';
import { logger } from '../logger.js';
import {
  parseFrame,
  makeRes,
  makeEvent,
  type ConnectParams,
  type ConnectPayload,
} from './protocol.js';
import { DevicePairingStore } from './DevicePairingStore.js';
import { nodeRegistry } from './NodeRegistry.js';

// ── Tunables ─────────────────────────────────────────────────────────────────

const PING_INTERVAL_MS     = 30_000;
const PONG_TIMEOUT_MS      = 10_000;
const MAX_WS_CONNECTIONS   = 10;
const MAX_CONNECTION_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_FRAME_BYTES      = 65_536; // 64 KB

// Module-level connection counter — exported for observability (/health endpoint)
let activeConnections = 0;

/** Returns the current number of active WebSocket connections. */
export function getActiveWsConnections(): number { return activeConnections; }

// ── Loopback detection ────────────────────────────────────────────────────────

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

// ── registerStreamWs ─────────────────────────────────────────────────────────

export function registerStreamWs(
  app: FastifyInstance,
  core: KrythorCore,
  getToken: () => string,
  guard: GuardEngine,
  deviceStore?: DevicePairingStore,
  gatewayId = 'local',
  gatewayVersion = '0.0.0',
): void {
  let eventSeq = 0;

  app.get('/ws/stream', { websocket: true }, (socket, request) => {
    // ── Connection cap ─────────────────────────────────────────────────────
    if (activeConnections >= MAX_WS_CONNECTIONS) {
      socket.send(JSON.stringify(makeEvent('error', { error: 'Too many connections' })));
      socket.close(4029, 'Too many connections');
      return;
    }

    const remoteIp = request.ip;
    let handshakeDone = false;
    let connectedDeviceId: string | null = null;
    let connectedDeviceRole: string = 'client';
    let connectedToken: string | undefined; // token used in the connect handshake

    activeConnections++;

    // ── Max connection lifetime ─────────────────────────────────────────────
    const maxAgeTimer = setTimeout(() => {
      socket.send(JSON.stringify(makeEvent('reconnect', { reason: 'max_connection_age' })));
      socket.close(4000, 'Max connection age — please reconnect');
    }, MAX_CONNECTION_AGE_MS);

    // ── Keepalive heartbeat ─────────────────────────────────────────────────
    let pongReceived = true;
    let pongTimer: ReturnType<typeof setTimeout> | null = null;

    const pingInterval = setInterval(() => {
      if (!pongReceived) { socket.terminate(); return; }
      pongReceived = false;
      try { socket.ping(); } catch { socket.terminate(); return; }
      pongTimer = setTimeout(() => { if (!pongReceived) socket.terminate(); }, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);

    socket.on('pong', () => {
      pongReceived = true;
      if (pongTimer) { clearTimeout(pongTimer); pongTimer = null; }
    });

    // ── Message handler ─────────────────────────────────────────────────────
    socket.on('message', async (rawMessage: Buffer) => {
      if (rawMessage.length > MAX_FRAME_BYTES) {
        socket.send(JSON.stringify(makeRes('', false, undefined, 'Frame too large (max 64 KB)')));
        return;
      }

      const frame = parseFrame(rawMessage.toString());
      if (!frame) {
        socket.send(JSON.stringify(makeRes('', false, undefined, 'Invalid frame — must be JSON {type:"req", id, method}')));
        return;
      }

      // ── req:connect — mandatory first frame ───────────────────────────────
      if (frame.method === 'connect') {
        if (handshakeDone) {
          socket.send(JSON.stringify(makeRes(frame.id, false, undefined, 'Already connected')));
          return;
        }

        const params = (frame.params ?? {}) as ConnectParams;

        // Auth validation
        const tokenOk = verifyToken(params.auth?.token, getToken());
        if (!tokenOk) {
          socket.send(JSON.stringify(makeRes(frame.id, false, undefined, 'Unauthorized')));
          socket.close(4001, 'Unauthorized');
          activeConnections = Math.max(0, activeConnections - 1);
          return;
        }

        // Device pairing
        let deviceStatus: ConnectPayload['deviceStatus'] = 'no_device';
        let issuedDeviceToken: string | undefined;

        if (deviceStore && params.device) {
          const deviceId = params.device.deviceId;
          const deviceRole = params.device.role ?? 'client';

          const { device, tokenValid } = deviceStore.checkDevice(
            deviceId,
            {
              platform:     params.device.platform,
              deviceFamily: params.device.deviceFamily,
              role:         deviceRole,
              caps:         params.device.caps,
            },
            params.deviceToken,
          );

          connectedDeviceId   = deviceId;
          connectedDeviceRole = deviceRole;

          if (device.status === 'denied') {
            socket.send(JSON.stringify(makeRes(frame.id, false, undefined, 'Device denied')));
            socket.close(4003, 'Device denied');
            activeConnections = Math.max(0, activeConnections - 1);
            return;
          }

          if (device.status === 'approved' && tokenValid) {
            deviceStatus = 'approved';
          } else if (device.status === 'approved' && !tokenValid) {
            // Token missing or stale — re-issue
            const updated = deviceStore.approve(deviceId);
            issuedDeviceToken = updated.deviceToken;
            deviceStatus = 'approved';
          } else if (device.status === 'pending' && isLoopback(remoteIp)) {
            // Auto-approve loopback connects
            const updated = deviceStore.autoApprove(deviceId);
            issuedDeviceToken = updated.deviceToken;
            deviceStatus = 'auto_approved';
            logger.info('ws:device_auto_approved', { deviceId, ip: remoteIp });
          } else {
            // Remote + pending → hold as pending (owner must approve)
            deviceStatus = 'pending';
            logger.info('ws:device_pending', { deviceId, ip: remoteIp });
            // Do NOT close — allow the client to stay connected for approval polling
          }

          // Register in node registry if this is an approved node
          if ((deviceStatus === 'approved' || deviceStatus === 'auto_approved') && deviceRole === 'node') {
            nodeRegistry.register(deviceId, socket, params.device.caps ?? []);
            logger.info('ws:node_registered', { deviceId, caps: params.device.caps ?? [] });
          }
        }

        handshakeDone = true;
        connectedToken = params.auth?.token ?? (request.query as Record<string, string>)['token'];

        const payload: ConnectPayload = {
          hello: 'ok',
          gatewayId,
          version: gatewayVersion,
          deviceStatus,
          ...(issuedDeviceToken ? { deviceToken: issuedDeviceToken } : {}),
        };

        socket.send(JSON.stringify(makeRes(frame.id, true, payload)));

        // Emit snapshot events
        socket.send(JSON.stringify(makeEvent('gateway:ready', {
          gatewayId,
          version: gatewayVersion,
          connectedAt: Date.now(),
        }, ++eventSeq)));

        return;
      }

      // ── All other methods require a completed handshake ────────────────────
      if (!handshakeDone) {
        socket.send(JSON.stringify(makeRes(frame.id, false, undefined, 'Connect handshake required — send {type:"req",method:"connect"} first')));
        return;
      }

      // Per-frame token recheck: only enforce if the gateway token appears to have
      // changed since the connect handshake. We track the token seen at connect time
      // and check if it still matches the current gateway token.
      // This avoids false rejections when clients send frames without re-supplying
      // the token (which is the normal case post-handshake).
      if (!verifyToken(connectedToken, getToken())) {
        socket.send(JSON.stringify(makeRes(frame.id, false, undefined, 'Token invalidated — reconnect required')));
        socket.close(4001, 'Token invalidated');
        return;
      }

      // ── Method dispatch ────────────────────────────────────────────────────

      try {
        switch (frame.method) {

          case 'health': {
            const models = core.getModels();
            const stats = models?.stats() ?? { providerCount: 0, modelCount: 0 };
            socket.send(JSON.stringify(makeRes(frame.id, true, {
              status: 'ok',
              providerCount: stats.providerCount,
              modelCount: stats.modelCount,
              activeConnections,
            })));
            break;
          }

          case 'command': {
            const params = (frame.params ?? {}) as Record<string, unknown>;
            const input = typeof params['input'] === 'string' ? params['input'] : '';
            if (!input.trim()) {
              socket.send(JSON.stringify(makeRes(frame.id, false, undefined, 'input required')));
              break;
            }

            const verdict = guard.check({ operation: 'command:execute', source: 'user', content: input });
            if (!verdict.allowed) {
              socket.send(JSON.stringify(makeRes(frame.id, false, undefined, `Blocked: ${verdict.reason}`)));
              break;
            }

            const result = await core.handleCommand(input);
            socket.send(JSON.stringify(makeRes(frame.id, true, result)));
            break;
          }

          case 'agent.run': {
            const params = (frame.params ?? {}) as Record<string, unknown>;
            const agentId   = typeof params['agentId'] === 'string' ? params['agentId'] : '';
            const input     = typeof params['input'] === 'string' ? params['input'] : '';
            const runId     = typeof params['runId'] === 'string' ? params['runId'] : undefined;

            if (!agentId || !input.trim()) {
              socket.send(JSON.stringify(makeRes(frame.id, false, undefined, 'agentId and input required')));
              break;
            }

            const orch = core.getOrchestrator();
            if (!orch) {
              socket.send(JSON.stringify(makeRes(frame.id, false, undefined, 'Orchestrator not available')));
              break;
            }

            // Immediately acknowledge with runId
            const effectiveRunId = runId ?? `ws-${Date.now()}`;
            socket.send(JSON.stringify(makeRes(frame.id, true, { runId: effectiveRunId, status: 'accepted' })));

            // Run agent and forward events to this socket
            void orch.runAgent(agentId, { input, runId: effectiveRunId }).then(run => {
              socket.send(JSON.stringify(makeEvent('agent:completed', {
                runId: run.id,
                status: run.status,
                output: run.output,
                modelUsed: run.modelUsed,
              }, ++eventSeq)));
            }).catch(err => {
              socket.send(JSON.stringify(makeEvent('agent:error', {
                runId: effectiveRunId,
                error: err instanceof Error ? err.message : String(err),
              }, ++eventSeq)));
            });
            break;
          }

          default: {
            socket.send(JSON.stringify(makeRes(frame.id, false, undefined, `Unknown method: ${frame.method}`)));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        socket.send(JSON.stringify(makeRes(frame.id, false, undefined, message)));
      }
    });

    // ── Cleanup ─────────────────────────────────────────────────────────────
    socket.on('close', () => {
      activeConnections = Math.max(0, activeConnections - 1);
      clearInterval(pingInterval);
      clearTimeout(maxAgeTimer);
      if (pongTimer) clearTimeout(pongTimer);
      if (connectedDeviceId) {
        logger.info('ws:device_disconnected', { deviceId: connectedDeviceId, ip: remoteIp });
        if (connectedDeviceRole === 'node') {
          nodeRegistry.unregister(connectedDeviceId);
          logger.info('ws:node_unregistered', { deviceId: connectedDeviceId });
        }
      }
    });
  });

  // ── Legacy /ws/stream URL still works (token in query param for old clients)
  // The legacy path is the same handler — it accepts token in ?token= for
  // backwards compat and still requires the connect handshake.
}
