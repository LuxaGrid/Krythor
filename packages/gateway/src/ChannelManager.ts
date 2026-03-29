import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logger } from './logger.js';

// ─── Channel types ────────────────────────────────────────────────────────────

export type ChannelEvent =
  | 'agent_run_complete'
  | 'agent_run_failed'
  | 'memory_saved'
  | 'memory_deleted'
  | 'conversation_created'
  | 'conversation_archived'
  | 'provider_added'
  | 'provider_removed'
  | 'heartbeat'
  | 'custom';

export const ALL_CHANNEL_EVENTS: ChannelEvent[] = [
  'agent_run_complete',
  'agent_run_failed',
  'memory_saved',
  'memory_deleted',
  'conversation_created',
  'conversation_archived',
  'provider_added',
  'provider_removed',
  'heartbeat',
  'custom',
];

/** Retry policy for channel delivery. */
export interface ChannelRetryPolicy {
  /** Maximum number of retry attempts after the first failure (default: 3). */
  maxRetries?: number;
  /** Initial delay in ms before the first retry (default: 1000). */
  minDelayMs?: number;
  /** Maximum delay cap in ms (default: 30000). */
  maxDelayMs?: number;
  /** Whether to add random jitter to retry delays (default: true). */
  jitter?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  /** Webhook URL to POST events to */
  url: string;
  /** Events this channel subscribes to. Empty = all events. */
  events: ChannelEvent[];
  /** Optional secret — sent as X-Krythor-Signature header (HMAC-SHA256) */
  secret?: string;
  /** Custom headers to include in every outgoing request */
  headers?: Record<string, string>;
  /** Retry policy for failed deliveries. */
  retryPolicy?: ChannelRetryPolicy;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  /** Stats: last delivery attempt */
  lastDeliveryAt?: string;
  lastDeliveryStatus?: 'ok' | 'failed';
  lastDeliveryStatusCode?: number;
  failureCount: number;
  /** Total number of retried deliveries */
  retryCount?: number;
}

export interface ChannelEvent_Payload {
  event: ChannelEvent;
  gatewayId: string;
  ts: string;        // ISO timestamp
  data: Record<string, unknown>;
}

// ─── ChannelManager ───────────────────────────────────────────────────────────

export class ChannelManager {
  private configPath: string;
  private channels: Map<string, Channel> = new Map();
  private gatewayId: string;

  constructor(configDir: string, gatewayId: string) {
    this.configPath = join(configDir, 'channels.json');
    this.gatewayId = gatewayId;
    this.load();
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  list(): Channel[] {
    return Array.from(this.channels.values());
  }

  get(id: string): Channel | undefined {
    return this.channels.get(id);
  }

  add(input: Omit<Channel, 'id' | 'createdAt' | 'updatedAt' | 'failureCount'>): Channel {
    const channel: Channel = {
      ...input,
      id:          randomUUID(),
      createdAt:   new Date().toISOString(),
      updatedAt:   new Date().toISOString(),
      failureCount: 0,
    };
    this.channels.set(channel.id, channel);
    this.save();
    return channel;
  }

  update(id: string, patch: Partial<Omit<Channel, 'id' | 'createdAt'>>): Channel {
    const existing = this.channels.get(id);
    if (!existing) throw new Error(`Channel not found: ${id}`);
    const updated: Channel = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
    this.channels.set(id, updated);
    this.save();
    return updated;
  }

  remove(id: string): void {
    if (!this.channels.has(id)) throw new Error(`Channel not found: ${id}`);
    this.channels.delete(id);
    this.save();
  }

  // ── Delivery ────────────────────────────────────────────────────────────────

  /**
   * Dispatch an event to all matching enabled channels.
   * Non-blocking — fires and does not await. Failures are logged.
   */
  emit(event: ChannelEvent, data: Record<string, unknown>): void {
    const payload: ChannelEvent_Payload = {
      event,
      gatewayId: this.gatewayId,
      ts: new Date().toISOString(),
      data,
    };

    for (const channel of this.channels.values()) {
      if (!channel.isEnabled) continue;
      if (channel.events.length > 0 && !channel.events.includes(event)) continue;
      void this.deliver(channel, payload);
    }
  }

  private async deliver(channel: Channel, payload: ChannelEvent_Payload): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent':   'Krythor-Channel/1.0',
      'X-Krythor-Event': payload.event,
      'X-Krythor-Gateway-Id': payload.gatewayId,
      ...channel.headers,
    };

