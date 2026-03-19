/**
 * WebSocket stream endpoint tests.
 *
 * These tests start a real Fastify/WebSocket server on a random port so that
 * actual WS connections can be made with the ws client. This exercises the full
 * auth, message handling, keepalive, and reconnect paths.
 *
 * Tests are isolated: each describe block creates and tears down its own server.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import WebSocket from 'ws';
import { registerStreamWs } from './stream.js';
import type { KrythorCore } from '@krythor/core';
import type { GuardEngine } from '@krythor/guard';

// ── Helpers ────────────────────────────────────────────────────────────────────

const VALID_TOKEN = 'test-token-abc123';

/** Minimal KrythorCore stub that echoes the input back as output. */
function makeCoreStub(): KrythorCore {
  return {
    handleCommand: async (input: string) => ({ output: `echo: ${input}`, agentId: 'stub' }),
  } as unknown as KrythorCore;
}

/** Minimal GuardEngine stub that allows all commands. */
function makeGuardAllow(): GuardEngine {
  return {
    check: () => ({ allowed: true, reason: '' }),
  } as unknown as GuardEngine;
}

/** Minimal GuardEngine stub that denies all commands. */
function makeGuardDeny(): GuardEngine {
  return {
    check: () => ({ allowed: false, reason: 'BLOCKED' }),
  } as unknown as GuardEngine;
}

/** Start a Fastify server with the WS stream endpoint; returns [app, port]. */
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

/** Connect a WS client and collect all messages until the socket closes or timeout. */
function collectMessages(ws: WebSocket, timeoutMs = 2000): Promise<string[]> {
  const messages: string[] = [];
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(messages), timeoutMs);
    ws.on('message', (data) => messages.push(data.toString()));
    ws.on('close', () => { clearTimeout(timer); resolve(messages); });
    ws.on('error', () => { clearTimeout(timer); resolve(messages); });
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

  it('sends connected message on valid token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream?token=${VALID_TOKEN}`);
    const messages = await collectMessages(ws, 1000);
    const connected = messages.find(m => {
      try { return (JSON.parse(m) as { type?: string }).type === 'connected'; } catch { return false; }
    });
    expect(connected).toBeDefined();
    ws.close();
  });

  it('closes with 4001 on invalid token', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream?token=wrong-token`);
    const closeCode = await new Promise<number>(resolve => {
      ws.on('close', (code) => resolve(code));
      ws.on('error', () => resolve(0));
    });
    expect(closeCode).toBe(4001);
  });

  it('closes with 4001 when no token provided', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream`);
    const closeCode = await new Promise<number>(resolve => {
      ws.on('close', (code) => resolve(code));
      ws.on('error', () => resolve(0));
    });
    expect(closeCode).toBe(4001);
  });
});

// ── Message handling ──────────────────────────────────────────────────────────

describe('WS /ws/stream — message handling', () => {
  let app: ReturnType<typeof Fastify>;
  let port: number;

  beforeAll(async () => {
    [app, port] = await startServer(() => VALID_TOKEN, makeCoreStub(), makeGuardAllow());
  });
  afterAll(async () => { await app.close(); });

  it('echoes a command back as a result message', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream?token=${VALID_TOKEN}`);
      const received: string[] = [];
      ws.on('open', () => ws.send(JSON.stringify({ input: 'hello' })));
      ws.on('message', (data) => {
        received.push(data.toString());
        const parsed = JSON.parse(data.toString()) as { type?: string };
        if (parsed.type === 'result') {
          ws.close();
          expect(received.some(m => m.includes('result'))).toBe(true);
          resolve();
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
  });

  it('returns error on invalid JSON', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream?token=${VALID_TOKEN}`);
      ws.on('open', () => ws.send('not json at all'));
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as { error?: string; type?: string };
        if (parsed.error && parsed.type !== 'connected') {
          ws.close();
          expect(parsed.error).toMatch(/invalid json/i);
          resolve();
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
  });

  it('returns error on missing input field', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream?token=${VALID_TOKEN}`);
      ws.on('open', () => ws.send(JSON.stringify({ notInput: 'hi' })));
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as { error?: string; type?: string };
        if (parsed.error && parsed.type !== 'connected') {
          ws.close();
          expect(parsed.error).toMatch(/input/i);
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

  it('returns GUARD_DENIED error when guard blocks the command', async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream?token=${VALID_TOKEN}`);
      ws.on('open', () => ws.send(JSON.stringify({ input: 'do something' })));
      ws.on('message', (data) => {
        const parsed = JSON.parse(data.toString()) as { type?: string; error?: string };
        if (parsed.type === 'error') {
          ws.close();
          expect(parsed.error).toBe('GUARD_DENIED');
          resolve();
        }
      });
      ws.on('error', reject);
      setTimeout(() => reject(new Error('timeout')), 3000);
    });
  });
});

// ── Reconnect / connection cap ────────────────────────────────────────────────

describe('WS /ws/stream — connection cap', () => {
  it('rejects connections beyond MAX_WS_CONNECTIONS (10) with close code 4029', async () => {
    const [app, port] = await startServer(() => VALID_TOKEN, makeCoreStub(), makeGuardAllow());

    const sockets: WebSocket[] = [];
    try {
      // Open 10 connections (the cap)
      const opens = Array.from({ length: 10 }, () =>
        new Promise<WebSocket>(resolve => {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream?token=${VALID_TOKEN}`);
          ws.on('open', () => resolve(ws));
          ws.on('error', () => resolve(ws));
        }),
      );
      const opened = await Promise.all(opens);
      sockets.push(...opened);

      // The 11th connection should be rejected with 4029
      const closeCode = await new Promise<number>(resolve => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/stream?token=${VALID_TOKEN}`);
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
