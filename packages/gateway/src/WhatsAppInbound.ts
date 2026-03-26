// ─── WhatsAppInbound ──────────────────────────────────────────────────────────
//
// WhatsApp inbound channel using @whiskeysockets/baileys (WhatsApp Web protocol).
// Baileys is an OPTIONAL dependency — if not installed, start() returns an error.
//
// Setup:
//   1. Install: npm install @whiskeysockets/baileys
//   2. Configure via ChatChannelRegistry or InboundChannelManager
//   3. On first start, a QR code is logged and accessible via getPairingQR()
//      Scan it with the WhatsApp mobile app to pair
//
// Behaviour:
//   - Stores multi-file auth state in sessionDir for persistence across restarts
//   - Routes incoming text messages to the configured agent via the orchestrator
//   - Replies to the same chat with the agent's response
//   - On disconnect: attempts reconnect up to 3 times with exponential backoff
//   - QR code is available via getPairingQR() after first start (before pairing)
//

import type { AgentOrchestrator } from '@krythor/core';
import { join } from 'path';
import { logger } from './logger.js';

export interface WhatsAppInboundConfig {
  agentId: string;
  enabled: boolean;
  sessionDir?: string;
}

// Minimal type interface for the Baileys socket — avoids a compile-time dependency
// on the actual baileys package while still giving us enough shape to work with.
interface BaileysSocket {
  ev: {
    on(event: string, handler: (...args: unknown[]) => void): void;
  };
  sendMessage(jid: string, content: { text: string }): Promise<unknown>;
  logout(): Promise<void>;
  end(error?: Error): void;
}

export class WhatsAppInbound {
  private config: WhatsAppInboundConfig | null = null;
  private orchestrator: AgentOrchestrator;
  private dataDir: string;
  private running = false;
  private socket: BaileysSocket | null = null;
  private pairingQR: string | null = null;
  private reconnectCount = 0;
  private readonly MAX_RECONNECTS = 3;

  constructor(orchestrator: AgentOrchestrator, dataDir: string) {
    this.orchestrator = orchestrator;
    this.dataDir = dataDir;
  }

  // ── Configuration ──────────────────────────────────────────────────────────

  configure(cfg: WhatsAppInboundConfig): void {
    this.config = cfg;
  }

  isRunning(): boolean {
    return this.running;
  }

  getPairingQR(): string | null {
    return this.pairingQR;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (!this.config?.enabled) {
      return { ok: false, error: 'WhatsApp inbound is not configured or disabled' };
    }
    if (this.running) return { ok: true };

    // Attempt dynamic import of baileys — fails gracefully if not installed
    const baileys = await import('@whiskeysockets/baileys').catch(() => null) as {
      default?: unknown;
      makeWASocket?: (...args: unknown[]) => BaileysSocket;
      useMultiFileAuthState?: (dir: string) => Promise<{ state: unknown; saveCreds: () => Promise<void> }>;
      DisconnectReason?: Record<string, number>;
      fetchLatestBaileysVersion?: () => Promise<{ version: number[] }>;
      Browsers?: { appropriate: (name: string) => unknown };
    } | null;

    if (!baileys) {
      return {
        ok: false,
        error:
          'WhatsApp requires @whiskeysockets/baileys. ' +
          'Install it with: npm install @whiskeysockets/baileys',
      };
    }

    // Resolve the functions — baileys may use either named or default exports
    const makeWASocket = baileys.makeWASocket;
    const useMultiFileAuthState = baileys.useMultiFileAuthState;

    if (!makeWASocket || !useMultiFileAuthState) {
      return {
        ok: false,
        error: 'Failed to load makeWASocket or useMultiFileAuthState from @whiskeysockets/baileys',
      };
    }

    try {
      const sessionDir =
        this.config.sessionDir ?? join(this.dataDir, 'whatsapp-session');

      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

      let version: number[] = [2, 3000, 1015901307];
      if (baileys.fetchLatestBaileysVersion) {
        try {
          const v = await baileys.fetchLatestBaileysVersion();
          version = v.version;
        } catch { /* use fallback */ }
      }

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: baileys.Browsers?.appropriate('Krythor') ?? ['Krythor', 'Desktop', '1.0'],
        logger: { level: 'silent', child: () => ({ level: 'silent' }) },
      }) as BaileysSocket;

