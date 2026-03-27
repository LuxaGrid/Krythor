// ─── DiscordInbound ───────────────────────────────────────────────────────────
//
// Lightweight Discord inbound channel using the Discord REST API only.
// No discord.js or websocket library required — uses polling via fetch.
//
// Setup:
//   1. Create a Discord bot at https://discord.com/developers/applications
//   2. Copy the Bot Token and the channel ID you want to listen to
//   3. Configure via PATCH /api/discord or environment variables:
//      KRYTHOR_DISCORD_TOKEN, KRYTHOR_DISCORD_CHANNEL_ID, KRYTHOR_DISCORD_AGENT_ID
//
// Behaviour:
//   - Polls the Discord channel every POLL_INTERVAL_MS for new messages
//   - Ignores messages from the bot itself
//   - Routes each new user message to the configured agent via the orchestrator
//   - Posts the agent's reply back to the same channel
//   - Tracks the last seen message ID to avoid reprocessing
//
// DM / guild policy:
//   - If guildId is set, treat messages as guild channel messages
//   - Otherwise treat as DM — dmPolicy is enforced
//
// Rate limits: Discord allows 50 GET /messages requests per second per channel.
// At a 3-second poll interval we are well within limits.
//

import type { AgentOrchestrator } from '@krythor/core';
import type { ConversationStore } from '@krythor/memory';
import type { DmPairingStore } from './DmPairingStore.js';
import { logger } from './logger.js';

const DISCORD_API = 'https://discord.com/api/v10';
const POLL_INTERVAL_MS = 3_000;
const MAX_REPLY_LEN = 2_000; // Discord message limit is 2000 chars

export interface DiscordInboundConfig {
  token: string;
  channelId: string;
  agentId: string;
  enabled: boolean;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  /** Guild channel policy. Default: 'open' (guild channels are generally trusted). */
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  /** Channel-wide guild sender allowlist — used when groupPolicy is 'allowlist'. */
  groupAllowFrom?: string[];
  guildId?: string;
  resetTriggers?: string[];
  /** Max context messages injected per turn. Default: 50. 0 = disabled. */
  historyLimit?: number;
  /** Max chars per outbound message chunk. Default: 2000 (Discord limit). */
  textChunkLimit?: number;
  /** Split strategy: 'length' (default) or 'newline' (paragraph boundaries first). */
  chunkMode?: 'length' | 'newline';
}

interface DiscordMessage {
  id: string;
  author: { id: string; bot?: boolean };
  content: string;
  timestamp: string;
}

/**
 * Split text into chunks no longer than maxLen characters.
 * When mode='newline', prefer splitting on paragraph boundaries before hard split.
 */
function splitIntoChunks(text: string, maxLen: number, mode: 'length' | 'newline'): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];

  if (mode === 'newline') {
    const paragraphs = text.split(/\n\n+/);
    let current = '';
    for (const para of paragraphs) {
      const candidate = current ? `${current}\n\n${para}` : para;
      if (candidate.length <= maxLen) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        if (para.length > maxLen) {
          for (let i = 0; i < para.length; i += maxLen) {
            chunks.push(para.slice(i, i + maxLen));
          }
          current = '';
        } else {
          current = para;
        }
      }
    }
    if (current) chunks.push(current);
  } else {
    for (let i = 0; i < text.length; i += maxLen) {
      chunks.push(text.slice(i, i + maxLen));
    }
  }

  return chunks;
}

export class DiscordInbound {
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastMessageId: string | null = null;
  private botUserId: string | null = null;
  private config: DiscordInboundConfig | null = null;
  private orchestrator: AgentOrchestrator;
  private pairingStore: DmPairingStore;
  private convStore: ConversationStore | null;
  private processing = false;
  private channelId: string = 'discord';
  /** Per-author conversation tracking: authorId → conversationId */
  private authorConvMap = new Map<string, string>();

