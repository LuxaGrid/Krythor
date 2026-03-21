import type { FastifyInstance } from 'fastify';
import type { ConversationStore } from '@krythor/memory';
import type { GuardEngine } from '@krythor/guard';

/** Conversations are considered idle after this many milliseconds without activity. */
const SESSION_IDLE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Enrich a raw Conversation object with session-idle metadata.
 * This is a read-only computed field — the underlying data is never modified.
 */
function withIdleStatus(conv: { id: string; title: string; agentId: string | null; createdAt: number; updatedAt: number }) {
  const now = Date.now();
  const sessionAgeMs = now - conv.updatedAt;
  const isIdle = sessionAgeMs >= SESSION_IDLE_THRESHOLD_MS;
  return {
    ...conv,
    sessionAgeMs,
    isIdle,
  };
}

export function registerConversationRoutes(app: FastifyInstance, store: ConversationStore, guard?: GuardEngine): void {

  // GET /api/conversations — list all, with idle status metadata
  app.get('/api/conversations', async (_req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'conversation:read', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    return reply.send(store.listConversations().map(withIdleStatus));
  });

  // POST /api/conversations — create new
  app.post('/api/conversations', {
    schema: {
      body: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { agentId } = (req.body ?? {}) as { agentId?: string };
    const conv = store.createConversation(agentId);
    return reply.code(201).send(conv);
  });

  // GET /api/conversations/:id — get single conversation with session age metadata
  app.get<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'conversation:read', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    const conv = store.getConversation(req.params.id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    return reply.send(withIdleStatus(conv));
  });

  // PATCH /api/conversations/:id — update title
  app.patch<{ Params: { id: string } }>('/api/conversations/:id', {
    schema: {
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { title } = req.body as { title: string };
    const conv = store.getConversation(req.params.id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    store.updateConversationTitle(req.params.id, title);
    return reply.send({ ...conv, title });
  });

  // DELETE /api/conversations/:id
  app.delete<{ Params: { id: string } }>('/api/conversations/:id', async (req, reply) => {
    const conv = store.getConversation(req.params.id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    store.deleteConversation(req.params.id);
    return reply.code(204).send();
  });

  // GET /api/conversations/:id/messages
  app.get<{ Params: { id: string } }>('/api/conversations/:id/messages', async (req, reply) => {
    if (guard) {
      const verdict = guard.check({ operation: 'conversation:read', source: 'user' });
      if (!verdict.allowed) return reply.code(403).send({ error: 'GUARD_DENIED', reason: verdict.reason });
    }
    const conv = store.getConversation(req.params.id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    return reply.send(store.getMessages(req.params.id));
  });

  // DELETE /api/conversations/:id/messages/last-assistant — remove most recent assistant message
  // Used by the Regenerate feature to clear the bad response before resubmitting.
  app.delete<{ Params: { id: string } }>('/api/conversations/:id/messages/last-assistant', async (req, reply) => {
    const conv = store.getConversation(req.params.id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    const deleted = store.deleteLastAssistantMessage(req.params.id);
    return reply.code(deleted ? 204 : 404).send();
  });

  // GET /api/conversations/:id/export — export as JSON or Markdown
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>('/api/conversations/:id/export', async (req, reply) => {
    const conv = store.getConversation(req.params.id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    const messages = store.getMessages(req.params.id);
    const format = req.query.format === 'markdown' ? 'markdown' : 'json';

    if (format === 'json') {
      return reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="conversation-${conv.id}.json"`)
        .send(JSON.stringify({ conversation: conv, messages }, null, 2));
    }

    // Markdown
    const lines: string[] = [
      `# ${conv.title}`,
      ``,
      `*Exported: ${new Date().toISOString()}*`,
      ``,
      `---`,
      ``,
    ];
    for (const msg of messages) {
      const speaker = msg.role === 'user' ? '**You**' : msg.role === 'assistant' ? '**Assistant**' : `**${msg.role}**`;
      lines.push(`${speaker}`);
      lines.push(``);
      lines.push(msg.content);
      lines.push(``);
      lines.push(`---`);
      lines.push(``);
    }
    return reply
      .header('Content-Type', 'text/markdown; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="conversation-${conv.id}.md"`)
      .send(lines.join('\n'));
  });

  // POST /api/conversations/:id/messages — add a message (internal use)
  app.post<{ Params: { id: string } }>('/api/conversations/:id/messages', {
    schema: {
      body: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role:       { type: 'string', enum: ['user', 'assistant', 'system'] },
          content:    { type: 'string', minLength: 1 },
          modelId:    { type: 'string' },
          providerId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const conv = store.getConversation(req.params.id);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });
    const { role, content, modelId, providerId } = req.body as {
      role: 'user' | 'assistant' | 'system';
      content: string;
      modelId?: string;
      providerId?: string;
    };
    const msg = store.addMessage(req.params.id, role, content, modelId, providerId);
    return reply.code(201).send(msg);
  });
}
