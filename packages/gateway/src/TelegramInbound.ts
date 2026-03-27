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
import type { DmPairingStore } from './DmPairingStore.js';
import { logger } from './logger.js';

const TELEGRAM_API = 'https://api.telegram.org';
const LONG_POLL_TIMEOUT_S = 30;
const MAX_REPLY_LEN = 4096;

export interface TelegramInboundConfig {
  token: string;
  agentId: string;
  enabled: boolean;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  groups?: Record<string, { requireMention?: boolean; allowFrom?: string[] }>;
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

interface TelegramUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

export class TelegramInbound {
  private config: TelegramInboundConfig | null = null;
  private orchestrator: AgentOrchestrator;
  private pairingStore: DmPairingStore;
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;
  private botUsername: string | null = null;
  private channelId: string = 'telegram';

  constructor(orchestrator: AgentOrchestrator, pairingStore: DmPairingStore) {
    this.orchestrator = orchestrator;
    this.pairingStore = pairingStore;
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

        // Check requireMention
        if (groupCfg.requireMention && this.botUsername) {
          if (!message.text?.includes(`@${this.botUsername}`)) {
            return; // not mentioned — ignore
          }
        }
      }

      // groupPolicy === 'open' or group is in allowlist: fall through to agent
      void this.sendChatAction(chatId, 'typing').catch(() => {});
      await this.runAgent(chatId, fromId, message.text!);

    } else {
      // ── DM policy enforcement ───────────────────────────────────────────────
      const dmPolicy = this.config.dmPolicy ?? 'pairing';

      if (dmPolicy === 'disabled') {
        return; // silently ignore
      }

      if (dmPolicy === 'open') {
        void this.sendChatAction(chatId, 'typing').catch(() => {});
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
        await this.runAgent(chatId, fromId, message.text!);
        return;
      }

      // dmPolicy === 'pairing' (default)
      if (this.pairingStore.isAllowed(this.channelId, fromId)) {
        void this.sendChatAction(chatId, 'typing').catch(() => {});
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

  private async runAgent(chatId: number, fromId: string, text: string): Promise<void> {
    if (!this.config) return;
    try {
      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input: text,
        contextOverride: `[Telegram from user ${fromId}]`,
      });

      const reply = (run.output ?? 'Sorry, I could not process your message.')
        .slice(0, MAX_REPLY_LEN);
      await this.sendMessage(chatId, reply);
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

  private async sendMessage(chatId: number, text: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.config!.token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status}`);
  }

  private async sendChatAction(chatId: number, action: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.config!.token}/sendChatAction`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
