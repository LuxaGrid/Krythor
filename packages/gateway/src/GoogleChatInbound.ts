// ─── GoogleChatInbound ────────────────────────────────────────────────────────
//
// Google Chat inbound channel using the Google Chat REST API (app-based bot).
// Receives events via HTTP webhook (Google Chat pushes POST requests to your URL).
//
// Setup:
//   1. Create a Google Cloud project and enable the Google Chat API
//   2. Configure an app at https://chat.google.com/u/0/appDetails (set the endpoint URL)
//   3. Authenticate as a service account: set serviceAccountJson to your key file path
//      or inline the JSON as a string
//   4. The gateway exposes POST /chat/google/:channelId — point your Google Chat
//      app's endpoint URL at this route
//
// Behaviour:
//   - Processes incoming webhook events (MESSAGE type)
//   - Routes DMs and space messages to the configured agent
//   - Replies via the Google Chat REST API using a service account bearer token
//   - dmPolicy/groupPolicy enforcement with pairing store
//   - SessionRouter integration for conversation continuity
//   - No WebSocket or long-polling needed — purely webhook-driven
//
// NOTE: This handler is webhook-only. It does NOT require an external npm package.
// The gateway's HTTP server must be publicly accessible (or use a tunnel like ngrok).
//

import type { AgentOrchestrator } from '@krythor/core';
import type { ConversationStore } from '@krythor/memory';
import { resolveSessionKey } from '@krythor/memory';
import type { DmPairingStore } from './DmPairingStore.js';
import type { SessionRouter } from './SessionRouter.js';
import { handleSlashCommand } from './InboundSlashCommands.js';
import { logger } from './logger.js';

const MAX_REPLY_LEN = 4_000;

export interface GoogleChatInboundConfig {
  agentId: string;
  enabled: boolean;
  /**
   * Path to the service account JSON key file, or the JSON content as a string.
   * Used to obtain bearer tokens for reply calls.
   */
  serviceAccountJson?: string;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  groupAllowFrom?: string[];
  resetTriggers?: string[];
  historyLimit?: number;
  textChunkLimit?: number;
  chunkMode?: 'length' | 'newline';
}

// ── Google Chat webhook types ─────────────────────────────────────────────────

export interface GoogleChatEvent {
  type: string;           // 'MESSAGE', 'ADDED_TO_SPACE', 'REMOVED_FROM_SPACE', 'CARD_CLICKED'
  eventTime?: string;
  message?: {
    name: string;
    sender: {
      name: string;       // users/<userId>
      displayName: string;
      type: string;       // 'HUMAN' or 'BOT'
    };
    text?: string;
    space: {
      name: string;       // spaces/<spaceId>
      type: string;       // 'ROOM' or 'DM'
    };
    thread?: { name: string };
  };
  space?: {
    name: string;
    type: string;
  };
  user?: {
    name: string;
    displayName: string;
    type: string;
  };
}

// ── Token cache ───────────────────────────────────────────────────────────────

interface TokenCache {
  token: string;
  expiresAt: number;
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

// ── GoogleChatInbound ─────────────────────────────────────────────────────────

export class GoogleChatInbound {
  private config: GoogleChatInboundConfig | null = null;
  private orchestrator: AgentOrchestrator;
  private pairingStore: DmPairingStore;
  private convStore: ConversationStore | null;
  private sessionRouter: SessionRouter | null;
  private tokenCache: TokenCache | null = null;
  private running = false;

  private readonly internalChannelId = 'googlechat';

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

  configure(cfg: GoogleChatInboundConfig): void {
    this.config = cfg;
  }

  getConfig(): GoogleChatInboundConfig | null {
    return this.config ? { ...this.config, serviceAccountJson: '***' } : null;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  // Google Chat is webhook-driven — "running" just means we're configured and
  // ready to process inbound webhook calls via handleWebhookEvent().

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config?.enabled) {
      return { ok: false, error: 'Google Chat inbound is not configured or disabled' };
    }
    this.running = true;
    logger.info('[googlechat] Webhook handler active', { agentId: this.config.agentId });
    return { ok: true };
  }

  stop(): void {
    this.running = false;
    this.tokenCache = null;
    logger.info('[googlechat] Stopped');
  }

