// ─── SlackInbound ─────────────────────────────────────────────────────────────
//
// Slack inbound channel using @slack/bolt Socket Mode.
// No public URL required — connects via WebSocket to Slack's Socket Mode API.
//
// @slack/bolt is an OPTIONAL dependency — if not installed, start() returns an error.
//
// Setup:
//   1. Install: npm install @slack/bolt
//   2. Create a Slack App at https://api.slack.com/apps
//   3. Enable Socket Mode (Settings > Socket Mode) and generate an App-Level Token (xapp-)
//   4. Add the following OAuth scopes (OAuth & Permissions > Bot Token Scopes):
//      chat:write, im:history, im:read, channels:history, channels:read,
//      groups:history, groups:read, mpim:history, mpim:read
//   5. Enable the Events API and subscribe to events:
//      message.im, message.channels, message.groups, message.mpim, app_mention
//   6. Install the App to your workspace and copy the Bot User OAuth Token (xoxb-)
//
// Behaviour:
//   - Uses Socket Mode for real-time message delivery (no public endpoint needed)
//   - DMs are routed using dmPolicy (pairing/allowlist/open/disabled)
//   - Channel/group messages use groupPolicy (open/allowlist/disabled)
//   - App mentions in channels are always handled when the bot is in the channel
//

import type { AgentOrchestrator } from '@krythor/core';
import type { ConversationStore } from '@krythor/memory';
import { resolveSessionKey } from '@krythor/memory';
import type { DmPairingStore } from './DmPairingStore.js';
import type { SessionRouter } from './SessionRouter.js';
import { handleSlashCommand } from './InboundSlashCommands.js';
import { logger } from './logger.js';

const MAX_REPLY_LEN = 3_000; // Slack message limit is 40,000 but keeping it practical

export interface SlackInboundConfig {
  botToken: string;        // xoxb- OAuth token
  appToken: string;        // xapp- App-Level token for Socket Mode
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

// Minimal type interfaces for @slack/bolt to avoid compile-time dependency
interface BoltApp {
  message(pattern: RegExp | string, handler: BoltMessageHandler): void;
  event(eventName: string, handler: BoltEventHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

type BoltMessageHandler = (params: {
  message: SlackMessage;
  say: (text: string | object) => Promise<void>;
  client: SlackClient;
}) => Promise<void>;

type BoltEventHandler = (params: {
  event: Record<string, unknown>;
  say: (text: string | object) => Promise<void>;
  client: SlackClient;
}) => Promise<void>;

interface SlackClient {
  auth: { test(): Promise<{ user_id: string; bot_id?: string }> };
  conversations: { history(args: object): Promise<{ messages: SlackMessage[] }> };
}

interface SlackMessage {
  type: string;
  subtype?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  channel: string;
  channel_type?: string; // 'im' for DM, 'channel'/'group' for channels
  ts: string;
  thread_ts?: string;
}

/**
 * Split text into chunks no longer than maxLen characters.
 */
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

export class SlackInbound {
  private config: SlackInboundConfig | null = null;
  private orchestrator: AgentOrchestrator;
  private pairingStore: DmPairingStore;
  private convStore: ConversationStore | null;
  private sessionRouter: SessionRouter | null;
  private app: BoltApp | null = null;
  private botUserId: string | null = null;
  private running = false;
  private channelId: string = 'slack';

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

  configure(cfg: SlackInboundConfig): void {
    this.config = cfg;
  }

  getConfig(): SlackInboundConfig | null {
    return this.config
      ? { ...this.config, botToken: '***', appToken: '***' }
      : null;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config?.enabled) {
      return { ok: false, error: 'Slack inbound is not configured or disabled' };
    }
    if (this.running) return { ok: true };

    // Attempt dynamic import of @slack/bolt — fails gracefully if not installed
    type DynImport = (m: string) => Promise<{ App?: new (opts: object) => BoltApp }>;
    const bolt = await (Function('m', 'return import(m)') as DynImport)('@slack/bolt').catch(() => null);

    if (!bolt?.App) {
      return {
        ok: false,
        error: 'Slack requires @slack/bolt. Install it with: npm install @slack/bolt',
      };
    }

    try {
      this.app = new bolt.App({
        token: this.config.botToken,
        appToken: this.config.appToken,
        socketMode: true,
        logLevel: 'error',
      });

      // Resolve bot user id to filter own messages
      const { user_id } = await (this.app as unknown as { client: SlackClient })
        .client.auth.test();
      this.botUserId = user_id;

      // Register message handler for all messages
      this.app.message(/[\s\S]*/, async ({ message, say }) => {
        await this.handleMessage(message as SlackMessage, say);
      });

      await this.app.start();
      this.running = true;
      logger.info('[slack] Socket Mode started', { agentId: this.config.agentId, botUserId: this.botUserId });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: `Slack start failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async stop(): Promise<void> {
    if (this.running && this.app) {
      try {
        await this.app.stop();
      } catch { /* ignore */ }
      this.app = null;
      this.running = false;
      logger.info('[slack] Socket Mode stopped');
    }
  }

  private async handleMessage(
    msg: SlackMessage,
    say: (text: string | object) => Promise<void>,
  ): Promise<void> {
    if (!this.config) return;

    // Ignore messages from bots (including ourselves)
    if (msg.bot_id || msg.subtype === 'bot_message') return;
    if (msg.user === this.botUserId) return;
    if (!msg.text || !msg.user) return;

    const isDM = msg.channel_type === 'im';
    const userId = msg.user;

    if (isDM) {
      const dmPolicy = this.config.dmPolicy ?? 'pairing';

      if (dmPolicy === 'disabled') return;

      if (dmPolicy === 'open') {
        await this.processMessage(msg, say, false);
        return;
      }

      if (dmPolicy === 'allowlist') {
        const allowed =
          this.pairingStore.isAllowed(this.channelId, userId) ||
          (this.config.allowFrom?.includes(userId) ?? false);
        if (!allowed) {
          await say('You are not authorized to message this bot.').catch(() => {});
          return;
        }
        await this.processMessage(msg, say, false);
        return;
      }

      // pairing (default)
      if (this.pairingStore.isAllowed(this.channelId, userId)) {
        await this.processMessage(msg, say, false);
        return;
      }

      const result = this.pairingStore.requestPairing(this.channelId, userId);
      if (result) {
        await say(`Your pairing code is: \`${result.code}\`. Send this code to the bot owner to get access. Codes expire in 1 hour.`).catch(() => {});
      } else {
        await say('A pairing request is already pending. Please wait for the owner to respond.').catch(() => {});
      }

    } else {
      // Channel / group message
      const groupPolicy = this.config.groupPolicy ?? 'open';
      if (groupPolicy === 'disabled') return;

      if (groupPolicy === 'allowlist') {
        const effectiveAllowFrom = this.config.groupAllowFrom ?? this.config.allowFrom;
        const allowed =
          this.pairingStore.isAllowed(this.channelId, userId) ||
          (effectiveAllowFrom?.includes(userId) ?? false);
        if (!allowed) return;
      }

      await this.processMessage(msg, say, true);
    }
  }

