// ─── BlueBubblesInbound ───────────────────────────────────────────────────────
//
// BlueBubbles inbound channel — connects to a BlueBubbles server via its
// REST API and WebSocket event stream to receive and reply to iMessages
// (routed through a Mac running BlueBubbles Server).
//
// Setup:
//   1. Install BlueBubbles Server on a Mac: https://bluebubbles.app
//   2. Enable the REST API in BlueBubbles Server settings
//   3. Note your server URL (e.g. http://192.168.1.10:1234) and password
//   4. Configure with serverUrl, password, and agentId
//
// Behaviour:
//   - Authenticates with the BlueBubbles REST API
//   - Connects to the /ws WebSocket endpoint for real-time message events
//   - Processes incoming text messages and routes them to the configured agent
//   - Replies via the BlueBubbles REST API sendMessage endpoint
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

export interface BlueBubblesInboundConfig {
  serverUrl: string;   // e.g. http://192.168.1.10:1234
  password: string;    // BlueBubbles server password
  agentId: string;
  enabled: boolean;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  groupAllowFrom?: string[];
  resetTriggers?: string[];
  historyLimit?: number;
  textChunkLimit?: number;
  chunkMode?: 'length' | 'newline';
}

// ── Minimal WebSocket interface ──────────────────────────────────────────────

interface WS {
  on(event: 'open', fn: () => void): this;
  on(event: 'close', fn: () => void): this;
  on(event: 'error', fn: (err: Error) => void): this;
  on(event: 'message', fn: (data: Buffer | string) => void): this;
  send(data: string): void;
  terminate(): void;
}

type WSConstructor = new (url: string, opts?: object) => WS;

// ── BlueBubbles event types ───────────────────────────────────────────────────

interface BBMessage {
  guid: string;
  text?: string;
  handle?: { address: string };   // sender phone/email
  chatGuid?: string;              // chat identifier
  isFromMe?: boolean;
  dateCreated?: number;
}

interface BBEvent {
  type: string;   // 'new-message', 'updated-message', etc.
  data?: BBMessage;
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

// ── BlueBubblesInbound ────────────────────────────────────────────────────────

export class BlueBubblesInbound {
  private config: BlueBubblesInboundConfig | null = null;
  private orchestrator: AgentOrchestrator;
  private pairingStore: DmPairingStore;
  private convStore: ConversationStore | null;
  private sessionRouter: SessionRouter | null;

  private ws: WS | null = null;
  private running = false;
  private reconnectCount = 0;
  private readonly MAX_RECONNECTS = 5;

  private readonly channelId = 'bluebubbles';

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

  configure(cfg: BlueBubblesInboundConfig): void {
    this.config = cfg;
  }

  getConfig(): BlueBubblesInboundConfig | null {
    return this.config ? { ...this.config, password: '***' } : null;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config?.enabled) {
      return { ok: false, error: 'BlueBubbles inbound is not configured or disabled' };
    }
    if (this.running) return { ok: true };

    // Verify connectivity with a quick API ping
    try {
      const res = await fetch(
        `${this.config.serverUrl}/api/v1/ping?password=${encodeURIComponent(this.config.password)}`,
        { signal: AbortSignal.timeout(5_000) },
      );
      if (!res.ok) {
        return { ok: false, error: `BlueBubbles server returned HTTP ${res.status}` };
      }
    } catch (err) {
      return { ok: false, error: `BlueBubbles connection failed: ${err instanceof Error ? err.message : String(err)}` };
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
    logger.info('[bluebubbles] Stopped');
  }

  // ── WebSocket connection ───────────────────────────────────────────────────

  private async connect(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config) return { ok: false, error: 'Not configured' };

    let WSClass: WSConstructor | null = null;
    if (typeof (globalThis as Record<string, unknown>)['WebSocket'] !== 'undefined') {
      WSClass = (globalThis as Record<string, unknown>)['WebSocket'] as WSConstructor;
    }
    if (!WSClass) {
      type DynImport = (m: string) => Promise<{ default?: WSConstructor; WebSocket?: WSConstructor }>;
      const wsModule = await (Function('m', 'return import(m)') as DynImport)('ws').catch(() => null);
      WSClass = wsModule?.default ?? wsModule?.WebSocket ?? null;
    }
    if (!WSClass) {
      return { ok: false, error: 'WebSocket not available. Install ws: npm install ws' };
    }

    const wsUrl = this.config.serverUrl.replace(/^http/, 'ws') +
      `/ws?password=${encodeURIComponent(this.config.password)}`;

    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const ws = new (WSClass as WSConstructor)(wsUrl);
      const connectTimeout = setTimeout(() => { ws.terminate(); resolve({ ok: false, error: 'WebSocket timed out' }); }, 10_000);

      ws.on('open', () => {
        clearTimeout(connectTimeout);
        this.ws = ws;
        this.running = true;
        this.reconnectCount = 0;
        logger.info('[bluebubbles] Connected', { serverUrl: this.config?.serverUrl });
        resolve({ ok: true });
      });

      ws.on('error', (err) => {
        clearTimeout(connectTimeout);
        if (!this.running) {
          resolve({ ok: false, error: `BlueBubbles WS error: ${err.message}` });
        }
      });

