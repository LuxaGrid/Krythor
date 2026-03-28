// ─── SessionRouter ────────────────────────────────────────────────────────────
//
// Centralises session key resolution and conversation lookup for all inbound
// channel handlers.
//
// All inbound handlers (Telegram, Discord, WhatsApp, Slack, Signal, etc.) call
// SessionRouter.resolveConversation() instead of maintaining their own in-memory
// senderConvMap. This makes dmScope, identityLinks, resetByType, and sendPolicy
// work uniformly across every channel.
//
// Config lives in app-config.json under the "session" key:
//   session.dmScope          — DM session grouping mode
//   session.identityLinks    — map canonical id → [provider:peerId] aliases
//   session.resetTriggers    — additional reset trigger phrases
//   session.sendPolicy       — delivery block rules
//

import type { ConversationStore } from '@krythor/memory';
import {
  SessionStore,
  resolveSessionKey,
  type DmScope,
  type ChatType,
  type SendPolicyConfig,
  type SessionEntry,
} from '@krythor/memory';

export interface SessionConfig {
  dmScope?: DmScope;
  identityLinks?: Record<string, string[]>;
  resetTriggers?: string[];
  sendPolicy?: SendPolicyConfig;
}

export interface ResolvedSession {
  sessionKey: string;
  conversationId: string;
  isNew: boolean;
  entry: SessionEntry;
}

export class SessionRouter {
  constructor(
    private readonly sessionStore: SessionStore,
    private readonly convStore: ConversationStore,
    private readonly config: SessionConfig = {},
  ) {}

  /**
   * Resolve (or create) a session for an inbound message.
   * Returns the session key and conversation ID to use.
   */
  resolveConversation(params: {
    agentId: string;
    channel: string;
    chatType: ChatType;
    peerId?: string;
    groupId?: string;
    accountId?: string;
    displayName?: string;
  }): ResolvedSession {
    const { agentId, channel, chatType, peerId, groupId, accountId, displayName } = params;

    const sessionKey = resolveSessionKey({
      agentId,
      channel,
      chatType,
      peerId,
      groupId,
      accountId,
      dmScope: this.config.dmScope ?? 'main',
      identityLinks: this.config.identityLinks ?? {},
    });

    const existing = this.sessionStore.getByKey(sessionKey);

    if (existing) {
      this.sessionStore.touch(sessionKey);
      return { sessionKey, conversationId: existing.conversationId, isNew: false, entry: existing };
    }

    // Create a new conversation and session entry
    const conv = this.convStore.createConversation(agentId);
    const entry = this.sessionStore.upsert({
      sessionKey,
      conversationId: conv.id,
      agentId,
      channel,
      chatType,
      peerId: peerId ?? null,
      accountId: accountId ?? null,
      displayName: displayName ?? null,
      lastChannel: channel,
      lastTo: null,
      sendPolicy: null,
      modelOverride: null,
      originLabel: displayName ?? null,
    });

    return { sessionKey, conversationId: conv.id, isNew: true, entry };
  }

  /**
   * Reset a session: unlink the session key from its conversation ID.
   * Next message will create a new conversation.
   */
  resetSession(sessionKey: string, agentId: string): string {
    const conv = this.convStore.createConversation(agentId);
    const existing = this.sessionStore.getByKey(sessionKey);
    if (existing) {
      this.sessionStore.upsert({
        ...existing,
        conversationId: conv.id,
      });
    }
    return conv.id;
  }

  /**
   * Check whether a reset trigger was hit.
   */
  isResetTrigger(text: string): boolean {
    const triggers = ['/new', '/reset', ...(this.config.resetTriggers ?? [])];
    const lower = text.trim().toLowerCase();
    return triggers.some(t => lower === t.toLowerCase());
  }

  /**
   * Evaluate send policy for a session entry.
   */
  isSendAllowed(entry: SessionEntry): boolean {
    return SessionStore.evaluateSendPolicy(entry, this.config.sendPolicy) === 'allow';
  }

  /**
   * Update the send policy override for a session (from /send on|off|inherit).
   */
  setSendPolicy(sessionKey: string, policy: 'allow' | 'deny' | null): void {
    this.sessionStore.setSendPolicy(sessionKey, policy);
  }

  /**
   * Get current config (for reload support).
   */
  getConfig(): SessionConfig {
    return this.config;
  }

  /**
   * Get the session entry for a session key (null if not found).
   */
  getSessionEntry(sessionKey: string): import('@krythor/memory').SessionEntry | null {
    return this.sessionStore.getByKey(sessionKey) ?? null;
  }

  /**
   * Return a new SessionRouter with updated config (for hot reload).
   */
  withConfig(config: SessionConfig): SessionRouter {
    return new SessionRouter(this.sessionStore, this.convStore, config);
  }
}