  constructor(orchestrator: AgentOrchestrator, pairingStore: DmPairingStore, convStore: ConversationStore | null = null) {
    this.orchestrator = orchestrator;
    this.pairingStore = pairingStore;
    this.convStore = convStore;
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  configure(cfg: DiscordInboundConfig): void {
    this.config = cfg;
    // Use channelId as the pairing store key to keep keys unique per channel
    this.channelId = `discord-${cfg.channelId}`;
  }

  getConfig(): DiscordInboundConfig | null {
    return this.config ? { ...this.config, token: '***' } : null;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config?.enabled) return { ok: false, error: 'Discord inbound is not configured or disabled' };
    if (this.timer) return { ok: true }; // already running

    // Resolve bot user ID to filter own messages
    try {
      const me = await this.discordGet('/users/@me') as { id: string; username: string };
      this.botUserId = me.id;
      logger.info('[discord] Bot authenticated', { botUser: me.username });
    } catch (err) {
      return { ok: false, error: `Discord auth failed: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Seed allowlist from config.allowFrom (pre-configured senders)
    if (this.config.allowFrom && this.config.allowFrom.length > 0) {
      for (const senderId of this.config.allowFrom) {
        this.pairingStore.addToAllowlist(this.channelId, senderId);
      }
    }

    // Seed lastMessageId to the newest message so we don't replay history
    try {
      const messages = await this.fetchMessages() as DiscordMessage[];
      if (messages.length > 0) this.lastMessageId = messages[0]!.id;
    } catch { /* ignore on start */ }

    this.timer = setInterval(() => { void this.poll(); }, POLL_INTERVAL_MS);
    if (this.timer.unref) this.timer.unref();
    logger.info('[discord] Polling started', { channelId: this.config.channelId, guildId: this.config.guildId });
    return { ok: true };
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('[discord] Polling stopped');
    }
  }

  // ── Polling loop ───────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (this.processing || !this.config?.enabled) return;
    this.processing = true;
    try {
      const messages = await this.fetchMessages() as DiscordMessage[];
      // Messages are newest-first; we want oldest-first for processing
      const toProcess = messages
        .filter(m => !m.author.bot && m.author.id !== this.botUserId)
        .filter(m => !this.lastMessageId || BigInt(m.id) > BigInt(this.lastMessageId))
        .reverse();

      for (const msg of toProcess) {
        this.lastMessageId = msg.id;
        await this.handleMessage(msg);
      }
    } catch (err) {
      logger.warn('[discord] Poll error', { err: err instanceof Error ? err.message : String(err) });
    } finally {
      this.processing = false;
    }
  }

  private async handleMessage(msg: DiscordMessage): Promise<void> {
    if (!this.config) return;

    const isDM = !this.config.guildId;
    const authorId = msg.author.id;

    if (isDM) {
      // ── DM policy enforcement ─────────────────────────────────────────────
      const dmPolicy = this.config.dmPolicy ?? 'pairing';

      if (dmPolicy === 'disabled') {
        return;
      }

      if (dmPolicy === 'open') {
        logger.info('[discord] DM received (open)', { msgId: msg.id, author: authorId });
        await this.processMessage(msg);
        return;
      }

      if (dmPolicy === 'allowlist') {
        const allowed =
          this.pairingStore.isAllowed(this.channelId, authorId) ||
          (this.config.allowFrom?.includes(authorId) ?? false);

        if (!allowed) {
          logger.info('[discord] DM sender not on allowlist', { author: authorId });
          await this.sendMessage('You are not authorized to message this bot.', msg.id).catch(() => {});
          return;
        }

        logger.info('[discord] DM received (allowlist approved)', { msgId: msg.id, author: authorId });
        await this.processMessage(msg);
        return;
      }

      // dmPolicy === 'pairing' (default)
      if (this.pairingStore.isAllowed(this.channelId, authorId)) {
        logger.info('[discord] DM received (pairing approved)', { msgId: msg.id, author: authorId });
        await this.processMessage(msg);
        return;
      }

      // Not allowed — request pairing
      const result = this.pairingStore.requestPairing(this.channelId, authorId);
      if (result) {
        await this.sendMessage(
          `Your pairing code is: \`${result.code}\`. Send this code to the bot owner to get access. Codes expire in 1 hour.`,
          msg.id,
        ).catch(() => {});
      } else {
        await this.sendMessage(
          'A pairing request is already pending. Please wait for the owner to respond.',
          msg.id,
        ).catch(() => {});
      }

    } else {
      // ── Guild message — apply groupPolicy ─────────────────────────────────
      const groupPolicy = this.config.groupPolicy ?? 'open';

      if (groupPolicy === 'disabled') {
        logger.info('[discord] Guild messages disabled by groupPolicy', { guildId: this.config.guildId });
        return;
      }

      if (groupPolicy === 'allowlist') {
        // groupAllowFrom takes priority over allowFrom for guild messages
        const effectiveAllowFrom = this.config.groupAllowFrom ?? this.config.allowFrom;
        const allowed =
          this.pairingStore.isAllowed(this.channelId, authorId) ||
          (effectiveAllowFrom?.includes(authorId) ?? false);
        if (!allowed) {
          logger.info('[discord] Guild sender not on allowlist', { author: authorId, guildId: this.config.guildId });
          return; // silently ignore — no pairing flow for guild channels
        }
      }

      logger.info('[discord] Guild message received', {
        msgId: msg.id,
        author: authorId,
        guildId: this.config.guildId,
        channelId: this.config.channelId,
      });
      await this.processMessage(msg);
    }
  }

  private async processMessage(msg: DiscordMessage): Promise<void> {
    if (!this.config) return;
    logger.info('[discord] Processing message', { msgId: msg.id, author: msg.author.id });

    const authorId = msg.author.id;

    // Check for session reset triggers (case-insensitive exact match)
    const triggers = this.config.resetTriggers ?? ['/new'];
    const isReset = triggers.some(t => msg.content.trim().toLowerCase() === t.toLowerCase());
    if (isReset) {
      this.authorConvMap.delete(authorId);
      await this.sendMessage('(new conversation started)', msg.id).catch(() => {});
      return;
    }

    // Resolve or create a per-author conversation for context continuity
    let conversationId = this.authorConvMap.get(authorId);
    let contextMessages: Array<{ role: string; content: string }> = [];

    if (this.convStore) {
      if (!conversationId) {
        const conv = this.convStore.createConversation(this.config.agentId);
        conversationId = conv.id;
        this.authorConvMap.set(authorId, conversationId);
      }
      const msgs = this.convStore.getMessages(conversationId);
      // Apply historyLimit to prevent unbounded context growth
      const historyLimit = this.config.historyLimit ?? 50;
      const limited = historyLimit > 0 ? msgs.slice(-historyLimit) : msgs;
      contextMessages = limited.map(m => ({ role: m.role, content: m.content }));
    }

    const typingPromise = this.sendTyping().catch(() => {});

    try {
      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input: msg.content,
        contextOverride: `[Discord message from user ${authorId}]`,
      }, { contextMessages });

      const output = run.output ?? 'Sorry, I could not process your message.';

      // Persist the exchange
      if (this.convStore && conversationId) {
        this.convStore.addMessage(conversationId, 'user', msg.content);
        this.convStore.addMessage(conversationId, 'assistant', output, run.modelUsed);
      }

      await typingPromise;

      // Split long replies into chunks
      const chunks = splitIntoChunks(output, this.config.textChunkLimit ?? MAX_REPLY_LEN, this.config.chunkMode ?? 'length');
      let firstChunk = true;
      for (const chunk of chunks) {
        // Only reply-thread on the first chunk to avoid a chain of replies
        await this.sendMessage(chunk, firstChunk ? msg.id : undefined);
        firstChunk = false;
      }
    } catch (err) {
      logger.error('[discord] Agent run failed', { err: err instanceof Error ? err.message : String(err), msgId: msg.id });
      await this.sendMessage('Agent error — could not process your message.', msg.id).catch(() => {});
    }
  }

  // ── Discord REST helpers ───────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      'Authorization': `Bot ${this.config!.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'KrythorBot/1.0',
    };
  }

  private async discordGet(path: string): Promise<unknown> {
    const res = await fetch(`${DISCORD_API}${path}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Discord GET ${path} failed: ${res.status}`);
    return res.json();
  }

  private async fetchMessages(): Promise<DiscordMessage[]> {
    const qs = this.lastMessageId ? `?after=${this.lastMessageId}&limit=10` : '?limit=1';
    const res = await fetch(`${DISCORD_API}/channels/${this.config!.channelId}/messages${qs}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      if (res.status === 429) {
        const body = await res.json().catch(() => ({})) as { retry_after?: number };
        const wait = (body.retry_after ?? 1) * 1000;
        await new Promise(r => setTimeout(r, wait));
        return [];
      }
      throw new Error(`Discord messages fetch failed: ${res.status}`);
    }
    return res.json() as Promise<DiscordMessage[]>;
  }

  private async sendMessage(content: string, replyToId?: string): Promise<void> {
    const body: Record<string, unknown> = { content };
    if (replyToId) body['message_reference'] = { message_id: replyToId };
    const res = await fetch(`${DISCORD_API}/channels/${this.config!.channelId}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Discord send failed: ${res.status}`);
  }

  private async sendTyping(): Promise<void> {
    await fetch(`${DISCORD_API}/channels/${this.config!.channelId}/typing`, {
      method: 'POST',
      headers: this.headers(),
    });
  }
}
