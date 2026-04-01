// ─── WebChatInbound ───────────────────────────────────────────────────────────
//
// Webchat inbound channel — routes messages from the /chat web UI through
// the same policy, rate-limiting, session, and history pipeline used by all
// other inbound channels (Telegram, Discord, etc.).
//
// Transport: HTTP POST /api/webchat/message
//   No external dependencies, no background polling loop — messages arrive via
//   the gateway's own HTTP server. The channel "runs" as long as it is enabled
//   and configured; stop() disables message processing.
//
// Session continuity:
//   Each browser session is identified by a clientId header or cookie sent by
//   the /chat page.  Messages from the same clientId are routed to the same
//   conversation so history is preserved across page refreshes.
//
// Policies:
//   - senderRateLimit  — per-clientId message rate limiting
//   - resetTriggers    — keywords that start a new conversation
//   - historyLimit     — max context messages injected per turn
//   - textChunkLimit   — max chars per response chunk
//   - chunkMode        — 'length' | 'newline' chunk splitting
//

import type { AgentOrchestrator } from '@krythor/core';
import type { ConversationStore } from '@krythor/memory';
import { resolveSessionKey } from '@krythor/memory';
import type { SessionRouter } from './SessionRouter.js';
import { SenderRateLimiter } from './SenderRateLimiter.js';
import { handleSlashCommand } from './InboundSlashCommands.js';
import { logger } from './logger.js';

const MAX_REPLY_LEN = 8000;

export interface WebChatInboundConfig {
  agentId: string;
  enabled: boolean;
  resetTriggers?: string[];
  /** Max context messages injected per turn. Default: 50. 0 = disabled. */
  historyLimit?: number;
  /** Max chars per response chunk. Default: 8000. */
  textChunkLimit?: number;
  /** Split strategy: 'length' (default) or 'newline'. */
  chunkMode?: 'length' | 'newline';
  /** Per-sender rate limiting. Default: 30 messages per 60 s. */
  senderRateLimit?: { maxMessages?: number; windowMs?: number };
}

export interface WebChatMessageResult {
  output: string;
  conversationId?: string;
  isReset?: boolean;
}

/**
 * Split text into chunks no longer than maxLen characters.
 * Mirrors the same logic used in TelegramInbound.
 */
function splitIntoChunks(text: string, maxLen: number, mode: 'length' | 'newline'): string[] {
  if (text.length <= maxLen) return [text];

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
        if (!inFence) { inFence = true; fenceLang = (fenceMatch[2] ?? '').trim(); }
        else { inFence = false; fenceLang = ''; }
      }
      const candidate = current ? `${current}\n${line}` : line;
      if (candidate.length > maxLen && current.length > 0) {
        flush();
        current = inFence ? `\`\`\`${fenceLang}\n${line}` : line;
      } else {
        current = candidate;
      }
    }
    flush();
    return result.filter(c => c.length > 0);
  }

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
        if (para.length > maxLen) { chunks.push(...fenceAwareSplit(para)); current = ''; }
        else { current = para; }
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  return fenceAwareSplit(text);
}

export class WebChatInbound {
  private config: WebChatInboundConfig | null = null;
  private readonly orchestrator: AgentOrchestrator;
  private readonly convStore: ConversationStore | null;
  private readonly sessionRouter: SessionRouter | null;
  private running = false;
  private rateLimiter: SenderRateLimiter | null = null;

  constructor(
    orchestrator: AgentOrchestrator,
    convStore: ConversationStore | null = null,
    sessionRouter: SessionRouter | null = null,
  ) {
    this.orchestrator = orchestrator;
    this.convStore = convStore;
    this.sessionRouter = sessionRouter;
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  configure(cfg: WebChatInboundConfig): void {
    this.config = cfg;
    this.rateLimiter?.destroy();
    this.rateLimiter = new SenderRateLimiter(
      cfg.senderRateLimit ?? { maxMessages: 30, windowMs: 60_000 },
    );
  }

  getConfig(): WebChatInboundConfig | null {
    return this.config ? { ...this.config } : null;
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config?.enabled) {
      return { ok: false, error: 'WebChat inbound is not configured or disabled' };
    }
    if (!this.config.agentId) {
      return { ok: false, error: 'WebChat inbound requires an agentId' };
    }
    this.running = true;
    logger.info('[webchat] Channel started', { agentId: this.config.agentId });
    return { ok: true };
  }

  stop(): void {
    if (this.running) {
      this.running = false;
      this.rateLimiter?.destroy();
      this.rateLimiter = null;
      logger.info('[webchat] Channel stopped');
    }
  }

