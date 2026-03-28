// ─── IMessageInbound ──────────────────────────────────────────────────────────
//
// iMessage inbound channel using AppleScript via shell commands.
// Requires macOS with Messages.app and Script Editor permissions.
//
// This is a polling-based integration — there is no event push API for iMessage
// outside of BlueBubbles. Instead, it polls a user-provided shell script or
// SQLite read of the Messages database (~/Library/Messages/chat.db).
//
// Setup:
//   1. macOS with Messages.app (iMessage must be signed in)
//   2. Grant Full Disk Access to the process running Krythor
//      (System Settings > Privacy & Security > Full Disk Access)
//   3. Optional: set pollIntervalMs (default 5000 ms)
//
// Behaviour:
//   - Polls ~/Library/Messages/chat.db for new messages since last check
//   - Sends replies via AppleScript (osascript)
//   - dmPolicy/groupPolicy enforcement with pairing store
//   - SessionRouter integration for conversation continuity
//   - Tracks last-seen message ID to avoid reprocessing
//
// NOTE: Direct chat.db reads on macOS 12+ require Full Disk Access due to SIP.
//       This handler uses read-only SQLite access and never modifies the database.
//

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'os';
import { join } from 'path';
import type { AgentOrchestrator } from '@krythor/core';
import type { ConversationStore } from '@krythor/memory';
import { resolveSessionKey } from '@krythor/memory';
import type { DmPairingStore } from './DmPairingStore.js';
import type { SessionRouter } from './SessionRouter.js';
import { handleSlashCommand } from './InboundSlashCommands.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

const MAX_REPLY_LEN = 4_000;

export interface IMessageInboundConfig {
  agentId: string;
  enabled: boolean;
  /** Polling interval in milliseconds. Default: 5000. */
  pollIntervalMs?: number;
  /** Path to chat.db. Defaults to ~/Library/Messages/chat.db. */
  chatDbPath?: string;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  groupAllowFrom?: string[];
  resetTriggers?: string[];
  historyLimit?: number;
  textChunkLimit?: number;
  chunkMode?: 'length' | 'newline';
}

// ── SQLite row types ──────────────────────────────────────────────────────────

interface MessageRow {
  rowid: number;
  text: string | null;
  is_from_me: number;
  handle_id: number;
  chat_id: string;
  is_group: number;
  address: string | null;
}

// ── Chunking ─────────────────────────────────────────────────────────────────

