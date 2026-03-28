// ─── SignalInbound ─────────────────────────────────────────────────────────────
//
// Signal inbound channel using signal-cli JSON-RPC daemon mode.
// No npm package required — communicates with a locally-running signal-cli
// process over a Unix socket or TCP port.
//
// Setup:
//   1. Install signal-cli: https://github.com/AsamK/signal-cli/releases
//   2. Register or link a number:
//      signal-cli -u +15551234567 register
//      signal-cli -u +15551234567 verify <code>
//   3. Start the daemon:
//      signal-cli -u +15551234567 jsonRpc
//      (or with a socket: signal-cli --socket /tmp/signal.sock -u +15551234567 jsonRpc)
//   4. Configure via ChatChannelRegistry with phoneNumber and the daemon address
//
// Behaviour:
//   - Connects to signal-cli JSON-RPC daemon via TCP (host:port) or Unix socket path
//   - Listens for receive events and routes to the configured agent
//   - Replies to the sender (or group) via signal-cli sendMessage RPC call
//   - dmPolicy/groupPolicy enforcement with pairing store
//   - SessionRouter integration for conversation continuity
//   - Reconnects on disconnect with exponential backoff (max 5 attempts)
//

import { createConnection, Socket } from 'net';
import type { AgentOrchestrator } from '@krythor/core';
import type { ConversationStore } from '@krythor/memory';
import { resolveSessionKey } from '@krythor/memory';
import type { DmPairingStore } from './DmPairingStore.js';
import type { SessionRouter } from './SessionRouter.js';
import { handleSlashCommand } from './InboundSlashCommands.js';
import { logger } from './logger.js';

const MAX_REPLY_LEN = 4_000;

export interface SignalInboundConfig {
  phoneNumber: string;       // Registered Signal number, e.g. +15551234567
  agentId: string;
  enabled: boolean;
  /** TCP connection: host defaults to '127.0.0.1' */
  host?: string;
  /** TCP port for the JSON-RPC daemon. Mutually exclusive with socketPath. */
  port?: number;
  /** Unix socket path for the JSON-RPC daemon. Takes precedence over host/port. */
  socketPath?: string;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  groupAllowFrom?: string[];
  resetTriggers?: string[];
  historyLimit?: number;
  textChunkLimit?: number;
  chunkMode?: 'length' | 'newline';
}

// ── JSON-RPC types ─────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  method?: string;  // server-sent notifications have a method but no id
  result?: unknown;
  error?: { code: number; message: string };
  params?: unknown; // notifications carry params, not result
}

interface SignalReceiveEvent {
  envelope: {
    source?: string;         // sender number
    sourceNumber?: string;
    sourceName?: string;
    sourceDevice?: number;
    timestamp: number;
    dataMessage?: {
      message?: string;
      groupInfo?: {
        groupId?: string;
        type?: string;
      };
    };
  };
  account?: string;
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

// ── SignalInbound ─────────────────────────────────────────────────────────────

export class SignalInbound {
  private config: SignalInboundConfig | null = null;
  private orchestrator: AgentOrchestrator;
  private pairingStore: DmPairingStore;
  private convStore: ConversationStore | null;
  private sessionRouter: SessionRouter | null;

  private socket: Socket | null = null;
  private running = false;
  private reconnectCount = 0;
  private readonly MAX_RECONNECTS = 5;

  private nextId = 1;
  private pendingRpcs = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
  private lineBuffer = '';

  private readonly channelId = 'signal';

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

  configure(cfg: SignalInboundConfig): void {
    this.config = cfg;
  }

  getConfig(): SignalInboundConfig | null {
    return this.config ? { ...this.config } : null;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config?.enabled) {
      return { ok: false, error: 'Signal inbound is not configured or disabled' };
    }
    if (this.running) return { ok: true };

    return this.connect();
  }

