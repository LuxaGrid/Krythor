// ─── ChatChannelRegistry ──────────────────────────────────────────────────────
//
// Manages inbound bot channel configurations (Telegram, Discord, WhatsApp).
// This is SEPARATE from ChannelManager which handles outbound webhooks.
//
// Configs are persisted to <configDir>/chat-channels.json.
//
// Credential security note: credentials are stored as plain strings in JSON for
// now. Encryption at rest (e.g. OS keychain or AES-GCM with a machine key) is a
// planned future enhancement — track in issue tracker before deploying to any
// multi-user or server environment.
//

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export type ChannelType = 'telegram' | 'discord' | 'whatsapp' | 'slack' | 'signal' | 'mattermost' | 'googlechat' | 'bluebubbles' | 'imessage' | 'webchat';

export type ChannelStatus =
  | 'not_installed'
  | 'installed'
  | 'credentials_missing'
  | 'awaiting_pairing'
  | 'connected'
  | 'error';

export interface ChatChannelConfig {
  id: string;
  type: ChannelType;
  displayName: string;
  enabled: boolean;
  /** Credential values stored as-is in JSON. Encryption is a future enhancement. */
  credentials: Record<string, string>;
  agentId?: string;
  pairingCode?: string;
  pairingExpiry?: number;
  lastHealthCheck?: number;
  lastHealthStatus?: 'ok' | 'error';
  lastError?: string;
  connectedAt?: number;
  dmPolicy?: 'pairing' | 'allowlist' | 'open' | 'disabled';
  groupPolicy?: 'open' | 'allowlist' | 'disabled';
  allowFrom?: string[];
  /**
   * Channel-wide group sender allowlist. Applied when groupPolicy is 'allowlist'
   * and a group does not have its own allowFrom. Provides a simpler alternative
   * to per-group allowFrom when the same sender set applies to all groups.
   */
  groupAllowFrom?: string[];
  groups?: Record<string, { requireMention?: boolean; allowFrom?: string[] }>;
  /**
   * Keywords that trigger a new conversation for a sender (case-insensitive exact match).
   * Useful for "start over", "reset", etc. Defaults to ['/new'].
   */
  resetTriggers?: string[];
  /**
   * Maximum number of past messages to inject as context for each incoming message.
   * Prevents unbounded context growth. Default: 50. Set to 0 to disable history injection.
   */
  historyLimit?: number;
  /**
   * Maximum characters per outbound message chunk. Replies longer than this are split
   * into multiple messages. Default: channel native limit (4096 Telegram, 2000 Discord).
   */
  textChunkLimit?: number;
  /**
   * How to split long replies:
   *   'length' (default) — hard split at textChunkLimit
   *   'newline' — prefer paragraph boundaries (blank lines) before length split
   */
  chunkMode?: 'length' | 'newline';
  /**
   * Acknowledgment reaction sent immediately when a message is accepted for processing.
   * Telegram: unicode emoji e.g. "👀". Discord: unicode emoji or custom emoji name.
   * Set to "" to disable. Default: "👀".
   */
  ackReaction?: string;
}

export interface ChannelProviderMeta {
  id: string;
  type: ChannelType;
  displayName: string;
  description: string;
  installStrategy: 'npm_package' | 'env_config' | 'webhook' | 'built_in';
  credentialFields: Array<{
    key: string;
    label: string;
    hint: string;
    secret: boolean;
    required: boolean;
  }>;
  requiresPairing: boolean;
  docsUrl?: string;
}