  private async processMessage(
    msg: SlackMessage,
    say: (text: string | object) => Promise<void>,
    isChannel: boolean,
  ): Promise<void> {
    if (!this.config) return;

    const userId = msg.user!;
    const text = msg.text!;
    const chatType = isChannel ? 'group' : 'direct';

    // ── Slash command pre-check ────────────────────────────────────────────────
    const slashSessionKey = this.sessionRouter
      ? resolveSessionKey({
          agentId: this.config.agentId,
          channel: 'slack',
          chatType,
          peerId: !isChannel ? userId : undefined,
          groupId: isChannel ? msg.channel : undefined,
          dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
        })
      : undefined;
    const slashEntry = slashSessionKey && this.sessionRouter
      ? this.sessionRouter.getSessionEntry(slashSessionKey)
      : null;

    const slashResult = handleSlashCommand(text, {
      agentId: this.config.agentId,
      channel: 'slack',
      senderId: userId,
      conversationId: slashEntry?.conversationId,
      sessionKey: slashSessionKey,
      convStore: this.convStore,
      sessionRouter: this.sessionRouter,
    });

    if (slashResult.isHandled && slashResult.response) {
      await say(slashResult.response).catch(() => {});
      return;
    }

    // Check for reset triggers
    const isReset = slashResult.isReset || (this.sessionRouter
      ? this.sessionRouter.isResetTrigger(text)
      : (['/new', '/reset', ...(this.config.resetTriggers ?? [])]).some(
          t => text.trim().toLowerCase() === t.toLowerCase(),
        ));

    let conversationId: string | undefined;
    let contextMessages: Array<{ role: string; content: string }> = [];

    if (this.sessionRouter && this.convStore) {
      const groupId = isChannel ? msg.channel : undefined;
      const peerId = !isChannel ? userId : undefined;

      if (isReset) {
        const key = resolveSessionKey({
          agentId: this.config.agentId,
          channel: 'slack',
          chatType,
          peerId,
          groupId,
          dmScope: this.sessionRouter.getConfig().dmScope ?? 'main',
        });
        this.sessionRouter.resetSession(key, this.config.agentId);
        await say('(new conversation started)').catch(() => {});
        return;
      }

      const resolved = this.sessionRouter.resolveConversation({
        agentId: this.config.agentId,
        channel: 'slack',
        chatType,
        peerId,
        groupId,
      });

      if (!this.sessionRouter.isSendAllowed(resolved.entry)) return;

      conversationId = resolved.conversationId;
      const msgs = this.convStore.getMessages(conversationId);
      const historyLimit = this.config.historyLimit ?? 50;
      const limited = historyLimit > 0 ? msgs.slice(-historyLimit) : msgs;
      contextMessages = limited.map(m => ({ role: m.role, content: m.content }));

    } else if (this.convStore) {
      if (isReset) {
        await say('(new conversation started)').catch(() => {});
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
        await say('(new conversation started)').catch(() => {});
        return;
      }
    }

    try {
      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input: text,
        contextOverride: `[Slack from user ${userId}]`,
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
        await say(chunk);
      }
    } catch (err) {
      logger.error('[slack] Agent run failed', { err: err instanceof Error ? err.message : String(err) });
      await say('Agent error — could not process your message.').catch(() => {});
    }
  }
}
