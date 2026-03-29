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
  /** When true, the conversation has been archived by the idle cleanup job. */
  archived: boolean;
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
  /** Number of prompt/input tokens for this turn (null = not tracked). */
  inputTokens: number | null;
  /** Number of completion/output tokens for this turn (null = not tracked). */
  outputTokens: number | null;
  createdAt: number;
}

// ─── Raw row types ────────────────────────────────────────────────────────────

interface ConversationRow {
  id: string;
  title: string;
  name?: string | null;
  pinned: number;
  archived: number;
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
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: number;
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    name: row.name ?? null,
    pinned: row.pinned === 1,
    archived: (row.archived ?? 0) === 1,
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
    inputTokens: row.input_tokens ?? null,
    outputTokens: row.output_tokens ?? null,
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
    return { id, title: 'New Chat', name: null, pinned: false, archived: false, agentId: agentId ?? null, createdAt: now, updatedAt: now };
  }

  listConversations(includeArchived = false): Conversation[] {
    // Pinned first, then by updatedAt desc — per ITEM 4 spec
    // By default, archived conversations are excluded.
    const sql = includeArchived
      ? `SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC, id DESC`
      : `SELECT * FROM conversations WHERE archived = 0 ORDER BY pinned DESC, updated_at DESC, id DESC`;
    const rows = this.db.prepare(sql).all() as ConversationRow[];
    return rows.map(rowToConversation);
  }

  /**
   * Archive conversations that have been idle for more than the given threshold and are not pinned.
   * Sets archived = 1 on matching rows. Does NOT delete.
   * @param olderThanMs  – cutoff age in milliseconds (e.g. 24 * 60 * 60 * 1000 for 24 hours)
   * @returns number of conversations archived
   */
  archiveIdleConversations(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db.prepare(`
      UPDATE conversations
      SET archived = 1
      WHERE archived = 0
        AND pinned  = 0
        AND updated_at < @cutoff
    `).run({ cutoff });
    return result.changes;
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
    tokens?: { inputTokens?: number; outputTokens?: number },
  ): Message {
    const now = Date.now();
    const id = randomUUID();
    const inputTokens = tokens?.inputTokens ?? null;
    const outputTokens = tokens?.outputTokens ?? null;
    this.db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, model_id, provider_id, input_tokens, output_tokens, created_at)
      VALUES (@id, @conversationId, @role, @content, @modelId, @providerId, @inputTokens, @outputTokens, @now)
    `).run({ id, conversationId, role, content, modelId: modelId ?? null, providerId: providerId ?? null, inputTokens, outputTokens, now });
    this.touchConversation(conversationId);
    return { id, conversationId, role, content, modelId: modelId ?? null, providerId: providerId ?? null, inputTokens, outputTokens, createdAt: now };
  }

  getMessages(conversationId: string): Message[] {
    const rows = this.db.prepare(`
      SELECT * FROM messages WHERE conversation_id = @conversationId ORDER BY created_at ASC
    `).all({ conversationId }) as MessageRow[];
    return rows.map(rowToMessage);
  }

  /**
   * Return aggregate token stats for a conversation.
   * Both totals are null when no token data has been recorded.
   */
  getTokenStats(conversationId: string): { totalInputTokens: number | null; totalOutputTokens: number | null; messageCount: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS message_count,
        SUM(input_tokens)  AS total_input,
        SUM(output_tokens) AS total_output
      FROM messages
      WHERE conversation_id = @conversationId
    `).get({ conversationId }) as { message_count: number; total_input: number | null; total_output: number | null } | undefined;
    return {
      totalInputTokens:  row?.total_input ?? null,
      totalOutputTokens: row?.total_output ?? null,
      messageCount:      row?.message_count ?? 0,
    };
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

  /**
   * Search messages by content using case-insensitive LIKE.
   * Returns matching messages with their conversation metadata.
   */
  searchMessages(query: string, opts: {
    agentId?: string;
    role?: 'user' | 'assistant' | 'system';
    limit?: number;
  } = {}): Array<Message & { conversation: Conversation }> {
    const limit = Math.min(opts.limit ?? 20, 200);
    const q = `%${query}%`;

    let sql: string;
    const params: Record<string, unknown> = { q, limit };

    if (opts.agentId && opts.role) {
      sql = `
        SELECT m.*, c.* FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.content LIKE @q AND c.agent_id = @agentId AND m.role = @role
        ORDER BY m.created_at DESC LIMIT @limit
      `;
      params['agentId'] = opts.agentId;
      params['role'] = opts.role;
    } else if (opts.agentId) {
      sql = `
        SELECT m.*, c.* FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.content LIKE @q AND c.agent_id = @agentId
        ORDER BY m.created_at DESC LIMIT @limit
      `;
      params['agentId'] = opts.agentId;
    } else if (opts.role) {
      sql = `
        SELECT m.*, c.* FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.content LIKE @q AND m.role = @role
        ORDER BY m.created_at DESC LIMIT @limit
      `;
      params['role'] = opts.role;
    } else {
      sql = `
        SELECT m.*, c.* FROM messages m
        JOIN conversations c ON c.id = m.conversation_id
        WHERE m.content LIKE @q
        ORDER BY m.created_at DESC LIMIT @limit
      `;
    }

    const rows = this.db.prepare(sql).all(params) as Array<MessageRow & {
      title: string; name?: string | null; pinned: number; archived: number; agent_id: string | null; created_at: number; updated_at: number;
    }>;

    return rows.map(row => ({
      id:             row.id,
      conversationId: row.conversation_id,
      role:           row.role as Message['role'],
      content:        row.content,
      modelId:        row.model_id,
      providerId:     row.provider_id,
      inputTokens:    row.input_tokens ?? null,
      outputTokens:   row.output_tokens ?? null,
      createdAt:      row.created_at,
      conversation:   rowToConversation({
        id:         row.conversation_id,
        title:      row.title,
        name:       row.name,
        pinned:     row.pinned,
        archived:   row.archived,
        agent_id:   row.agent_id,
        created_at: row.updated_at,
        updated_at: row.updated_at,
      }),
    }));
  }
}
