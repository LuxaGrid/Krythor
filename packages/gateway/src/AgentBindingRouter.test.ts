import { describe, it, expect } from 'vitest';
import { AgentBindingRouter } from './AgentBindingRouter.js';
import type { AgentBinding } from './AgentBindingRouter.js';

describe('AgentBindingRouter', () => {
  it('returns undefined when no bindings and no default', () => {
    const router = new AgentBindingRouter([]);
    expect(router.resolve('telegram', 'user1')).toBeUndefined();
  });

  it('returns defaultAgentId when no bindings match', () => {
    const router = new AgentBindingRouter([], { defaultAgentId: 'main' });
    expect(router.resolve('telegram', 'user1')).toBe('main');
  });

  it('matches channel wildcard (no fields)', () => {
    const bindings: AgentBinding[] = [{ agentId: 'catch-all', match: {} }];
    const router = new AgentBindingRouter(bindings);
    expect(router.resolve('telegram', 'anyone')).toBe('catch-all');
    expect(router.resolve('discord', 'anyone')).toBe('catch-all');
  });

  it('matches exact channel', () => {
    const bindings: AgentBinding[] = [
      { agentId: 'tg-agent', match: { channel: 'telegram' } },
      { agentId: 'dc-agent', match: { channel: 'discord' } },
    ];
    const router = new AgentBindingRouter(bindings);
    expect(router.resolve('telegram', 'user1')).toBe('tg-agent');
    expect(router.resolve('discord', 'user1')).toBe('dc-agent');
  });

  it('matches exact peerId', () => {
    const bindings: AgentBinding[] = [
      { agentId: 'vip-agent', match: { peerId: 'vip-user' } },
      { agentId: 'default-agent', match: {} },
    ];
    const router = new AgentBindingRouter(bindings);
    expect(router.resolve('telegram', 'vip-user')).toBe('vip-agent');
    expect(router.resolve('telegram', 'normal-user')).toBe('default-agent');
  });

  it('matches guildId', () => {
    const bindings: AgentBinding[] = [
      { agentId: 'work-agent', match: { channel: 'discord', guildId: 'guild-123' } },
      { agentId: 'main-agent', match: {} },
    ];
    const router = new AgentBindingRouter(bindings);
    expect(router.resolve('discord', 'user1', undefined, 'guild-123')).toBe('work-agent');
    expect(router.resolve('discord', 'user1', undefined, 'guild-456')).toBe('main-agent');
  });

  it('matches accountId', () => {
    const bindings: AgentBinding[] = [
      { agentId: 'biz-agent', match: { channel: 'telegram', accountId: 'biz' } },
      { agentId: 'personal-agent', match: { channel: 'telegram' } },
    ];
    const router = new AgentBindingRouter(bindings);
    expect(router.resolve('telegram', 'user1', 'biz')).toBe('biz-agent');
    expect(router.resolve('telegram', 'user1', 'personal')).toBe('personal-agent');
  });

  it('first match wins (order matters)', () => {
    const bindings: AgentBinding[] = [
      { agentId: 'first', match: { channel: 'telegram' } },
      { agentId: 'second', match: {} },
    ];
    const router = new AgentBindingRouter(bindings);
    expect(router.resolve('telegram', 'user1')).toBe('first');
  });

  it('AND semantics — all present fields must match', () => {
    const bindings: AgentBinding[] = [
      { agentId: 'specific', match: { channel: 'discord', peerId: 'user-x' } },
      { agentId: 'fallback', match: {} },
    ];
    const router = new AgentBindingRouter(bindings);
    // Both fields match → specific
    expect(router.resolve('discord', 'user-x')).toBe('specific');
    // Channel matches but peerId doesn't → fallback
    expect(router.resolve('discord', 'user-y')).toBe('fallback');
    // peerId matches but channel doesn't → fallback
    expect(router.resolve('telegram', 'user-x')).toBe('fallback');
  });

  it('reports size', () => {
    const router = new AgentBindingRouter([
      { agentId: 'a', match: {} },
      { agentId: 'b', match: {} },
    ]);
    expect(router.size).toBe(2);
  });

  it('returns defaultAgentId when no binding matches but default is set', () => {
    const bindings: AgentBinding[] = [
      { agentId: 'work', match: { channel: 'slack' } },
    ];
    const router = new AgentBindingRouter(bindings, { defaultAgentId: 'fallback' });
    expect(router.resolve('telegram', 'user1')).toBe('fallback');
  });
});