  // ── Webhook entry point ────────────────────────────────────────────────────

  /**
   * Call this from the gateway HTTP route when a Google Chat webhook POST arrives.
   * Returns a Google Chat response object (for synchronous reply).
   */
  async handleWebhookEvent(event: GoogleChatEvent): Promise<{ text: string } | null> {
    if (!this.config || !this.running) return null;
    if (event.type !== 'MESSAGE') return null;

    const msg = event.message;
    if (!msg?.text || !msg.sender) return null;

    // Ignore bot messages
    if (msg.sender.type === 'BOT') return null;

    const text = msg.text.trim();
    if (!text) return null;

    const userId = msg.sender.name;   // users/<userId>
    const spaceId = msg.space.name;   // spaces/<spaceId>
    const isDM = msg.space.type === 'DM';

    let reply: string | null = null;

    if (isDM) {
      reply = await this.handleDmMessage(userId, text, spaceId);
    } else {
      reply = await this.handleSpaceMessage(userId, spaceId, text);
    }

    return reply ? { text: reply } : null;
  }

  // ── DM and space handling ─────────────────────────────────────────────────

  private async handleDmMessage(userId: string, text: string, spaceId: string): Promise<string | null> {
    if (!this.config) return null;

    const dmPolicy = this.config.dmPolicy ?? 'pairing';
    if (dmPolicy === 'disabled') return null;

    if (dmPolicy === 'open') {
      return this.processMessage(userId, text, false, spaceId, undefined);
    }

    if (dmPolicy === 'allowlist') {
      const allowed =
        this.pairingStore.isAllowed(this.internalChannelId, userId) ||
        (this.config.allowFrom?.includes(userId) ?? false);
      if (!allowed) {
        return 'You are not authorized to message this bot.';
      }
      return this.processMessage(userId, text, false, spaceId, undefined);
    }

    // pairing (default)
    if (this.pairingStore.isAllowed(this.internalChannelId, userId)) {
      return this.processMessage(userId, text, false, spaceId, undefined);
    }

    const result = this.pairingStore.requestPairing(this.internalChannelId, userId);
    if (result) {
      return `Your pairing code is: \`${result.code}\`\nSend this code to the bot owner to get access. Codes expire in 1 hour.`;
    }
    return 'A pairing request is already pending. Please wait for the owner to respond.';
  }

  private async handleSpaceMessage(userId: string, spaceId: string, text: string): Promise<string | null> {
    if (!this.config) return null;

    const groupPolicy = this.config.groupPolicy ?? 'open';
    if (groupPolicy === 'disabled') return null;

    if (groupPolicy === 'allowlist') {
      const effectiveAllowFrom = this.config.groupAllowFrom ?? this.config.allowFrom;
      const allowed =
        this.pairingStore.isAllowed(this.internalChannelId, userId) ||
        (effectiveAllowFrom?.includes(userId) ?? false);
      if (!allowed) return null;
    }

    return this.processMessage(userId, text, true, spaceId, spaceId);
  }

