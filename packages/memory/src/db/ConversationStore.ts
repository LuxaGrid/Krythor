import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { applySchema } from './schema.js';
import { randomUUID } from 'crypto';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  /** User-defined name override. When set, UIs should prefer this over `title`. */
  name?: string | null;
  /** When true, this conversation is pinned and appears first in listings. */
  pinned: boolean;
  agentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelId: string | null;
  providerId: string | null;
  createdAt: number;
}

// ─── Raw row types ────────────────────────────────────────────────────────────

interface ConversationRow {
  id: string;
  title: string;
  name?: string | null;
  pinned: number;
  agent_id: string | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model_id: string | null;
  provider_id: string | null;
  created_at: number;
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    name: row.name ?? null,
    pinned: row.pinned === 1,
    agentId: row.agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Message['role'],
    content: row.content,
    modelId: row.model_id,
    providerId: row.provider_id,
    createdAt: row.created_at,
  };
}

// ─── ConversationStore ────────────────────────────────────────────────────────

export class ConversationStore {
  private db: Database.Database;

  /**
   * @param dataDir - path to the data directory; a new connection is opened here
   * @param sharedDb - optional pre-existing Database instance to reuse (avoids WAL contention)
   */
  constructor(dataDir: string, sharedDb?: Database.Database) {
    if (sharedDb) {
      this.db = sharedDb;
    } else {
      mkdirSync(dataDir, { recursive: true });
      const dbPath = join(dataDir, 'memory.db');
      this.db = new Database(dbPath);
      applySchema(this.db);
    }
  }

  close(): void {
    this.db.close();
  }

  // ── Conversations ──────────────────────────────────────────────────────────

  createConversation(agentId?: string): Conversation {
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO conversations (id, title, name, pinned, agent_id, created_at, updated_at)
      VALUES (@id, @title, NULL, 0, @agentId, @now, @now)
    `).run({ id, title: 'New Chat', agentId: agentId ?? null, now });
    return { id, title: 'New Chat', name: null, pinned: false, agentId: agentId ?? null, createdAt: now, updatedAt: now };
  }

  listConversations(): Conversation[] {
    // Pinned first, then by updatedAt desc — per ITEM 4 spec
    const rows = this.db.prepare(`
      SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC, id DESC
    `).all() as ConversationRow[];
    return rows.map(rowToConversation);
  }

  getConversation(id: string): Conversation | null {
    const row = this.db.prepare(`SELECT * FROM conversations WHERE id = @id`).get({ id }) as ConversationRow | undefined;
    return row ? rowToConversation(row) : null;
  }

  updateConversationTitle(id: string, title: string): void {
    const now = Date.now();
    this.db.prepare(`UPDATE conversations SET title = @title, updated_at = @now WHERE id = @id`)
      .run({ id, title, now });
  }

  /** Update name and/or pinned state of a conversation. */
  updateConversation(id: string, updates: { name?: string | null; pinned?: boolean }): Conversation | null {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };

    if (updates.name !== undefined) {
      sets.push('name = @name');
      params['name'] = updates.name ?? null;
    }
    if (updates.pinned !== undefined) {
      sets.push('pinned = @pinned');
      params['pinned'] = updates.pinned ? 1 : 0;
    }

    if (sets.length === 0) return this.getConversation(id);

    params['now'] = Date.now();
    sets.push('updated_at = @now');
    this.db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = @id`).run(params);
    return this.getConversation(id);
  }

  touchConversation(id: string): void {
    const now = Date.now();
    this.db.prepare(`UPDATE conversations SET updated_at = @now WHERE id = @id`).run({ id, now });
  }

  deleteConversation(id: string): void {
    // CASCADE deletes messages
    this.db.prepare(`DELETE FROM conversations WHERE id = @id`).run({ id });
  }

  // ── Messages ───────────────────────────────────────────────────────────────

  addMessage(
    conversationId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    modelId?: string,
    providerId?: string,
  ): Message {
    const now = Date.now();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, model_id, provider_id, created_at)
      VALUES (@id, @conversationId, @role, @content, @modelId, @providerId, @now)
    `).run({ id, conversationId, role, content, modelId: modelId ?? null, providerId: providerId ?? null, now });
    this.touchConversation(conversationId);
    return { id, conversationId, role, content, modelId: modelId ?? null, providerId: providerId ?? null, createdAt: now };
  }

  getMessages(conversationId: string): Message[] {
    const rows = this.db.prepare(`
      SELECT * FROM messages WHERE conversation_id = @conversationId ORDER BY created_at ASC
    `).all({ conversationId }) as MessageRow[];
    return rows.map(rowToMessage);
  }

  /** Delete a single message by ID. Returns true if a row was deleted. */
  deleteMessage(messageId: string): boolean {
    const result = this.db.prepare(`DELETE FROM messages WHERE id = @id`).run({ id: messageId });
    return result.changes > 0;
  }

  /** Delete the most recent assistant message in a conversation (used by Regenerate). */
  deleteLastAssistantMessage(conversationId: string): boolean {
    const row = this.db.prepare(`
      SELECT id FROM messages
      WHERE conversation_id = @conversationId AND role = 'assistant'
      ORDER BY created_at DESC
      LIMIT 1
    `).get({ conversationId }) as { id: string } | undefined;
    if (!row) return false;
    return this.deleteMessage(row.id);
  }
}
