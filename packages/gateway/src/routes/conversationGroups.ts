/**
 * Conversation Groups routes — group/folder management for conversations.
 *
 * POST   /api/conversation-groups                               — create group
 * GET    /api/conversation-groups                               — list groups
 * GET    /api/conversation-groups/:id                           — get group + conversations
 * PATCH  /api/conversation-groups/:id                           — rename / reorder group
 * DELETE /api/conversation-groups/:id                           — delete group (conversations kept, group_id NULLed)
 * POST   /api/conversation-groups/:id/conversations             — add conversation to group
 * DELETE /api/conversation-groups/:id/conversations/:convId     — remove conversation from group
 * GET    /api/conversation-groups/:id/conversations             — list conversations in group
 */

import type { FastifyInstance } from 'fastify';
import { ConversationGroupStore } from '@krythor/memory';
import type { ConversationStore } from '@krythor/memory';

export function registerConversationGroupRoutes(
  app: FastifyInstance,
  groupStore: ConversationGroupStore,
  convStore: ConversationStore,
): void {

  // POST /api/conversation-groups — create a new group
  app.post('/api/conversation-groups', {
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name:        { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: ['string', 'null'], maxLength: 500 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const { name, description } = req.body as { name: string; description?: string | null };
    const group = groupStore.create(name, description ?? null);
    return reply.code(201).send(group);
  });

  // GET /api/conversation-groups — list all groups ordered by sortOrder
  app.get('/api/conversation-groups', async (_req, reply) => {
    const groups = groupStore.list();
    return reply.send(groups);
  });

  // GET /api/conversation-groups/:id — get group metadata + its conversations
  app.get<{ Params: { id: string } }>('/api/conversation-groups/:id', async (req, reply) => {
    const group = groupStore.get(req.params.id);
    if (!group) return reply.code(404).send({ error: 'Group not found' });
    const conversations = groupStore.listConversations(req.params.id);
    return reply.send({ ...group, conversations });
  });

  // PATCH /api/conversation-groups/:id — rename or reorder group
  app.patch<{ Params: { id: string } }>('/api/conversation-groups/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          name:        { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: ['string', 'null'], maxLength: 500 },
          sortOrder:   { type: 'integer', minimum: 0 },
        },
        additionalProperties: false,
        minProperties: 1,
      },
    },
  }, async (req, reply) => {
    const group = groupStore.get(req.params.id);
    if (!group) return reply.code(404).send({ error: 'Group not found' });

    const body = req.body as { name?: string; description?: string | null; sortOrder?: number };
    const updated = groupStore.update(req.params.id, {
      ...(body.name        !== undefined && { name:        body.name }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.sortOrder   !== undefined && { sortOrder:   body.sortOrder }),
    });
    return reply.send(updated);
  });

  // DELETE /api/conversation-groups/:id — delete group; conversations keep their data
  app.delete<{ Params: { id: string } }>('/api/conversation-groups/:id', async (req, reply) => {
    const group = groupStore.get(req.params.id);
    if (!group) return reply.code(404).send({ error: 'Group not found' });
    groupStore.delete(req.params.id);
    return reply.code(204).send();
  });

  // GET /api/conversation-groups/:id/conversations — list conversations in group
  app.get<{ Params: { id: string } }>('/api/conversation-groups/:id/conversations', async (req, reply) => {
    const group = groupStore.get(req.params.id);
    if (!group) return reply.code(404).send({ error: 'Group not found' });
    const conversations = groupStore.listConversations(req.params.id);
    return reply.send(conversations);
  });

  // POST /api/conversation-groups/:id/conversations — add a conversation to group
  app.post<{ Params: { id: string } }>('/api/conversation-groups/:id/conversations', {
    schema: {
      body: {
        type: 'object',
        required: ['conversationId'],
        properties: {
          conversationId: { type: 'string', minLength: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (req, reply) => {
    const group = groupStore.get(req.params.id);
    if (!group) return reply.code(404).send({ error: 'Group not found' });

    const { conversationId } = req.body as { conversationId: string };
    const conv = convStore.getConversation(conversationId);
    if (!conv) return reply.code(404).send({ error: 'Conversation not found' });

    groupStore.addConversation(req.params.id, conversationId);
    return reply.code(204).send();
  });

  // DELETE /api/conversation-groups/:id/conversations/:convId — remove from group
  app.delete<{ Params: { id: string; convId: string } }>(
    '/api/conversation-groups/:id/conversations/:convId',
    async (req, reply) => {
      const group = groupStore.get(req.params.id);
      if (!group) return reply.code(404).send({ error: 'Group not found' });

      const conv = convStore.getConversation(req.params.convId);
      if (!conv) return reply.code(404).send({ error: 'Conversation not found' });

      groupStore.removeConversation(req.params.convId);
      return reply.code(204).send();
    },
  );
}
