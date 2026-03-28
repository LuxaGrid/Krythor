// ─── InboundChannelManager ────────────────────────────────────────────────────
//
// Manages all inbound chat channels (Discord, Telegram, WhatsApp).
// Creates, configures, starts, and stops channel instances based on what is
// present in ChatChannelRegistry.
//
// Usage:
//   const mgr = new InboundChannelManager(registry, orchestrator, dataDir, logger);
//   await mgr.startAll();
//   // later, after config update:
//   await mgr.restartChannel('telegram');
//   // on shutdown:
//   mgr.stopAll();
//

import { join } from 'path';
import type { AgentOrchestrator } from '@krythor/core';
import type { ConversationStore } from '@krythor/memory';
import { ChatChannelRegistry } from './ChatChannelRegistry.js';
import { DmPairingStore } from './DmPairingStore.js';
import { DiscordInbound } from './DiscordInbound.js';
import { TelegramInbound } from './TelegramInbound.js';
import { WhatsAppInbound } from './WhatsAppInbound.js';
import type { SessionRouter } from './SessionRouter.js';
import { logger } from './logger.js';

type AnyInbound = DiscordInbound | TelegramInbound | WhatsAppInbound;

export class InboundChannelManager {
  private readonly registry: ChatChannelRegistry;
  private readonly orchestrator: AgentOrchestrator;
  private readonly dataDir: string;
  private readonly log: typeof logger;
  private readonly instances = new Map<string, AnyInbound>();
  private readonly errors = new Map<string, string>();
  private readonly pairingStore: DmPairingStore;
  private readonly convStore: ConversationStore | null;
  private readonly sessionRouter: SessionRouter | null;