    if (channel.secret) {
      const { createHmac } = await import('crypto');
      const sig = createHmac('sha256', channel.secret).update(body).digest('hex');
      headers['X-Krythor-Signature'] = `sha256=${sig}`;
    }

    const policy = channel.retryPolicy ?? {};
    const maxRetries = Math.min(policy.maxRetries ?? 3, 10);
    const minDelay   = policy.minDelayMs ?? 1_000;
    const maxDelay   = policy.maxDelayMs ?? 30_000;
    const useJitter  = policy.jitter !== false;

    let attempt = 0;
    let totalRetries = channel.retryCount ?? 0;
    let lastStatus: number | undefined;

    while (attempt <= maxRetries) {
      const now = new Date().toISOString();
      try {
        const resp = await fetch(channel.url, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(10_000),
        });
        lastStatus = resp.status;

        if (resp.ok) {
          this.channels.set(channel.id, {
            ...channel,
            lastDeliveryAt: now,
            lastDeliveryStatus: 'ok',
            lastDeliveryStatusCode: resp.status,
            failureCount: 0,
            retryCount: totalRetries,
          });
          this.save();
          return;
        }

        // Non-2xx: retry unless rate-limited (429) or server error (5xx) on last attempt
        logger.warn('Channel delivery failed', { channelId: channel.id, event: payload.event, status: resp.status, attempt, maxRetries });

        if (attempt === maxRetries) {
          this.channels.set(channel.id, {
            ...channel,
            lastDeliveryAt: now,
            lastDeliveryStatus: 'failed',
            lastDeliveryStatusCode: resp.status,
            failureCount: channel.failureCount + 1,
            retryCount: totalRetries,
          });
          this.save();
          return;
        }
      } catch (err) {
        logger.warn('Channel delivery error', { channelId: channel.id, event: payload.event, error: String(err), attempt, maxRetries });

        if (attempt === maxRetries) {
          const now2 = new Date().toISOString();
          this.channels.set(channel.id, {
            ...channel,
            lastDeliveryAt: now2,
            lastDeliveryStatus: 'failed',
            lastDeliveryStatusCode: lastStatus,
            failureCount: channel.failureCount + 1,
            retryCount: totalRetries,
          });
          this.save();
          return;
        }
      }

      // Exponential backoff: minDelay * 2^attempt, capped at maxDelay, with optional jitter
      attempt++;
      totalRetries++;
      let delay = Math.min(minDelay * Math.pow(2, attempt - 1), maxDelay);
      if (useJitter) delay = delay * (0.5 + Math.random() * 0.5);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // ── Test delivery ─────────────────────────────────────────────────────────

  async test(id: string): Promise<{ ok: boolean; statusCode?: number; latencyMs: number; error?: string }> {
    const channel = this.channels.get(id);
    if (!channel) throw new Error(`Channel not found: ${id}`);

    const payload: ChannelEvent_Payload = {
      event: 'custom',
      gatewayId: this.gatewayId,
      ts: new Date().toISOString(),
      data: { test: true, message: 'Krythor channel test delivery' },
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent':   'Krythor-Channel/1.0',
      'X-Krythor-Event': 'custom',
      'X-Krythor-Gateway-Id': this.gatewayId,
      ...channel.headers,
    };
    if (channel.secret) {
      const { createHmac } = await import('crypto');
      const sig = createHmac('sha256', channel.secret).update(body).digest('hex');
      headers['X-Krythor-Signature'] = `sha256=${sig}`;
    }

    const start = Date.now();
    try {
      const resp = await fetch(channel.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      return { ok: resp.ok, statusCode: resp.status, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: String(err) };
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private load(): void {
    if (!existsSync(this.configPath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf-8')) as Channel[];
      if (Array.isArray(raw)) {
        for (const ch of raw) {
          if (ch.id) this.channels.set(ch.id, ch);
        }
      }
    } catch (err) {
      logger.warn('Failed to load channels.json', { error: String(err) });
    }
  }

  private save(): void {
    try {
      mkdirSync(join(this.configPath, '..'), { recursive: true });
      writeFileSync(this.configPath, JSON.stringify(Array.from(this.channels.values()), null, 2), 'utf-8');
    } catch (err) {
      logger.warn('Failed to save channels.json', { error: String(err) });
    }
  }
}
