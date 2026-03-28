// ─── MattermostInbound ────────────────────────────────────────────────────────
//
// Mattermost inbound channel using the Mattermost WebSocket driver.
// Connects to a Mattermost server via WebSocket for real-time event delivery.
//
// No npm package required — uses the Node built-in WebSocket (Node 22+) or the
// optional 'ws' package if available.
//
// Setup:
//   1. Create a Bot Account or Personal Access Token in your Mattermost server
//   2. Add the bot to the channels you want it to monitor
//   3. Configure with serverUrl, token, agentId
//
// Behaviour:
//   - Connects via WebSocket to Mattermost's real-time events endpoint
//   - Filters posted events for direct messages and channel messages
//   - Routes messages to the configured agent via the orchestrator
//   - dmPolicy/groupPolicy enforcement with pairing store
//   - SessionRouter integration for conversation continuity
//   - Reconnects on disconnect with exponential backoff (max 5 attempts)
//

import type { AgentOrchestrator } from '@krythor/core';
import type { ConversationStore } from '@krythor/memory';
import { resolveSessionKey } from '@krythor/memory';
import type { DmPairingStore } from './DmPairingStore.js';
import type { SessionRouter } from './SessionRouter.js';
import { handleSlashCommand } from './InboundSlashCommands.js';
import { logger } from './logger.js';

const MAX_REPLY_LEN = 4_000;

export interface MattermostInboundConfig {
  serverUrl: string;    // e.g. https://mattermost.example.com
  token: string;        // Bot token or Personal Access Token
  agentId: string;
  enabled: boolean;
  /** Only respond in these channel IDs. If empty, respond in all accessible channels. */
  channelIds?: string[];
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  groupAllowFrom?: string[];
  resetTriggers?: string[];
  historyLimit?: number;
  textChunkLimit?: number;
  chunkMode?: 'length' | 'newline'
}

// ── Minimal WebSocket interface ──────────────────────────────────────────────

interface WS {
  on(event: 'open', fn: () => void): this;
  on(event: 'close', fn: (code: number, reason: Buffer | string) => void): this;
  on(event: 'error', fn: (err: Error) => void): this;
  on(event: 'message', fn: (data: Buffer | string) => void): this;
  send(data: string): void;
  terminate(): void;
  readyState: number;
}

type WSConstructor = new (url: string, opts?: object) => WS;

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

// ── MattermostInbound ─────────────────────────────────────────────────────────

export class MattermostInbound {
  private config: MattermostInboundConfig | null = null;
  private orchestrator: AgentOrchestrator;
  private pairingStore: DmPairingStore;
  private convStore: ConversationStore | null;
  private sessionRouter: SessionRouter | null;

  private ws: WS | null = null;
  private running = false;
  private botUserId: string | null = null;
  private reconnectCount = 0;
  private readonly MAX_RECONNECTS = 5;
  private seqNum = 1;

  private readonly channelId = 'mattermost';

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

  configure(cfg: MattermostInboundConfig): void {
    this.config = cfg;
  }

  getConfig(): MattermostInboundConfig | null {
    return this.config ? { ...this.config, token: '***' } : null;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config?.enabled) {
      return { ok: false, error: 'Mattermost inbound is not configured or disabled' };
    }
    if (this.running) return { ok: true };

    // Resolve bot user ID first
    try {
      const meRes = await fetch(`${this.config.serverUrl}/api/v4/users/me`, {
        headers: { Authorization: `Bearer ${this.config.token}` },
      });
      if (!meRes.ok) {
        return { ok: false, error: `Mattermost auth failed: HTTP ${meRes.status}` };
      }
      const me = await meRes.json() as { id: string };
      this.botUserId = me.id;
    } catch (err) {
      return { ok: false, error: `Mattermost auth error: ${err instanceof Error ? err.message : String(err)}` };
    }