export const CHANNEL_PROVIDERS: ChannelProviderMeta[] = [
  {
    id: 'telegram',
    type: 'telegram',
    displayName: 'Telegram',
    description: 'Chat with your agents via a Telegram bot. Get a bot token from @BotFather.',
    installStrategy: 'npm_package',
    credentialFields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        hint: 'From @BotFather — looks like 123456789:ABCdef...',
        secret: true,
        required: true,
      },
      {
        key: 'agentId',
        label: 'Agent ID',
        hint: 'Which Krythor agent handles messages',
        secret: false,
        required: false,
      },
    ],
    requiresPairing: false,
    docsUrl: 'https://core.telegram.org/bots#how-do-i-create-a-bot',
  },
  {
    id: 'discord',
    type: 'discord',
    displayName: 'Discord',
    description: 'Chat with your agents in a Discord server. Requires a bot token and channel ID.',
    installStrategy: 'env_config',
    credentialFields: [
      {
        key: 'token',
        label: 'Bot Token',
        hint: 'From Discord Developer Portal',
        secret: true,
        required: true,
      },
      {
        key: 'channelId',
        label: 'Channel ID',
        hint: 'Right-click channel → Copy Channel ID',
        secret: false,
        required: true,
      },
      {
        key: 'agentId',
        label: 'Agent ID',
        hint: 'Which Krythor agent handles messages',
        secret: false,
        required: false,
      },
    ],
    requiresPairing: false,
    docsUrl: 'https://discord.com/developers/applications',
  },
  {
    id: 'whatsapp',
    type: 'whatsapp',
    displayName: 'WhatsApp',
    description:
      'Chat with your agents via WhatsApp. Requires whatsapp-web.js and a pairing code scan.',
    installStrategy: 'npm_package',
    credentialFields: [
      {
        key: 'agentId',
        label: 'Agent ID',
        hint: 'Which Krythor agent handles messages',
        secret: false,
        required: false,
      },
    ],
    requiresPairing: true,
    docsUrl: 'https://wwebjs.dev/',
  },
  {
    id: 'bluebubbles',
    type: 'bluebubbles',
    displayName: 'BlueBubbles',
    description:
      'Chat with your agents via iMessage using a BlueBubbles server running on a Mac.',
    installStrategy: 'env_config',
    credentialFields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        hint: 'e.g. http://192.168.1.10:1234',
        secret: false,
        required: true,
      },
      {
        key: 'password',
        label: 'Server Password',
        hint: 'Set in BlueBubbles Server settings',
        secret: true,
        required: true,
      },
      {
        key: 'agentId',
        label: 'Agent ID',
        hint: 'Which Krythor agent handles messages',
        secret: false,
        required: false,
      },
    ],
    requiresPairing: false,
    docsUrl: 'https://bluebubbles.app',
  },
  {
    id: 'imessage',
    type: 'imessage',
    displayName: 'iMessage (macOS)',
    description:
      'Direct iMessage integration on macOS by polling the Messages database. Requires Full Disk Access.',
    installStrategy: 'env_config',
    credentialFields: [
      {
        key: 'agentId',
        label: 'Agent ID',
        hint: 'Which Krythor agent handles messages',
        secret: false,
        required: false,
      },
      {
        key: 'pollIntervalMs',
        label: 'Poll Interval (ms)',
        hint: 'How often to check for new messages. Default: 5000',
        secret: false,
        required: false,
      },
    ],
    requiresPairing: false,
  },
  {
    id: 'mattermost',
    type: 'mattermost',
    displayName: 'Mattermost',
    description:
      'Chat with your agents in Mattermost via WebSocket. Requires a bot account token.',
    installStrategy: 'env_config',
    credentialFields: [
      {
        key: 'serverUrl',
        label: 'Server URL',
        hint: 'e.g. https://mattermost.example.com',
        secret: false,
        required: true,
      },
      {
        key: 'token',
        label: 'Bot Token',
        hint: 'Personal Access Token or Bot account token',
        secret: true,
        required: true,
      },
      {
        key: 'agentId',
        label: 'Agent ID',
        hint: 'Which Krythor agent handles messages',
        secret: false,
        required: false,
      },
      {
        key: 'channelIds',
        label: 'Channel IDs',
        hint: 'Comma-separated channel IDs to monitor (blank = all accessible channels)',
        secret: false,
        required: false,
      },
    ],
    requiresPairing: false,
    docsUrl: 'https://docs.mattermost.com/developer/bot-accounts.html',
  },
  {
    id: 'googlechat',
    type: 'googlechat',
    displayName: 'Google Chat',
    description:
      'Chat with your agents via Google Chat. Requires a Google Cloud service account and webhook setup.',
    installStrategy: 'webhook',
    credentialFields: [
      {
        key: 'agentId',
        label: 'Agent ID',
        hint: 'Which Krythor agent handles messages',
        secret: false,
        required: false,
      },
      {
        key: 'serviceAccountJson',
        label: 'Service Account JSON',
        hint: 'Path to service account key file, or paste the JSON directly',
        secret: true,
        required: false,
      },
    ],
    requiresPairing: false,
    docsUrl: 'https://developers.google.com/chat/how-tos/apps-develop',
  },
  {
    id: 'signal',
    type: 'signal',
    displayName: 'Signal',
    description:
      'Chat with your agents via Signal. Requires signal-cli running in JSON-RPC daemon mode.',
    installStrategy: 'env_config',
    credentialFields: [
      {
        key: 'phoneNumber',
        label: 'Phone Number',
        hint: 'Registered Signal number, e.g. +15551234567',
        secret: false,
        required: true,
      },
      {
        key: 'port',
        label: 'Daemon Port',
        hint: 'TCP port for signal-cli JSON-RPC daemon (default: 7583)',
        secret: false,
        required: false,
      },
      {
        key: 'socketPath',
        label: 'Socket Path',
        hint: 'Unix socket path, e.g. /tmp/signal.sock (overrides host/port if set)',
        secret: false,
        required: false,
      },
      {
        key: 'agentId',
        label: 'Agent ID',
        hint: 'Which Krythor agent handles messages',
        secret: false,
        required: false,
      },
    ],
    requiresPairing: false,
    docsUrl: 'https://github.com/AsamK/signal-cli',
  },
  {
    id: 'slack',
    type: 'slack',
    displayName: 'Slack',
    description:
      'Chat with your agents in Slack via Socket Mode. Requires a Slack App with Bot Token and App-Level Token.',
    installStrategy: 'npm_package',
    credentialFields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        hint: 'From OAuth & Permissions — starts with xoxb-',
        secret: true,
        required: true,
      },
      {
        key: 'appToken',
        label: 'App-Level Token',
        hint: 'From Settings > Socket Mode — starts with xapp-',
        secret: true,
        required: true,
      },
      {
        key: 'agentId',
        label: 'Agent ID',
        hint: 'Which Krythor agent handles messages',
        secret: false,
        required: false,
      },
    ],
    requiresPairing: false,
    docsUrl: 'https://api.slack.com/apps',
  },
  {
    id: 'webchat',
    type: 'webchat',
    displayName: 'Web Chat',
    description:
      'Embed a chat widget on any webpage, or share the hosted chat URL directly.',
    installStrategy: 'built_in',
    credentialFields: [],
    requiresPairing: false,
  },
];

