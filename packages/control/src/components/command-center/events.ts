// Krythor Command Center — Event Definitions & Factories

import type { CCEvent, CCEventType, AgentAnimationState } from './types';

// ── Human-readable labels ─────────────────────────────────────────────────────

export const EVENT_LABELS: Record<CCEventType, string> = {
  TASK_STARTED:      'Task Started',
  TASK_COMPLETED:    'Task Completed',
  TOOL_CALLED:       'Tool Called',
  TOOL_COMPLETED:    'Tool Completed',
  MODEL_SELECTED:    'Model Selected',
  AGENT_HANDOFF:     'Agent Handoff',
  MEMORY_RETRIEVED:  'Memory Retrieved',
  ERROR:             'Error',
  RESPONSE_COMPLETE: 'Response Complete',
  AGENT_IDLE:        'Agent Idle',
  AGENT_MOVED:       'Agent Moved',
};

// ── Tailwind text-color classes per event type ────────────────────────────────

export const EVENT_COLORS: Record<CCEventType, string> = {
  TASK_STARTED:      'text-arc-400',
  TASK_COMPLETED:    'text-emerald-400',
  TOOL_CALLED:       'text-blue-400',
  TOOL_COMPLETED:    'text-blue-300',
  MODEL_SELECTED:    'text-gold-400',
  AGENT_HANDOFF:     'text-purple-400',
  MEMORY_RETRIEVED:  'text-cyan-400',
  ERROR:             'text-red-400',
  RESPONSE_COMPLETE: 'text-emerald-300',
  AGENT_IDLE:        'text-zinc-500',
  AGENT_MOVED:       'text-zinc-400',
};

// ── Agent state transitions driven by event type ──────────────────────────────

export const AGENT_STATE_TRANSITIONS: Record<CCEventType, AgentAnimationState> = {
  TASK_STARTED:      'thinking',
  TASK_COMPLETED:    'speaking',
  TOOL_CALLED:       'working',
  TOOL_COMPLETED:    'thinking',
  MODEL_SELECTED:    'listening',
  AGENT_HANDOFF:     'handoff',
  MEMORY_RETRIEVED:  'working',
  ERROR:             'error',
  RESPONSE_COMPLETE: 'speaking',
  AGENT_IDLE:        'idle',
  AGENT_MOVED:       'handoff',
};

// ── Event factory ─────────────────────────────────────────────────────────────

export function makeEvent(
  type: CCEventType,
  agentId: string,
  summary: string,
  extras?: Partial<Omit<CCEvent, 'id' | 'type' | 'agentId' | 'summary'>>
): CCEvent {
  return {
    id: crypto.randomUUID(),
    type,
    agentId,
    ts: Date.now(),
    summary,
    ...extras,
  };
}
