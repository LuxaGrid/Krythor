import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { Conversation } from './ConversationStore.js';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ConversationGroup {
  id: string;
  name: string;
  description?: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Raw row types ────────────────────────────────────────────────────────────

interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface ConversationRow {
  id: string;
  title: string;
  name: string | null;
  pinned: number;
  archived: number;
  agent_id: string | null;
  created_at: number;
  updated_at: number;
  compacted_at: number | null;
  group_id: string | null;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function rowToGroup(row: GroupRow): ConversationGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToConversation(row: ConversationRow): Conversation & { groupId: string | null } {
  return {
    id: row.id,
    title: row.title,
    name: row.name ?? null,
    pinned: row.pinned === 1,
    archived: (row.archived ?? 0) === 1,
    agentId: row.agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    compactedAt: row.compacted_at ?? null,
    groupId: row.group_id ?? null,
  };
}

// ─── ConversationGroupStore ───────────────────────────────────────────────────

export class ConversationGroupStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ── Groups ─────────────────────────────────────────────────────────────────

  create(name: string, description?: string | null): ConversationGroup {
    const now = Date.now();
    const id = randomUUID();
    const desc = description ?? null;

    // Place new group after existing ones
    const maxRow = this.db.prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM conversation_groups`
    ).get() as { max_sort: number } | undefined;
    const sortOrder = (maxRow?.max_sort ?? -1) + 1;

    this.db.prepare(`
      INSERT INTO conversation_groups (id, name, description, sort_order, created_at, updated_at)
      VALUES (@id, @name, @desc, @sortOrder, @now, @now)
    `).run({ id, name, desc, sortOrder, now });

    return { id, name, description: desc, sortOrder, createdAt: now, updatedAt: now };
  }

  list(): ConversationGroup[] {
    const rows = this.db.prepare(
      `SELECT * FROM conversation_groups ORDER BY sort_order ASC, created_at ASC`
    ).all() as GroupRow[];
    return rows.map(rowToGroup);
  }

  get(id: string): ConversationGroup | null {
    const row = this.db.prepare(
      `SELECT * FROM conversation_groups WHERE id = @id`
    ).get({ id }) as GroupRow | undefined;
    return row ? rowToGroup(row) : null;
  }

  update(id: string, fields: { name?: string; description?: string | null; sortOrder?: number }): ConversationGroup | null {
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };

    if (fields.name !== undefined) {
      sets.push('name = @name');
      params['name'] = fields.name;
    }
    if (fields.description !== undefined) {
      sets.push('description = @description');
      params['description'] = fields.description ?? null;
    }
    if (fields.sortOrder !== undefined) {
      sets.push('sort_order = @sortOrder');
      params['sortOrder'] = fields.sortOrder;
    }

    if (sets.length === 0) return this.get(id);

    params['now'] = Date.now();
    sets.push('updated_at = @now');
    this.db.prepare(`UPDATE conversation_groups SET ${sets.join(', ')} WHERE id = @id`).run(params);
    return this.get(id);
  }

  delete(id: string): void {
    // ON DELETE SET NULL on conversations.group_id handles the FK cascade
    this.db.prepare(`DELETE FROM conversation_groups WHERE id = @id`).run({ id });
  }

  // ── Conversation membership ────────────────────────────────────────────────

  /** Assign a conversation to a group. Replaces any existing group assignment. */
  addConversation(groupId: string, conversationId: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE conversations
      SET group_id = @groupId, updated_at = @now
      WHERE id = @conversationId
    `).run({ groupId, conversationId, now });
  }

  /** Remove a conversation from its group (sets group_id = NULL). */
  removeConversation(conversationId: string): void {
    const now = Date.now();
    this.db.prepare(`
      UPDATE conversations
      SET group_id = NULL, updated_at = @now
      WHERE id = @conversationId
    `).run({ conversationId, now });
  }

  /** List all conversations belonging to the given group, ordered by updatedAt desc. */
  listConversations(groupId: string): Array<Conversation & { groupId: string | null }> {
    const rows = this.db.prepare(`
      SELECT * FROM conversations
      WHERE group_id = @groupId
      ORDER BY pinned DESC, updated_at DESC, id DESC
    `).all({ groupId }) as ConversationRow[];
    return rows.map(rowToConversation);
  }
}
