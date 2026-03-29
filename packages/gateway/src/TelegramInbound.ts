// ─── TelegramInbound ──────────────────────────────────────────────────────────
//
// Lightweight Telegram inbound channel using the Telegram Bot API (REST only).
// No external npm dependencies required — uses long-polling via fetch.
//
// Setup:
//   1. Create a Telegram bot via @BotFather and copy the Bot Token
//   2. Configure via ChatChannelRegistry or InboundChannelManager
//
// Behaviour:
//   - Long-polls GET /getUpdates?offset=<n>&timeout=30&limit=100
//   - Keeps track of offset (= last update_id + 1) to avoid reprocessing
//   - Routes each message.text to the configured agent via the orchestrator
//   - Sends typing indicator before running the agent
//   - Posts the agent reply back to the same chat
//   - Stops by setting running=false and aborting the current fetch
//
// DM / group policy:
//   - dmPolicy: 'pairing' (default) | 'allowlist' | 'open' | 'disabled'
//   - groupPolicy: 'allowlist' (default) | 'open' | 'disabled'
//   - Groups are identified by chat.id < 0; DMs by chat.id > 0
//
// Telegram limits:
//   - Max message length: 4096 characters
//   - Long-poll timeout: 30 seconds (configured below)
//

import type { AgentOrchestrator } from '@krythor/core';
import type { ConversationStore } from '@krythor/memory';
import { resolveSessionKey } from '@krythor/memory';
import type { DmPairingStore } from './DmPairingStore.js';
import type { SessionRouter } from './SessionRouter.js';
import { handleSlashCommand } from './InboundSlashCommands.js';
import { logger } from './logger.js';

const TELEGRAM_API = 'https://api.telegram.org';
const LONG_POLL_TIMEOUT_S = 30;
const MAX_REPLY_LEN = 4096;

/** Max processed message IDs held in the dedup cache before oldest are evicted. */
const DEDUP_CACHE_MAX = 500;

/** Retry policy for outbound Telegram API calls (sendMessage, reactions, etc.). */
const RETRY_ATTEMPTS   = 3;
const RETRY_MIN_MS     = 400;
const RETRY_MAX_MS     = 30_000;
const RETRY_JITTER     = 0.1;

/** Compute exponential backoff with jitter. */
function backoffMs(attempt: number, minMs: number, maxMs: number, jitter: number): number {
  const base = Math.min(minMs * Math.pow(2, attempt), maxMs);
  return Math.floor(base * (1 + (Math.random() * 2 - 1) * jitter));
}

export interface TelegramInboundConfig {
  token: string;
  agentId: string;
  enabled: boolean;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  /** Channel-wide group sender allowlist — fallback when per-group allowFrom is not set. */
  groupAllowFrom?: string[];
  groups?: Record<string, { requireMention?: boolean; allowFrom?: string[] }>;
  resetTriggers?: string[];
  /** Max context messages injected per turn. Default: 50. 0 = disabled. */
  historyLimit?: number;
  /** Max chars per outbound message chunk. Default: 4096 (Telegram limit). */
  textChunkLimit?: number;
  /** Split strategy: 'length' (default) or 'newline' (paragraph boundaries first). */
  chunkMode?: 'length' | 'newline';
  /**
   * Acknowledgment reaction emoji sent as soon as a message is accepted.
   * Default: "👀". Set to "" to disable.
   */
  ackReaction?: string;
  /**
   * Randomized inter-chunk delay range (ms) to simulate natural pacing when
   * a reply is split into multiple messages. A random value between min and max
   * is awaited between each pair of chunks.
   * Default: { min: 800, max: 2500 }. Set max to 0 to disable.
   */
  humanDelay?: { min?: number; max?: number };
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
  };
}

/**
 * Split text into chunks no longer than maxLen characters.
 * When mode='newline', prefer splitting on paragraph boundaries (blank lines)
 * before falling back to hard length splitting.
 *
 * Code-fence aware: never splits inside a ``` fence. If a fence must be split
 * at maxLen, the current chunk is closed with ``` and the next chunk reopens it
 * so Markdown remains valid.
 */
