// ─── NodeRegistry ─────────────────────────────────────────────────────────────
//
// Tracks WebSocket connections from devices with role:'node'.
// Used by the gateway to forward node.invoke calls to the correct socket.
//
// Lifecycle:
//   1. WS handshake completes with role:'node' → register(deviceId, socket, caps)
//   2. Socket closes → unregister(deviceId)
//   3. REST POST /api/nodes/:deviceId/invoke → invoke(deviceId, command, params)
//
// Thread safety: Node.js is single-threaded; no locking needed.
//

import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';

export interface NodeEntry {
  deviceId: string;
  caps: string[];
  connectedAt: number;
  /** Send a typed req frame and wait for the matching res frame. */
  invoke(command: string, params: unknown, timeoutMs?: number): Promise<unknown>;
}

/** Maximum time to wait for a node to respond to an invoke (default 30 s) */
const DEFAULT_INVOKE_TIMEOUT_MS = 30_000;

export class NodeRegistry {
  private readonly nodes = new Map<string, NodeEntry>();

  /**
   * Register a connected node socket.
   * Returns the NodeEntry — caller should call unregister on socket close.
   */
  register(deviceId: string, socket: WebSocket, caps: string[]): NodeEntry {
    const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

    // Forward res frames from the node back to waiting invoke() callers
    const onMessage = (raw: Buffer | string) => {
      try {
        const frame = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf-8')) as Record<string, unknown>;
        if (frame['type'] === 'res' && typeof frame['id'] === 'string') {
          const waiter = pending.get(frame['id']);
          if (waiter) {
            clearTimeout(waiter.timer);
            pending.delete(frame['id']);
            if (frame['ok']) {
              waiter.resolve(frame['payload']);
            } else {
              waiter.reject(new Error(typeof frame['error'] === 'string' ? frame['error'] : 'Node error'));
            }
          }
        }
      } catch {
        // malformed frame — ignore
      }
    };

    socket.on('message', onMessage);

    const entry: NodeEntry = {
      deviceId,
      caps,
      connectedAt: Date.now(),
      invoke(command: string, params: unknown, timeoutMs = DEFAULT_INVOKE_TIMEOUT_MS): Promise<unknown> {
        return new Promise((resolve, reject) => {
          if (socket.readyState !== socket.OPEN) {
            reject(new Error(`Node ${deviceId} is not connected`));
            return;
          }
          const id = randomUUID();
          const frame = JSON.stringify({ type: 'req', id, method: 'node.invoke', params: { command, params } });
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`node.invoke timeout after ${timeoutMs}ms (command: ${command})`));
          }, timeoutMs);
          pending.set(id, { resolve, reject, timer });
          try {
            socket.send(frame);
          } catch (err) {
            clearTimeout(timer);
            pending.delete(id);
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      },
    };

    this.nodes.set(deviceId, entry);
    return entry;
  }

  /**
   * Unregister a node when its socket closes.
   */
  unregister(deviceId: string): void {
    this.nodes.delete(deviceId);
  }

  /**
   * Look up a connected node by deviceId.
   */
  get(deviceId: string): NodeEntry | undefined {
    return this.nodes.get(deviceId);
  }

  /**
   * List all currently-connected nodes (safe snapshot).
   */
  list(): { deviceId: string; caps: string[]; connectedAt: number }[] {
    return Array.from(this.nodes.values()).map(n => ({
      deviceId:    n.deviceId,
      caps:        n.caps,
      connectedAt: n.connectedAt,
    }));
  }
}

/** Singleton shared across gateway (stream handler + node routes) */
export const nodeRegistry = new NodeRegistry();