// ── Internal persistence shape ────────────────────────────────────────────────

interface PersistedRegistry {
  version: 1;
  channels: ChatChannelConfig[];
}

function loadFile(filePath: string): PersistedRegistry {
  if (!existsSync(filePath)) {
    return { version: 1, channels: [] };
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as PersistedRegistry;
    if (!Array.isArray(parsed.channels)) return { version: 1, channels: [] };
    return parsed;
  } catch {
    return { version: 1, channels: [] };
  }
}

// ── ChatChannelRegistry ───────────────────────────────────────────────────────

export class ChatChannelRegistry {
  private readonly filePath: string;
  private configs: Map<string, ChatChannelConfig>;

  constructor(configDir: string) {
    // Ensure the directory exists
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }
    this.filePath = join(configDir, 'chat-channels.json');
    const data = loadFile(this.filePath);
    this.configs = new Map(data.channels.map(c => [c.id, c]));
  }

  // ── Provider metadata ───────────────────────────────────────────────────────

  listProviders(): ChannelProviderMeta[] {
    return CHANNEL_PROVIDERS;
  }

  getProvider(id: string): ChannelProviderMeta | undefined {
    return CHANNEL_PROVIDERS.find(p => p.id === id);
  }

  // ── Config CRUD ─────────────────────────────────────────────────────────────

  listConfigs(): ChatChannelConfig[] {
    return Array.from(this.configs.values());
  }

  getConfig(id: string): ChatChannelConfig | undefined {
    return this.configs.get(id);
  }

  saveConfig(config: ChatChannelConfig): void {
    // Fill in displayName from provider metadata if caller did not supply one
    if (!config.displayName) {
      const meta = this.getProvider(config.id);
      config.displayName = meta?.displayName ?? config.id;
    }
    this.configs.set(config.id, config);
    this.persist();
  }

  deleteConfig(id: string): void {
    this.configs.delete(id);
    this.persist();
  }

  // ── Status derivation ───────────────────────────────────────────────────────
  //
  // Status is derived from the config state at call time — no stored "status"
  // field. The ordering matters:
  //   1. No config at all                    → not_installed
  //   2. Disabled                            → installed (has config, not active)
  //   3. Required credentials missing        → credentials_missing
  //   4. Requires pairing but no confirmed code → awaiting_pairing
  //   5. Last health check was successful    → connected
  //   6. Last health check recorded an error → error
  //   7. Enabled + credentials + no health check yet → installed

  getStatus(id: string): ChannelStatus {
    const config = this.configs.get(id);
    if (!config) return 'not_installed';

    if (!config.enabled) return 'installed';

    const validationError = this.validateCredentials(id, config.credentials);
    if (validationError !== null) return 'credentials_missing';

    const provider = this.getProvider(id);
    if (provider?.requiresPairing && !config.connectedAt && !config.pairingCode) {
      return 'awaiting_pairing';
    }

    if (config.lastHealthStatus === 'ok') return 'connected';
    if (config.lastHealthStatus === 'error') return 'error';

    // Enabled, credentials present, no health check yet → treat as installed/pending
    return 'installed';
  }

  // ── Credential validation ───────────────────────────────────────────────────

  /**
   * Returns null if all required credentials are present, or an error message
   * describing which required field is missing.
   */
  validateCredentials(channelId: string, creds: Record<string, string>): string | null {
    const provider = this.getProvider(channelId);
    if (!provider) return `Unknown channel provider: ${channelId}`;

    for (const field of provider.credentialFields) {
      if (field.required) {
        const value = creds[field.key];
        if (!value || value.trim() === '') {
          return `Required credential missing: ${field.label} (${field.key})`;
        }
      }
    }
    return null;
  }

  // ── Connection test ─────────────────────────────────────────────────────────
  //
  // Per-provider test strategies:
  //   telegram  — calls https://api.telegram.org/bot<token>/getMe (5 s timeout)
  //   discord   — validates token format (contains exactly two dots)
  //   whatsapp  — checks whether whatsapp-web.js is resolvable in node_modules

  async testConnection(channelId: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const config = this.configs.get(channelId);
    if (!config) {
      return { ok: false, latencyMs: 0, error: 'Channel not configured' };
    }

    const start = Date.now();

    try {
      switch (config.type) {
        case 'telegram': {
          const token = config.credentials['botToken'];
          if (!token) {
            return { ok: false, latencyMs: 0, error: 'botToken not set' };
          }
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5_000);
          try {
            const res = await fetch(
              `https://api.telegram.org/bot${token}/getMe`,
              { signal: controller.signal },
            );
            clearTimeout(timeout);
            const latencyMs = Date.now() - start;
            if (!res.ok) {
              const body = await res.json().catch(() => ({})) as { description?: string };
              return {
                ok: false,
                latencyMs,
                error: body.description ?? `Telegram API returned HTTP ${res.status}`,
              };
            }
            this.recordHealthCheck(channelId, true);
            return { ok: true, latencyMs };
          } catch (err) {
            clearTimeout(timeout);
            const latencyMs = Date.now() - start;
            const msg = err instanceof Error ? err.message : String(err);
            this.recordHealthCheck(channelId, false, msg);
            return { ok: false, latencyMs, error: msg };
          }
        }

        case 'discord': {
          const token = config.credentials['token'];
          if (!token) {
            return { ok: false, latencyMs: 0, error: 'token not set' };
          }
          // A valid Discord bot token contains exactly two dots
          // (e.g. MTIz.ABCDE.xyz) — this is a format check only.
          // A real connection test would require the bot library gateway handshake.
          const latencyMs = Date.now() - start;
          const parts = token.split('.');
          if (parts.length !== 3) {
            this.recordHealthCheck(channelId, false, 'Token format invalid — expected three dot-separated segments');
            return {
              ok: false,
              latencyMs,
              error: 'Token format invalid — expected three dot-separated segments (e.g. MTIz.ABCDE.xyz)',
            };
          }
          this.recordHealthCheck(channelId, true);
          return { ok: true, latencyMs };
        }

        case 'whatsapp': {
          // Check whether whatsapp-web.js is installed in node_modules
          try {
            require.resolve('whatsapp-web.js');
            const latencyMs = Date.now() - start;
            this.recordHealthCheck(channelId, true);
            return { ok: true, latencyMs };
          } catch {
            const latencyMs = Date.now() - start;
            const error = 'whatsapp-web.js is not installed — run: npm install whatsapp-web.js';
            this.recordHealthCheck(channelId, false, error);
            return { ok: false, latencyMs, error };
          }
        }

        case 'bluebubbles': {
          const serverUrl = config.credentials['serverUrl'];
          const password = config.credentials['password'];
          if (!serverUrl || !password) {
            return { ok: false, latencyMs: 0, error: 'serverUrl or password not set' };
          }
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5_000);
          try {
            const res = await fetch(
              `${serverUrl}/api/v1/ping?password=${encodeURIComponent(password)}`,
              { signal: controller.signal },
            );
            clearTimeout(timeout);
            const latencyMs = Date.now() - start;
            if (!res.ok) {
              const error = `BlueBubbles server returned HTTP ${res.status}`;
              this.recordHealthCheck(channelId, false, error);
              return { ok: false, latencyMs, error };
            }
            this.recordHealthCheck(channelId, true);
            return { ok: true, latencyMs };
          } catch (err) {
            clearTimeout(timeout);
            const latencyMs = Date.now() - start;
            const error = err instanceof Error ? err.message : String(err);
            this.recordHealthCheck(channelId, false, error);
            return { ok: false, latencyMs, error };
          }
        }

        case 'imessage': {
          // Check platform
          if (process.platform !== 'darwin') {
            const error = 'iMessage requires macOS';
            this.recordHealthCheck(channelId, false, error);
            return { ok: false, latencyMs: 0, error };
          }
          // Verify chat.db exists
          const { existsSync } = await import('fs');
          const { homedir } = await import('os');
          const { join } = await import('path');
          const dbPath = config.credentials['chatDbPath'] ??
            join(homedir(), 'Library', 'Messages', 'chat.db');
          const latencyMs = Date.now() - start;
          if (!existsSync(dbPath)) {
            const error = `chat.db not found at ${dbPath}. Ensure Full Disk Access is granted.`;
            this.recordHealthCheck(channelId, false, error);
            return { ok: false, latencyMs, error };
          }
          this.recordHealthCheck(channelId, true);
          return { ok: true, latencyMs };
        }

        case 'mattermost': {
          const serverUrl = config.credentials['serverUrl'];
          if (!serverUrl) {
            return { ok: false, latencyMs: 0, error: 'serverUrl not set' };
          }
          const token = config.credentials['token'];
          if (!token) {
            return { ok: false, latencyMs: 0, error: 'token not set' };
          }
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5_000);
          try {
            const res = await fetch(`${serverUrl}/api/v4/users/me`, {
              headers: { Authorization: `Bearer ${token}` },
              signal: controller.signal,
            });
            clearTimeout(timeout);
            const latencyMs = Date.now() - start;
            if (!res.ok) {
              const error = `Mattermost API returned HTTP ${res.status}`;
              this.recordHealthCheck(channelId, false, error);
              return { ok: false, latencyMs, error };
            }
            this.recordHealthCheck(channelId, true);
            return { ok: true, latencyMs };
          } catch (err) {
            clearTimeout(timeout);
            const latencyMs = Date.now() - start;
            const error = err instanceof Error ? err.message : String(err);
            this.recordHealthCheck(channelId, false, error);
            return { ok: false, latencyMs, error };
          }
        }

        case 'googlechat': {
          // For Google Chat, just verify the service account JSON is parseable
          const saJson = config.credentials['serviceAccountJson'];
          const latencyMs = Date.now() - start;
          if (!saJson) {
            // No service account configured — webhook-only mode, mark as ok
            this.recordHealthCheck(channelId, true);
            return { ok: true, latencyMs };
          }
          try {
            const raw = saJson.trim();
            if (raw.startsWith('{')) {
              JSON.parse(raw);
            } else {
              const { existsSync } = await import('fs');
              if (!existsSync(raw)) {
                const error = `Service account file not found: ${raw}`;
                this.recordHealthCheck(channelId, false, error);
                return { ok: false, latencyMs, error };
              }
            }
            this.recordHealthCheck(channelId, true);
            return { ok: true, latencyMs };
          } catch {
            const error = 'Service account JSON is not valid JSON';
            this.recordHealthCheck(channelId, false, error);
            return { ok: false, latencyMs, error };
          }
        }

        case 'signal': {
          // Verify signal-cli is reachable by attempting a TCP connection
          const { createConnection } = await import('net');
          const port = config.credentials['port'] ? Number(config.credentials['port']) : 7583;
          const host = config.credentials['host'] ?? '127.0.0.1';
          const socketPath = config.credentials['socketPath'];
          await new Promise<void>((resolve, reject) => {
            const sock = socketPath
              ? createConnection({ path: socketPath })
              : createConnection({ host, port });
            const t = setTimeout(() => { sock.destroy(); reject(new Error('Connection timed out')); }, 5_000);
            sock.once('connect', () => { clearTimeout(t); sock.destroy(); resolve(); });
            sock.once('error', (err) => { clearTimeout(t); reject(err); });
          });
          const latencyMs = Date.now() - start;
          this.recordHealthCheck(channelId, true);
          return { ok: true, latencyMs };
        }

        case 'slack': {
          // Check whether @slack/bolt is installed in node_modules
          try {
            require.resolve('@slack/bolt');
            const latencyMs = Date.now() - start;
            this.recordHealthCheck(channelId, true);
            return { ok: true, latencyMs };
          } catch {
            const latencyMs = Date.now() - start;
            const error = '@slack/bolt is not installed — run: npm install @slack/bolt';
            this.recordHealthCheck(channelId, false, error);
            return { ok: false, latencyMs, error };
          }
        }

        default: {
          return { ok: false, latencyMs: 0, error: `Unsupported channel type: ${config.type}` };
        }
      }
    } catch (err) {
      const latencyMs = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, latencyMs, error: msg };
    }
  }

  // ── WhatsApp pairing ────────────────────────────────────────────────────────
  //
  // Generates a short random pairing code and stores it in the config with a
  // 10-minute expiry. The caller is responsible for displaying this code to the
  // user and polling for confirmation via whatsapp-web.js (not implemented here —
  // this just tracks the code lifecycle so the UI can display it).

  async generatePairingCode(channelId: string): Promise<{ code: string; expiresAt: number }> {
    const config = this.configs.get(channelId);
    if (!config) {
      throw new Error(`Channel not found: ${channelId}`);
    }
    if (config.type !== 'whatsapp') {
      throw new Error(`Pairing codes for this channel are managed by DmPairingStore`);
    }

    // Generate an 8-character uppercase alphanumeric code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excludes ambiguous chars (I, O, 0, 1)
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }

    const expiresAt = Date.now() + 60 * 60 * 1_000; // 60 minutes

    this.saveConfig({
      ...config,
      pairingCode: code,
      pairingExpiry: expiresAt,
    });

    return { code, expiresAt };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  recordHealthCheck(channelId: string, ok: boolean, error?: string): void {
    const config = this.configs.get(channelId);
    if (!config) return;
    this.saveConfig({
      ...config,
      lastHealthCheck: Date.now(),
      lastHealthStatus: ok ? 'ok' : 'error',
      lastError: ok ? undefined : error,
      connectedAt: ok && !config.connectedAt ? Date.now() : config.connectedAt,
    });
  }

  private persist(): void {
    const data: PersistedRegistry = {
      version: 1,
      channels: Array.from(this.configs.values()),
    };
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