    return this.connect();
  }

  stop(): void {
    this.reconnectCount = this.MAX_RECONNECTS; // Prevent auto-reconnect
    if (this.ws) {
      try { this.ws.terminate(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.running = false;
    logger.info('[mattermost] Stopped');
  }

  // ── WebSocket connection ───────────────────────────────────────────────────

  private async connect(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config) return { ok: false, error: 'Not configured' };

    // Try native WebSocket (Node 22+) first, fall back to 'ws' package
    let WSClass: WSConstructor | null = null;
    try {
      // Node 22+ has WebSocket globally
      if (typeof (globalThis as Record<string, unknown>)['WebSocket'] !== 'undefined') {
        WSClass = (globalThis as Record<string, unknown>)['WebSocket'] as WSConstructor;
      }
    } catch { /* not available */ }

    if (!WSClass) {
      type DynImport = (m: string) => Promise<{ default?: WSConstructor; WebSocket?: WSConstructor }>;
      const wsModule = await (Function('m', 'return import(m)') as DynImport)('ws').catch(() => null);
      WSClass = wsModule?.default ?? wsModule?.WebSocket ?? null;
    }

    if (!WSClass) {
      return {
        ok: false,
        error: 'WebSocket not available. Install ws: npm install ws',
      };
    }

    const wsUrl = this.config.serverUrl.replace(/^http/, 'ws') + '/api/v4/websocket';

    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const ws = new (WSClass as WSConstructor)(wsUrl, {
        headers: { Authorization: `Bearer ${this.config!.token}` },
      });

      const connectTimeout = setTimeout(() => {
        ws.terminate();
        resolve({ ok: false, error: 'WebSocket connection timed out after 10s' });
      }, 10_000);

      ws.on('open', () => {
        clearTimeout(connectTimeout);
        this.ws = ws;
        this.running = true;
        this.reconnectCount = 0;

        // Authenticate via the WebSocket auth challenge
        this.wsSend({
          seq: this.seqNum++,
          action: 'authentication_challenge',
          data: { token: this.config!.token },
        });

        logger.info('[mattermost] WebSocket connected', {
          serverUrl: this.config?.serverUrl,
          botUserId: this.botUserId,
        });
        resolve({ ok: true });
      });

      ws.on('error', (err) => {
        clearTimeout(connectTimeout);
        logger.error('[mattermost] WebSocket error', { err: err.message });
        if (!this.running) {
          resolve({ ok: false, error: `Mattermost WebSocket error: ${err.message}` });
        }
      });

      ws.on('close', () => {
        this.running = false;
        this.ws = null;

        if (this.reconnectCount < this.MAX_RECONNECTS && this.config?.enabled) {
          this.reconnectCount++;
          const delay = Math.min(Math.pow(2, this.reconnectCount) * 1_000, 30_000);
          logger.warn('[mattermost] Disconnected — reconnecting', { attempt: this.reconnectCount, delay });
          setTimeout(() => { void this.connect(); }, delay);
        } else {
          logger.error('[mattermost] Max reconnects reached or stopped');
        }
      });

      ws.on('message', (data) => {
        const raw = typeof data === 'string' ? data : (data as Buffer).toString('utf-8');
        void this.onMessage(raw);
      });
    });
  }

  private wsSend(payload: Record<string, unknown>): void {
    if (!this.ws || !this.running) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err) {
      logger.warn('[mattermost] Failed to send WS message', { err: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── Event handling ─────────────────────────────────────────────────────────

  private async onMessage(raw: string): Promise<void> {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (event['event'] !== 'posted') return;

    const data = event['data'] as Record<string, unknown> | undefined;
    if (!data) return;

    let post: Record<string, unknown>;
    try {
      post = JSON.parse(data['post'] as string) as Record<string, unknown>;
    } catch {
      return;
    }

    // Ignore own messages
    if (post['user_id'] === this.botUserId) return;

    const text = (post['message'] as string | undefined)?.trim();
    if (!text) return;

    const postChannelId = post['channel_id'] as string | undefined;
    const channelType = data['channel_type'] as string | undefined; // 'D' = direct, 'O'/'P' = channel
    const userId = post['user_id'] as string | undefined;

    if (!postChannelId || !userId) return;

    // Channel filter
    if (this.config?.channelIds?.length && !this.config.channelIds.includes(postChannelId)) {
      return;
    }

    const isDM = channelType === 'D';

    if (isDM) {
      await this.handleDmMessage(userId, text, postChannelId);
    } else {
      await this.handleChannelMessage(userId, postChannelId, text);
    }
  }

  private async handleDmMessage(userId: string, text: string, channelId: string): Promise<void> {
    if (!this.config) return;

    const dmPolicy = this.config.dmPolicy ?? 'pairing';
    if (dmPolicy === 'disabled') return;

    if (dmPolicy === 'open') {
      await this.processMessage(userId, text, false, channelId, undefined);
      return;
    }

    if (dmPolicy === 'allowlist') {
      const allowed =
        this.pairingStore.isAllowed(this.channelId, userId) ||
        (this.config.allowFrom?.includes(userId) ?? false);
      if (!allowed) {
        await this.postMessage(channelId, 'You are not authorized to message this bot.');
        return;
      }
      await this.processMessage(userId, text, false, channelId, undefined);
      return;
    }

    // pairing (default)
    if (this.pairingStore.isAllowed(this.channelId, userId)) {
      await this.processMessage(userId, text, false, channelId, undefined);
      return;
    }

    const result = this.pairingStore.requestPairing(this.channelId, userId);
    if (result) {
      await this.postMessage(channelId, `Your pairing code is: \`${result.code}\`\nSend this code to the bot owner to get access. Codes expire in 1 hour.`);
    } else {
      await this.postMessage(channelId, 'A pairing request is already pending. Please wait for the owner to respond.');
    }
  }

  private async handleChannelMessage(userId: string, postChannelId: string, text: string): Promise<void> {
    if (!this.config) return;

    const groupPolicy = this.config.groupPolicy ?? 'open';
    if (groupPolicy === 'disabled') return;

    if (groupPolicy === 'allowlist') {
      const effectiveAllowFrom = this.config.groupAllowFrom ?? this.config.allowFrom;
      const allowed =
        this.pairingStore.isAllowed(this.channelId, userId) ||
        (effectiveAllowFrom?.includes(userId) ?? false);
      if (!allowed) return;
    }

    await this.processMessage(userId, text, true, postChannelId, postChannelId);
  }

  private async processMessage(
    userId: string,
    text: string,
    isChannel: boolean,
    replyChannelId: string,
    groupId: string | undefined,
  ): Promise<void> {
    if (!this.config) return;

    const chatType = isChannel ? 'group' : 'direct';

    // ── Slash command pre-check ──────────────────────────────────────────────
    const slashSessionKey = this.sessionRouter
      ? resolveSessionKey({
          agentId: this.config.agentId,
          channel: 'mattermost',
          chatType,
          peerId: !isChannel ? userId : undefined,
          groupId: isChannel ? groupId : undefined,
          dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
        })
      : undefined;
    const slashEntry = slashSessionKey && this.sessionRouter
      ? this.sessionRouter.getSessionEntry(slashSessionKey)
      : null;

    const slashResult = handleSlashCommand(text, {
      agentId: this.config.agentId,
      channel: 'mattermost',
      senderId: userId,
      conversationId: slashEntry?.conversationId,
      sessionKey: slashSessionKey,
      convStore: this.convStore,
      sessionRouter: this.sessionRouter,
    });

    if (slashResult.isHandled && slashResult.response) {
      await this.postMessage(replyChannelId, slashResult.response);
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
          channel: 'mattermost',
          chatType,
          peerId: !isChannel ? userId : undefined,
          groupId: isChannel ? groupId : undefined,
          dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
        });
        this.sessionRouter.resetSession(key, this.config.agentId);
        await this.postMessage(replyChannelId, '(new conversation started)');
        return;
      }

      const resolved = this.sessionRouter.resolveConversation({
        agentId: this.config.agentId,
        channel: 'mattermost',
        chatType,
        peerId: !isChannel ? userId : undefined,
        groupId: isChannel ? groupId : undefined,
      });

      if (!this.sessionRouter.isSendAllowed(resolved.entry)) return;

      conversationId = resolved.conversationId;
      const msgs = this.convStore.getMessages(conversationId);
      const historyLimit = this.config.historyLimit ?? 50;
      const limited = historyLimit > 0 ? msgs.slice(-historyLimit) : msgs;
      contextMessages = limited.map(m => ({ role: m.role, content: m.content }));

    } else if (this.convStore) {
      if (isReset) {
        await this.postMessage(replyChannelId, '(new conversation started)');
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
        await this.postMessage(replyChannelId, '(new conversation started)');
        return;
      }
    }

    try {
      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input: text,
        contextOverride: `[Mattermost from user ${userId}${isChannel ? ` in channel ${groupId}` : ''}]`,
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
        await this.postMessage(replyChannelId, chunk);
      }
    } catch (err) {
      logger.error('[mattermost] Agent run failed', { err: err instanceof Error ? err.message : String(err) });
      await this.postMessage(replyChannelId, 'Agent error — could not process your message.');
    }
  }

  // ── REST API helpers ────────────────────────────────────────────────────────

  private async postMessage(channelId: string, message: string): Promise<void> {
    if (!this.config) return;
    try {
      await fetch(`${this.config.serverUrl}/api/v4/posts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel_id: channelId, message }),
      });
    } catch (err) {
      logger.error('[mattermost] Failed to post message', { err: err instanceof Error ? err.message : String(err) });
    }
  }
}
