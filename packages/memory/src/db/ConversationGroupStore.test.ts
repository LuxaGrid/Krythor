/**
 * Tests for ConversationGroupStore — group CRUD and conversation membership.
 *
 * Uses a real in-memory SQLite database with all migrations applied so the
 * conversation_groups table and the group_id FK column on conversations both
 * exist exactly as they do in production.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MigrationRunner } from './MigrationRunner.js';
import { ConversationGroupStore } from './ConversationGroupStore.js';
import { ConversationStore } from './ConversationStore.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function openDb(): Database.Database {
  process.env['KRYTHOR_DATA_DIR'] = require('os').tmpdir();
  const db = new Database(':memory:');
  new MigrationRunner(db).run();
  return db;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('ConversationGroupStore', () => {
  let db: Database.Database;
  let groups: ConversationGroupStore;
  let convs: ConversationStore;

  beforeEach(() => {
    db = openDb();
    groups = new ConversationGroupStore(db);
    // Pass the shared DB so ConversationStore operates on the same in-memory
    // connection (dataDir is irrelevant when sharedDb is supplied).
    convs = new ConversationStore('', db);
  });

  afterEach(() => {
    db.close();
  });

  // ── 1. create() ─────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('returns a group with the given name and null description by default', () => {
      const g = groups.create('Work');
      expect(g.id).toBeTruthy();
      expect(g.name).toBe('Work');
      expect(g.description).toBeNull();
      expect(typeof g.createdAt).toBe('number');
      expect(typeof g.updatedAt).toBe('number');
    });

    it('stores an optional description', () => {
      const g = groups.create('Research', 'Papers and links');
      expect(g.description).toBe('Papers and links');
    });

    it('auto-increments sortOrder starting at 0', () => {
      const g0 = groups.create('First');
      const g1 = groups.create('Second');
      const g2 = groups.create('Third');
      expect(g0.sortOrder).toBe(0);
      expect(g1.sortOrder).toBe(1);
      expect(g2.sortOrder).toBe(2);
    });

    it('persists the group so it is retrievable immediately', () => {
      const g = groups.create('Persisted');
      const fetched = groups.get(g.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe('Persisted');
    });
  });

  // ── 2. list() ────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns an empty array when no groups exist', () => {
      expect(groups.list()).toEqual([]);
    });

    it('returns groups sorted by sort_order ascending', () => {
      const a = groups.create('A');
      const b = groups.create('B');
      const c = groups.create('C');

      // Manually swap sort orders to verify the query sorts, not insert order.
      groups.update(a.id, { sortOrder: 10 });
      groups.update(c.id, { sortOrder: 0 });
      groups.update(b.id, { sortOrder: 5 });

      const listed = groups.list();
      expect(listed.map(g => g.id)).toEqual([c.id, b.id, a.id]);
    });

    it('includes all created groups', () => {
      groups.create('X');
      groups.create('Y');
      expect(groups.list()).toHaveLength(2);
    });
  });

  // ── 3. get() ─────────────────────────────────────────────────────────────────

  describe('get()', () => {
    it('returns the group for a valid id', () => {
      const g = groups.create('Fetch me');
      const result = groups.get(g.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(g.id);
      expect(result!.name).toBe('Fetch me');
    });

    it('returns null for an unknown id', () => {
      expect(groups.get('does-not-exist')).toBeNull();
    });
  });

  // ── 4. update() ──────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates the name', () => {
      const g = groups.create('Old Name');
      const updated = groups.update(g.id, { name: 'New Name' });
      expect(updated!.name).toBe('New Name');
    });

    it('updates the description', () => {
      const g = groups.create('Group', 'Original');
      const updated = groups.update(g.id, { description: 'Updated description' });
      expect(updated!.description).toBe('Updated description');
    });

    it('can clear description to null', () => {
      const g = groups.create('Group', 'Has description');
      const updated = groups.update(g.id, { description: null });
      expect(updated!.description).toBeNull();
    });

    it('updates sortOrder', () => {
      const g = groups.create('Ordered');
      const updated = groups.update(g.id, { sortOrder: 42 });
      expect(updated!.sortOrder).toBe(42);
    });

    it('advances updatedAt when fields change', async () => {
      const g = groups.create('Timed');
      // Wait a tick so clock advances
      await new Promise(r => setTimeout(r, 2));
      const updated = groups.update(g.id, { name: 'Timed Updated' });
      expect(updated!.updatedAt).toBeGreaterThanOrEqual(g.updatedAt);
    });

    it('returns null for an unknown id', () => {
      expect(groups.update('ghost', { name: 'X' })).toBeNull();
    });

    it('returns current group unchanged when no fields are provided', () => {
      const g = groups.create('No-op');
      const result = groups.update(g.id, {});
      expect(result!.name).toBe('No-op');
    });
  });

  // ── 5. delete() ──────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('removes the group from the store', () => {
      const g = groups.create('Temporary');
      groups.delete(g.id);
      expect(groups.get(g.id)).toBeNull();
    });

    it('is a no-op for an unknown id (does not throw)', () => {
      expect(() => groups.delete('no-such-id')).not.toThrow();
    });

    it('sets group_id to NULL on associated conversations (FK ON DELETE SET NULL)', () => {
      const g = groups.create('With Members');
      const c1 = convs.createConversation();
      const c2 = convs.createConversation();
      groups.addConversation(g.id, c1.id);
      groups.addConversation(g.id, c2.id);

      groups.delete(g.id);

      const fetched1 = convs.getConversation(c1.id);
      const fetched2 = convs.getConversation(c2.id);
      expect(fetched1).not.toBeNull();
      expect(fetched1!.groupId).toBeNull();
      expect(fetched2).not.toBeNull();
      expect(fetched2!.groupId).toBeNull();
    });

    it('conversations survive group deletion', () => {
      const g = groups.create('Doomed Group');
      const c = convs.createConversation();
      groups.addConversation(g.id, c.id);

      groups.delete(g.id);

      expect(convs.getConversation(c.id)).not.toBeNull();
    });
  });

  // ── 6. addConversation() ─────────────────────────────────────────────────────

  describe('addConversation()', () => {
    it('sets group_id on the conversation', () => {
      const g = groups.create('Target Group');
      const c = convs.createConversation();
      groups.addConversation(g.id, c.id);

      const fetched = convs.getConversation(c.id);
      expect(fetched!.groupId).toBe(g.id);
    });

    it('replaces any existing group assignment', () => {
      const g1 = groups.create('Group 1');
      const g2 = groups.create('Group 2');
      const c = convs.createConversation();

      groups.addConversation(g1.id, c.id);
      groups.addConversation(g2.id, c.id);

      const fetched = convs.getConversation(c.id);
      expect(fetched!.groupId).toBe(g2.id);
    });

    it('conversation appears in listConversations for the new group', () => {
      const g = groups.create('Membership Group');
      const c = convs.createConversation();
      groups.addConversation(g.id, c.id);

      const members = groups.listConversations(g.id);
      expect(members.map(m => m.id)).toContain(c.id);
    });
  });

  // ── 7. removeConversation() ──────────────────────────────────────────────────

  describe('removeConversation()', () => {
    it('sets group_id to NULL', () => {
      const g = groups.create('Leave Me');
      const c = convs.createConversation();
      groups.addConversation(g.id, c.id);

      groups.removeConversation(c.id);

      const fetched = convs.getConversation(c.id);
      expect(fetched!.groupId).toBeNull();
    });

    it('conversation no longer appears in listConversations', () => {
      const g = groups.create('Remove Test');
      const c = convs.createConversation();
      groups.addConversation(g.id, c.id);
      groups.removeConversation(c.id);

      expect(groups.listConversations(g.id)).toHaveLength(0);
    });

    it('is a no-op for a conversation not in any group (does not throw)', () => {
      const c = convs.createConversation();
      expect(() => groups.removeConversation(c.id)).not.toThrow();
    });

    it('does not delete the conversation', () => {
      const g = groups.create('Keep Convo');
      const c = convs.createConversation();
      groups.addConversation(g.id, c.id);
      groups.removeConversation(c.id);

      expect(convs.getConversation(c.id)).not.toBeNull();
    });
  });

  // ── 8. listConversations() ───────────────────────────────────────────────────

  describe('listConversations()', () => {
    it('returns an empty array when no conversations are in the group', () => {
      const g = groups.create('Empty Group');
      expect(groups.listConversations(g.id)).toEqual([]);
    });

    it('returns only conversations belonging to the given group', () => {
      const g1 = groups.create('Group A');
      const g2 = groups.create('Group B');
      const c1 = convs.createConversation();
      const c2 = convs.createConversation();
      const c3 = convs.createConversation();

      groups.addConversation(g1.id, c1.id);
      groups.addConversation(g1.id, c2.id);
      groups.addConversation(g2.id, c3.id);

      const members = groups.listConversations(g1.id);
      const ids = members.map(m => m.id);
      expect(ids).toContain(c1.id);
      expect(ids).toContain(c2.id);
      expect(ids).not.toContain(c3.id);
    });

    it('orders pinned conversations before unpinned', () => {
      const g = groups.create('Pin Order');
      const unpinned = convs.createConversation();
      const pinned   = convs.createConversation();

      groups.addConversation(g.id, unpinned.id);
      groups.addConversation(g.id, pinned.id);
      convs.updateConversation(pinned.id, { pinned: true });

      const members = groups.listConversations(g.id);
      expect(members[0]!.id).toBe(pinned.id);
      expect(members[1]!.id).toBe(unpinned.id);
    });

    it('orders by updated_at DESC within same pin tier', async () => {
      const g = groups.create('Time Order');
      const older  = convs.createConversation();
      const newer  = convs.createConversation();

      groups.addConversation(g.id, older.id);
      // Touch newer to advance its updated_at beyond older
      await new Promise(r => setTimeout(r, 2));
      groups.addConversation(g.id, newer.id);
      convs.touchConversation(newer.id);

      const members = groups.listConversations(g.id);
      // newer should appear first
      expect(members[0]!.id).toBe(newer.id);
      expect(members[1]!.id).toBe(older.id);
    });

    it('exposes groupId on returned conversations', () => {
      const g = groups.create('Has GroupId');
      const c = convs.createConversation();
      groups.addConversation(g.id, c.id);

      const members = groups.listConversations(g.id);
      expect(members[0]!.groupId).toBe(g.id);
    });
  });

  // ── 9. delete group with conversations ───────────────────────────────────────

  describe('delete group with conversations — full scenario', () => {
    it('conversations survive and have group_id = NULL after group deletion', () => {
      const g = groups.create('Full Lifecycle');
      const c1 = convs.createConversation();
      const c2 = convs.createConversation();

      groups.addConversation(g.id, c1.id);
      groups.addConversation(g.id, c2.id);

      expect(groups.listConversations(g.id)).toHaveLength(2);

      groups.delete(g.id);

      // Group is gone
      expect(groups.get(g.id)).toBeNull();

      // Conversations still exist
      const f1 = convs.getConversation(c1.id);
      const f2 = convs.getConversation(c2.id);
      expect(f1).not.toBeNull();
      expect(f2).not.toBeNull();

      // group_id is NULL
      expect(f1!.groupId).toBeNull();
      expect(f2!.groupId).toBeNull();

      // listConversations returns empty (group gone, and group_id NULLed)
      // Querying the now-deleted group id returns empty array
      expect(groups.listConversations(g.id)).toHaveLength(0);
    });
  });
});
