/**
 * GatewayEventBus — internal lifecycle event system.
 *
 * Fires named events at key points in the gateway lifecycle.
 * Registered handlers can react to these events synchronously or
 * asynchronously (fire-and-forget; errors are caught and logged).
 *
 * Event taxonomy:
 *
 *   gateway:startup       — Gateway has fully started and is ready to serve
 *   gateway:shutdown      — Gateway is shutting down
 *
 *   session:new           — A new conversation was created
 *   session:compact       — A conversation was compacted
 *
 *   command:received      — A command was received (before inference)
 *   command:completed     — A command run completed
 *
 *   agent:run:started     — An agent run started
 *   agent:run:completed   — An agent run completed
 *   agent:run:failed      — An agent run failed
 *
 *   message:received      — An inbound message arrived on a chat channel
 *
 * Handlers receive a typed payload and a context object.
 * Multiple handlers can be registered for the same event.
 * Handlers are called in registration order.
 */

export type GatewayEventName =
  | 'gateway:startup'
  | 'gateway:shutdown'
  | 'session:new'
  | 'session:compact'
  | 'command:received'
  | 'command:completed'
  | 'agent:run:started'
  | 'agent:run:completed'
  | 'agent:run:failed'
  | 'message:received';

export interface GatewayEventPayload {
  'gateway:startup':      { version: string; dataDir: string; host: string; port: number };
  'gateway:shutdown':     Record<string, never>;
  'session:new':          { conversationId: string; agentId?: string };
  'session:compact':      { conversationId: string; keptMessages: number };
  'command:received':     { input: string; agentId?: string; conversationId?: string; stream: boolean };
  'command:completed':    { input: string; agentId?: string; conversationId?: string; modelUsed?: string; durationMs: number };
  'agent:run:started':    { runId: string; agentId: string };
  'agent:run:completed':  { runId: string; agentId: string; durationMs: number; modelUsed?: string };
  'agent:run:failed':     { runId: string; agentId: string; error: string };
  'message:received':     { channel: string; senderId: string; text: string; isGroup: boolean };
}

export type GatewayEventHandler<E extends GatewayEventName> =
  (payload: GatewayEventPayload[E]) => void | Promise<void>;

export class GatewayEventBus {
  private readonly handlers = new Map<string, Array<GatewayEventHandler<GatewayEventName>>>();

  on<E extends GatewayEventName>(event: E, handler: GatewayEventHandler<E>): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler as GatewayEventHandler<GatewayEventName>);
    this.handlers.set(event, existing);
  }

  off<E extends GatewayEventName>(event: E, handler: GatewayEventHandler<E>): void {
    const existing = this.handlers.get(event);
    if (!existing) return;
    const idx = existing.indexOf(handler as GatewayEventHandler<GatewayEventName>);
    if (idx !== -1) existing.splice(idx, 1);
  }

  emit<E extends GatewayEventName>(event: E, payload: GatewayEventPayload[E]): void {
    const handlers = this.handlers.get(event);
    if (!handlers || handlers.length === 0) return;
    for (const handler of handlers) {
      try {
        const result = (handler as GatewayEventHandler<E>)(payload);
        if (result instanceof Promise) {
          result.catch(err => {
            console.error(`[GatewayEventBus] Handler error for event "${event}":`, err);
          });
        }
      } catch (err) {
        console.error(`[GatewayEventBus] Handler error for event "${event}":`, err);
      }
    }
  }

  /** Return the number of registered handlers for a given event. */
  handlerCount(event: GatewayEventName): number {
    return this.handlers.get(event)?.length ?? 0;
  }

  /** Remove all handlers for all events. */
  clear(): void {
    this.handlers.clear();
  }
}

/** Singleton instance — shared across the gateway process. */
export const gatewayEvents = new GatewayEventBus();