  // ── Message handling ───────────────────────────────────────────────────────

  /**
   * Handle an incoming message from the /chat web UI.
   *
   * @param clientId    Stable browser session identifier (cookie or header).
   * @param text        The message text.
   * @param conversationId  Existing conversation ID from a prior turn (if any).
   * @returns           { output, conversationId, isReset }
   */
  async handleMessage(
    clientId: string,
    text: string,
    conversationId?: string,
  ): Promise<WebChatMessageResult> {
    if (!this.config || !this.running) {
      return { output: 'WebChat channel is not active.' };
    }

    // Rate limiting
    if (this.rateLimiter && !this.rateLimiter.allowed('webchat', clientId)) {
      logger.info('[webchat] Sender rate-limited', { clientId });
      return { output: 'You are sending messages too quickly. Please wait a moment.' };
    }

    try {
      // Slash command handling
      const slashResult = handleSlashCommand(text, {
        agentId:       this.config.agentId,
        channel:       'webchat',
        senderId:      clientId,
        convStore:     this.convStore,
        sessionRouter: this.sessionRouter,
      });

      if (slashResult.isHandled) {
        return {
          output:         slashResult.response ?? '(command handled)',
          conversationId: conversationId,
          isReset:        slashResult.isReset,
        };
      }

      // Reset trigger check
      const isReset = slashResult.isReset || (this.sessionRouter
        ? this.sessionRouter.isResetTrigger(text)
        : ['/new', '/reset', ...(this.config.resetTriggers ?? [])].some(
            t => text.trim().toLowerCase() === t.toLowerCase(),
          ));

      let activeConvId: string | undefined = conversationId;
      let contextMessages: Array<{ role: string; content: string }> = [];

      if (this.sessionRouter && this.convStore) {
        if (isReset) {
          const key = resolveSessionKey({
            agentId:  this.config.agentId,
            channel:  'webchat',
            chatType: 'direct',
            peerId:   clientId,
            dmScope:  this.sessionRouter.getConfig().dmScope ?? 'main',
          });
          activeConvId = this.sessionRouter.resetSession(key, this.config.agentId);
          return { output: '(new conversation started)', conversationId: activeConvId, isReset: true };
        }

        const resolved = this.sessionRouter.resolveConversation({
          agentId:     this.config.agentId,
          channel:     'webchat',
          chatType:    'direct',
          peerId:      clientId,
          displayName: clientId,
        });

        activeConvId = resolved.conversationId;
        const msgs = this.convStore.getMessages(activeConvId);
        const historyLimit = this.config.historyLimit ?? 50;
        const limited = historyLimit > 0 ? msgs.slice(-historyLimit) : msgs;
        contextMessages = limited.map(m => ({ role: m.role, content: m.content }));

      } else if (this.convStore) {
        if (isReset) {
          return { output: '(new conversation started)', isReset: true };
        }
        // Reuse existing conversationId if provided; otherwise create a new one
        if (!activeConvId) {
          const conv = this.convStore.createConversation(this.config.agentId);
          activeConvId = conv.id;
        }
        const msgs = this.convStore.getMessages(activeConvId);
        const historyLimit = this.config.historyLimit ?? 50;
        const limited = historyLimit > 0 ? msgs.slice(-historyLimit) : msgs;
        contextMessages = limited.map(m => ({ role: m.role, content: m.content }));

      } else {
        if (isReset) {
          return { output: '(new conversation started)', isReset: true };
        }
      }

      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input:           text,
        contextOverride: `[WebChat session: ${clientId}]`,
      }, { contextMessages });

      const output = run.output ?? 'Sorry, I could not process your message.';

      // Persist exchange
      if (this.convStore && activeConvId) {
        this.convStore.addMessage(activeConvId, 'user', text);
        this.convStore.addMessage(activeConvId, 'assistant', output, run.modelUsed);
      }

      // Chunk the output for consistency — callers may join chunks or deliver them
      const chunks = splitIntoChunks(
        output,
        this.config.textChunkLimit ?? MAX_REPLY_LEN,
        this.config.chunkMode ?? 'length',
      );

      return {
        output:         chunks.join('\n\n'),
        conversationId: activeConvId,
      };

    } catch (err) {
      logger.error('[webchat] Agent run failed', {
        err: err instanceof Error ? err.message : String(err),
        clientId,
      });
      return { output: 'Agent error — could not process your message.' };
    }
  }
}