      this.socket = sock;

      // Handle credential updates (persist auth state)
      sock.ev.on('creds.update', () => {
        saveCreds().catch((err: unknown) =>
          logger.warn({ err }, '[whatsapp] Failed to save credentials'),
        );
      });

      // Handle connection updates
      sock.ev.on('connection.update', (update: unknown) => {
        const u = update as {
          connection?: string;
          qr?: string;
          lastDisconnect?: { error?: { output?: { statusCode?: number } } };
        };

        if (u.qr) {
          this.pairingQR = u.qr;
          logger.info('[whatsapp] QR code received — scan with WhatsApp mobile app');
          logger.info({ qr: u.qr }, '[whatsapp] QR');
        }

        if (u.connection === 'open') {
          this.running = true;
          this.reconnectCount = 0;
          this.pairingQR = null;
          logger.info('[whatsapp] Connected');
        }

        if (u.connection === 'close') {
          this.running = false;
          const statusCode = u.lastDisconnect?.error?.output?.statusCode;
          // Baileys DisconnectReason.loggedOut === 401
          const loggedOut = statusCode === 401;

          if (!loggedOut && this.reconnectCount < this.MAX_RECONNECTS) {
            this.reconnectCount++;
            const delay = Math.pow(2, this.reconnectCount) * 1_000; // 2s, 4s, 8s
            logger.warn(
              { reconnectCount: this.reconnectCount, delay },
              '[whatsapp] Disconnected — reconnecting',
            );
            setTimeout(() => {
              if (this.config?.enabled) {
                void this.start();
              }
            }, delay);
          } else {
            if (loggedOut) {
              logger.warn('[whatsapp] Logged out — pairing required again');
            } else {
              logger.error({ reconnectCount: this.reconnectCount }, '[whatsapp] Max reconnects reached');
            }
          }
        }
      });

      // Handle incoming messages
      sock.ev.on('messages.upsert', async (upsert: unknown) => {
        const u = upsert as {
          messages: Array<{
            key: { fromMe?: boolean; remoteJid?: string };
            message?: {
              conversation?: string;
              extendedTextMessage?: { text?: string };
            };
          }>;
          type: string;
        };

        if (u.type !== 'notify') return;

        for (const msg of u.messages) {
          if (msg.key.fromMe) continue;
          const jid = msg.key.remoteJid;
          if (!jid) continue;

          const text =
            msg.message?.conversation ??
            msg.message?.extendedTextMessage?.text;

          if (!text) continue;

          await this.handleMessage(jid, text);
        }
      });

      this.running = true;
      logger.info('[whatsapp] Starting — waiting for connection');
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, '[whatsapp] Failed to start');
      return { ok: false, error: `WhatsApp start failed: ${msg}` };
    }
  }

  stop(): void {
    if (this.socket) {
      try { this.socket.end(); } catch { /* ignore */ }
      this.socket = null;
    }
    this.running = false;
    logger.info('[whatsapp] Stopped');
  }

  // ── Message handling ───────────────────────────────────────────────────────

  private async handleMessage(jid: string, text: string): Promise<void> {
    if (!this.config || !this.socket) return;
    logger.info({ jid }, '[whatsapp] Received message');

    try {
      const run = await this.orchestrator.runAgent(this.config.agentId, {
        input: text,
        contextOverride: `[WhatsApp from ${jid}]`,
      });

      const reply = (run.output ?? 'Sorry, I could not process your message.').slice(0, 4096);
      await this.socket.sendMessage(jid, { text: reply });
    } catch (err) {
      logger.error({ err, jid }, '[whatsapp] Agent run failed');
      await this.socket
        .sendMessage(jid, { text: '⚠️ Agent error — could not process your message.' })
        .catch(() => {});
    }
  }
}