  constructor(
    registry: ChatChannelRegistry,
    orchestrator: AgentOrchestrator,
    dataDir: string,
    log: typeof logger,
    convStore: ConversationStore | null = null,
    sessionRouter: SessionRouter | null = null,
  ) {
    this.registry = registry;
    this.orchestrator = orchestrator;
    this.dataDir = dataDir;
    this.log = log;
    this.pairingStore = new DmPairingStore(join(dataDir, 'pairing'));
    this.convStore = convStore;
    this.sessionRouter = sessionRouter;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Expose the pairing store so routes can access pending/allowlist state. */
  getPairingStore(): DmPairingStore {
    return this.pairingStore;
  }

  /** Start all enabled channels from the registry. */
  async startAll(): Promise<void> {
    const configs = this.registry.listConfigs().filter(c => c.enabled);
    for (const config of configs) {
      await this.startChannel(config.id);
    }
  }

  /** Stop all running channel instances. */
  stopAll(): void {
    for (const [id, instance] of this.instances) {
      try {
        instance.stop();
        this.log.info('[inbound] Channel stopped', { channelId: id });
      } catch (err) {
        this.log.warn('[inbound] Error stopping channel', { err: err instanceof Error ? err.message : String(err), channelId: id });
      }
    }
    this.instances.clear();
    this.errors.clear();
  }

  /** Restart a single channel by config ID (call after config update). */
  async restartChannel(configId: string): Promise<{ ok: boolean; error?: string }> {
    const existing = this.instances.get(configId);
    if (existing) {
      try { existing.stop(); } catch { /* ignore */ }
      this.instances.delete(configId);
      this.errors.delete(configId);
      this.log.info('[inbound] Channel stopped for restart', { channelId: configId });
    }

    const config = this.registry.getConfig(configId);
    if (!config) {
      return { ok: false, error: `Channel config not found: ${configId}` };
    }
    if (!config.enabled) {
      return { ok: false, error: `Channel ${configId} is disabled` };
    }

    return this.startChannel(configId);
  }

  /** Get running status for all channels. */
  getStatus(): Record<string, { running: boolean; error?: string }> {
    const result: Record<string, { running: boolean; error?: string }> = {};

    for (const config of this.registry.listConfigs()) {
      const instance = this.instances.get(config.id);
      const error = this.errors.get(config.id);

      if (instance) {
        const running = this.isInstanceRunning(instance);
        result[config.id] = { running, ...(error ? { error } : {}) };
      } else {
        result[config.id] = { running: false, ...(error ? { error } : {}) };
      }
    }

    return result;
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private async startChannel(configId: string): Promise<{ ok: boolean; error?: string }> {
    const config = this.registry.getConfig(configId);
    if (!config || !config.enabled) {
      return { ok: false, error: `Channel ${configId} is not enabled or not found` };
    }

    let instance: AnyInbound;

    try {
      switch (config.type) {
        case 'discord': {
          const token = config.credentials['token'];
          const channelId = config.credentials['channelId'];
          const agentId = config.agentId ?? config.credentials['agentId'] ?? '';
          if (!token || !channelId || !agentId) {
            const err = 'Discord channel missing required credentials (token, channelId, agentId)';
            this.errors.set(configId, err);
            this.registry.recordHealthCheck(configId, false, err);
            return { ok: false, error: err };
          }
          const discord = new DiscordInbound(this.orchestrator, this.pairingStore, this.convStore, this.sessionRouter);
          discord.configure({
            token,
            channelId,
            agentId,
            enabled: true,
            dmPolicy:        config.dmPolicy,
            groupPolicy:     config.groupPolicy,
            allowFrom:       config.allowFrom,
            groupAllowFrom:  config.groupAllowFrom,
            guildId:         config.credentials['guildId'],
            resetTriggers:   config.resetTriggers,
            historyLimit:    config.historyLimit,
            textChunkLimit:  config.textChunkLimit,
            chunkMode:       config.chunkMode,
          });
          instance = discord;
          break;
        }

        case 'telegram': {
          const token = config.credentials['botToken'];
          const agentId = config.agentId ?? config.credentials['agentId'] ?? '';
          if (!token || !agentId) {
            const err = 'Telegram channel missing required credentials (botToken, agentId)';
            this.errors.set(configId, err);
            this.registry.recordHealthCheck(configId, false, err);
            return { ok: false, error: err };
          }
          const telegram = new TelegramInbound(this.orchestrator, this.pairingStore, this.convStore, this.sessionRouter);
          telegram.configure({
            token,
            agentId,
            enabled: true,
            dmPolicy:        config.dmPolicy,
            groupPolicy:     config.groupPolicy,
            allowFrom:       config.allowFrom,
            groupAllowFrom:  config.groupAllowFrom,
            groups:          config.groups,
            resetTriggers:   config.resetTriggers,
            historyLimit:    config.historyLimit,
            textChunkLimit:  config.textChunkLimit,
            chunkMode:       config.chunkMode,
            ackReaction:     config.ackReaction,
          });
          instance = telegram;
          break;
        }

        case 'whatsapp': {
          const agentId = config.agentId ?? config.credentials['agentId'] ?? '';
          if (!agentId) {
            const err = 'WhatsApp channel missing required agentId';
            this.errors.set(configId, err);
            this.registry.recordHealthCheck(configId, false, err);
            return { ok: false, error: err };
          }
          const whatsapp = new WhatsAppInbound(this.orchestrator, this.dataDir);
          whatsapp.configure({
            agentId,
            enabled: true,
            sessionDir: config.credentials['sessionDir'],
          });
          instance = whatsapp;
          break;
        }

        default: {
          const err = `Unknown channel type: ${(config as { type: string }).type}`;
          this.errors.set(configId, err);
          this.registry.recordHealthCheck(configId, false, err);
          return { ok: false, error: err };
        }
      }

      const result = await instance.start();

      if (result.ok) {
        this.instances.set(configId, instance);
        this.errors.delete(configId);
        this.registry.recordHealthCheck(configId, true);
        this.log.info('[inbound] Channel started', { channelId: configId, type: config.type });
      } else {
        const errMsg = result.error ?? 'Unknown start error';
        this.errors.set(configId, errMsg);
        this.registry.recordHealthCheck(configId, false, errMsg);
        this.log.warn('[inbound] Channel failed to start', { channelId: configId, type: config.type, error: errMsg });
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.errors.set(configId, msg);
      this.registry.recordHealthCheck(configId, false, msg);
      this.log.error('[inbound] Exception starting channel', { err: msg, channelId: configId });
      return { ok: false, error: msg };
    }
  }

  private isInstanceRunning(instance: AnyInbound): boolean {
    if (instance instanceof DiscordInbound) return instance.isRunning();
    if (instance instanceof TelegramInbound) return instance.isRunning();
    if (instance instanceof WhatsAppInbound) return instance.isRunning();
    return false;
  }
}
