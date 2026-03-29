import { describe, it, expect, beforeEach } from 'vitest';
import { GatewayEventBus } from './GatewayEventBus.js';

let bus: GatewayEventBus;

beforeEach(() => {
  bus = new GatewayEventBus();
});

describe('GatewayEventBus.on / emit', () => {
  it('calls a registered handler with payload', () => {
    const calls: string[] = [];
    bus.on('gateway:startup', ({ version }) => { calls.push(version); });
    bus.emit('gateway:startup', { version: '1.0.0', dataDir: '/data', host: 'localhost', port: 3000 });
    expect(calls).toEqual(['1.0.0']);
  });

  it('calls multiple handlers in registration order', () => {
    const order: number[] = [];
    bus.on('session:new', () => { order.push(1); });
    bus.on('session:new', () => { order.push(2); });
    bus.on('session:new', () => { order.push(3); });
    bus.emit('session:new', { conversationId: 'c1' });
    expect(order).toEqual([1, 2, 3]);
  });

  it('does nothing when no handlers registered', () => {
    expect(() => bus.emit('gateway:shutdown', {})).not.toThrow();
  });
});

describe('GatewayEventBus.off', () => {
  it('removes a specific handler', () => {
    const calls: number[] = [];
    const h1 = () => { calls.push(1); };
    const h2 = () => { calls.push(2); };
    bus.on('session:compact', h1);
    bus.on('session:compact', h2);
    bus.off('session:compact', h1);
    bus.emit('session:compact', { conversationId: 'c1', keptMessages: 5 });
    expect(calls).toEqual([2]);
  });

  it('no-ops when handler not registered', () => {
    expect(() => bus.off('session:new', () => {})).not.toThrow();
  });
});

describe('GatewayEventBus error isolation', () => {
  it('continues calling remaining handlers after sync error', () => {
    const calls: number[] = [];
    bus.on('command:received', () => { throw new Error('boom'); });
    bus.on('command:received', () => { calls.push(1); });
    bus.emit('command:received', { input: 'hello', stream: false });
    expect(calls).toEqual([1]);
  });

  it('does not throw on async handler rejection', async () => {
    bus.on('command:completed', async () => { throw new Error('async boom'); });
    expect(() =>
      bus.emit('command:completed', { input: 'x', durationMs: 100 })
    ).not.toThrow();
    // Allow microtask queue to flush so rejection is handled internally
    await new Promise(r => setTimeout(r, 10));
  });
});

describe('GatewayEventBus.handlerCount', () => {
  it('returns 0 for unregistered event', () => {
    expect(bus.handlerCount('gateway:startup')).toBe(0);
  });

  it('increments as handlers are added', () => {
    bus.on('agent:run:started', () => {});
    bus.on('agent:run:started', () => {});
    expect(bus.handlerCount('agent:run:started')).toBe(2);
  });

  it('decrements after off()', () => {
    const h = () => {};
    bus.on('agent:run:failed', h);
    bus.off('agent:run:failed', h);
    expect(bus.handlerCount('agent:run:failed')).toBe(0);
  });
});

describe('GatewayEventBus.clear', () => {
  it('removes all handlers for all events', () => {
    bus.on('gateway:startup', () => {});
    bus.on('session:new', () => {});
    bus.clear();
    expect(bus.handlerCount('gateway:startup')).toBe(0);
    expect(bus.handlerCount('session:new')).toBe(0);
  });
});

describe('GatewayEventBus typed payloads', () => {
  it('emits agent:run:started with correct shape', () => {
    let received: { runId: string; agentId: string } | null = null;
    bus.on('agent:run:started', p => { received = p; });
    bus.emit('agent:run:started', { runId: 'r1', agentId: 'a1' });
    expect(received).toEqual({ runId: 'r1', agentId: 'a1' });
  });

  it('emits agent:run:completed with durationMs', () => {
    let ms = 0;
    bus.on('agent:run:completed', p => { ms = p.durationMs; });
    bus.emit('agent:run:completed', { runId: 'r1', agentId: 'a1', durationMs: 42 });
    expect(ms).toBe(42);
  });

  it('emits agent:run:failed with error string', () => {
    let err = '';
    bus.on('agent:run:failed', p => { err = p.error; });
    bus.emit('agent:run:failed', { runId: 'r1', agentId: 'a1', error: 'timeout' });
    expect(err).toBe('timeout');
  });
});