function splitIntoChunks(text: string, maxLen: number, mode: 'length' | 'newline'): string[] {
  if (text.length <= maxLen) return [text];

  // ── Fence-aware hard split ─────────────────────────────────────────────────
  // Walk through the text line by line, tracking whether we're inside a code
  // fence. Collect lines into a current chunk; when adding the next line would
  // exceed maxLen, flush the current chunk (closing any open fence) and start
  // a new one (reopening the fence if needed).
  function fenceAwareSplit(src: string): string[] {
    const lines = src.split('\n');
    const result: string[] = [];
    let current = '';
    let inFence = false;
    let fenceLang = '';

    const flush = () => {
      if (!current) return;
      const out = inFence ? `${current}\n\`\`\`` : current;
      result.push(out.trim());
      current = '';
    };

    for (const line of lines) {
      const fenceMatch = line.match(/^(`{3,})(.*)/);
      if (fenceMatch) {
        if (!inFence) {
          inFence = true;
          fenceLang = (fenceMatch[2] ?? '').trim();
        } else {
          inFence = false;
          fenceLang = '';
        }
      }

      const candidate = current ? `${current}\n${line}` : line;
      if (candidate.length > maxLen && current.length > 0) {
        // Flush current chunk
        flush();
        // If we're inside a fence, reopen it in the new chunk
        if (inFence) {
          current = `\`\`\`${fenceLang}\n${line}`;
        } else {
          current = line;
        }
      } else {
        current = candidate;
      }
    }
    flush();
    return result.filter(c => c.length > 0);
  }

  if (mode === 'newline') {
    // Try paragraph-boundary splits first; fall back to fence-aware hard split
    // for paragraphs that still exceed maxLen.
    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];
    let current = '';
    for (const para of paragraphs) {
      const candidate = current ? `${current}\n\n${para}` : para;
      if (candidate.length <= maxLen) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        if (para.length > maxLen) {
          chunks.push(...fenceAwareSplit(para));
          current = '';
        } else {
          current = para;
        }
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  return fenceAwareSplit(text);
}

interface TelegramUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

export class TelegramInbound {
  private config: TelegramInboundConfig | null = null;
  private orchestrator: AgentOrchestrator;
  private pairingStore: DmPairingStore;
  private convStore: ConversationStore | null;
  private sessionRouter: SessionRouter | null;
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;
  private botUsername: string | null = null;
  private channelId: string = 'telegram';
  /**
   * Deduplication cache — tracks recently processed update_ids to prevent
   * re-processing the same message on reconnect or poll overlap.
   * Bounded at DEDUP_CACHE_MAX entries; oldest are evicted when full.
   */
  private readonly seenUpdateIds = new Set<number>();

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

  // ── Configuration ──────────────────────────────────────────────────────────

  configure(cfg: TelegramInboundConfig): void {
    this.config = cfg;
  }

  getConfig(): TelegramInboundConfig | null {
    return this.config ? { ...this.config, token: '***' } : null;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config?.enabled) {
      return { ok: false, error: 'Telegram inbound is not configured or disabled' };
    }
    if (this.running) return { ok: true };

    // Validate token by calling getMe; also capture botUsername for mention detection
    try {
      const me = await this.telegramGet('getMe') as { ok: boolean; result?: { username?: string; id?: number } };
      if (!me.ok) {
        return { ok: false, error: 'Telegram getMe returned ok=false — check bot token' };
      }
      this.botUsername = me.result?.username ?? null;
      logger.info('[telegram] Bot authenticated', { botUsername: this.botUsername });
    } catch (err) {
      return {
        ok: false,
        error: `Telegram auth failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Seed allowlist from config.allowFrom (pre-configured senders)
    if (this.config.allowFrom && this.config.allowFrom.length > 0) {
      for (const senderId of this.config.allowFrom) {
        this.pairingStore.addToAllowlist(this.channelId, senderId);
      }
    }

    // Seed offset to skip any pending messages already queued
    try {
      const res = await this.telegramGet(
        `getUpdates?offset=-1&limit=1`,
      ) as TelegramUpdatesResponse;
      if (res.ok && res.result.length > 0) {
        this.offset = res.result[res.result.length - 1]!.update_id + 1;
      }
    } catch { /* ignore on start */ }

    this.running = true;
    void this.pollLoop();
    logger.info('[telegram] Long-polling started');
    return { ok: true };
  }

  stop(): void {
    if (this.running) {
      this.running = false;
      this.abortController?.abort();
      this.abortController = null;
      logger.info('[telegram] Long-polling stopped');
    }
  }

  // ── Polling loop ───────────────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        this.abortController = new AbortController();
        const url =
          `${TELEGRAM_API}/bot${this.config!.token}/getUpdates` +
          `?offset=${this.offset}&timeout=${LONG_POLL_TIMEOUT_S}&limit=100`;

        const res = await fetch(url, { signal: this.abortController.signal });
        if (!res.ok) {
          logger.warn('[telegram] getUpdates HTTP error — retrying', { status: res.status });
          await this.sleep(2_000);
          continue;
        }

        const body = await res.json() as TelegramUpdatesResponse;
        if (!body.ok) {
          logger.warn('[telegram] getUpdates returned ok=false — retrying');
          await this.sleep(2_000);
          continue;
        }

        for (const update of body.result) {
          this.offset = update.update_id + 1;
          // Dedup: skip if we've already processed this update_id
          if (this.seenUpdateIds.has(update.update_id)) continue;
          if (this.seenUpdateIds.size >= DEDUP_CACHE_MAX) {
            // Evict the oldest entry (Set preserves insertion order)
            const oldest = this.seenUpdateIds.values().next().value;
            if (oldest !== undefined) this.seenUpdateIds.delete(oldest);
          }
          this.seenUpdateIds.add(update.update_id);
          if (update.message?.text) {
            await this.handleMessage(update.message);
          }
        }
      } catch (err) {
        if (!this.running) break; // stopped intentionally
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('abort') || msg.includes('AbortError')) break;
        logger.warn('[telegram] Poll error — retrying', { err: err instanceof Error ? err.message : String(err) });
        await this.sleep(3_000);
      }
    }
  }

  private async handleMessage(
    message: NonNullable<TelegramUpdate['message']>,
  ): Promise<void> {
    if (!this.config) return;

    const chatId   = message.chat.id;
    const fromId   = String(message.from?.id ?? 0);
    const fromName = message.from?.first_name;
    const isGroup  = chatId < 0;

    logger.info('[telegram] Received message', { chatId, fromId, isGroup });

    if (isGroup) {
      // ── Group policy enforcement ────────────────────────────────────────────
      const groupPolicy = this.config.groupPolicy ?? 'allowlist';

      if (groupPolicy === 'disabled') {
        return; // silently ignore
      }

      if (groupPolicy === 'allowlist') {
        // Check if this group chat.id is in the configured groups map
        const groupKey = String(chatId);
        const groupCfg = this.config.groups?.[groupKey];
        if (!groupCfg) {
          // Group not in allowlist — ignore silently
          logger.info('[telegram] Group not in allowlist — ignoring', { chatId });
          return;
        }

        // Per-group sender allowlist (falls back to channel-wide groupAllowFrom)
        const effectiveGroupAllowFrom = groupCfg.allowFrom ?? this.config.groupAllowFrom;
        if (effectiveGroupAllowFrom && effectiveGroupAllowFrom.length > 0) {
          if (!effectiveGroupAllowFrom.includes(fromId)) {
            logger.info('[telegram] Group sender not in allowFrom — ignoring', { chatId, fromId });
            return;
          }
        }

        // Check requireMention
        if (groupCfg.requireMention && this.botUsername) {
          if (!message.text?.includes(`@${this.botUsername}`)) {
            return; // not mentioned — ignore
          }
        }
      }

      // groupPolicy === 'open' or group is in allowlist: fall through to agent
      void this.sendChatAction(chatId, 'typing').catch(() => {});
      await this.sendAckReaction(chatId, message.message_id).catch(() => {});
      await this.runAgent(chatId, fromId, message.text!);

    } else {
      // ── DM policy enforcement ───────────────────────────────────────────────
      const dmPolicy = this.config.dmPolicy ?? 'pairing';

      if (dmPolicy === 'disabled') {
        return; // silently ignore
      }

      if (dmPolicy === 'open') {
        void this.sendChatAction(chatId, 'typing').catch(() => {});
        await this.sendAckReaction(chatId, message.message_id).catch(() => {});
        await this.runAgent(chatId, fromId, message.text!);
        return;
      }

      if (dmPolicy === 'allowlist') {
        const allowed =
          this.pairingStore.isAllowed(this.channelId, fromId) ||
          (this.config.allowFrom?.includes(fromId) ?? false);

        if (!allowed) {
          await this.sendMessage(chatId, 'You are not authorized to message this bot.').catch(() => {});
          return;
        }

        void this.sendChatAction(chatId, 'typing').catch(() => {});
        await this.sendAckReaction(chatId, message.message_id).catch(() => {});
        await this.runAgent(chatId, fromId, message.text!);
        return;
      }

      // dmPolicy === 'pairing' (default)
      if (this.pairingStore.isAllowed(this.channelId, fromId)) {
        void this.sendChatAction(chatId, 'typing').catch(() => {});
        await this.sendAckReaction(chatId, message.message_id).catch(() => {});
        await this.runAgent(chatId, fromId, message.text!);
        return;
      }

      // Not allowed — request pairing
      const result = this.pairingStore.requestPairing(this.channelId, fromId, fromName);
      if (result) {
        await this.sendMessage(
          chatId,
          `Your pairing code is: \`${result.code}\`. Send this code to the bot owner to get access. Codes expire in 1 hour.`,
        ).catch(() => {});
      } else {
        await this.sendMessage(
          chatId,
          'A pairing request is already pending. Please wait for the owner to respond.',
        ).catch(() => {});
      }
    }
  }

  private async runAgent(chatId: number, fromId: string, text: string, isGroup = false): Promise<void> {
    if (!this.config) return;
    try {
      // ── Slash command pre-check ────────────────────────────────────────────
      const chatTypeForCmd = isGroup ? 'group' : 'direct';
      const groupIdForCmd  = isGroup ? String(chatId) : undefined;
      const slashSessionKey = this.sessionRouter
        ? resolveSessionKey({
            agentId: this.config.agentId,
            channel: 'telegram',
            chatType: chatTypeForCmd,
            peerId: !isGroup ? fromId : undefined,
            groupId: groupIdForCmd,
            dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
          })
        : undefined;
      const slashEntry = slashSessionKey && this.sessionRouter
        ? this.sessionRouter.getSessionEntry(slashSessionKey)
        : null;

      const slashResult = handleSlashCommand(text, {
        agentId: this.config.agentId,
        channel: 'telegram',
        senderId: fromId,
        conversationId: slashEntry?.conversationId,
        sessionKey: slashSessionKey,
        convStore: this.convStore,
        sessionRouter: this.sessionRouter,
      });

      if (slashResult.isHandled && slashResult.response) {
        await this.sendMessage(chatId, slashResult.response);
        return;
      }

      // Check for session reset triggers
      const isReset = slashResult.isReset || (this.sessionRouter
        ? this.sessionRouter.isResetTrigger(text)
        : ['/new', '/reset', ...(this.config.resetTriggers ?? [])].some(
            t => text.trim().toLowerCase() === t.toLowerCase(),
          ));

      let conversationId: string | undefined;
      let contextMessages: Array<{ role: string; content: string }> = [];

      if (this.sessionRouter && this.convStore) {
        const chatType = isGroup ? 'group' : 'direct';
        const groupId  = isGroup ? String(chatId) : undefined;

        if (isReset) {
          const key = resolveSessionKey({
            agentId: this.config.agentId,
            channel: 'telegram',
            chatType,
            peerId: !isGroup ? fromId : undefined,
            groupId,
            dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
          });
          conversationId = this.sessionRouter.resetSession(key, this.config.agentId);
          await this.sendMessage(chatId, '(new conversation started)');
          return;
        }

        const resolved = this.sessionRouter.resolveConversation({
          agentId: this.config.agentId,
          channel: 'telegram',
          chatType,
          peerId: !isGroup ? fromId : undefined,
          groupId,
          displayName: String(chatId),
        });

        // Check send policy
        if (!this.sessionRouter.isSendAllowed(resolved.entry)) {
          return;
        }

        conversationId = resolved.conversationId;
        const msgs = this.convStore.getMessages(conversationId);
        const historyLimit = this.config.historyLimit ?? 50;
        const limited = historyLimit > 0 ? msgs.slice(-historyLimit) : msgs;
        contextMessages = limited.map(m => ({ role: m.role, content: m.content }));

      } else if (this.convStore) {
        // Legacy path: no SessionRouter (backward compat)
        if (isReset) {
          await this.sendMessage(chatId, '(new conversation started)');
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
          await this.sendMessage(chatId, '(new conversation started)');
          return;
        }
      }

      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input: text,
        contextOverride: `[Telegram from user ${fromId}]`,
      }, { contextMessages });

      const output = run.output ?? 'Sorry, I could not process your message.';

      // Persist the exchange to the conversation store
      if (this.convStore && conversationId) {
        this.convStore.addMessage(conversationId, 'user', text);
        this.convStore.addMessage(conversationId, 'assistant', output, run.modelUsed);
      }

      // Split long replies into chunks and deliver with optional human-like pacing
      const chunks = splitIntoChunks(output, this.config.textChunkLimit ?? MAX_REPLY_LEN, this.config.chunkMode ?? 'length');
      const delayMin = this.config.humanDelay?.min ?? 800;
      const delayMax = this.config.humanDelay?.max ?? 2500;
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0 && delayMax > 0) {
          const ms = delayMin + Math.random() * (delayMax - delayMin);
          await this.sleep(Math.round(ms));
        }
        await this.sendMessage(chatId, chunks[i]!);
      }
    } catch (err) {
      logger.error('[telegram] Agent run failed', { err: err instanceof Error ? err.message : String(err), chatId });
      await this.sendMessage(chatId, 'Agent error — could not process your message.').catch(() => {});
    }
  }

  // ── Telegram REST helpers ──────────────────────────────────────────────────

  private async telegramGet(path: string): Promise<unknown> {
    const url = path.startsWith('http')
      ? path
      : `${TELEGRAM_API}/bot${this.config!.token}/${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Telegram GET ${path} failed: ${res.status}`);
    return res.json();
  }

  /**
   * Send a message with retry on transient errors and 429 rate-limits.
   * Retries up to RETRY_ATTEMPTS times with exponential backoff + jitter.
   * On Telegram Markdown parse errors (400) retries once in plain text mode.
   */
  private async sendMessage(chatId: number, text: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.config!.token}/sendMessage`;
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text }),
        });

        if (res.ok) return;

        if (res.status === 429) {
          // Respect Telegram's retry_after
          let waitMs: number;
          try {
            const body = await res.json() as { parameters?: { retry_after?: number } };
            waitMs = ((body.parameters?.retry_after ?? 1) * 1000);
          } catch {
            waitMs = backoffMs(attempt, RETRY_MIN_MS, RETRY_MAX_MS, RETRY_JITTER);
          }
          await this.sleep(waitMs);
          continue;
        }

        // Non-retryable error
        throw new Error(`Telegram sendMessage failed: ${res.status}`);
      } catch (err) {
        if (err instanceof Error && (
          err.message.includes('failed: 429') ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('ECONNREFUSED') ||
          err.message.includes('fetch failed') ||
          err.message.includes('network')
        )) {
          lastErr = err;
          await this.sleep(backoffMs(attempt, RETRY_MIN_MS, RETRY_MAX_MS, RETRY_JITTER));
          continue;
        }
        throw err;
      }
    }

    throw lastErr ?? new Error('Telegram sendMessage failed after retries');
  }

  private async sendChatAction(chatId: number, action: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.config!.token}/sendChatAction`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  }

  /**
   * Send an acknowledgment reaction emoji on the triggering message.
   * Uses config.ackReaction (default "👀"). Empty string disables.
   * Non-fatal — errors are swallowed by the caller.
   */
  private async sendAckReaction(chatId: number, messageId: number): Promise<void> {
    const emoji = this.config?.ackReaction ?? '👀';
    if (!emoji) return; // disabled
    const url = `${TELEGRAM_API}/bot${this.config!.token}/setMessageReaction`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji }],
      }),
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