  private async processMessage(
    userId: string,
    text: string,
    isSpace: boolean,
    spaceId: string,
    groupId: string | undefined,
  ): Promise<string | null> {
    if (!this.config) return null;

    const chatType = isSpace ? 'group' : 'direct';

    // ── Slash command pre-check ──────────────────────────────────────────────
    const slashSessionKey = this.sessionRouter
      ? resolveSessionKey({
          agentId: this.config.agentId,
          channel: 'googlechat',
          chatType,
          peerId: !isSpace ? userId : undefined,
          groupId: isSpace ? groupId : undefined,
          dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
        })
      : undefined;
    const slashEntry = slashSessionKey && this.sessionRouter
      ? this.sessionRouter.getSessionEntry(slashSessionKey)
      : null;

    const slashResult = handleSlashCommand(text, {
      agentId: this.config.agentId,
      channel: 'googlechat',
      senderId: userId,
      conversationId: slashEntry?.conversationId,
      sessionKey: slashSessionKey,
      convStore: this.convStore,
      sessionRouter: this.sessionRouter,
    });

    if (slashResult.isHandled && slashResult.response) {
      return slashResult.response;
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
          channel: 'googlechat',
          chatType,
          peerId: !isSpace ? userId : undefined,
          groupId: isSpace ? groupId : undefined,
          dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
        });
        this.sessionRouter.resetSession(key, this.config.agentId);
        return '(new conversation started)';
      }

      const resolved = this.sessionRouter.resolveConversation({
        agentId: this.config.agentId,
        channel: 'googlechat',
        chatType,
        peerId: !isSpace ? userId : undefined,
        groupId: isSpace ? groupId : undefined,
      });

      if (!this.sessionRouter.isSendAllowed(resolved.entry)) return null;

      conversationId = resolved.conversationId;
      const msgs = this.convStore.getMessages(conversationId);
      const historyLimit = this.config.historyLimit ?? 50;
      const limited = historyLimit > 0 ? msgs.slice(-historyLimit) : msgs;
      contextMessages = limited.map(m => ({ role: m.role, content: m.content }));

    } else if (this.convStore) {
      if (isReset) return '(new conversation started)';
      const conv = this.convStore.createConversation(this.config.agentId);
      conversationId = conv.id;
      const msgs = this.convStore.getMessages(conversationId);
      const historyLimit = this.config.historyLimit ?? 50;
      const limited = historyLimit > 0 ? msgs.slice(-historyLimit) : msgs;
      contextMessages = limited.map(m => ({ role: m.role, content: m.content }));
    } else {
      if (isReset) return '(new conversation started)';
    }

    try {
      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input: text,
        contextOverride: `[Google Chat from ${userId}${isSpace ? ` in ${spaceId}` : ''}]`,
      }, { contextMessages });

      const output = run.output ?? 'Sorry, I could not process your message.';

      if (this.convStore && conversationId) {
        this.convStore.addMessage(conversationId, 'user', text);
        this.convStore.addMessage(conversationId, 'assistant', output, run.modelUsed);
      }

      // Google Chat's synchronous reply limit is ~4000 chars; send only the first chunk
      // as a synchronous reply. Additional chunks would need async REST calls.
      const chunks = splitIntoChunks(
        output,
        this.config.textChunkLimit ?? MAX_REPLY_LEN,
        this.config.chunkMode ?? 'length',
      );

      // Send additional chunks asynchronously if needed
      if (chunks.length > 1 && this.config.serviceAccountJson) {
        for (let i = 1; i < chunks.length; i++) {
          void this.sendToSpace(spaceId, chunks[i]!);
        }
      }

      return chunks[0] ?? output;
    } catch (err) {
      logger.error('[googlechat] Agent run failed', { err: err instanceof Error ? err.message : String(err) });
      return 'Agent error — could not process your message.';
    }
  }

  // ── REST send (for overflow chunks) ──────────────────────────────────────

  private async sendToSpace(spaceName: string, text: string): Promise<void> {
    if (!this.config?.serviceAccountJson) return;
    try {
      const token = await this.getAccessToken();
      if (!token) return;
      await fetch(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });
    } catch (err) {
      logger.error('[googlechat] Failed to send message to space', { err: err instanceof Error ? err.message : String(err) });
    }
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 60_000) {
      return this.tokenCache.token;
    }

    if (!this.config?.serviceAccountJson) return null;

    try {
      // Parse the service account key (file path or inline JSON)
      let keyJson: Record<string, string>;
      const raw = this.config.serviceAccountJson.trim();
      if (raw.startsWith('{')) {
        keyJson = JSON.parse(raw) as Record<string, string>;
      } else {
        const { readFileSync } = await import('fs');
        keyJson = JSON.parse(readFileSync(raw, 'utf-8')) as Record<string, string>;
      }

      // Build a JWT and exchange for an access token
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const claim = Buffer.from(JSON.stringify({
        iss: keyJson['client_email'],
        scope: 'https://www.googleapis.com/auth/chat.bot',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      })).toString('base64url');

      const { createSign } = await import('crypto');
      const sign = createSign('RSA-SHA256');
      sign.update(`${header}.${claim}`);
      const sig = sign.sign(keyJson['private_key']!).toString('base64url');
      const jwt = `${header}.${claim}.${sig}`;

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
      });
      const data = await res.json() as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;

      this.tokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      };
      return this.tokenCache.token;
    } catch (err) {
      logger.error('[googlechat] Failed to get access token', { err: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }
}
