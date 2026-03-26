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
// Telegram limits:
//   - Max message length: 4096 characters
//   - Long-poll timeout: 30 seconds (configured below)
//

import type { AgentOrchestrator } from '@krythor/core';
import { logger } from './logger.js';

const TELEGRAM_API = 'https://api.telegram.org';
const LONG_POLL_TIMEOUT_S = 30;
const MAX_REPLY_LEN = 4096;

export interface TelegramInboundConfig {
  token: string;
  agentId: string;
  enabled: boolean;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    from?: { id: number; first_name?: string };
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
  private running = false;
  private offset = 0;
  private abortController: AbortController | null = null;

  constructor(orchestrator: AgentOrchestrator) {
    this.orchestrator = orchestrator;
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

    // Validate token by calling getMe
    try {
      const me = await this.telegramGet('getMe') as { ok: boolean; result?: { username?: string } };
      if (!me.ok) {
        return { ok: false, error: 'Telegram getMe returned ok=false — check bot token' };
      }
      logger.info({ botUsername: me.result?.username }, '[telegram] Bot authenticated');
    } catch (err) {
      return {
        ok: false,
        error: `Telegram auth failed: ${err instanceof Error ? err.message : String(err)}`,
      };
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
          logger.warn({ status: res.status }, '[telegram] getUpdates HTTP error — retrying');
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
        logger.warn({ err }, '[telegram] Poll error — retrying');
        await this.sleep(3_000);
      }
    }
  }

  private async handleMessage(
    message: NonNullable<TelegramUpdate['message']>,
  ): Promise<void> {
    if (!this.config) return;
    const chatId = message.chat.id;
    const fromId = message.from?.id ?? 0;
    logger.info({ chatId, fromId }, '[telegram] Received message');

    // Send typing indicator (fire and forget)
    void this.sendChatAction(chatId, 'typing').catch(() => {});

    try {
      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input: message.text!,
        contextOverride: `[Telegram from user ${fromId}]`,
      });

      const reply = (run.output ?? 'Sorry, I could not process your message.')
        .slice(0, MAX_REPLY_LEN);
      await this.sendMessage(chatId, reply);
    } catch (err) {
      logger.error({ err, chatId }, '[telegram] Agent run failed');
      await this.sendMessage(chatId, '⚠️ Agent error — could not process your message.').catch(() => {});
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