  stop(): void {
    this.reconnectCount = this.MAX_RECONNECTS; // Prevent auto-reconnect
    if (this.socket) {
      try { this.socket.destroy(); } catch { /* ignore */ }
      this.socket = null;
    }
    this.running = false;
    this.pendingRpcs.clear();
    logger.info('[signal] Stopped');
  }

  // ── Connection ─────────────────────────────────────────────────────────────

  private connect(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      if (!this.config) { resolve({ ok: false, error: 'Not configured' }); return; }

      const sock = this.config.socketPath
        ? createConnection({ path: this.config.socketPath })
        : createConnection({ host: this.config.host ?? '127.0.0.1', port: this.config.port ?? 7583 });

      const connectTimeout = setTimeout(() => {
        sock.destroy();
        resolve({ ok: false, error: 'Connection timed out after 10s' });
      }, 10_000);

      sock.once('connect', () => {
        clearTimeout(connectTimeout);
        this.socket = sock;
        this.running = true;
        this.reconnectCount = 0;
        this.lineBuffer = '';
        logger.info('[signal] Connected to signal-cli daemon', {
          address: this.config?.socketPath ?? `${this.config?.host ?? '127.0.0.1'}:${this.config?.port ?? 7583}`,
        });
        resolve({ ok: true });
      });

      sock.once('error', (err) => {
        clearTimeout(connectTimeout);
        logger.error('[signal] Connection error', { err: err.message });
        resolve({ ok: false, error: `signal-cli connection failed: ${err.message}` });
      });

      sock.on('data', (data: Buffer) => {
        this.lineBuffer += data.toString('utf-8');
        const lines = this.lineBuffer.split('\n');
        this.lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) this.onLine(trimmed);
        }
      });

      sock.on('close', () => {
        this.running = false;
        this.socket = null;
        // Reject any pending RPCs
        for (const [, pending] of this.pendingRpcs) {
          pending.reject(new Error('Connection closed'));
        }
        this.pendingRpcs.clear();

        if (this.reconnectCount < this.MAX_RECONNECTS && this.config?.enabled) {
          this.reconnectCount++;
          const delay = Math.min(Math.pow(2, this.reconnectCount) * 1_000, 30_000);
          logger.warn('[signal] Disconnected — reconnecting', { attempt: this.reconnectCount, delay });
          setTimeout(() => { void this.connect(); }, delay);
        } else {
          logger.error('[signal] Max reconnects reached or stopped', { reconnectCount: this.reconnectCount });
        }
      });
    });
  }

  // ── JSON-RPC protocol ──────────────────────────────────────────────────────

  private onLine(line: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line) as JsonRpcResponse;
    } catch {
      logger.warn('[signal] Unparseable line from daemon', { line: line.slice(0, 200) });
      return;
    }

    // Server-sent notification (receive event)
    if (msg.method === 'receive' && msg.params !== undefined) {
      void this.handleReceiveEvent(msg.params as SignalReceiveEvent);
      return;
    }

    // Response to a pending RPC call
    if (msg.id !== undefined) {
      const pending = this.pendingRpcs.get(msg.id);
      if (pending) {
        this.pendingRpcs.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  private sendRpc(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.socket || !this.running) {
        reject(new Error('Not connected to signal-cli'));
        return;
      }
      const id = this.nextId++;
      const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      this.pendingRpcs.set(id, { resolve, reject });
      this.socket.write(JSON.stringify(req) + '\n', 'utf-8');
    });
  }

  private async sendMessage(recipient: string, message: string, groupId?: string): Promise<void> {
    try {
      const params: Record<string, unknown> = { message };
      if (groupId) {
        params['groupId'] = groupId;
      } else {
        params['recipient'] = [recipient];
      }
      await this.sendRpc('send', params);
    } catch (err) {
      logger.error('[signal] Failed to send message', {
        err: err instanceof Error ? err.message : String(err),
        recipient,
      });
    }
  }

  // ── Message handling ───────────────────────────────────────────────────────

  private async handleReceiveEvent(event: SignalReceiveEvent): Promise<void> {
    if (!this.config) return;

    const envelope = event.envelope;
    const dataMsg = envelope.dataMessage;
    if (!dataMsg?.message) return;

    const text = dataMsg.message.trim();
    if (!text) return;

    const sender = envelope.sourceNumber ?? envelope.source;
    if (!sender) return;

    const groupId = dataMsg.groupInfo?.groupId;
    const isGroup = Boolean(groupId);

    if (isGroup) {
      await this.handleGroupMessage(sender, groupId!, text);
    } else {
      await this.handleDmMessage(sender, text);
    }
  }

  private async handleDmMessage(sender: string, text: string): Promise<void> {
    if (!this.config) return;

    const dmPolicy = this.config.dmPolicy ?? 'pairing';
    if (dmPolicy === 'disabled') return;

    if (dmPolicy === 'open') {
      await this.processMessage(sender, text, false, sender, undefined);
      return;
    }

    if (dmPolicy === 'allowlist') {
      const allowed =
        this.pairingStore.isAllowed(this.channelId, sender) ||
        (this.config.allowFrom?.includes(sender) ?? false);
      if (!allowed) {
        await this.sendMessage(sender, 'You are not authorized to message this bot.');
        return;
      }
      await this.processMessage(sender, text, false, sender, undefined);
      return;
    }

    // pairing (default)
    if (this.pairingStore.isAllowed(this.channelId, sender)) {
      await this.processMessage(sender, text, false, sender, undefined);
      return;
    }

    const result = this.pairingStore.requestPairing(this.channelId, sender);
    if (result) {
      await this.sendMessage(
        sender,
        `Your pairing code is: ${result.code}\nSend this code to the bot owner to get access. Codes expire in 1 hour.`,
      );
    } else {
      await this.sendMessage(sender, 'A pairing request is already pending. Please wait for the owner to respond.');
    }
  }

  private async handleGroupMessage(sender: string, groupId: string, text: string): Promise<void> {
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

    await this.processMessage(sender, text, true, sender, groupId);
  }

  private async processMessage(
    userId: string,
    text: string,
    isGroup: boolean,
    replyTo: string,
    groupId: string | undefined,
  ): Promise<void> {
    if (!this.config) return;

    const chatType = isGroup ? 'group' : 'direct';

    // ── Slash command pre-check ──────────────────────────────────────────────
    const slashSessionKey = this.sessionRouter
      ? resolveSessionKey({
          agentId: this.config.agentId,
          channel: 'signal',
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
      channel: 'signal',
      senderId: userId,
      conversationId: slashEntry?.conversationId,
      sessionKey: slashSessionKey,
      convStore: this.convStore,
      sessionRouter: this.sessionRouter,
    });

    if (slashResult.isHandled && slashResult.response) {
      await this.sendMessage(replyTo, slashResult.response, groupId);
      return;
    }

    // Reset trigger check
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
          channel: 'signal',
          chatType,
          peerId: !isGroup ? userId : undefined,
          groupId: isGroup ? groupId : undefined,
          dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
        });
        this.sessionRouter.resetSession(key, this.config.agentId);
        await this.sendMessage(replyTo, '(new conversation started)', groupId);
        return;
      }

      const resolved = this.sessionRouter.resolveConversation({
        agentId: this.config.agentId,
        channel: 'signal',
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
        await this.sendMessage(replyTo, '(new conversation started)', groupId);
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
        await this.sendMessage(replyTo, '(new conversation started)', groupId);
        return;
      }
    }

    try {
      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input: text,
        contextOverride: `[Signal from ${userId}${isGroup ? ` in group ${groupId}` : ''}]`,
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
        await this.sendMessage(replyTo, chunk, groupId);
      }
    } catch (err) {
      logger.error('[signal] Agent run failed', { err: err instanceof Error ? err.message : String(err) });
      await this.sendMessage(replyTo, 'Agent error — could not process your message.', groupId);
    }
  }
}