      ws.on('close', () => {
        this.running = false;
        this.ws = null;

        if (this.reconnectCount < this.MAX_RECONNECTS && this.config?.enabled) {
          this.reconnectCount++;
          const delay = Math.min(Math.pow(2, this.reconnectCount) * 1_000, 30_000);
          logger.warn('[bluebubbles] Disconnected — reconnecting', { attempt: this.reconnectCount });
          setTimeout(() => { void this.connect(); }, delay);
        } else {
          logger.error('[bluebubbles] Max reconnects reached');
        }
      });

      ws.on('message', (data) => {
        const raw = typeof data === 'string' ? data : (data as Buffer).toString('utf-8');
        void this.onMessage(raw);
      });
    });
  }

  // ── Event handling ─────────────────────────────────────────────────────────

  private async onMessage(raw: string): Promise<void> {
    let event: BBEvent;
    try {
      event = JSON.parse(raw) as BBEvent;
    } catch {
      return;
    }

    if (event.type !== 'new-message') return;
    const msg = event.data;
    if (!msg) return;
    if (msg.isFromMe) return;

    const text = msg.text?.trim();
    if (!text) return;

    const sender = msg.handle?.address;
    if (!sender) return;

    const chatGuid = msg.chatGuid ?? sender;
    const isGroup = chatGuid.startsWith('iMessage;+;') || chatGuid.includes(';chat');

    if (isGroup) {
      await this.handleGroupMessage(sender, chatGuid, text);
    } else {
      await this.handleDmMessage(sender, chatGuid, text);
    }
  }

  private async handleDmMessage(sender: string, chatGuid: string, text: string): Promise<void> {
    if (!this.config) return;

    const dmPolicy = this.config.dmPolicy ?? 'pairing';
    if (dmPolicy === 'disabled') return;

    if (dmPolicy === 'open') {
      await this.processMessage(sender, text, false, chatGuid, undefined);
      return;
    }

    if (dmPolicy === 'allowlist') {
      const allowed =
        this.pairingStore.isAllowed(this.channelId, sender) ||
        (this.config.allowFrom?.includes(sender) ?? false);
      if (!allowed) {
        await this.sendReply(chatGuid, 'You are not authorized to message this bot.');
        return;
      }
      await this.processMessage(sender, text, false, chatGuid, undefined);
      return;
    }

    // pairing (default)
    if (this.pairingStore.isAllowed(this.channelId, sender)) {
      await this.processMessage(sender, text, false, chatGuid, undefined);
      return;
    }

    const result = this.pairingStore.requestPairing(this.channelId, sender);
    if (result) {
      await this.sendReply(chatGuid, `Your pairing code is: ${result.code}\nSend this code to the bot owner to get access. Codes expire in 1 hour.`);
    } else {
      await this.sendReply(chatGuid, 'A pairing request is already pending. Please wait for the owner to respond.');
    }
  }

  private async handleGroupMessage(sender: string, chatGuid: string, text: string): Promise<void> {
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

    await this.processMessage(sender, text, true, chatGuid, chatGuid);
  }

  private async processMessage(
    userId: string,
    text: string,
    isGroup: boolean,
    chatGuid: string,
    groupId: string | undefined,
  ): Promise<void> {
    if (!this.config) return;

    const chatType = isGroup ? 'group' : 'direct';

    // ── Slash command pre-check ──────────────────────────────────────────────
    const slashSessionKey = this.sessionRouter
      ? resolveSessionKey({
          agentId: this.config.agentId,
          channel: 'bluebubbles',
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
      channel: 'bluebubbles',
      senderId: userId,
      conversationId: slashEntry?.conversationId,
      sessionKey: slashSessionKey,
      convStore: this.convStore,
      sessionRouter: this.sessionRouter,
    });

    if (slashResult.isHandled && slashResult.response) {
      await this.sendReply(chatGuid, slashResult.response);
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
          channel: 'bluebubbles',
          chatType,
          peerId: !isGroup ? userId : undefined,
          groupId: isGroup ? groupId : undefined,
          dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
        });
        this.sessionRouter.resetSession(key, this.config.agentId);
        await this.sendReply(chatGuid, '(new conversation started)');
        return;
      }

      const resolved = this.sessionRouter.resolveConversation({
        agentId: this.config.agentId,
        channel: 'bluebubbles',
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
        await this.sendReply(chatGuid, '(new conversation started)');
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
        await this.sendReply(chatGuid, '(new conversation started)');
        return;
      }
    }

    try {
      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input: text,
        contextOverride: `[BlueBubbles/iMessage from ${userId}${isGroup ? ` in ${chatGuid}` : ''}]`,
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
        await this.sendReply(chatGuid, chunk);
      }
    } catch (err) {
      logger.error('[bluebubbles] Agent run failed', { err: err instanceof Error ? err.message : String(err) });
      await this.sendReply(chatGuid, 'Agent error — could not process your message.');
    }
  }

  // ── REST send ─────────────────────────────────────────────────────────────

  private async sendReply(chatGuid: string, message: string): Promise<void> {
    if (!this.config) return;
    try {
      await fetch(`${this.config.serverUrl}/api/v1/message/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatGuid,
          message,
          password: this.config.password,
        }),
      });
    } catch (err) {
      logger.error('[bluebubbles] Failed to send reply', { err: err instanceof Error ? err.message : String(err) });
    }
  }
}
