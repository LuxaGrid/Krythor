/**
 * WebSocket stream endpoint tests.
 *
 * Tests are isolated: each describe block creates and tears down its own server.
 * Uses the new typed frame protocol: connect handshake → req/res/event.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import { registerStreamWs } from './stream.js';
import type { KrythorCore } from '@krythor/core';
import type { GuardEngine } from '@krythor/guard';

// ── Helpers ────────────────────────────────────────────────────────────────────

const VALID_TOKEN = 'test-token-abc123';

/** Minimal KrythorCore stub. */
function makeCoreStub(): KrythorCore {
  return {
    handleCommand: async (input: string) => ({ output: `echo: ${input}`, agentId: 'stub' }),
    getModels: () => null,
    getOrchestrator: () => null,
  } as unknown as KrythorCore;
}

/** Allow-all guard stub. */
function makeGuardAllow(): GuardEngine {
  return { check: () => ({ allowed: true, reason: '', action: 'allow', warnings: [] }) } as unknown as GuardEngine;
}

/** Deny-all guard stub. */
function makeGuardDeny(): GuardEngine {
  return { check: () => ({ allowed: false, reason: 'BLOCKED', action: 'deny', warnings: [] }) } as unknown as GuardEngine;
}

async function startServer(
  getToken: () => string,
  core: KrythorCore,
  guard: GuardEngine,
): Promise<[ReturnType<typeof Fastify>, number]> {
  const app = Fastify({ logger: false });
  await app.register(fastifyWebsocket);
  registerStreamWs(app, core, getToken, guard);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return [app, port];
}

/** Wait for a specific message type on a WS connection. */
function waitForMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        if (predicate(parsed)) {
          clearTimeout(timer);
          resolve(parsed);
        }
      } catch { /* ignore */ }
    });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

/** Send a connect frame and wait for the res:connect response. Cleans up its listener after. */
async function doConnect(ws: WebSocket, token: string): Promise<Record<string, unknown>> {
  // Wait for open first
  await new Promise<void>((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'req', id: 'conn-1', method: 'connect', params: { auth: { token } } }));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 3000);
    const onMsg = (data: Buffer) => {
      try {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        if (parsed['type'] === 'res' && parsed['id'] === 'conn-1') {
          clearTimeout(timer);
          ws.off('message', onMsg);
          resolve(parsed);
        }
      } catch { /* ignore */ }
    };
    ws.on('message', onMsg);
    ws.once('error', (err) => { clearTimeout(timer); ws.off('message', onMsg); reject(err); });
  });
}

// ── Auth tests ────────────────────────────────────────────────────────────────

describe('WS /ws/stream — auth', () => {
  let app: ReturnType<typeof Fastify>;
  let port: number;

  beforeAll(async () => {
    [app, port] = await startServer(() => VALID_TOKEN, makeCoreStub(), makeGuardAllow());
  });
  afterAll(async () => { await app.close(); });

  it('returns ok:true on valid token in connect frame', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    const res = await doConnect(ws, VALID_TOKEN);
    expect(res['ok']).toBe(true);
    const payload = res['payload'] as Record<string, unknown>;
    expect(payload['hello']).toBe('ok');
    ws.close();
  });

  it('closes with 4001 on invalid token in connect frame', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    const closeCode = await new Promise<number>((resolve) => {
      ws.once('open', () => {
        ws.send(JSON.stringify({ type: 'req', id: 'c1', method: 'connect', params: { auth: { token: 'wrong' } } }));
      });
      ws.on('close', (code) => resolve(code));
      ws.on('error', () => resolve(0));
      setTimeout(() => resolve(-1), 3000);
    });
    expect(closeCode).toBe(4001);
  });

  it('returns error when first frame is not connect', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        ws.send(JSON.stringify({ type: 'req', id: 'r1', method: 'health' }));
      });
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        if (parsed['type'] === 'res' && parsed['id'] === 'r1') {
          expect(parsed['ok']).toBe(false);
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
  });
});

// ── Command handling ──────────────────────────────────────────────────────────

describe('WS /ws/stream — command handling', () => {
  let app: ReturnType<typeof Fastify>;
  let port: number;

  beforeAll(async () => {
    [app, port] = await startServer(() => VALID_TOKEN, makeCoreStub(), makeGuardAllow());
  });
  afterAll(async () => { await app.close(); });

  it('handles a command after connect handshake', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    await doConnect(ws, VALID_TOKEN);

    await new Promise<void>((resolve, reject) => {
      ws.send(JSON.stringify({ type: 'req', id: 'r2', method: 'command', params: { input: 'hello' } }));
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        if (parsed['type'] === 'res' && parsed['id'] === 'r2') {
          expect(parsed['ok']).toBe(true);
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
  });

  it('returns error on invalid JSON frame', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    await doConnect(ws, VALID_TOKEN);

    await new Promise<void>((resolve, reject) => {
      ws.send('not json at all');
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        if (parsed['type'] === 'res' && parsed['ok'] === false) {
          expect(String(parsed['error'])).toMatch(/invalid frame/i);
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
  });

  it('returns error on unknown method', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    await doConnect(ws, VALID_TOKEN);

    await new Promise<void>((resolve, reject) => {
      ws.send(JSON.stringify({ type: 'req', id: 'r3', method: 'unknown_method' }));
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        if (parsed['type'] === 'res' && parsed['id'] === 'r3') {
          expect(parsed['ok']).toBe(false);
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
  });
});

// ── Guard enforcement ─────────────────────────────────────────────────────────

describe('WS /ws/stream — guard enforcement', () => {
  let app: ReturnType<typeof Fastify>;
  let port: number;

  beforeAll(async () => {
    [app, port] = await startServer(() => VALID_TOKEN, makeCoreStub(), makeGuardDeny());
  });
  afterAll(async () => { await app.close(); });

  it('returns error when guard blocks a command', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    await doConnect(ws, VALID_TOKEN);

    await new Promise<void>((resolve, reject) => {
      ws.send(JSON.stringify({ type: 'req', id: 'r4', method: 'command', params: { input: 'do something' } }));
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as Record<string, unknown>;
        if (parsed['type'] === 'res' && parsed['id'] === 'r4') {
          expect(parsed['ok']).toBe(false);
          expect(String(parsed['error'])).toMatch(/BLOCKED/i);
          ws.close();
          resolve();
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
  });
});

// ── Connection cap ─────────────────────────────────────────────────────────────

describe('WS /ws/stream — connection cap', () => {
  it('rejects connections beyond MAX_WS_CONNECTIONS (10) with close code 4029', async () => {
    const [app, port] = await startServer(() => VALID_TOKEN, makeCoreStub(), makeGuardAllow());

    const sockets: WebSocket[] = [];
    try {
      // Open 10 connections (the cap)
      const opens = Array.from({ length: 10 }, () =>
        new Promise<WebSocket>(resolve => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
          ws.on('open', () => resolve(ws));
          ws.on('error', () => resolve(ws));
        }),
      );
      const opened = await Promise.all(opens);
      sockets.push(...opened);

      // The 11th connection should be rejected with 4029
      const closeCode = await new Promise<number>(resolve => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
        ws.on('close', code => resolve(code));
        ws.on('error', () => resolve(0));
        setTimeout(() => resolve(-1), 2000);
      });
      expect(closeCode).toBe(4029);
    } finally {
      sockets.forEach(ws => { try { ws.close(); } catch {} });
      await app.close();
    }
  });
});