function splitIntoChunks(text: string, maxLen: number, mode: 'length' | 'newline'): string[] {
  if (text.length <= maxLen) return [text];

  if (mode === 'newline') {
    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];
    let current = '';
    for (const para of paragraphs) {
      const candidate = current ? `${current}\n\n${para}` : para;
      if (candidate.length <= maxLen) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        current = para.length > maxLen ? para.slice(0, maxLen) : para;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

// ── IMessageInbound ───────────────────────────────────────────────────────────

export class IMessageInbound {
  private config: IMessageInboundConfig | null = null;
  private orchestrator: AgentOrchestrator;
  private pairingStore: DmPairingStore;
  private convStore: ConversationStore | null;
  private sessionRouter: SessionRouter | null;

  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRowId = 0;

  private readonly channelId = 'imessage';

  constructor(
    orchestrator: AgentOrchestrator,
    pairingStore: DmPairingStore,
    convStore: ConversationStore | null = null,
    sessionRouter: SessionRouter | null = null,
  ) {
    this.orchestrator = orchestrator;
    this.pairingStore = pairingStore;
    this.convStore = convStore;
    this.sessionRouter = sessionRouter;
  }

  configure(cfg: IMessageInboundConfig): void {
    this.config = cfg;
  }

  getConfig(): IMessageInboundConfig | null {
    return this.config ? { ...this.config } : null;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config?.enabled) {
      return { ok: false, error: 'iMessage inbound is not configured or disabled' };
    }
    if (this.running) return { ok: true };

    // Check macOS platform
    if (process.platform !== 'darwin') {
      return { ok: false, error: 'iMessage inbound requires macOS' };
    }

    // Verify better-sqlite3 is available (used for reading chat.db)
    try {
      require.resolve('better-sqlite3');
    } catch {
      return {
        ok: false,
        error: 'iMessage requires better-sqlite3 (already a @krythor/memory dependency — check your installation)',
      };
    }

    // Seed the last row ID to avoid replaying old messages on startup
    try {
      this.lastRowId = await this.getMaxRowId();
    } catch (err) {
      return {
        ok: false,
        error: `Cannot read chat.db: ${err instanceof Error ? err.message : String(err)}. Ensure Full Disk Access is granted.`,
      };
    }

    this.running = true;
    this.schedulePoll();
    logger.info('[imessage] Polling started', {
      pollIntervalMs: this.config.pollIntervalMs ?? 5000,
      lastRowId: this.lastRowId,
    });
    return { ok: true };
  }

  stop(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.running = false;
    logger.info('[imessage] Stopped');
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  private schedulePoll(): void {
    if (!this.running) return;
    const interval = this.config?.pollIntervalMs ?? 5_000;
    this.pollTimer = setTimeout(() => {
      void this.poll().finally(() => { this.schedulePoll(); });
    }, interval);
  }

  private async poll(): Promise<void> {
    if (!this.config || !this.running) return;

    try {
      const rows = await this.fetchNewMessages();
      for (const row of rows) {
        if (row.rowid > this.lastRowId) this.lastRowId = row.rowid;
        if (!row.text || row.is_from_me) continue;
        const sender = row.address ?? String(row.handle_id);
        const isGroup = Boolean(row.is_group);
        if (isGroup) {
          await this.handleGroupMessage(sender, row.chat_id, row.text);
        } else {
          await this.handleDmMessage(sender, row.chat_id, row.text);
        }
      }
    } catch (err) {
      logger.warn('[imessage] Poll error', { err: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Database access ────────────────────────────────────────────────────────

  private dbPath(): string {
    return this.config?.chatDbPath ?? join(homedir(), 'Library', 'Messages', 'chat.db');
  }

  private getMaxRowId(): Promise<number> {
    return new Promise((resolve, reject) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Database = require('better-sqlite3') as new (path: string, opts?: object) => any;
        const db = new Database(this.dbPath(), { readonly: true });
        const row = db.prepare('SELECT MAX(ROWID) as maxid FROM message').get() as { maxid: number | null };
        db.close();
        resolve(row?.maxid ?? 0);
      } catch (err) {
        reject(err);
      }
    });
  }

  private fetchNewMessages(): Promise<MessageRow[]> {
    return new Promise((resolve, reject) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Database = require('better-sqlite3') as new (path: string, opts?: object) => any;
        const db = new Database(this.dbPath(), { readonly: true });
        const rows = db.prepare(`
          SELECT
            m.ROWID        AS rowid,
            m.text         AS text,
            m.is_from_me   AS is_from_me,
            m.handle_id    AS handle_id,
            c.chat_identifier AS chat_id,
            (SELECT COUNT(*) FROM chat_handle_join chj WHERE chj.chat_id = c.ROWID) > 1 AS is_group,
            h.id           AS address
          FROM message m
          LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
          LEFT JOIN chat c ON c.ROWID = cmj.chat_id
          LEFT JOIN handle h ON h.ROWID = m.handle_id
          WHERE m.ROWID > ? AND m.text IS NOT NULL AND m.text != ''
          ORDER BY m.ROWID ASC
          LIMIT 100
        `).all(this.lastRowId) as MessageRow[];
        db.close();
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    });
  }

  // ── DM and group handling ─────────────────────────────────────────────────

  private async handleDmMessage(sender: string, chatId: string, text: string): Promise<void> {
    if (!this.config) return;

    const dmPolicy = this.config.dmPolicy ?? 'pairing';
    if (dmPolicy === 'disabled') return;

    if (dmPolicy === 'open') {
      await this.processMessage(sender, text, false, chatId, undefined);
      return;
    }

    if (dmPolicy === 'allowlist') {
      const allowed =
        this.pairingStore.isAllowed(this.channelId, sender) ||
        (this.config.allowFrom?.includes(sender) ?? false);
      if (!allowed) {
        await this.sendReply(chatId, 'You are not authorized to message this bot.');
        return;
      }
      await this.processMessage(sender, text, false, chatId, undefined);
      return;
    }

    // pairing (default)
    if (this.pairingStore.isAllowed(this.channelId, sender)) {
      await this.processMessage(sender, text, false, chatId, undefined);
      return;
    }

    const result = this.pairingStore.requestPairing(this.channelId, sender);
    if (result) {
      await this.sendReply(chatId, `Your pairing code is: ${result.code}\nSend this code to the bot owner to get access. Codes expire in 1 hour.`);
    } else {
      await this.sendReply(chatId, 'A pairing request is already pending. Please wait for the owner to respond.');
    }
  }

  private async handleGroupMessage(sender: string, chatId: string, text: string): Promise<void> {
    if (!this.config) return;

    const groupPolicy = this.config.groupPolicy ?? 'open';
    if (groupPolicy === 'disabled') return;

    if (groupPolicy === 'allowlist') {
      const effectiveAllowFrom = this.config.groupAllowFrom ?? this.config.allowFrom;
      const allowed =
        this.pairingStore.isAllowed(this.channelId, sender) ||
        (effectiveAllowFrom?.includes(sender) ?? false);
      if (!allowed) return;
    }

    await this.processMessage(sender, text, true, chatId, chatId);
  }

  private async processMessage(
    userId: string,
    text: string,
    isGroup: boolean,
    chatId: string,
    groupId: string | undefined,
  ): Promise<void> {
    if (!this.config) return;

    const chatType = isGroup ? 'group' : 'direct';

    // ── Slash command pre-check ──────────────────────────────────────────────
    const slashSessionKey = this.sessionRouter
      ? resolveSessionKey({
          agentId: this.config.agentId,
          channel: 'imessage',
          chatType,
          peerId: !isGroup ? userId : undefined,
          groupId: isGroup ? groupId : undefined,
          dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
        })
      : undefined;
    const slashEntry = slashSessionKey && this.sessionRouter
      ? this.sessionRouter.getSessionEntry(slashSessionKey)
      : null;

    const slashResult = handleSlashCommand(text, {
      agentId: this.config.agentId,
      channel: 'imessage',
      senderId: userId,
      conversationId: slashEntry?.conversationId,
      sessionKey: slashSessionKey,
      convStore: this.convStore,
      sessionRouter: this.sessionRouter,
    });

    if (slashResult.isHandled && slashResult.response) {
      await this.sendReply(chatId, slashResult.response);
      return;
    }

    const isReset = slashResult.isReset || (this.sessionRouter
      ? this.sessionRouter.isResetTrigger(text)
      : (['/new', '/reset', ...(this.config.resetTriggers ?? [])]).some(
          t => text.trim().toLowerCase() === t.toLowerCase(),
        ));

    let conversationId: string | undefined;
    let contextMessages: Array<{ role: string; content: string }> = [];

    if (this.sessionRouter && this.convStore) {
      if (isReset) {
        const key = resolveSessionKey({
          agentId: this.config.agentId,
          channel: 'imessage',
          chatType,
          peerId: !isGroup ? userId : undefined,
          groupId: isGroup ? groupId : undefined,
          dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
        });
        this.sessionRouter.resetSession(key, this.config.agentId);
        await this.sendReply(chatId, '(new conversation started)');
        return;
      }

      const resolved = this.sessionRouter.resolveConversation({
        agentId: this.config.agentId,
        channel: 'imessage',
        chatType,
        peerId: !isGroup ? userId : undefined,
        groupId: isGroup ? groupId : undefined,
      });

      if (!this.sessionRouter.isSendAllowed(resolved.entry)) return;

      conversationId = resolved.conversationId;
      const msgs = this.convStore.getMessages(conversationId);
      const historyLimit = this.config.historyLimit ?? 50;
      const limited = historyLimit > 0 ? msgs.slice(-historyLimit) : msgs;
      contextMessages = limited.map(m => ({ role: m.role, content: m.content }));

    } else if (this.convStore) {
      if (isReset) {
        await this.sendReply(chatId, '(new conversation started)');
        return;
      }
      const conv = this.convStore.createConversation(this.config.agentId);
      conversationId = conv.id;
      const msgs = this.convStore.getMessages(conversationId);
      const historyLimit = this.config.historyLimit ?? 50;
      const limited = historyLimit > 0 ? msgs.slice(-historyLimit) : msgs;
      contextMessages = limited.map(m => ({ role: m.role, content: m.content }));
    } else {
      if (isReset) {
        await this.sendReply(chatId, '(new conversation started)');
        return;
      }
    }

    try {
      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input: text,
        contextOverride: `[iMessage from ${userId}${isGroup ? ` in ${chatId}` : ''}]`,
      }, { contextMessages });

      const output = run.output ?? 'Sorry, I could not process your message.';

      if (this.convStore && conversationId) {
        this.convStore.addMessage(conversationId, 'user', text);
        this.convStore.addMessage(conversationId, 'assistant', output, run.modelUsed);
      }

      const chunks = splitIntoChunks(
        output,
        this.config.textChunkLimit ?? MAX_REPLY_LEN,
        this.config.chunkMode ?? 'length',
      );
      for (const chunk of chunks) {
        await this.sendReply(chatId, chunk);
      }
    } catch (err) {
      logger.error('[imessage] Agent run failed', { err: err instanceof Error ? err.message : String(err) });
      await this.sendReply(chatId, 'Agent error — could not process your message.');
    }
  }

  // ── AppleScript send ──────────────────────────────────────────────────────

  private async sendReply(chatId: string, message: string): Promise<void> {
    // Escape the message for AppleScript: double-quote and backslash
    const escaped = message
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');

    const script = `
      tell application "Messages"
        set targetService to 1st service whose service type = iMessage
        set targetChat to (1st chat of targetService whose id = "${chatId}")
        send "${escaped}" to targetChat
      end tell
    `;

    try {
      await execFileAsync('osascript', ['-e', script]);
    } catch (err) {
      logger.error('[imessage] Failed to send reply via AppleScript', {
        err: err instanceof Error ? err.message : String(err),
        chatId,
      });
    }
  }
}
