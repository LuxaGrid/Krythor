/**
 * Tests for ITEM I: conversation management improvements.
 *
 * 1. GET /api/conversations/:id/messages — paginated response envelope
 * 2. POST /api/conversations/:id/messages — add message without inference
 * 3. POST /api/command with /clear, /model, /agent slash commands
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildServer, GATEWAY_PORT } from '../server.js';
import { loadOrCreateToken } from '../auth.js';
import { join } from 'path';
import { homedir } from 'os';

let app: Awaited<ReturnType<typeof buildServer>>;
let authToken: string;
const HOST = `127.0.0.1:${GATEWAY_PORT}`;
const createdConvIds: string[] = [];

function getDataDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'Krythor');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Krythor');
  }
  return join(homedir(), '.local', 'share', 'krythor');
}

beforeAll(async () => {
  app = await buildServer();
  await app.ready();
  const cfg = loadOrCreateToken(join(getDataDir(), 'config'));
  authToken = cfg.token ?? '';
});

afterAll(async () => {
  for (const id of createdConvIds) {
    await app.inject({
      method: 'DELETE',
      url: `/api/conversations/${id}`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
  }
});

async function createConv(): Promise<{ id: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
    payload: JSON.stringify({}),
  });
  expect(res.statusCode).toBe(201);
  const conv = JSON.parse(res.body) as { id: string };
  createdConvIds.push(conv.id);
  return conv;
}

async function addMessage(convId: string, role: string, content: string): Promise<void> {
  await app.inject({
    method: 'POST',
    url: `/api/conversations/${convId}/messages`,
    headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
    payload: JSON.stringify({ role, content }),
  });
}

// ── 1. Paginated GET /api/conversations/:id/messages ─────────────────────────

describe('GET /api/conversations/:id/messages — pagination (ITEM I)', () => {

  it('returns { messages, total, page, limit, hasMore } envelope', async () => {
    const conv = await createConv();
    await addMessage(conv.id, 'user', 'Hello');
    await addMessage(conv.id, 'assistant', 'Hi there');

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conv.id}/messages`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(typeof body.page).toBe('number');
    expect(typeof body.limit).toBe('number');
    expect(typeof body.hasMore).toBe('boolean');
    expect(body.total).toBe(2);
    expect(body.messages).toHaveLength(2);
    expect(body.hasMore).toBe(false);
  });

  it('respects ?limit= and returns hasMore=true when more pages exist', async () => {
    const conv = await createConv();
    // Add 5 messages
    for (let i = 0; i < 5; i++) {
      await addMessage(conv.id, 'user', `Message ${i + 1}`);
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conv.id}/messages?limit=2&page=1`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.messages).toHaveLength(2);
    expect(body.total).toBe(5);
    expect(body.hasMore).toBe(true);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(2);
  });

  it('?page=2 returns the second page of messages', async () => {
    const conv = await createConv();
    for (let i = 0; i < 5; i++) {
      await addMessage(conv.id, 'user', `Msg ${i + 1}`);
    }

    const res = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conv.id}/messages?limit=3&page=2`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.messages).toHaveLength(2); // msgs 4 and 5
    expect(body.hasMore).toBe(false);
    expect(body.page).toBe(2);
  });

  it('returns 404 for a non-existent conversation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/conversations/nonexistent-id-xyz/messages',
      headers: { authorization: `Bearer ${authToken}`, host: HOST },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── 2. POST /api/conversations/:id/messages (add without inference) ───────────

describe('POST /api/conversations/:id/messages — add without inference (ITEM I)', () => {

  it('adds a user message and returns 201 with the message object', async () => {
    const conv = await createConv();

    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conv.id}/messages`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ role: 'user', content: 'Imported message' }),
    });

    expect(res.statusCode).toBe(201);
    const msg = JSON.parse(res.body);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Imported message');
    expect(msg.id).toBeDefined();
  });

  it('adds an assistant message with optional modelId', async () => {
    const conv = await createConv();

    const res = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conv.id}/messages`,
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ role: 'assistant', content: 'AI response', modelId: 'gpt-4o' }),
    });

    expect(res.statusCode).toBe(201);
    const msg = JSON.parse(res.body);
    expect(msg.role).toBe('assistant');
    expect(msg.modelId).toBe('gpt-4o');
  });

  it('returns 404 for a non-existent conversation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/conversations/nonexistent-xyz/messages',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ role: 'user', content: 'Hello' }),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── 3. /command in-chat slash commands ───────────────────────────────────────

describe('POST /api/command — in-chat slash commands (ITEM I)', () => {

  it('/clear returns synthetic cleared response immediately (no inference)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/command',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ input: '/clear' }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.command).toBe('clear');
    expect(body.output).toContain('cleared');
  });

  it('/model without arg returns list of models', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/command',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ input: '/model' }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.command).toBe('model:list');
    expect(typeof body.output).toBe('string');
  });

  it('/model <id> returns switch confirmation with modelId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/command',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ input: '/model gpt-4o' }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.command).toBe('model:switch');
    expect(body.modelId).toBe('gpt-4o');
  });

  it('/agent without arg returns agent status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/command',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ input: '/agent' }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.command).toBe('agent:status');
  });

  it('/agent <id> returns switch confirmation with agentId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/command',
      headers: { authorization: `Bearer ${authToken}`, host: HOST, 'content-type': 'application/json' },
      payload: JSON.stringify({ input: '/agent my-agent' }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.command).toBe('agent:switch');
    expect(body.agentId).toBe('my-agent');
  });
});
